import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import seed_data
from .config import CONTENT_DIR, STATIC_DIR, settings
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
app.include_router(ws_router)

if CONTENT_DIR.exists():
    app.mount("/content", StaticFiles(directory=CONTENT_DIR), name="content")

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
