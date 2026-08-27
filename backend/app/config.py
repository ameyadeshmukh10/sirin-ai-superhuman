from pathlib import Path

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

    # HeyGen LiveAvatar (LITE mode) — setting both key and avatar id turns avatar
    # mode on; unset means the audio-only experience, unchanged.
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

    # When set, /api/admin/* (the settings view's API) requires this token in an
    # X-Admin-Token header. Leave empty for open access in local dev.
    admin_token: str = ""

    @property
    def avatar_enabled(self) -> bool:
        return bool(self.heygen_api_key and self.heygen_avatar_id)


settings = Settings()
