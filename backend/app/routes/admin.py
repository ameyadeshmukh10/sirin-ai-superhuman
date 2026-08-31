"""Admin API backing the settings view (/settings in the frontend).

Edits are written twice: onto the live store docs (so they apply immediately)
and into override documents that seed_data.seed() re-applies on startup — with
MongoDB configured, edits survive restarts; with the in-memory store they last
until restart, like everything else. Uploaded files (logo, persona image,
videos) are saved under UPLOADS_DIR (backend/uploads by default — mount a
persistence volume there in production) and served from /uploads; repo-baked
assets stay under backend/content/ and /content.

When ADMIN_TOKEN is set, every route here requires it in an X-Admin-Token
header; unset means open access (local dev).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import shutil
import uuid
from pathlib import Path
from typing import Literal

import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..config import UPLOADS_DIR, asset_file, settings
from ..credits import summary as credits_summary
from ..orchestrator.prompt import GTM_KNOWLEDGE
from ..seed_data import CONTENT_EDITABLE_FIELDS, PERSONA, PERSONA_EDITABLE_FIELDS, seed
from ..store import get_store
from . import billing

log = logging.getLogger("admin")

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_PDF_BYTES = 60 * 1024 * 1024
MAX_DECK_SLIDES = 40
MAX_RENDER_PIXELS = 4096 * 4096  # per rendered PDF page, pre-checked before rasterizing
# whole-deck output budget (~an average of 1600x1250 per page): a PDF under
# MAX_PDF_BYTES could otherwise rasterize into gigabytes on the uploads volume
MAX_TOTAL_RENDER_PIXELS = MAX_DECK_SLIDES * 2_000_000
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
LOGO_EXTS = IMAGE_EXTS | {".svg"}
VIDEO_EXTS = {".mp4", ".webm"}

# Uploaded content lives entirely in its override doc, keyed by type; seed()
# re-registers these on startup while their files still exist.
CUSTOM_CONTENT_PREFIXES = ("video:", "deck:")

RESETTABLE_KEYS = {"persona", "brand", "gtm", "theme"}

# The persona voice_id lands in the ElevenLabs request path — keep it to the
# opaque-ID charset so a stored value can never reshape that URL.
VOICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Theme override: color tokens the settings view may re-color (they map to the
# --color-<key> custom properties in frontend/src/index.css) and the Google
# Fonts the frontend offers.
THEME_COLOR_KEYS = {
    "accent",
    "ink",
    "panel",
    "panel-2",
    "line",
    "body",
    "muted",
    "moss",
    "atlantic",
}
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# KEEP IN SYNC with HEADING_FONTS / BODY_FONTS in frontend/src/brand.ts.
# The frontend resolves stored names against its catalog and silently ignores
# anything else, so accepting an unlisted name would store a font that never
# applies — reject it here instead.
HEADING_FONT_NAMES = {
    "Source Serif 4",
    "Playfair Display",
    "Lora",
    "Merriweather",
    "Libre Baskerville",
    "Cormorant Garamond",
    "DM Serif Display",
    "Space Grotesk",
    "Poppins",
    "Montserrat",
}
BODY_FONT_NAMES = {
    "Inter",
    "Roboto",
    "Open Sans",
    "Source Sans 3",
    "Nunito Sans",
    "Work Sans",
    "IBM Plex Sans",
    "Karla",
    "DM Sans",
    "Manrope",
}

# HeyGen public-avatar catalog, bundled with the app (id, name, preview_url,
# portrait). The settings view browses it; the chosen avatar is stored as the
# "avatar" override and applied to new sessions by
# orchestrator.agent.resolve_avatar_id.
AVATAR_CATALOG: list[dict] = json.loads(
    (Path(__file__).resolve().parent.parent / "avatar_catalog.json").read_text()
)
AVATARS_BY_ID = {a["id"]: a for a in AVATAR_CATALOG}

# Serializes the file-replacement flows (persona photo, logo, deck slides),
# deck deletion, reset, and content edits: their swap → persist → cleanup and
# read-modify-write steps must not interleave, or one request's cleanup could
# delete the files another request's stored paths end up pointing at (and a
# stale edit read could clobber a just-committed replacement). Uploads stream
# OUTSIDE the lock (to dotted temp names); only the fast swap/persist/cleanup
# section holds it. (Single-process app, so an asyncio lock fully serializes
# them; video uploads need none — unique filenames.)
_replace_lock = asyncio.Lock()


def require_admin(request: Request) -> None:
    """Gate /api/admin/*: when ADMIN_TOKEN is set, require it in X-Admin-Token."""
    if settings.admin_token and not secrets.compare_digest(
        request.headers.get("x-admin-token", ""), settings.admin_token
    ):
        raise HTTPException(401, "invalid admin token")


router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


# ---------- models ----------


class PersonaUpdate(BaseModel):
    name: str | None = None
    company: str | None = None
    website: str | None = None
    tagline: str | None = None
    description: str | None = None
    greeting: str | None = None
    mic_disclaimer: str | None = None
    voice_id: str | None = None
    default_topics: list[str] | None = None


class WordmarkText(BaseModel):
    kind: Literal["text"]
    text: str = Field(min_length=1, max_length=40)
    # camelCase to match the frontend Wordmark type — served verbatim by /api/brand
    accentStart: int = Field(default=0, ge=0)
    accentEnd: int | None = Field(default=None, ge=0)


class WordmarkLogo(BaseModel):
    kind: Literal["logo"]
    src: str
    alt: str = ""


class BrandUpdate(BaseModel):
    wordmark: WordmarkText | WordmarkLogo | None = None
    book_meeting_url: str | None = None


class ThemeUpdate(BaseModel):
    # The full desired theme each time (the form always submits every field);
    # an empty update clears the override so the code defaults come back.
    colors: dict[str, str] = Field(default_factory=dict)
    heading_font: str | None = None
    body_font: str | None = None


class GtmUpdate(BaseModel):
    # None or blank resets to the code default (GTM_KNOWLEDGE)
    text: str | None = Field(default=None, max_length=40000)


class ContentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    presenter_notes: list[str] | None = None


class AvatarUpdate(BaseModel):
    # None clears the selection (fall back to the HEYGEN_AVATAR_ID env default)
    avatar_id: str | None = None


# ---------- helpers ----------


def _admin_persona(persona: dict) -> dict:
    """Shape a stored persona doc into the settings view's editable payload."""
    return {
        "id": persona["_id"],
        "image_url": persona.get("image_path"),
        # lets the voice dropdown show the env-configured voice as "Server
        # default" instead of presenting its raw ID as a custom selection
        "default_voice_id": settings.elevenlabs_voice_id,
        **{k: persona.get(k) for k in sorted(PERSONA_EDITABLE_FIELDS)},
    }


async def _get_persona_or_500() -> dict:
    """Return the seeded persona doc, or fail loudly if seeding never ran."""
    persona = await get_store().get_persona(PERSONA["_id"])
    if persona is None:
        raise HTTPException(500, "persona not seeded")
    return persona


async def _content_with_flags() -> list[dict]:
    """List content items with custom/edited flags derived from their overrides."""
    store = get_store()
    overrides = await store.list_overrides()
    items = []
    for item in await store.list_content_items():
        items.append(
            {
                "id": item["_id"],
                "type": item["type"],
                "title": item["title"],
                "description": item["description"],
                "assets": item.get("assets") or [],
                "presenter_notes": item.get("presenter_notes") or [],
                "custom": any(f"{p}{item['_id']}" in overrides for p in CUSTOM_CONTENT_PREFIXES),
                "edited": f"content:{item['_id']}" in overrides,
            }
        )
    items.sort(key=lambda i: (i["type"] != "slide_deck", i["title"].lower()))
    return items


async def _avatar_state() -> dict:
    """The avatar selection as the settings view sees it."""
    override = await get_store().get_override("avatar") or {}
    selected_id = override.get("avatar_id")
    catalog_entry = AVATARS_BY_ID.get(selected_id) or {}
    return {
        "selected_id": selected_id,
        "selected_name": catalog_entry.get("name") or override.get("name"),
        "env_default_id": settings.heygen_avatar_id or None,
        "heygen_configured": bool(settings.heygen_api_key),
    }


async def _config() -> dict:
    """Assemble the full settings payload served by GET /api/admin/config."""
    store = get_store()
    gtm = await store.get_override("gtm") or {}
    return {
        "store": store.kind,
        "persona": _admin_persona(await _get_persona_or_500()),
        "brand": await store.get_override("brand") or {},
        "theme": await store.get_override("theme") or {},
        "gtm": {"default": GTM_KNOWLEDGE.strip(), "custom": gtm.get("text")},
        "avatar": await _avatar_state(),
        "content": await _content_with_flags(),
    }


def _clean_str(value: str | None, max_len: int = 4000) -> str | None:
    """Strip a string field; None/blank means 'not provided', too long is a 422."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > max_len:
        raise HTTPException(422, f"value too long (max {max_len} chars)")
    return value


def _file_ext(filename: str | None, allowed: set[str]) -> str:
    """Return the lowercased extension of an upload, rejecting types not allowed."""
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if filename and "." in filename else ""
    if ext not in allowed:
        raise HTTPException(422, f"unsupported file type; allowed: {', '.join(sorted(allowed))}")
    return ext


async def _save_upload(upload: UploadFile, dest_rel: str, max_bytes: int) -> None:
    """Stream an upload to UPLOADS_DIR/dest_rel, enforcing the size cap."""
    dest = UPLOADS_DIR / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with dest.open("wb") as fh:
            while chunk := await upload.read(1024 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(413, f"file too large (max {max_bytes // (1024 * 1024)}MB)")
                fh.write(chunk)
    except BaseException:
        # any failure — size cap, client I/O error, cancellation — must not
        # leave a partial file accumulating on the persistent uploads volume
        dest.unlink(missing_ok=True)
        raise
    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, "empty file")


# ---------- config ----------


@router.get("/config")
async def get_config():
    """Return everything the settings view edits: persona, brand, GTM, content."""
    return await _config()


# ---------- persona ----------


@router.put("/persona")
async def update_persona(body: PersonaUpdate):
    """Update persona fields on the live doc and persist them as overrides."""
    store = get_store()
    fields: dict = {}
    voice_cleared = False
    if body.voice_id is not None:
        voice = body.voice_id.strip()
        if not voice:
            # blank = explicit clear: drop the override, back to the env default
            voice_cleared = True
        elif not VOICE_ID_RE.fullmatch(voice):
            raise HTTPException(422, "voice_id must be an ElevenLabs voice ID")
        else:
            fields["voice_id"] = voice
    for key in ("name", "company", "website", "tagline"):
        value = _clean_str(getattr(body, key), max_len=200)
        if value is not None:
            fields[key] = value
    for key in ("description", "greeting", "mic_disclaimer"):
        value = _clean_str(getattr(body, key))
        if value is not None:
            fields[key] = value
    if body.default_topics is not None:
        topics = [t.strip()[:80] for t in body.default_topics if t and t.strip()]
        if not topics:
            raise HTTPException(422, "default_topics must contain at least one topic")
        fields["default_topics"] = topics[:6]
    if not fields and not voice_cleared:
        raise HTTPException(422, "no fields to update")

    override = await store.get_override("persona") or {}
    override.update(fields)
    if voice_cleared:
        override.pop("voice_id", None)
    if override:
        await store.set_override("persona", override)
    else:
        await store.delete_override("persona")

    persona = await _get_persona_or_500()
    persona.update(fields)
    if voice_cleared:
        persona["voice_id"] = settings.elevenlabs_voice_id
    await store.upsert_persona(persona)
    return {"persona": _admin_persona(persona)}


@router.post("/persona/image")
async def upload_persona_image(file: UploadFile = File(...)):
    """Replace the persona photo; seed() auto-detects persona*.<ext> on startup.

    Every upload gets a unique filename (like logo and deck-slide replacements),
    so its URL changes and browsers can't keep serving the previous photo from
    cache — with the old fixed persona.<ext> name, a replacement saved fine but
    every page kept showing the stale cached image."""
    ext = _file_ext(file.filename, IMAGE_EXTS)
    # full UUID: a truncated name colliding with the current photo's would
    # silently reuse its URL — the exact stale-cache failure this scheme fixes
    name = f"persona-{uuid.uuid4().hex}{ext}"
    # write to a temp name first so a failed upload can't destroy the current
    # photo; the leading dot keeps it out of the persona* seed detection
    tmp_rel = f".persona-upload-{uuid.uuid4().hex}{ext}"
    await _save_upload(file, tmp_rel, MAX_IMAGE_BYTES)
    tmp = UPLOADS_DIR / tmp_rel
    async with _replace_lock:
        try:
            tmp.rename(UPLOADS_DIR / name)
        except OSError:
            tmp.unlink(missing_ok=True)
            raise

        store = get_store()
        # copy before mutating: the memory store hands out its live doc, and a
        # failed upsert below must leave the stored doc untouched
        persona = dict(await _get_persona_or_500())
        persona["image_path"] = f"/uploads/{name}"
        try:
            await store.upsert_persona(persona)
        except BaseException:
            # the prior photo still exists and stays referenced — drop the
            # unreferenced new file
            (UPLOADS_DIR / name).unlink(missing_ok=True)
            raise
        # predecessors (unique-named and legacy fixed-name alike) go only after
        # the doc durably points at the new file — a failure at any earlier
        # step leaves a working photo
        for path in UPLOADS_DIR.glob("persona*.*"):
            if path.name != name:
                path.unlink(missing_ok=True)
    return {"image_url": persona["image_path"]}


# ---------- brand ----------


@router.put("/brand")
async def update_brand(body: BrandUpdate):
    """Update the wordmark and/or book-a-meeting URL override."""
    store = get_store()
    override = await store.get_override("brand") or {}
    if body.wordmark is not None:
        if isinstance(body.wordmark, WordmarkLogo) and not body.wordmark.src.startswith(
            ("/uploads/", "/content/")  # /content/ kept for pre-volume overrides
        ):
            raise HTTPException(
                422, "logo src must be an uploaded /uploads/ (or legacy /content/) path"
            )
        override["wordmark"] = body.wordmark.model_dump(exclude_none=True)
    if body.book_meeting_url is not None:
        url = body.book_meeting_url.strip()
        if url and not url.startswith(("https://", "http://")):
            raise HTTPException(422, "book_meeting_url must be an http(s) URL")
        if url:
            override["book_meeting_url"] = url[:500]
        else:
            override.pop("book_meeting_url", None)
    if override:
        await store.set_override("brand", override)
    else:
        await store.delete_override("brand")
    return {"brand": override}


@router.post("/brand/logo")
async def upload_logo(file: UploadFile = File(...)):
    """Upload a logo file and switch the wordmark to it."""
    ext = _file_ext(file.filename, LOGO_EXTS)
    # unique final name so browsers never serve a stale cached logo; stream to
    # a dotted temp name first — the file must not appear under the logo-*
    # cleanup pattern until inside the lock, or a concurrent request's cleanup
    # could delete it before this request stores its path
    name = f"logo-{uuid.uuid4().hex[:8]}{ext}"
    tmp_rel = f"branding/.logo-upload-{uuid.uuid4().hex[:8]}{ext}"
    await _save_upload(file, tmp_rel, MAX_IMAGE_BYTES)
    tmp = UPLOADS_DIR / tmp_rel

    async with _replace_lock:
        try:
            tmp.rename(UPLOADS_DIR / "branding" / name)
        except OSError:
            tmp.unlink(missing_ok=True)
            raise
        try:
            store = get_store()
            override = await store.get_override("brand") or {}
            alt = (override.get("wordmark") or {}).get("alt") or PERSONA.get("company") or "logo"
            override["wordmark"] = {"kind": "logo", "src": f"/uploads/branding/{name}", "alt": alt}
            await store.set_override("brand", override)
        except BaseException:
            # the override still points at the previous logo — drop the new,
            # unreferenced file instead of leaving it on the volume
            (UPLOADS_DIR / "branding" / name).unlink(missing_ok=True)
            raise
        # previous logo files go only once the override durably points at the
        # new one — a failure above leaves the current logo file untouched
        for path in (UPLOADS_DIR / "branding").glob("logo-*.*"):
            if path.name != name:
                path.unlink(missing_ok=True)
    return {"brand": override}


# ---------- theme (colors & fonts) ----------


@router.put("/theme")
async def update_theme(body: ThemeUpdate):
    """Replace the appearance override: color tokens (hex) and font choices.

    Stored as its own "theme" override (separate from "brand") so resetting the
    wordmark never wipes the colors, and vice versa. Served to every visitor
    merged into GET /api/brand."""
    theme: dict = {}
    colors: dict[str, str] = {}
    for key, value in body.colors.items():
        if key not in THEME_COLOR_KEYS:
            raise HTTPException(422, f"unknown color key {key!r}")
        value = value.strip()
        if not HEX_COLOR_RE.fullmatch(value):
            raise HTTPException(422, f"{key} must be a #rrggbb hex code")
        colors[key] = value.lower()
    if colors:
        theme["colors"] = colors
    for field, allowed in (("heading_font", HEADING_FONT_NAMES), ("body_font", BODY_FONT_NAMES)):
        value = (getattr(body, field) or "").strip()
        if value:
            if value not in allowed:
                raise HTTPException(422, f"{field} must be one of the supported fonts")
            theme[field] = value

    store = get_store()
    if theme:
        await store.set_override("theme", theme)
    else:
        await store.delete_override("theme")
    return {"theme": theme}


# ---------- messaging (GTM knowledge) ----------


@router.put("/gtm")
async def update_gtm(body: GtmUpdate):
    """Set custom GTM knowledge for new sessions; blank text resets to default."""
    store = get_store()
    text = (body.text or "").strip()
    if text:
        await store.set_override("gtm", {"text": text})
    else:
        await store.delete_override("gtm")
    return {"gtm": {"default": GTM_KNOWLEDGE.strip(), "custom": text or None}}


# ---------- avatar ----------


@router.get("/avatars")
async def list_avatars():
    """The HeyGen public-avatar catalog plus the current selection state."""
    return {"avatars": AVATAR_CATALOG, **await _avatar_state()}


@router.put("/avatar")
async def update_avatar(body: AvatarUpdate):
    """Select the avatar new sessions use; null clears back to the env default."""
    store = get_store()
    if body.avatar_id:
        avatar = AVATARS_BY_ID.get(body.avatar_id)
        if avatar is None:
            raise HTTPException(422, "unknown avatar_id")
        await store.set_override("avatar", {"avatar_id": avatar["id"], "name": avatar["name"]})
    else:
        await store.delete_override("avatar")
    return await _avatar_state()


# ---------- credits ----------


class CreditsGrant(BaseModel):
    credits: int = Field(ge=1, le=1_000_000)
    note: str | None = None


class CreditsCheckout(BaseModel):
    pack: str


class CreditsSettingsUpdate(BaseModel):
    enabled: bool | None = None
    low_threshold: int | None = Field(default=None, ge=0, le=1_000_000)


def _require_wallet_admin() -> None:
    """Wallet mutations (grants, enforcement) need a real token: the open-access
    dev mode that's fine for content edits would let anyone on a public deploy
    mint credits or switch enforcement off."""
    if not settings.admin_token:
        raise HTTPException(403, "set ADMIN_TOKEN to manage credits")


@router.get("/credits")
async def get_credits():
    """Wallet balance, per-service consumption, recent activity, and config."""
    return await credits_summary(get_store())


@router.post("/credits/grant")
async def grant_credits(body: CreditsGrant):
    """Add credits manually — the dev/offline path next to Stripe purchases."""
    _require_wallet_admin()
    store = get_store()
    mc = body.credits * 1000
    await store.adjust_credits(
        mc, {"kind": "grant", "mc": mc, "note": _clean_str(body.note, max_len=200) or "manual grant"}
    )
    return await credits_summary(store)


@router.post("/credits/checkout")
async def credits_checkout(body: CreditsCheckout, request: Request):
    """Start a Stripe Checkout for a credit pack; the webhook credits the wallet."""
    return {"url": await billing.create_checkout(body.pack, str(request.base_url))}


@router.put("/credits/settings")
async def update_credits_settings(body: CreditsSettingsUpdate):
    """Toggle balance enforcement and the low-balance warning threshold."""
    _require_wallet_admin()
    store = get_store()
    override = await store.get_override("credits") or {}
    if body.enabled is not None:
        override["enabled"] = body.enabled
    if body.low_threshold is not None:
        override["low_threshold"] = body.low_threshold
    await store.set_override("credits", override)
    return await credits_summary(store)


# ---------- content items ----------


@router.put("/content/{item_id}")
async def update_content(item_id: str, body: ContentUpdate):
    """Edit a content item's title, description, or presenter notes."""
    store = get_store()
    # under _replace_lock: this read-modify-write must not interleave with a
    # slide replacement or delete, or a stale read here would re-point the
    # override at already-swept slide files
    async with _replace_lock:
        items = {i["_id"]: i for i in await store.list_content_items()}
        item = items.get(item_id)
        if item is None:
            raise HTTPException(404, "content item not found")

        fields: dict = {}
        title = _clean_str(body.title, max_len=200)
        if title is not None:
            fields["title"] = title
        description = _clean_str(body.description)
        if description is not None:
            fields["description"] = description
        if body.presenter_notes is not None:
            if item["type"] != "slide_deck":
                raise HTTPException(422, "presenter_notes only apply to slide decks")
            fields["presenter_notes"] = [n.strip()[:4000] for n in body.presenter_notes]
        if not fields:
            raise HTTPException(422, "no fields to update")

        # the override is the durable truth seed() restores from — write it first,
        # so a failure after it leaves at worst a stale live item that the next
        # startup heals, never a durable record that silently reverts the edit
        item.update(fields)
        for prefix in CUSTOM_CONTENT_PREFIXES:
            custom_override = await store.get_override(f"{prefix}{item_id}")
            if custom_override is not None:
                # uploaded content: its override doc IS the source of truth
                custom_override["doc"] = dict(item)
                await store.set_override(f"{prefix}{item_id}", custom_override)
                break
        else:
            override = await store.get_override(f"content:{item_id}") or {}
            override.update({k: v for k, v in fields.items() if k in CONTENT_EDITABLE_FIELDS})
            await store.set_override(f"content:{item_id}", override)
        await store.upsert_content_item(item)
    return {"content": await _content_with_flags()}


def _render_pdf_to_slides(pdf_path: Path, dest_dir: Path) -> int:
    """Rasterize each PDF page to NN.png in dest_dir; returns the page count.

    Runs in a worker thread (rendering is CPU-bound). Raises ValueError with a
    user-facing message on anything wrong with the document itself."""
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as exc:
        raise ValueError("couldn't read that PDF") from exc
    with doc:
        if doc.page_count == 0:
            raise ValueError("the PDF has no pages")
        if doc.page_count > MAX_DECK_SLIDES:
            raise ValueError(f"the PDF has {doc.page_count} pages (max {MAX_DECK_SLIDES})")
        total_pixels = 0.0
        for number, page in enumerate(doc, start=1):
            # render to ~1600px wide; cap the zoom so tiny pages don't explode
            zoom = min(2.5, 1600 / max(1.0, page.rect.width))
            # pathological page geometry must not exhaust memory or disk: bound
            # the output pixel count — per page and across the whole deck —
            # before any pixmap is allocated
            pixels = (page.rect.width * zoom) * (page.rect.height * zoom)
            if pixels > MAX_RENDER_PIXELS:
                raise ValueError(f"page {number} is too large to render")
            total_pixels += pixels
            if total_pixels > MAX_TOTAL_RENDER_PIXELS:
                raise ValueError("the PDF's pages are too large to render as one deck")
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            pix.save(dest_dir / f"{number:02d}.png")
        return doc.page_count


async def _assemble_slides(files: list[UploadFile], tmp_rel: str) -> list[str]:
    """Validate an uploaded slide set (one PDF or ordered images) and write the
    slide files into UPLOADS_DIR/tmp_rel; returns the slide filenames in order.
    The caller owns tmp_rel and must remove it on any failure."""
    tmp_dir = UPLOADS_DIR / tmp_rel
    is_pdf = len(files) == 1 and (files[0].filename or "").lower().endswith(".pdf")
    if not is_pdf and len(files) > MAX_DECK_SLIDES:
        raise HTTPException(422, f"too many slides (max {MAX_DECK_SLIDES})")
    if is_pdf:
        await _save_upload(files[0], f"{tmp_rel}/source.pdf", MAX_PDF_BYTES)
        try:
            count = await asyncio.to_thread(_render_pdf_to_slides, tmp_dir / "source.pdf", tmp_dir)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        (tmp_dir / "source.pdf").unlink(missing_ok=True)
        return [f"{n:02d}.png" for n in range(1, count + 1)]
    # slide order follows the original filenames, sorted
    ordered = sorted(files, key=lambda f: (f.filename or "").lower())
    slide_names = []
    for number, upload in enumerate(ordered, start=1):
        ext = _file_ext(upload.filename, IMAGE_EXTS)
        name = f"{number:02d}{ext}"
        await _save_upload(upload, f"{tmp_rel}/{name}", MAX_IMAGE_BYTES)
        slide_names.append(name)
    return slide_names


@router.post("/content/deck")
async def upload_deck(
    files: list[UploadFile] = File(...),
    title: str = Form(...),
    description: str = Form(...),
):
    """Create a slide deck from one PDF (a slide per page) or ordered images."""
    title_clean = _clean_str(title, max_len=200)
    description_clean = _clean_str(description)
    if not title_clean or not description_clean:
        raise HTTPException(422, "title and description are required")
    if not files:
        raise HTTPException(422, "no files uploaded")

    slug = re.sub(r"[^a-z0-9]+", "_", title_clean.lower()).strip("_")[:40] or "deck"
    deck_id = f"{slug}_{uuid.uuid4().hex[:6]}"
    # dotted temp dir: assembled out of sight, renamed into place only when whole
    tmp_rel = f"decks/.deck-upload-{uuid.uuid4().hex[:8]}"
    tmp_dir = UPLOADS_DIR / tmp_rel
    try:
        slide_names = await _assemble_slides(files, tmp_rel)
        tmp_dir.rename(UPLOADS_DIR / "decks" / deck_id)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    doc = {
        "_id": deck_id,
        "type": "slide_deck",
        "title": title_clean,
        "description": description_clean,
        "assets": [f"/uploads/decks/{deck_id}/{name}" for name in slide_names],
        "presenter_notes": [],
    }
    store = get_store()
    try:
        # override first — it is the durable record delete/seed key off
        await store.set_override(f"deck:{deck_id}", {"doc": doc})
        await store.upsert_content_item(doc)
    except BaseException:
        # a half-registered deck would be undeletable and unseedable: unwind
        # everything, best-effort, before re-raising
        for cleanup in (
            lambda: store.delete_content_item(deck_id),
            lambda: store.delete_override(f"deck:{deck_id}"),
        ):
            try:
                await cleanup()
            except Exception:
                pass
        shutil.rmtree(UPLOADS_DIR / "decks" / deck_id, ignore_errors=True)
        raise
    return {"content": await _content_with_flags()}


@router.post("/content/{item_id}/slides")
async def replace_deck_slides(item_id: str, files: list[UploadFile] = File(...)):
    """Replace a deck's slides with a new PDF or image set, keeping its identity.

    Works on uploaded and seeded decks alike; for seeded decks the replacement
    is recorded in the content override, so "Reset to defaults" restores the
    original slides. Presenter notes survive when the new set has the same
    number of slides; otherwise they reset (the talk track no longer lines up).
    Each replacement lands in a fresh generation subdirectory, so asset URLs
    change and browsers can't keep showing the old slides from cache."""
    store = get_store()
    items = {i["_id"]: i for i in await store.list_content_items()}
    item = items.get(item_id)
    if item is None or item.get("type") != "slide_deck":
        raise HTTPException(404, "slide deck not found")
    if not files:
        raise HTTPException(422, "no files uploaded")

    decks_root = (UPLOADS_DIR / "decks").resolve()
    deck_dir = (UPLOADS_DIR / "decks" / item_id).resolve()
    if deck_dir == decks_root or not deck_dir.is_relative_to(decks_root):
        raise HTTPException(422, "invalid deck id")

    tmp_rel = f"decks/.deck-upload-{uuid.uuid4().hex[:8]}"
    tmp_dir = UPLOADS_DIR / tmp_rel
    try:
        slide_names = await _assemble_slides(files, tmp_rel)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    gen = uuid.uuid4().hex[:8]
    async with _replace_lock:
        # revalidate under the lock: the deck may have been deleted (or its
        # notes edited) while the upload streamed and rendered outside it —
        # registering against that stale read would resurrect a deleted deck
        items = {i["_id"]: i for i in await store.list_content_items()}
        item = items.get(item_id)
        if item is None or item.get("type") != "slide_deck":
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise HTTPException(409, "this deck was deleted while the upload was in flight")

        doc = dict(item)
        doc["assets"] = [f"/uploads/decks/{item_id}/{gen}/{name}" for name in slide_names]
        count_changed = len(slide_names) != len(item.get("assets") or [])
        if count_changed:
            doc["presenter_notes"] = []

        custom_key, prior_custom = None, None
        for prefix in CUSTOM_CONTENT_PREFIXES:
            prior = await store.get_override(f"{prefix}{item_id}")
            if prior is not None:
                custom_key, prior_custom = f"{prefix}{item_id}", prior
                break
        prior_content = None if custom_key else await store.get_override(f"content:{item_id}")

        try:
            deck_dir.mkdir(parents=True, exist_ok=True)
            tmp_dir.rename(deck_dir / gen)
        except BaseException:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
        try:
            # override first — the durable record seed() restores from
            if custom_key:
                await store.set_override(custom_key, {**prior_custom, "doc": dict(doc)})
            else:
                merged = dict(prior_content or {})
                merged["assets"] = doc["assets"]
                if count_changed:
                    merged["presenter_notes"] = []
                await store.set_override(f"content:{item_id}", merged)
            await store.upsert_content_item(doc)
        except BaseException:
            # the old slides were never touched: put the prior override back,
            # then drop the new generation. If the restore itself fails, KEEP
            # the new files — the stored override points at them, so the next
            # seed heals the live item instead of dropping the deck
            restored = False
            try:
                if custom_key:
                    await store.set_override(custom_key, prior_custom)
                elif prior_content is not None:
                    await store.set_override(f"content:{item_id}", prior_content)
                else:
                    await store.delete_override(f"content:{item_id}")
                restored = True
            except Exception:
                pass
            if restored:
                shutil.rmtree(deck_dir / gen, ignore_errors=True)
            raise
        # success — sweep the previous generation(s); best-effort, since the
        # records are already consistent and delete/reset/the next replacement
        # sweep this directory again
        for child in deck_dir.iterdir():
            if child.name == gen:
                continue
            try:
                shutil.rmtree(child) if child.is_dir() else child.unlink()
            except OSError:
                log.warning("couldn't remove old slides at %s — will retry", child)
    return {"content": await _content_with_flags()}


@router.post("/content/video")
async def upload_video(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(...),
):
    """Save an uploaded clip and register it as a play_video content item."""
    title_clean = _clean_str(title, max_len=200)
    description_clean = _clean_str(description)
    if not title_clean or not description_clean:
        raise HTTPException(422, "title and description are required")

    ext = _file_ext(file.filename, VIDEO_EXTS)
    slug = re.sub(r"[^a-z0-9]+", "_", title_clean.lower()).strip("_")[:40] or "video"
    item_id = f"{slug}_{uuid.uuid4().hex[:6]}"
    await _save_upload(file, f"videos/{item_id}{ext}", MAX_VIDEO_BYTES)

    doc = {
        "_id": item_id,
        "type": "video",
        "title": title_clean,
        "description": description_clean,
        "assets": [f"/uploads/videos/{item_id}{ext}"],
    }
    store = get_store()
    try:
        # override first — it is the durable record delete/seed key off
        await store.set_override(f"video:{item_id}", {"doc": doc})
        await store.upsert_content_item(doc)
    except BaseException:
        # unwind a half-registered video, best-effort, before re-raising
        for cleanup in (
            lambda: store.delete_content_item(item_id),
            lambda: store.delete_override(f"video:{item_id}"),
        ):
            try:
                await cleanup()
            except Exception:
                pass
        (UPLOADS_DIR / "videos" / f"{item_id}{ext}").unlink(missing_ok=True)
        raise
    return {"content": await _content_with_flags()}


@router.delete("/content/{item_id}")
async def delete_content(item_id: str):
    """Delete uploaded content (a video or deck), including its files on disk."""
    store = get_store()
    async with _replace_lock:
        for prefix in CUSTOM_CONTENT_PREFIXES:
            override = await store.get_override(f"{prefix}{item_id}")
            if override is not None:
                break
        else:
            raise HTTPException(422, "only content uploaded via settings can be deleted")
        for asset in (override.get("doc") or {}).get("assets") or []:
            # asset_file handles both /uploads/ and legacy /content/ paths
            path = asset_file(asset)
            if path is not None:
                path.unlink(missing_ok=True)
        # uploaded decks own a directory; remove it once its slides are gone.
        # cleanup errors propagate BEFORE the records go: a failed delete stays
        # retryable, and if it never is, the next seed() heals it (missing assets
        # → the orphan branch drops the override and sweeps the directory).
        # strict containment: a hostile "deck:.." override must not reach the
        # decks root or above, and video deletions never touch this tree
        if prefix == "deck:":
            decks_root = (UPLOADS_DIR / "decks").resolve()
            deck_dir = (UPLOADS_DIR / "decks" / item_id).resolve()
            if deck_dir != decks_root and deck_dir.is_relative_to(decks_root) and deck_dir.is_dir():
                shutil.rmtree(deck_dir)
        await store.delete_override(f"{prefix}{item_id}")
        await store.delete_content_item(item_id)
    return {"content": await _content_with_flags()}


# ---------- reset ----------


@router.delete("/overrides/{key}")
async def reset_override(key: str):
    """Drop one override and re-seed so the code defaults come back."""
    if key not in RESETTABLE_KEYS and not key.startswith("content:"):
        raise HTTPException(422, "unknown override key")
    store = get_store()
    async with _replace_lock:
        if key.startswith("content:"):
            override = await store.get_override(key) or {}
            if "assets" in override:
                # the deck's slides were replaced: removing the replacement
                # files restores the code slides. Errors propagate before the
                # override is deleted, so a failed reset stays retryable
                item_id = key.removeprefix("content:")
                decks_root = (UPLOADS_DIR / "decks").resolve()
                deck_dir = (UPLOADS_DIR / "decks" / item_id).resolve()
                if deck_dir != decks_root and deck_dir.is_relative_to(decks_root) and deck_dir.is_dir():
                    shutil.rmtree(deck_dir)
        await store.delete_override(key)
    # re-seed to restore the code defaults (remaining overrides are re-applied)
    await seed(store)
    return await _config()
