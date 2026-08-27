from fastapi import APIRouter, HTTPException

from ..seed_data import PERSONA
from ..store import get_store

router = APIRouter(prefix="/api")


def _public_persona(persona: dict) -> dict:
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
    return {"ok": True, "store": get_store().kind}


@router.get("/brand")
async def get_brand():
    # Runtime brand overrides set in the settings view; the frontend merges
    # these over its static defaults in brand.ts. Empty object = defaults.
    return await get_store().get_override("brand") or {}


@router.get("/persona")
async def get_persona():
    persona = await get_store().get_persona(PERSONA["_id"])
    if persona is None:
        raise HTTPException(500, "persona not seeded")
    return _public_persona(persona)


@router.post("/sessions")
async def create_session():
    store = get_store()
    persona = await store.get_persona(PERSONA["_id"])
    if persona is None:
        raise HTTPException(500, "persona not seeded")
    session = await store.create_session(persona["_id"])
    await store.add_event(session["_id"], "session_start")
    return {"id": session["_id"], "persona": _public_persona(persona)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
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
    items = await get_store().list_content_items()
    return {"items": items}
