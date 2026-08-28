"""ElevenLabs per-sentence streaming TTS with lookahead and strictly ordered relay.

Each sentence gets its own HTTP stream (model eleven_flash_v2_5, raw PCM output).
Up to `lookahead` sentences synthesize concurrently to hide time-to-first-byte, but
audio is relayed to the client strictly in sentence order. A failed sentence emits
`audio_failed` so the client reveals its text immediately and playback continues.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

import httpx

from ..config import Settings
from ..credits import consume_tts

log = logging.getLogger("tts")

_DONE = object()
_FAILED = object()
_CLOSE = -1

EmitJson = Callable[[dict], None]
EmitBytes = Callable[[int, bytes], None]


class TtsRelay:
    def __init__(
        self,
        settings: Settings,
        gen: int,
        emit_json: EmitJson,
        emit_bytes: EmitBytes,
        output_format: str | None = None,
        sample_rate: int | None = None,
        voice_id: str | None = None,
    ):
        self.settings = settings
        self.gen = gen
        self.emit_json = emit_json
        self.emit_bytes = emit_bytes
        self.output_format = output_format or settings.tts_output_format
        self.sample_rate = sample_rate or settings.tts_sample_rate
        self.voice_id = voice_id or settings.elevenlabs_voice_id
        self.queues: dict[int, asyncio.Queue] = {}
        self.order: asyncio.Queue[int] = asyncio.Queue()
        self.sem = asyncio.Semaphore(max(1, settings.tts_lookahead))
        self.fetch_tasks: list[asyncio.Task] = []
        self.prev_text: str | None = None
        self.relay_task = asyncio.create_task(self._relay())
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))

    def submit(self, seq: int, text: str) -> None:
        """Submit a sentence for TTS synthesis with the given sequence number."""
        queue: asyncio.Queue = asyncio.Queue()
        self.queues[seq] = queue
        self.order.put_nowait(seq)
        prev = self.prev_text
        self.prev_text = text
        self.fetch_tasks.append(asyncio.create_task(self._fetch(seq, text, prev, queue)))

    async def _fetch(self, seq: int, text: str, prev: str | None, queue: asyncio.Queue) -> None:
        """Fetch TTS audio for a sentence with retries, streaming chunks to the queue."""
        try:
            async with self.sem:
                if not self.settings.elevenlabs_api_key:
                    queue.put_nowait(_FAILED)
                    return
                for attempt in (0, 1):
                    try:
                        await self._stream_once(text, prev, queue)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        log.warning("TTS seq=%s attempt=%s failed: %s", seq, attempt, exc)
                        await asyncio.sleep(0.4)
                        continue
                    queue.put_nowait(_DONE)
                    # meter only what actually synthesized (failures are free) —
                    # outside the retry path, so an accounting hiccup can never
                    # trigger a second synthesis or double-queue audio
                    await consume_tts(len(text))
                    return
                queue.put_nowait(_FAILED)
        except asyncio.CancelledError:
            queue.put_nowait(_FAILED)
            raise
        except Exception:
            queue.put_nowait(_FAILED)

    async def _stream_once(self, text: str, prev: str | None, queue: asyncio.Queue) -> None:
        """Stream PCM audio from ElevenLabs for one sentence, pushing chunks to the queue."""
        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/"
            f"{self.voice_id}/stream"
            f"?output_format={self.output_format}"
        )
        body: dict = {"text": text, "model_id": self.settings.elevenlabs_model}
        if prev:
            body["previous_text"] = prev
        async with self.http.stream(
            "POST", url, json=body, headers={"xi-api-key": self.settings.elevenlabs_api_key}
        ) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread())[:200]
                raise RuntimeError(f"elevenlabs {resp.status_code}: {detail!r}")
            async for chunk in resp.aiter_bytes(chunk_size=16384):
                if chunk:
                    queue.put_nowait(chunk)

    async def _relay(self) -> None:
        """Relay TTS audio chunks to the client in strict sequence order."""
        while True:
            seq = await self.order.get()
            if seq == _CLOSE:
                return
            queue = self.queues.pop(seq)
            first = await queue.get()
            if first is _FAILED:
                self.emit_json({"type": "audio_failed", "seq": seq})
                continue
            self.emit_json(
                {
                    "type": "audio_start",
                    "seq": seq,
                    "format": "pcm_s16le",
                    "sample_rate": self.sample_rate,
                }
            )
            item = first
            while item is not _DONE and item is not _FAILED:
                self.emit_bytes(seq, item)
                item = await queue.get()
            self.emit_json({"type": "audio_end", "seq": seq})

    async def close(self) -> None:
        """Wait until every submitted sentence has been fully relayed, then clean up."""
        self.order.put_nowait(_CLOSE)
        try:
            await self.relay_task
        finally:
            await self.http.aclose()

    def abort(self) -> None:
        """Cancel all pending TTS tasks immediately without waiting for cleanup."""
        for task in self.fetch_tasks:
            task.cancel()
        self.relay_task.cancel()
        asyncio.get_running_loop().create_task(self.http.aclose())
