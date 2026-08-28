from fastapi import APIRouter, HTTPException

from .. import credits
from ..seed_data import PERSONA
from ..store import get_store

router = APIRouter(prefix="/api")


def _public_persona(persona: dict) -> dict:
    """Transform a stored persona document into the public API shape."""
    return {
        "id": persona["_id"],
        "name": persona["name"],
        "tagline": persona["tagline"],
        "description": persona["description"],
        "image_url": persona.get("image_path"),
        "default_topics": persona["default_topics"],
        "mic_disclaimer": persona["mic_disclaimer"],
    }


@router.get("/health")
async def health():
    """Health check endpoint returning store type."""
    return {"ok": True, "store": get_store().kind}


@router.get("/brand")
async def get_brand():
    """Return brand overrides set in the settings view, or empty object for defaults."""
    # Runtime brand overrides set in the settings view; the frontend merges
    # these over its static defaults in brand.ts. Empty object = defaults.
    return await get_store().get_override("brand") or {}


@router.get("/persona")
async def get_persona():
    """Return the seeded persona in public API format."""
    persona = await get_store().get_persona(PERSONA["_id"])
    if persona is None:
        raise HTTPException(500, "persona not seeded")
    return _public_persona(persona)


@router.post("/sessions")
async def create_session():
    """Create a new session and return its id with the persona."""
    store = get_store()
    if await credits.blocked(store):
        # enforcement is opt-in (settings view) — see app/credits.py
        raise HTTPException(402, "out of credits")
    persona = await store.get_persona(PERSONA["_id"])
    if persona is None:
        raise HTTPException(500, "persona not seeded")
    session = await store.create_session(persona["_id"])
    await store.add_event(session["_id"], "session_start")
    return {"id": session["_id"], "persona": _public_persona(persona)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Retrieve session details including status, persona, and message history."""
    store = get_store()
    session = await store.get_session(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    persona = await store.get_persona(session["persona_id"])
    messages = await store.get_messages(session_id)
    return {
        "id": session["_id"],
        "status": session["status"],
        "persona": _public_persona(persona),
        "messages": [
            {"role": m["role"], "text": m.get("text", ""), "interrupted": m.get("interrupted", False)}
            for m in messages
            if m.get("text")
        ],
    }


@router.get("/content")
async def list_content():
    """Return all available content items (slide decks and videos)."""
    items = await get_store().list_content_items()
    return {"items": items}
