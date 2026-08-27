"""Persona and content-item definitions, seeded idempotently on startup.

To add content: drop assets under backend/content/ and register them here.
Video items whose file is missing are skipped (add backend/content/videos/demo.mp4
to enable the play_video capability).

Runtime edits made in the settings view (/settings) are stored as override
documents (see routes/admin.py) and re-applied on top of these definitions on
every seed, so restarts keep edits while code-level rebrands still flow through
underneath. Override keys: "persona" (field overrides), "content:<id>" (field
overrides for seeded items), and "video:<id>" / "deck:<id>" ({"doc": ...} for
uploaded videos and slide decks).
"""

from .config import CONTENT_DIR, UPLOADS_DIR, asset_file, settings

# Persona fields the settings view may override; everything else stays code-owned.
PERSONA_EDITABLE_FIELDS = {
    "name",
    "company",
    "website",
    "tagline",
    "description",
    "greeting",
    "default_topics",
    "mic_disclaimer",
    "voice_id",
}

CONTENT_EDITABLE_FIELDS = {"title", "description", "presenter_notes"}


def _apply_override(doc: dict, override: dict | None, allowed: set[str]) -> dict:
    """Apply override fields to a document, keeping only allowed field names."""
    if override:
        doc.update({k: v for k, v in override.items() if k in allowed})
    return doc

PERSONA = {
    "_id": "sage",
    "name": "Sage",
    "company": "Sirin AI",
    "website": "sirin-ai.com",
    "tagline": "Your Sirin AI Guide",
    "description": (
        "Sage is Sirin AI's guide to custom AI agents, managed end to end. Ask how "
        "Sirin designs, deploys and manages agents — with the interfaces, integrations "
        "and ongoing support that make them useful inside real businesses — and explore "
        "what an agent could take on for your team. Whether you're just curious or ready "
        "to start a conversation, Sage can walk you through it."
    ),
    "voice_id": settings.elevenlabs_voice_id,
    "image_path": None,  # set at seed time from uploads/persona.* or content/persona.*
    "greeting": (
        "Hi, I'm Sage, your guide to Sirin AI. Sirin designs, deploys and manages "
        "custom AI agents — with the interfaces, integrations and ongoing support that "
        "make them genuinely useful inside real businesses. What kind of work is slow "
        "or repetitive for your team right now?"
    ),
    "default_topics": ["What is Sirin AI?", "What can an agent take on?", "How do we start?"],
    "mic_disclaimer": (
        "If you use the microphone, your audio is processed by your browser's speech "
        "service and this demo's AI providers."
    ),
}

SLIDE_DECKS = [
    {
        "_id": "overview_deck",
        "type": "slide_deck",
        "title": "Sirin AI Overview",
        "description": (
            "5 slides: 'AI agents built around your business', an AI capability "
            "delivered whole, the four layers (intelligence, experience, systems, "
            "operations), the work it's built for (CX, sales, operations, finance, "
            "research), and 'most AI projects stop at the prototype — Sirin starts "
            "there'. Show when someone asks what Sirin AI is or wants the big picture."
        ),
        "dir": "slides/overview",
        "presenter_notes": [
            "Sirin builds custom AI agents around your business and manages them end to "
            "end — one partner that designs, deploys and runs the agent for you.",
            "It's not software you have to assemble. Sirin combines the intelligence, "
            "the interface, the integrations and the operational support that make an "
            "agent genuinely useful inside your company — one partner, one system, one "
            "accountable outcome.",
            "Every agent is built as a complete operating system for a specific outcome: "
            "a custom agent designed around a real business process, a purpose-built "
            "interface, deep integrations into your systems, and ongoing management "
            "after deployment.",
            "Sirin agents are built for the work that matters to your team — customer "
            "experience, sales, operations, finance and research — and each one is "
            "designed around your company's own workflow and systems.",
            "Most AI projects stop when the prototype works. Sirin starts there — "
            "taking responsibility for how people experience the agent, how it connects "
            "to the business, and how it improves after deployment.",
        ],
    },
    {
        "_id": "how_it_works_deck",
        "type": "slide_deck",
        "title": "How It Works",
        "description": (
            "4 slides: from brief to operating agent (strategy, workflow design, UI, "
            "integrations, deployment, optimization), a custom agent designed around a "
            "real process, connected systems plus a purpose-built interface, and "
            "ongoing management after deployment. Show when someone asks how it works, "
            "what an engagement looks like, or about implementation."
        ),
        "dir": "slides/how_it_works",
        "presenter_notes": [
            "Every engagement runs from brief to operating agent — strategy, workflow "
            "design, the interface, integrations, deployment, and then ongoing "
            "optimization once it's live.",
            "The agent itself is designed around a real business process in your "
            "company, with the context, tools, rules and reasoning it needs to do "
            "useful work — not a generic template.",
            "It connects to the systems your teams already operate across, so it can "
            "retrieve context, take action and update the source of truth — and your "
            "people work with it through a clear, purpose-built interface, whether "
            "that's a dashboard, a chat experience, a workflow or a review queue.",
            "After deployment, Sirin keeps managing it — monitoring, improving and "
            "evolving the agent over time. You're not buying a prototype; you're adding "
            "an operating capability.",
        ],
    },
    {
        "_id": "differentiation_deck",
        "type": "slide_deck",
        "title": "The Sirin Difference",
        "description": (
            "3 slides: most AI projects stop when the prototype works — Sirin starts "
            "there, not software you have to assemble, and no platform evaluation "
            "required — start with the work. Show when someone compares Sirin to "
            "building in-house, to AI platforms and tools, or doubts AI projects make "
            "it into real use."
        ),
        "dir": "slides/differentiation",
        "presenter_notes": [
            "Here's the difference: most AI projects stop when the prototype works. "
            "Sirin starts there — taking responsibility for how people experience the "
            "agent, how it connects to the business, how it behaves under real "
            "operating conditions, and how it improves after deployment.",
            "You're not assembling software. Sirin delivers the intelligence, the "
            "interface, the integrations and the operational support as one whole "
            "capability — one partner, one system, one accountable outcome.",
            "And there's no platform evaluation required — you start with the work "
            "itself. Tell us where work is slow, repetitive or difficult to scale, and "
            "the team helps determine what an agent should do and what it needs to "
            "connect to.",
        ],
    },
    {
        "_id": "trust_deck",
        "type": "slide_deck",
        "title": "Clarity & Control",
        "description": (
            "2 slides: the context-action-clarity-control principles with exceptions "
            "flagged and routed to the right owner, then managed under real operating "
            "conditions with human judgment kept where it matters. Show on safety, "
            "control, oversight, or compliance concerns."
        ),
        "dir": "slides/trust",
        "presenter_notes": [
            "Every Sirin agent runs on the same principles — context, action, clarity "
            "and control. Agents can review work against your rules and policies, flag "
            "exceptions, and route higher-risk decisions to the right owner instead of "
            "acting alone.",
            "And because Sirin manages the agent under real operating conditions — "
            "monitoring, improving and evolving it over time — the cases where human "
            "judgment matters most keep surfacing to your team. For security "
            "specifics, the best next step is a conversation with the Sirin team.",
        ],
    },
    {
        "_id": "pricing_deck",
        "type": "slide_deck",
        "title": "How Engagements Work",
        "description": (
            "2 slides: pricing is tailored to the work an agent takes on ('start with "
            "the work'), then next steps — book a conversation with the Sirin team. "
            "Show whenever pricing, cost, or plans come up."
        ),
        "dir": "slides/pricing",
        "presenter_notes": [
            "Sirin doesn't publish pricing — every agent is scoped and priced around "
            "the work it takes on. The starting point is simple: tell us where work is "
            "slow, repetitive or difficult to scale.",
            "From there, the team helps determine what an agent should do, how it "
            "should work, and what it needs to connect to. The best next step is to "
            "book a conversation with the Sirin team.",
        ],
    },
]

VIDEOS = []


async def seed(store) -> None:
    """Seed persona and content items into the store, applying any saved overrides."""
    overrides = await store.list_overrides()

    persona = dict(PERSONA)
    # a photo uploaded via the settings view (UPLOADS_DIR, usually on a
    # persistence volume) wins over a persona image committed to the repo
    persona["image_path"] = next(
        (
            f"{prefix}/persona.{ext}"
            for root, prefix in ((UPLOADS_DIR, "/uploads"), (CONTENT_DIR, "/content"))
            for ext in ("jpg", "jpeg", "png", "webp")
            if (root / f"persona.{ext}").exists()
        ),
        None,
    )
    _apply_override(persona, overrides.get("persona"), PERSONA_EDITABLE_FIELDS)
    await store.upsert_persona(persona)

    seeded_ids: set[str] = set()
    for deck in SLIDE_DECKS:
        deck_dir = CONTENT_DIR / deck["dir"]
        slides = sorted(p.name for p in deck_dir.glob("*.png")) if deck_dir.exists() else []
        if not slides:
            continue
        seeded_ids.add(deck["_id"])
        await store.upsert_content_item(
            _apply_override(
                {
                    "_id": deck["_id"],
                    "type": "slide_deck",
                    "title": deck["title"],
                    "description": deck["description"],
                    "assets": [f"/content/{deck['dir']}/{name}" for name in slides],
                    "presenter_notes": deck.get("presenter_notes") or [],
                },
                overrides.get(f"content:{deck['_id']}"),
                CONTENT_EDITABLE_FIELDS,
            )
        )

    for video in VIDEOS:
        if not (CONTENT_DIR / video["file"]).exists():
            continue
        seeded_ids.add(video["_id"])
        await store.upsert_content_item(
            _apply_override(
                {
                    "_id": video["_id"],
                    "type": "video",
                    "title": video["title"],
                    "description": video["description"],
                    "assets": [f"/content/{video['file']}"],
                },
                overrides.get(f"content:{video['_id']}"),
                CONTENT_EDITABLE_FIELDS,
            )
        )

    # Content uploaded via the settings view (videos, decks) lives entirely in
    # its override doc; re-seed what still has files so prune keeps it.
    for key, override in overrides.items():
        if not key.startswith(("video:", "deck:")):
            continue
        doc = override.get("doc") or {}
        assets = doc.get("assets") or []
        # asset_file handles both /uploads/ and legacy /content/ paths
        asset_path = asset_file(assets[0]) if assets else None
        if asset_path is not None and asset_path.exists():
            seeded_ids.add(doc["_id"])
            await store.upsert_content_item(dict(doc))
        else:
            await store.delete_override(key)  # files are gone — drop the orphan

    # Content removed or renamed here must not linger from a previous seed
    # (a rebrand would otherwise keep serving the old brand's decks from Mongo).
    await store.prune_content_items(seeded_ids)
