from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
CONTENT_DIR = BACKEND_DIR / "content"
STATIC_DIR = Path(__file__).resolve().parent / "static"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"
    anthropic_max_tokens: int = 1024

    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    elevenlabs_model: str = "eleven_flash_v2_5"
    # pcm_22050 is broadly available; drop to pcm_16000 if the account tier rejects it
    tts_output_format: str = "pcm_22050"
    tts_sample_rate: int = 22050
    tts_lookahead: int = 2

    # HeyGen LiveAvatar (LITE mode). heygen_avatar_id is the default avatar; a
    # selection made in the settings view overrides it (see
    # orchestrator.agent.resolve_avatar_id). Avatar mode needs the API key plus
    # an avatar from either source; otherwise the audio-only experience runs.
    heygen_api_key: str = ""
    heygen_avatar_id: str = ""
    heygen_sandbox: bool = False
    # LiveAvatar hard-caps session length per plan (300s on the current tier —
    # requesting more is a 400). Sessions are rotated at turn boundaries before
    # the cap so the avatar never dies mid-sentence; raise this if the plan does.
    heygen_max_session_secs: int = 300
    liveavatar_api_base: str = "https://api.liveavatar.com"
    # LiveAvatar ingests PCM 16-bit 24 kHz; the browser pipeline stays on 22.05k
    avatar_tts_output_format: str = "pcm_24000"
    avatar_tts_sample_rate: int = 24000

    mongodb_url: str = ""
    port: int = 8000

    # ---- credit-based consumption (see app/credits.py) ----
    # 1 credit = this many USD of metered provider cost (default: 1 credit = 1¢).
    # Validated at startup: a zero/negative/non-finite price would invert or
    # silently break the accounting.
    credit_usd: float = Field(default=0.01, gt=0, allow_inf_nan=False)
    # Provider price table used to convert raw usage into credits. Defaults match
    # common published rates; tune them to your actual plans.
    claude_input_usd_per_mtok: float = Field(default=3.0, ge=0, allow_inf_nan=False)
    claude_output_usd_per_mtok: float = Field(default=15.0, ge=0, allow_inf_nan=False)
    tts_usd_per_1k_chars: float = Field(default=0.15, ge=0, allow_inf_nan=False)
    avatar_usd_per_min: float = Field(default=0.50, ge=0, allow_inf_nan=False)
    # Stripe Checkout for buying credit packs from the settings view. Leave unset
    # to run without purchases (credits can still be granted manually). The
    # webhook must be pointed at POST /api/billing/stripe-webhook and subscribed
    # to checkout.session.completed.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    # Absolute base URL of this deployment (e.g. https://demo.example.com), used
    # for Stripe success/cancel redirects. Falls back to the request's origin.
    public_base_url: str = ""

    # When set, /api/admin/* (the settings view's API) requires this token in an
    # X-Admin-Token header. Leave empty for open access in local dev.
    admin_token: str = ""

    # Where settings-view uploads (logo, persona photo, videos) are stored.
    # Defaults to backend/uploads; point it at a mounted volume to keep uploads
    # across redeploys (on Railway, mount the volume at /srv/uploads instead —
    # no env var needed).
    uploads_dir: str = ""


settings = Settings()

# Uploaded assets live outside CONTENT_DIR so a persistence volume can be
# mounted here without shadowing the repo-baked content (slides, seed videos).
UPLOADS_DIR = Path(settings.uploads_dir).resolve() if settings.uploads_dir else BACKEND_DIR / "uploads"


def asset_file(url_path: str) -> Path | None:
    """Map a served asset path (/uploads/... or /content/...) to its file on
    disk; None for non-strings, unknown prefixes, or paths escaping their root."""
    if not isinstance(url_path, str):
        return None  # malformed persisted data must never break seeding or deletes
    for prefix, root in (("/uploads/", UPLOADS_DIR), ("/content/", CONTENT_DIR)):
        if url_path.startswith(prefix):
            path = (root / url_path.removeprefix(prefix)).resolve()
            return path if path.is_relative_to(root.resolve()) else None
    return None
