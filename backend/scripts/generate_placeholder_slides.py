"""Generate placeholder slide PNGs into backend/content/slides/.

Run: uv run python scripts/generate_placeholder_slides.py
Replace the output with real deck exports when available.

Data-driven on purpose: the palette is parsed from the frontend theme
(frontend/src/index.css @theme block) and the deck set is validated against
app.seed_data.SLIDE_DECKS, so a rebrand only edits DECKS below — colors, footer
text, and deck sync come from the single sources of truth. Each deck's dir is
cleared before rendering and unknown deck dirs are removed, so no slides from a
previous brand can survive a regeneration.

WARNING: running this overwrites everything under content/slides/, including
real (non-placeholder) deck exports. Only run it when placeholders are wanted.
"""

import re
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.seed_data import PERSONA, SLIDE_DECKS  # noqa: E402

CONTENT = BACKEND / "content"
INDEX_CSS = BACKEND.parent / "frontend" / "src" / "index.css"


def _palette() -> dict[str, tuple[int, int, int]]:
    css = INDEX_CSS.read_text()
    colors = {}
    for name, hexval in re.findall(r"--color-([\w-]+):\s*(#[0-9a-fA-F]{6,8})", css):
        colors[name] = tuple(int(hexval[i : i + 2], 16) for i in (1, 3, 5))
    missing = {"ink", "panel", "line", "accent", "body", "muted"} - set(colors)
    assert not missing, f"index.css @theme is missing color tokens: {missing}"
    return colors


PAL = _palette()
BG = PAL["ink"]
CARD = PAL["panel"]
OUTLINE = PAL["line"]
ACCENT = PAL["accent"]
TEXT = PAL["body"]
MUTED = PAL["muted"]
FOOTER = (75, 85, 99)

# One entry per deck, keyed by the deck's dir basename in seed_data.SLIDE_DECKS.
# Each slide is (title, bullets); slide count must equal the deck's
# presenter_notes count — slide N is on screen while note N is spoken.
DECKS: dict[str, list[tuple[str, list[str]]]] = {
    "overview": [
        ("AI agents built around your business", [
            "Custom AI agents, managed end to end",
            "Designed, deployed and managed by one partner",
        ]),
        ("An AI capability, delivered whole", [
            "Not software you have to assemble",
            "One partner. One system. One accountable outcome.",
        ]),
        ("A complete operating system per outcome", [
            "Intelligence · Experience · Systems · Operations",
            "Built around a real business process",
        ]),
        ("Built for the work that matters", [
            "CX · Sales · Operations · Finance · Research",
            "Purpose-built around your workflow and systems",
        ]),
        ("Most AI projects stop at the prototype", [
            "Sirin starts there",
            "Improved and managed under real operating conditions",
        ]),
    ],
    "how_it_works": [
        ("From brief to operating agent", [
            "Strategy, workflow design, UI, integrations, deployment",
            "Ongoing optimization once the agent is live",
        ]),
        ("A custom agent, not a template", [
            "Designed around a real business process",
            "Context, tools, rules and reasoning to do useful work",
        ]),
        ("Connected to your systems", [
            "Retrieves context, takes action, updates source of truth",
            "A clear UI: dashboard, chat, workflow or review queue",
        ]),
        ("Managed after deployment", [
            "Sirin monitors, improves and evolves the agent",
            "An operating capability, not a prototype",
        ]),
    ],
    "differentiation": [
        ("Most AI projects stop at the prototype", [
            "Sirin starts there",
            "Accountable for usefulness in practice, not a demo",
        ]),
        ("Not software you have to assemble", [
            "Intelligence, interface, integrations, operations — whole",
            "One partner. One system. One accountable outcome.",
        ]),
        ("No platform evaluation required", [
            "Start with the work, not another tool to maintain",
            "Tell us where work is slow, repetitive or hard to scale",
        ]),
    ],
    "trust": [
        ("Context · Action · Clarity · Control", [
            "The same principles behind every Sirin agent",
            "Exceptions flagged and routed to the right owner",
        ]),
        ("Built for real operating conditions", [
            "Monitored, improved and evolved after deployment",
            "Human judgment stays where it matters most",
        ]),
    ],
    "pricing": [
        ("Start with the work", [
            "Pricing is tailored to the work an agent takes on",
            "Tell us where work is slow, repetitive or hard to scale",
        ]),
        ("Start a conversation", [
            "Scope what your agent should do and connect to",
            "Book time with the Sirin team",
        ]),
    ],
}


def _check_sync() -> None:
    seeded = {Path(d["dir"]).name: d for d in SLIDE_DECKS}
    assert set(DECKS) == set(seeded), (
        f"DECKS out of sync with seed_data.SLIDE_DECKS: "
        f"script={sorted(DECKS)} seed={sorted(seeded)}"
    )
    for name, slides in DECKS.items():
        notes = len(seeded[name]["presenter_notes"])
        assert len(slides) == notes, (
            f"deck '{name}': {len(slides)} slides but {notes} presenter notes — "
            f"slide N is narrated by note N, counts must match"
        )


def _font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def render(deck: str, index: int, title: str, bullets: list[str]) -> None:
    img = Image.new("RGB", (1600, 900), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([60, 60, 1540, 840], radius=28, fill=CARD, outline=OUTLINE, width=2)
    d.rectangle([120, 150, 168, 162], fill=ACCENT)
    d.text((120, 200), title, font=_font(64), fill=TEXT)
    y = 360
    for bullet in bullets:
        d.ellipse([124, y + 16, 140, y + 32], fill=ACCENT)
        d.text((170, y), bullet, font=_font(38), fill=MUTED)
        y += 110
    d.text(
        (120, 770),
        f"{PERSONA['company']} — placeholder slide {index + 1}",
        font=_font(24),
        fill=FOOTER,
    )
    out = CONTENT / "slides" / deck
    out.mkdir(parents=True, exist_ok=True)
    img.save(out / f"{index + 1:02d}.png")


if __name__ == "__main__":
    _check_sync()
    slides_root = CONTENT / "slides"
    for deck, slides in DECKS.items():
        deck_dir = slides_root / deck
        if deck_dir.exists():
            for old in deck_dir.glob("*.png"):
                old.unlink()
        for i, (title, bullets) in enumerate(slides):
            render(deck, i, title, bullets)
    if slides_root.exists():
        for stray in slides_root.iterdir():
            if stray.is_dir() and stray.name not in DECKS:
                shutil.rmtree(stray)
                print("removed stale deck dir:", stray.name)
    print("placeholder slides written to", slides_root)
