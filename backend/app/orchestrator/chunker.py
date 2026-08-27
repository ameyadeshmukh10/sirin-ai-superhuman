"""Splits a streamed token feed into speakable sentences.

Constraints that shape this code:
- TTS latency: emit the first sentence as early as possible.
- TTS quality: fragments under ~25 chars sound choppy — merge them into the next sentence.
- Very long sentences (> ~300 chars) are split at a clause boundary so audio starts sooner.
- The model is prompted for plain prose, but markdown occasionally slips through — sanitize.
"""

from __future__ import annotations

import re

_MD_CHARS = re.compile(r"[*_#`~]|^\s*[-•]\s+", re.MULTILINE)
_WS = re.compile(r"\s+")

# lowercase tokens that end with '.' but don't end a sentence
_ABBREVIATIONS = {
    "e.g.", "i.e.", "etc.", "vs.", "dr.", "mr.", "mrs.", "ms.", "st.",
    "inc.", "co.", "corp.", "no.", "approx.", "dept.", "est.", "min.", "max.",
}

MIN_LEN = 25
MAX_LEN = 300


def sanitize(text: str) -> str:
    """Remove markdown formatting and collapse whitespace to prepare text for TTS."""
    return _WS.sub(" ", _MD_CHARS.sub("", text)).strip()


class SentenceChunker:
    def __init__(self) -> None:
        self._buf = ""

    def feed(self, delta: str) -> list[str]:
        """Process incoming text tokens and emit complete sentences ready for TTS."""
        self._buf += delta
        out: list[str] = []
        while True:
            cut = self._find_boundary(self._buf)
            if cut is None:
                break
            sentence, self._buf = self._buf[:cut], self._buf[cut:]
            cleaned = sanitize(sentence)
            if cleaned:
                out.append(cleaned)
        return out

    def flush(self) -> str | None:
        """Return any remaining buffered text as a final sentence, or None if empty."""
        cleaned = sanitize(self._buf)
        self._buf = ""
        return cleaned or None

    def _find_boundary(self, text: str) -> int | None:
        """Find the next sentence boundary position, or None if buffering more text is needed."""
        for i, ch in enumerate(text):
            if ch not in ".!?":
                continue
            # need a following space/newline to be sure the sentence is complete
            if i + 1 >= len(text) or not text[i + 1].isspace():
                continue
            if ch == "." and self._is_non_terminal_period(text, i):
                continue
            if i + 1 < MIN_LEN:
                continue  # too short — merge into the next sentence
            return i + 1

        if len(text) > MAX_LEN:
            # no sentence end in sight — split at the last clause boundary
            window = text[:MAX_LEN]
            for sep in (", ", "; ", " "):
                pos = window.rfind(sep)
                if pos > MIN_LEN:
                    return pos + len(sep)
            return MAX_LEN
        return None

    @staticmethod
    def _is_non_terminal_period(text: str, i: int) -> bool:
        """Check if a period at position i is part of an abbreviation or decimal, not a sentence end."""
        # decimal number: "4.5 million"
        if i > 0 and text[i - 1].isdigit() and i + 2 < len(text) and text[i + 2].isdigit():
            return True
        start = text.rfind(" ", 0, i) + 1
        word = text[start : i + 1].lower()
        return word in _ABBREVIATIONS
