"""Persistence layer: MongoDB via Motor, with an in-memory fallback for keyless local dev."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

log = logging.getLogger("store")


def _now() -> float:
    return time.time()


class MemoryStore:
    """Dict-backed store with the same interface as MongoStore. Data is lost on restart."""

    kind = "memory"

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.messages: dict[str, list[dict]] = {}
        self.events: list[dict] = []
        self.personas: dict[str, dict] = {}
        self.content_items: dict[str, dict] = {}
        self.overrides: dict[str, dict] = {}

    async def upsert_persona(self, doc: dict) -> None:
        self.personas[doc["_id"]] = doc

    async def upsert_content_item(self, doc: dict) -> None:
        self.content_items[doc["_id"]] = doc

    async def delete_content_item(self, item_id: str) -> None:
        self.content_items.pop(item_id, None)

    async def prune_content_items(self, keep: set[str]) -> None:
        self.content_items = {k: v for k, v in self.content_items.items() if k in keep}

    async def get_override(self, key: str) -> dict | None:
        doc = self.overrides.get(key)
        return dict(doc) if doc is not None else None

    async def set_override(self, key: str, fields: dict) -> None:
        self.overrides[key] = dict(fields)

    async def delete_override(self, key: str) -> None:
        self.overrides.pop(key, None)

    async def list_overrides(self) -> dict[str, dict]:
        return {k: dict(v) for k, v in self.overrides.items()}

    async def get_persona(self, persona_id: str) -> dict | None:
        return self.personas.get(persona_id)

    async def list_content_items(self) -> list[dict]:
        return list(self.content_items.values())

    async def create_session(self, persona_id: str, meta: dict | None = None) -> dict:
        doc = {
            "_id": uuid.uuid4().hex,
            "persona_id": persona_id,
            "status": "active",
            "started_at": _now(),
            "ended_at": None,
            "meta": meta or {},
        }
        self.sessions[doc["_id"]] = doc
        self.messages[doc["_id"]] = []
        return doc

    async def get_session(self, session_id: str) -> dict | None:
        return self.sessions.get(session_id)

    async def set_session_status(self, session_id: str, status: str) -> None:
        if session_id in self.sessions:
            self.sessions[session_id]["status"] = status
            if status == "ended":
                self.sessions[session_id]["ended_at"] = _now()

    async def add_message(self, session_id: str, doc: dict) -> None:
        doc = {"_id": uuid.uuid4().hex, "session_id": session_id, "ts": _now(), **doc}
        self.messages.setdefault(session_id, []).append(doc)

    async def get_messages(self, session_id: str) -> list[dict]:
        return list(self.messages.get(session_id, []))

    async def add_event(self, session_id: str, name: str, props: dict | None = None) -> None:
        self.events.append(
            {"session_id": session_id, "type": name, "props": props or {}, "ts": _now()}
        )


class MongoStore:
    kind = "mongo"

    def __init__(self, db: Any) -> None:
        self.db = db

    async def ensure_indexes(self) -> None:
        await self.db.messages.create_index([("session_id", 1), ("ts", 1)])
        await self.db.events.create_index([("session_id", 1), ("ts", 1)])

    async def upsert_persona(self, doc: dict) -> None:
        await self.db.personas.replace_one({"_id": doc["_id"]}, doc, upsert=True)

    async def upsert_content_item(self, doc: dict) -> None:
        await self.db.content_items.replace_one({"_id": doc["_id"]}, doc, upsert=True)

    async def delete_content_item(self, item_id: str) -> None:
        await self.db.content_items.delete_one({"_id": item_id})

    async def prune_content_items(self, keep: set[str]) -> None:
        await self.db.content_items.delete_many({"_id": {"$nin": list(keep)}})

    async def get_override(self, key: str) -> dict | None:
        doc = await self.db.overrides.find_one({"_id": key})
        if doc is not None:
            doc.pop("_id", None)
        return doc

    async def set_override(self, key: str, fields: dict) -> None:
        await self.db.overrides.replace_one({"_id": key}, {"_id": key, **fields}, upsert=True)

    async def delete_override(self, key: str) -> None:
        await self.db.overrides.delete_one({"_id": key})

    async def list_overrides(self) -> dict[str, dict]:
        # unbounded: seed() prunes content items that aren't restored from here,
        # so truncating this listing could delete uploaded videos on startup
        out: dict[str, dict] = {}
        async for doc in self.db.overrides.find():
            key = doc.pop("_id")
            out[key] = doc
        return out

    async def get_persona(self, persona_id: str) -> dict | None:
        return await self.db.personas.find_one({"_id": persona_id})

    async def list_content_items(self) -> list[dict]:
        return await self.db.content_items.find().to_list(length=200)

    async def create_session(self, persona_id: str, meta: dict | None = None) -> dict:
        doc = {
            "_id": uuid.uuid4().hex,
            "persona_id": persona_id,
            "status": "active",
            "started_at": _now(),
            "ended_at": None,
            "meta": meta or {},
        }
        await self.db.sessions.insert_one(doc)
        return doc

    async def get_session(self, session_id: str) -> dict | None:
        return await self.db.sessions.find_one({"_id": session_id})

    async def set_session_status(self, session_id: str, status: str) -> None:
        update: dict = {"status": status}
        if status == "ended":
            update["ended_at"] = _now()
        await self.db.sessions.update_one({"_id": session_id}, {"$set": update})

    async def add_message(self, session_id: str, doc: dict) -> None:
        await self.db.messages.insert_one(
            {"_id": uuid.uuid4().hex, "session_id": session_id, "ts": _now(), **doc}
        )

    async def get_messages(self, session_id: str) -> list[dict]:
        return await self.db.messages.find({"session_id": session_id}).sort("ts", 1).to_list(
            length=500
        )

    async def add_event(self, session_id: str, name: str, props: dict | None = None) -> None:
        await self.db.events.insert_one(
            {"session_id": session_id, "type": name, "props": props or {}, "ts": _now()}
        )


Store = MemoryStore | MongoStore

_store: Store | None = None


async def init_store(mongodb_url: str) -> Store:
    global _store
    if mongodb_url:
        try:
            from motor.motor_asyncio import AsyncIOMotorClient

            client = AsyncIOMotorClient(mongodb_url, serverSelectionTimeoutMS=3000)
            await client.admin.command("ping")
            store = MongoStore(client.get_default_database("superhuman"))
            await store.ensure_indexes()
            log.info("Connected to MongoDB")
            _store = store
            return store
        except Exception as exc:  # fall through to memory store
            log.warning("MongoDB unavailable (%s) — using in-memory store", exc)
    else:
        log.warning("MONGODB_URL not set — using in-memory store")
    _store = MemoryStore()
    return _store


def get_store() -> Store:
    assert _store is not None, "store not initialized"
    return _store
