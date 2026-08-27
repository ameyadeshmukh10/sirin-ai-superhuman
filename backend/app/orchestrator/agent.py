"""SessionRunner: one instance per WebSocket connection.

Owns the generation counter (interrupt safety), a single outbound writer task
(never write to the WS from two tasks), and at most one in-flight turn task.

Turn flow: Claude token stream -> SentenceChunker -> per sentence: emit `sentence`
event + submit to the TTS relay. Tool_use blocks resolve to UI events that share the
same seq ordering. Continuation requests (tool_result) stay within the same gen.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import uuid

from anthropic import AsyncAnthropic
from fastapi import WebSocket, WebSocketDisconnect

from ..config import Settings
from ..services.liveavatar import LiveAvatarLink
from ..services.tts import TtsRelay
from . import tools as tools_mod
from .chunker import SentenceChunker
from .prompt import build_system_prompt

log = logging.getLogger("agent")

FALLBACK_REPLY = (
    "I'm having trouble reaching my brain right now. Give me a moment and try again, "
    "or use the Book a Meeting button to reach a human."
)

NUDGE_INSTRUCTION = (
    "[The visitor started to speak and cut you off, but then went quiet. In one "
    "short warm sentence, hand them the floor. Do not repeat or resume your "
    "previous point, do not show any content, and do not ask more than one thing.]"
)


async def resolve_avatar_id(store, settings) -> str | None:
    """The avatar for new sessions: settings-view selection, else the
    HEYGEN_AVATAR_ID env default. None (or no API key) means audio-only."""
    override = await store.get_override("avatar") or {}
    selected = override.get("avatar_id")
    avatar_id = selected if isinstance(selected, str) and selected else settings.heygen_avatar_id
    return avatar_id if settings.heygen_api_key and avatar_id else None


class _Seq:
    """Shared ordering counter for sentences and UI actions within one turn."""

    def __init__(self) -> None:
        self.value = 0

    def next(self) -> int:
        self.value += 1
        return self.value


class _PaceBuffer:
    """Seq-keyed timeline items for the avatar pacer. Producers insert out of
    order (TTS completions lag tool executions); the pacer consumes strictly
    in seq order."""

    def __init__(self) -> None:
        self.items: dict[int, tuple] = {}
        self.changed = asyncio.Event()

    def put(self, seq: int, item: tuple) -> None:
        self.items[seq] = item
        self.changed.set()

    async def get(self, seq: int) -> tuple:
        while seq not in self.items:
            self.changed.clear()
            await self.changed.wait()
        return self.items.pop(seq)


class SessionRunner:
    def __init__(self, ws: WebSocket, session: dict, persona: dict, store, settings: Settings):
        self.ws = ws
        self.session = session
        self.persona = persona
        self.store = store
        self.settings = settings
        self.gen = 0
        self.turn_task: asyncio.Task | None = None
        self.out_q: asyncio.Queue = asyncio.Queue()
        self.writer_task: asyncio.Task | None = None
        self.claude = (
            AsyncAnthropic(api_key=settings.anthropic_api_key)
            if settings.anthropic_api_key
            else None
        )
        self.content_items: list[dict] = []
        self.gtm_override: str | None = None
        self.avatar_id: str | None = None
        self._last_user_text: tuple[str, float] | None = None
        self.avatar: LiveAvatarLink | None = None
        self._pace_task: asyncio.Task | None = None
        self._pace_buffer: "_PaceBuffer | None" = None
        self._nudge_task: asyncio.Task | None = None
        self.current_deck_id: str | None = None  # last deck shown; scripts go_to_slide
        self._avatar_restarts = 0

    # ---------- outbound ----------

    def emit(self, event: dict, gen: int) -> None:
        self.out_q.put_nowait(("json", json.dumps({**event, "gen": gen})))

    def emit_bytes(self, gen: int, seq: int, chunk: bytes) -> None:
        self.out_q.put_nowait(("bytes", struct.pack(">II", gen, seq) + chunk))

    async def _writer(self) -> None:
        while True:
            kind, payload = await self.out_q.get()
            if kind == "json":
                await self.ws.send_text(payload)
            else:
                await self.ws.send_bytes(payload)

    # ---------- lifecycle ----------

    async def run(self) -> None:
        self.writer_task = asyncio.create_task(self._writer())
        self.content_items = await self.store.list_content_items()
        self.gtm_override = ((await self.store.get_override("gtm")) or {}).get("text")
        self.avatar_id = await resolve_avatar_id(self.store, self.settings)

        if self.avatar_id:
            self.avatar = await LiveAvatarLink.create(self.settings, self.avatar_id)
            if self.avatar:
                self.emit(
                    {
                        "type": "avatar",
                        "url": self.avatar.livekit_url,
                        "token": self.avatar.client_token,
                    },
                    self.gen,
                )

        history = await self.store.get_messages(self.session["_id"])
        if not history:
            await self._start_turn(self._greeting_turn)
        else:
            self.emit({"type": "state", "status": "idle"}, self.gen)

        try:
            while True:
                raw = await self.ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._dispatch(msg)
        except WebSocketDisconnect:
            pass
        finally:
            await self._cancel_turn(emit_event=False)
            if self.avatar:
                await self.avatar.close()  # bills per minute — never leave running
            if self.writer_task:
                self.writer_task.cancel()

    async def _dispatch(self, msg: dict) -> None:
        mtype = msg.get("type")
        if mtype == "ping":
            self.emit({"type": "pong"}, self.gen)
        elif mtype == "user_message":
            text = str(msg.get("text", "")).strip()[:2000]
            source = msg.get("source", "typed")
            if not text or self._is_duplicate(text):
                return
            await self.store.add_event(self.session["_id"], "user_message", {"source": source})
            await self._start_turn(lambda gen: self._assistant_turn(gen, text, source))
        elif mtype == "interrupt":
            # ack unconditionally: `interrupted` means "any prior gen is dead",
            # which is safe (and idempotent) even when no turn was running
            await self._cancel_turn(emit_event=False)
            self.emit({"type": "interrupted"}, self.gen)
            self.emit({"type": "state", "status": "idle"}, self.gen)
            await self.store.add_event(self.session["_id"], "interrupt")
            if msg.get("source") == "voice":
                # The visitor started talking over the persona. If their sentence
                # never materializes, hand them the floor instead of dead air.
                self._schedule_nudge()
        elif mtype == "analytics":
            await self.store.add_event(
                self.session["_id"], str(msg.get("name", "unknown"))[:64], msg.get("props") or {}
            )
        elif mtype == "end_session":
            await self._cancel_turn(emit_event=False)
            await self.store.set_session_status(self.session["_id"], "ended")
            await self.store.add_event(self.session["_id"], "session_end")
            await self.ws.close()

    def _is_duplicate(self, text: str) -> bool:
        now = asyncio.get_running_loop().time()
        if (
            self._last_user_text
            and self._last_user_text[0] == text
            and now - self._last_user_text[1] < 1.5
        ):
            return True
        self._last_user_text = (text, now)
        return False

    async def _start_turn(self, turn_factory) -> None:
        await self._cancel_turn(emit_event=True)
        gen = self.gen
        self.turn_task = asyncio.create_task(self._run_guarded(turn_factory, gen))

    async def _run_guarded(self, turn_factory, gen: int) -> None:
        try:
            await turn_factory(gen)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("turn failed")
            self._end_pace()
            self.emit(
                {"type": "error", "code": "turn_failed", "message": "turn failed", "fatal": False},
                gen,
            )
            self.emit({"type": "state", "status": "idle"}, gen)

    async def _cancel_turn(self, emit_event: bool) -> None:
        if self._nudge_task and not self._nudge_task.done():
            self._nudge_task.cancel()
        task, self.turn_task = self.turn_task, None
        active = task is not None and not task.done()
        self.gen += 1
        if self.avatar:
            # Always clear avatar-side buffered speech: the turn task can be done
            # while the avatar is still speaking what it buffered (it plays in
            # real time; we push faster than real time).
            self.avatar.interrupt()
        if self._pace_task and not self._pace_task.done():
            self._pace_task.cancel()
        self._pace_buffer = None
        if active:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            if emit_event:
                self.emit({"type": "interrupted"}, self.gen)
                await self.store.add_event(self.session["_id"], "interrupt")

    def _schedule_nudge(self) -> None:
        """After a voice barge-in that trails into silence, invite the visitor
        to go ahead — a great rep doesn't sit in dead air."""
        if self._nudge_task and not self._nudge_task.done():
            self._nudge_task.cancel()
        gen_at = self.gen

        async def _nudge() -> None:
            await asyncio.sleep(7.0)
            if self.gen != gen_at:
                return  # a real message or another interrupt arrived meanwhile
            if self.turn_task and not self.turn_task.done():
                return
            self._nudge_task = None  # _start_turn cancels pending nudges; not us
            await self._start_turn(
                lambda g: self._assistant_turn(g, NUDGE_INSTRUCTION, "nudge")
            )

        self._nudge_task = asyncio.create_task(_nudge())

    async def _ensure_avatar(self, gen: int) -> None:
        """Keep the avatar alive across LiveAvatar's per-session duration cap.

        At each turn boundary: rotate the session preemptively when it's close
        to the cap (so it never dies mid-sentence), restart it if it died
        anyway, and degrade to audio-only when restarts keep failing fast."""
        if self.avatar is None:
            return
        rotate_margin = max(60.0, self.settings.heygen_max_session_secs - 90.0)
        if self.avatar.closed:
            # long-lived links dying is just the cap — restarts stay available;
            # links dying young (bad key, no credits) burn the single retry
            if self.avatar.age > 120:
                self._avatar_restarts = 0
        elif self.avatar.age >= rotate_margin:
            log.info("avatar session near duration cap — rotating")
            self._avatar_restarts = 0
        else:
            return
        old, self.avatar = self.avatar, None
        await old.close(reason="UNKNOWN")
        if self._avatar_restarts < 1:
            self._avatar_restarts += 1
            self.avatar = await LiveAvatarLink.create(self.settings, self.avatar_id)
        if self.avatar:
            self.emit(
                {
                    "type": "avatar",
                    "url": self.avatar.livekit_url,
                    "token": self.avatar.client_token,
                },
                gen,
            )
        else:
            log.info("avatar unavailable — continuing audio-only")
            self.emit({"type": "avatar_ended"}, gen)

    # ---------- turns ----------

    def _new_relay(self, gen: int, seq: "_Seq") -> TtsRelay:
        if self.avatar:
            # Avatar mode: ordered PCM goes to LiveAvatar (which lip-syncs and
            # carries the audio in its WebRTC stream) instead of the browser.
            # LiveAvatar buffers our push into one continuous task, so the pacer
            # below is the single conductor for the turn: it walks the seq
            # timeline in order — sentences (exact PCM durations), failures, and
            # UI actions — so a slide flip executes only after the sentence
            # before it has fully finished playing, never at its start.
            bytes_per_sec = self.settings.avatar_tts_sample_rate * 2
            counts: dict[int, int] = {}
            buffer = _PaceBuffer()
            anchor = asyncio.Event()
            self.avatar.on_playback_started = anchor.set
            self._pace_buffer = buffer
            self._pace_task = asyncio.create_task(self._pace(gen, seq, buffer, anchor))

            def emit_json(event: dict) -> None:
                if event["type"] == "audio_start":
                    counts[event["seq"]] = 0
                elif event["type"] == "audio_end":
                    n = event["seq"]
                    buffer.put(n, ("sentence", counts.pop(n, 0) / bytes_per_sec))
                elif event["type"] == "audio_failed":
                    buffer.put(event["seq"], ("failed", event))

            def emit_bytes(n: int, chunk: bytes) -> None:
                counts[n] = counts.get(n, 0) + len(chunk)
                self.avatar.push_audio(chunk)

            return TtsRelay(
                self.settings,
                gen,
                emit_json,
                emit_bytes,
                output_format=self.settings.avatar_tts_output_format,
                sample_rate=self.settings.avatar_tts_sample_rate,
            )
        self._pace_buffer = None
        return TtsRelay(
            self.settings,
            gen,
            lambda event: self.emit(event, gen),
            lambda n, chunk: self.emit_bytes(gen, n, chunk),
        )

    def _emit_action(self, ui_event: dict, gen: int, n: int) -> None:
        """UI actions ride the pacer timeline in avatar mode (so they land at
        sentence boundaries); in audio-only mode they emit immediately and the
        client's reveal gating orders them."""
        full = {**ui_event, "seq": n}
        if self._pace_buffer is not None:
            self._pace_buffer.put(n, ("action", full))
        else:
            self.emit(full, gen)

    async def _pace(self, gen: int, seq: "_Seq", buffer: "_PaceBuffer", anchor: asyncio.Event) -> None:
        """Walk the turn's timeline in seq order, in step with avatar playback."""
        try:
            await asyncio.wait_for(anchor.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            pass  # anchor never came — pace from now; client fallbacks also apply
        expected, last_seq = 1, 0
        while True:
            kind, payload = await buffer.get(expected)
            expected += 1
            if kind == "end":
                break
            if kind == "sentence":
                last_seq = expected - 1
                self.emit({"type": "speak_started", "seq": last_seq}, gen)
                await asyncio.sleep(payload)
            elif kind in ("failed", "action"):
                self.emit(payload, gen)
        self.emit({"type": "speak_ended", "seq": last_seq}, gen)

    def _end_pace(self, seq: "_Seq | None" = None) -> None:
        """Close out the current turn's pacing timeline."""
        if self._pace_buffer is None:
            return
        if seq is not None:
            self._pace_buffer.put(seq.next(), ("end", None))
        else:
            # turn died mid-way: stop pacing and release the client's playing flag
            if self._pace_task and not self._pace_task.done():
                self._pace_task.cancel()
            self.emit({"type": "speak_ended", "seq": 0}, self.gen)

    async def _greeting_turn(self, gen: int) -> None:
        """Scripted opener: straight to TTS, no LLM call — instant and cheap."""
        seq = _Seq()
        relay = self._new_relay(gen, seq)
        sentences: list[str] = []
        try:
            self.emit({"type": "state", "status": "speaking"}, gen)
            self.emit({"type": "assistant_start", "message_id": uuid.uuid4().hex}, gen)
            chunker = SentenceChunker()
            parts = chunker.feed(self.persona["greeting"] + " ")
            tail = chunker.flush()
            if tail:
                parts.append(tail)
            for part in parts:
                n = seq.next()
                sentences.append(part)
                self.emit({"type": "sentence", "seq": n, "text": part}, gen)
                relay.submit(n, part)
            self._emit_action(
                {"type": "suggested_topics", "topics": self.persona["default_topics"]},
                gen,
                seq.next(),
            )
            await relay.close()
            self._end_pace(seq)
            self.emit({"type": "assistant_end", "stop_reason": "end_turn"}, gen)
            self.emit({"type": "state", "status": "idle"}, gen)
            await self.store.add_message(
                self.session["_id"],
                {"role": "assistant", "text": " ".join(sentences), "source": "greeting"},
            )
        except asyncio.CancelledError:
            relay.abort()
            await self._persist_partial(sentences)
            raise

    async def _assistant_turn(self, gen: int, user_text: str, source: str) -> None:
        if source != "nudge":
            # nudge instructions are one-shot steering — never part of history
            await self.store.add_message(
                self.session["_id"], {"role": "user", "text": user_text, "source": source}
            )
        self.emit({"type": "state", "status": "thinking"}, gen)
        await self._ensure_avatar(gen)

        seq = _Seq()
        relay = self._new_relay(gen, seq)
        sentences: list[str] = []
        started = False

        def dispatch_sentence(text: str) -> None:
            nonlocal started
            if not started:
                self.emit({"type": "assistant_start", "message_id": uuid.uuid4().hex}, gen)
                self.emit({"type": "state", "status": "speaking"}, gen)
                started = True
            n = seq.next()
            sentences.append(text)
            self.emit({"type": "sentence", "seq": n, "text": text}, gen)
            relay.submit(n, text)

        try:
            if self.claude is None:
                dispatch_sentence(FALLBACK_REPLY)
                stop_reason = "end_turn"
            else:
                stop_reason = await self._claude_loop(gen, user_text, dispatch_sentence, seq)
            await relay.close()
            self._end_pace(seq)
            self.emit({"type": "assistant_end", "stop_reason": stop_reason or "end_turn"}, gen)
            self.emit({"type": "state", "status": "idle"}, gen)
            await self.store.add_message(
                self.session["_id"],
                {"role": "assistant", "text": " ".join(sentences), "source": "llm"},
            )
        except asyncio.CancelledError:
            relay.abort()
            await self._persist_partial(sentences)
            raise

    async def _claude_loop(self, gen: int, user_text: str, dispatch_sentence, seq: _Seq) -> str:
        """Stream from Claude, handling tool-use continuations within the same gen."""
        history = await self._build_history()
        messages = history + [{"role": "user", "content": user_text}]
        system = build_system_prompt(self.persona, self.content_items, self.gtm_override)
        stop_reason = "end_turn"

        for _round in range(12):  # cap on tool-use continuations (walkthroughs use ~1/slide)
            chunker = SentenceChunker()
            async with self.claude.messages.stream(
                model=self.settings.anthropic_model,
                max_tokens=self.settings.anthropic_max_tokens,
                system=system,
                messages=messages,
                tools=tools_mod.TOOL_DEFINITIONS,
                thinking={"type": "disabled"},
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        for sentence in chunker.feed(event.delta.text):
                            dispatch_sentence(sentence)
                    elif event.type == "content_block_stop":
                        # flush before a possible tool block so slides never precede
                        # the sentence that introduces them
                        tail = chunker.flush()
                        if tail:
                            dispatch_sentence(tail)
                final = await stream.get_final_message()

            stop_reason = final.stop_reason or "end_turn"
            if stop_reason != "tool_use":
                break

            messages.append({"role": "assistant", "content": final.content})
            tool_results = []
            for block in final.content:
                if block.type != "tool_use":
                    continue
                ui_event, result, speech = tools_mod.execute(
                    block.name, block.input, self.content_items, self.current_deck_id
                )
                if ui_event and ui_event["type"] == "show_slides":
                    self.current_deck_id = ui_event["deck_id"]
                if ui_event:
                    self._emit_action(ui_event, gen, seq.next())
                    await self.store.add_event(
                        self.session["_id"], ui_event["type"], {"tool": block.name}
                    )
                if speech:
                    # Deterministic walkthrough narration: the presenter notes are
                    # spoken verbatim server-side, sentence by sentence, riding the
                    # same seq spine — so TTS/avatar pacing and slide flips hold.
                    script_chunker = SentenceChunker()
                    for sent in script_chunker.feed(speech):
                        dispatch_sentence(sent)
                    tail = script_chunker.flush()
                    if tail:
                        dispatch_sentence(tail)
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result}
                )
            messages.append({"role": "user", "content": tool_results})
        return stop_reason

    async def _build_history(self) -> list[dict]:
        docs = await self.store.get_messages(self.session["_id"])
        messages: list[dict] = []
        for doc in docs[-30:]:
            text = doc.get("text", "")
            if not text:
                continue
            if doc.get("interrupted"):
                text += " [user interrupted]"
            messages.append({"role": doc["role"], "content": text})
        return messages

    async def _persist_partial(self, sentences: list[str]) -> None:
        if sentences:
            await self.store.add_message(
                self.session["_id"],
                {"role": "assistant", "text": " ".join(sentences), "interrupted": True},
            )
