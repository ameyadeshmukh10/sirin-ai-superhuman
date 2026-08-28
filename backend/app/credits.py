"""Credit-based consumption metering for the paid backends.

One wallet of credits covers everything the app spends money on: Claude tokens,
ElevenLabs TTS characters, and LiveAvatar minutes. Each metered event converts
real usage into credits through the price table in config (1 credit =
settings.credit_usd of provider cost, 1¢ by default) and decrements the wallet;
an append-only ledger backs the settings view's usage dashboard.

Balances are stored as integer millicredits (mc, 1/1000 credit) so repeated
tiny charges never accumulate float drift.

Metering is always on — the dashboard shows consumption even before any
credits are granted. Enforcement is opt-in: the "credits" override's `enabled`
flag (settings view toggle) makes a zero balance block new sessions and new
conversation turns. Metering happens after usage, so small overdrafts are
expected and harmless.

Metering must never break a conversation: every consume_* helper swallows and
logs its own failures.
"""

from __future__ import annotations

import logging

from .config import settings
from .store import get_store

log = logging.getLogger("credits")

# Credit packs offered in the settings view when Stripe is configured. Larger
# packs carry a volume bonus; unit_usd_cents is what Stripe charges.
PACKS: dict[str, dict] = {
    "starter": {"label": "Starter", "credits": 1_000, "usd_cents": 10_00},
    "growth": {"label": "Growth", "credits": 5_500, "usd_cents": 50_00},
    "scale": {"label": "Scale", "credits": 24_000, "usd_cents": 200_00},
}

SERVICES = ("claude", "tts", "avatar")


def usd_to_mc(usd: float) -> int:
    """Convert a USD cost into millicredits via the configured credit price."""
    return max(0, round(usd / settings.credit_usd * 1000))


def mc_to_credits(mc: int) -> float:
    """Millicredits to credits, rounded for display."""
    return round(mc / 1000, 2)


async def _consume(service: str, units: float, usd: float, session_id: str | None) -> bool:
    """Record one metered usage event; never raises. True once recorded."""
    try:
        mc = usd_to_mc(usd)
        if mc <= 0:
            return True  # nothing to record is not a failure
        await get_store().adjust_credits(
            -mc,
            {
                "kind": "use",
                "service": service,
                "units": round(units, 3),
                "mc": mc,
                "session_id": session_id,
            },
        )
        return True
    except Exception:
        log.exception("metering %s failed (usage not recorded)", service)
        return False


async def consume_claude(input_tokens: int, output_tokens: int, session_id: str | None) -> bool:
    """Meter one Claude API round from its reported token usage."""
    usd = (
        input_tokens / 1_000_000 * settings.claude_input_usd_per_mtok
        + output_tokens / 1_000_000 * settings.claude_output_usd_per_mtok
    )
    return await _consume("claude", input_tokens + output_tokens, usd, session_id)


async def consume_tts(chars: int, session_id: str | None = None) -> bool:
    """Meter one successfully synthesized TTS sentence by character count."""
    return await _consume("tts", chars, chars / 1000 * settings.tts_usd_per_1k_chars, session_id)


async def consume_avatar(seconds: float, session_id: str | None = None) -> bool:
    """Meter one closed LiveAvatar session by its wall-clock duration."""
    return await _consume(
        "avatar", seconds, seconds / 60 * settings.avatar_usd_per_min, session_id
    )


async def credits_config(store) -> dict:
    """The stored enforcement settings, with defaults applied."""
    override = await store.get_override("credits") or {}
    return {
        "enabled": bool(override.get("enabled", False)),
        "low_threshold": int(override.get("low_threshold", 100)),
    }


async def blocked(store) -> bool:
    """True when enforcement is on and the wallet is empty; never raises.

    Fails closed once enforcement is known to be on: the operator opted into
    a hard spend limit, so an unreadable wallet blocks rather than letting
    unmetered usage through. An unreadable *config* fails open — enforcement
    may not even be in use, and blocking every visitor on any store hiccup
    would be worse."""
    try:
        if not (await credits_config(store))["enabled"]:
            return False
    except Exception:
        log.exception("credit config read failed — allowing the request")
        return False
    try:
        return (await store.get_wallet())["balance_mc"] <= 0
    except Exception:
        log.exception("wallet read failed while enforcement is on — blocking")
        return True


async def summary(store) -> dict:
    """Everything the settings view's Credits section shows."""
    wallet = await store.get_wallet()
    config = await credits_config(store)
    used = wallet.get("used_mc") or {}
    units = wallet.get("units") or {}
    return {
        "balance": mc_to_credits(wallet["balance_mc"]),
        "granted": mc_to_credits(wallet.get("granted_mc", 0)),
        "used": {
            "claude": {
                "credits": mc_to_credits(used.get("claude", 0)),
                "tokens": round(units.get("claude", 0)),
            },
            "tts": {
                "credits": mc_to_credits(used.get("tts", 0)),
                "chars": round(units.get("tts", 0)),
            },
            "avatar": {
                "credits": mc_to_credits(used.get("avatar", 0)),
                "minutes": round(units.get("avatar", 0) / 60, 1),
            },
        },
        "credit_usd": settings.credit_usd,
        "enabled": config["enabled"],
        "low_threshold": config["low_threshold"],
        "stripe_configured": bool(settings.stripe_secret_key and settings.stripe_webhook_secret),
        "packs": [
            {"id": pack_id, **pack} for pack_id, pack in PACKS.items()
        ],
        "recent": [
            {
                "ts": entry.get("ts"),
                "kind": entry.get("kind"),
                "service": entry.get("service"),
                "units": entry.get("units"),
                "credits": mc_to_credits(entry.get("mc", 0)),
                "note": entry.get("note"),
            }
            for entry in await store.list_credit_entries(12)
        ],
    }
