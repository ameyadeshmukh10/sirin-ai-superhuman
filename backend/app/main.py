import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import seed_data
from .config import CONTENT_DIR, STATIC_DIR, UPLOADS_DIR, settings
from .routes.admin import router as admin_router
from .routes.api import router as api_router
from .store import init_store
from .ws.endpoint import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = await init_store(settings.mongodb_url)
    await seed_data.seed(store)
    yield


app = FastAPI(title="Sirin AI Superhuman", lifespan=lifespan)
app.include_router(api_router)
app.include_router(admin_router)
app.include_router(ws_router)

# Largest allowed /api/admin request body: the video cap plus multipart overhead.
# Enforced from the declared Content-Length BEFORE Starlette parses the body, so
# an oversized upload is refused without spooling anything to temporary disk
# (the per-file caps in routes/admin.py still guard the streamed bytes).
ADMIN_MAX_BODY_BYTES = 210 * 1024 * 1024


@app.middleware("http")
async def admin_body_size_limit(request, call_next):
    """Refuse oversized (or undeclared-length) admin write requests up front."""
    if request.url.path.startswith("/api/admin") and request.method in ("POST", "PUT", "PATCH"):
        length = request.headers.get("content-length")
        # browsers and standard clients always declare Content-Length; refuse
        # chunked admin uploads rather than let them bypass the cap
        if length is None or not length.isdigit():
            return JSONResponse({"detail": "Content-Length required"}, status_code=411)
        if int(length) > ADMIN_MAX_BODY_BYTES:
            return JSONResponse({"detail": "request body too large"}, status_code=413)
    return await call_next(request)

CONTENT_DIR.mkdir(parents=True, exist_ok=True)  # repo-baked assets (slides, seed videos)
app.mount("/content", StaticFiles(directory=CONTENT_DIR), name="content")

# Settings-view uploads live here, separate from CONTENT_DIR so a persistence
# volume (e.g. Railway volume at /srv/uploads) can be mounted without hiding
# the assets baked into the image.
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

if (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # SPA catch-all: real files first, then index.html for client-side routes
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
else:

    @app.get("/")
    async def dev_root():
        return JSONResponse(
            {"hint": "frontend not built — run the Vite dev server (frontend/) or docker build"}
        )
