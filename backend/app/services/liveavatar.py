"""HeyGen LiveAvatar LITE-mode bridge.

Flow (docs.liveavatar.com): POST /v1/sessions/token (X-API-KEY, mode LITE) ->
POST /v1/sessions/start (Bearer session token) -> the browser joins the returned
LiveKit room for lip-synced video while this process connects the returned ws_url
and streams the same ElevenLabs PCM the audio-only mode would have played in the
browser (16-bit 24 kHz, base64, <=1MB per packet). `agent.interrupt` clears
everything buffered avatar-side, mirroring our gen-bump interrupt.

Caption sync: LiveAvatar buffers pushed audio into one continuous task and does
NOT echo per-packet event ids — it emits a single agent.speak_started when
playback begins. We surface that via on_playback_started; the SessionRunner then
paces per-sentence caption reveals itself using each utterance's exact PCM
duration (verified against the live API 2026-07-23).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from typing import Callable

import httpx
import websockets

log = logging.getLogger("liveavatar")

CONNECTED_TIMEOUT = 12.0
KEEPALIVE_INTERVAL = 60.0


class LiveAvatarLink:
    def __init__(self, settings, avatar_id: str | None = None):
        self.settings = settings
        # settings view selection wins; HEYGEN_AVATAR_ID env is the fallback
        self.avatar_id = avatar_id or settings.heygen_avatar_id
        self.session_id: str | None = None
        self.session_token: str | None = None
        self.livekit_url: str | None = None
        self.client_token: str | None = None
        self.ws = None
        self.on_playback_started: Callable[[], None] = lambda: None
        self._out_q: asyncio.Queue = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._connected = asyncio.Event()
        self._closed = False
        self.started_at = time.monotonic()

    @classmethod
    async def create(cls, settings, avatar_id: str | None = None) -> "LiveAvatarLink | None":
        """Create + start a LITE session and connect its command socket.

        Returns None on any failure; callers fall back to audio-only mode."""
        link = cls(settings, avatar_id)
        try:
            await link._start()
            log.info("LiveAvatar session %s started", link.session_id)
            return link
        except Exception as exc:
            log.warning("LiveAvatar unavailable, falling back to audio-only: %s", exc)
            await link.close(reason="UNKNOWN")
            return None

    async def _start(self) -> None:
        base = self.settings.liveavatar_api_base
        async with httpx.AsyncClient(timeout=20.0) as http:
            resp = await http.post(
                f"{base}/v1/sessions/token",
                headers={"X-API-KEY": self.settings.heygen_api_key},
                json={
                    "mode": "LITE",
                    "avatar_id": self.avatar_id,
                    "is_sandbox": self.settings.heygen_sandbox,
                    "max_session_duration": self.settings.heygen_max_session_secs,
                },
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            self.session_id = data["session_id"]
            self.session_token = data["session_token"]

            resp = await http.post(
                f"{base}/v1/sessions/start",
                headers={"Authorization": f"Bearer {self.session_token}"},
                json={},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            self.livekit_url = data["livekit_url"]
            self.client_token = data["livekit_client_token"]
            ws_url = data.get("ws_url")
            if not ws_url:
                raise RuntimeError("start response had no ws_url")

        self.ws = await websockets.connect(ws_url, max_size=None)
        self._tasks = [
            asyncio.create_task(self._reader()),
            asyncio.create_task(self._sender()),
            asyncio.create_task(self._keepalive()),
        ]
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=CONNECTED_TIMEOUT)
        except asyncio.TimeoutError:
            # Not fatal: some deployments only emit state once media flows.
            log.info("no state=connected within %ss; continuing", CONNECTED_TIMEOUT)

    # ---------- outbound (single sender preserves relay ordering) ----------

    def push_audio(self, pcm: bytes) -> None:
        """Queue one PCM chunk (24 kHz s16le mono, base64-encoded on send)."""
        self._out_q.put_nowait(
            {"type": "agent.speak", "audio": base64.b64encode(pcm).decode()}
        )

    def interrupt(self) -> None:
        """Drop any unsent audio, then clear everything buffered avatar-side."""
        while not self._out_q.empty():
            try:
                self._out_q.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._out_q.put_nowait({"type": "agent.interrupt", "event_id": uuid.uuid4().hex})

    async def _sender(self) -> None:
        while True:
            packet = await self._out_q.get()
            if self.ws is None or self._closed:
                continue
            try:
                await self.ws.send(json.dumps(packet))
            except Exception as exc:
                log.warning("send failed, avatar link degraded: %s", exc)
                self._closed = True

    async def _keepalive(self) -> None:
        while True:
            await asyncio.sleep(KEEPALIVE_INTERVAL)
            self._out_q.put_nowait({"type": "session.keep_alive", "event_id": uuid.uuid4().hex})

    # ---------- inbound ----------

    async def _reader(self) -> None:
        try:
            async for raw in self.ws:
                try:
                    ev = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                etype = ev.get("type")
                log.debug("inbound %s: %s", etype, str(ev)[:300])
                if etype == "session.state_updated":
                    state = ev.get("state")
                    if state == "connected":
                        self._connected.set()
                    elif state in ("closing", "closed"):
                        log.info("LiveAvatar session %s reported state=%s", self.session_id, state)
                        self._closed = True
                elif etype == "agent.speak_started":
                    self.on_playback_started()
        except Exception:
            pass

    @property
    def closed(self) -> bool:
        """True once the LiveAvatar side is gone (duration cap, credits, drop)."""
        return self._closed or self.ws is None

    @property
    def age(self) -> float:
        return time.monotonic() - self.started_at

    # ---------- teardown ----------

    async def close(self, reason: str = "USER_CLOSED") -> None:
        """Stop the LiveAvatar session promptly — it bills per minute."""
        self._closed = True
        for task in self._tasks:
            task.cancel()
        self._tasks = []
        if self.ws is not None:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None
        if self.session_id:
            try:
                async with httpx.AsyncClient(timeout=10.0) as http:
                    await http.post(
                        f"{self.settings.liveavatar_api_base}/v1/sessions/stop",
                        headers={"X-API-KEY": self.settings.heygen_api_key},
                        json={"session_id": self.session_id, "reason": reason},
                    )
            except Exception as exc:
                log.warning("session stop failed (may idle out on its own): %s", exc)
            self.session_id = None
