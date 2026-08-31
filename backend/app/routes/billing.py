"""Stripe integration for buying credit packs.

Two pieces: `create_checkout` (called by the admin credits API) starts a Stripe
Checkout Session for one of the packs in app/credits.py, and the public webhook
below credits the wallet when Stripe reports the payment complete. Uses
Stripe's plain REST API via httpx — no SDK dependency.

Setup: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, and point a Stripe
webhook at POST /api/billing/stripe-webhook subscribed to the
checkout.session.completed event. Crediting is idempotent per Checkout Session
(a replayed webhook can't grant twice — see store.adjust_credits).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

import httpx
from fastapi import APIRouter, HTTPException, Request

from ..config import settings
from ..credits import PACKS
from ..store import get_store

log = logging.getLogger("billing")

router = APIRouter(prefix="/api/billing")

WEBHOOK_TOLERANCE_SECS = 300


async def create_checkout(pack_id: str, base_url: str) -> str:
    """Create a Stripe Checkout Session for a credit pack; returns its URL."""
    pack = PACKS.get(pack_id)
    if pack is None:
        raise HTTPException(422, "unknown credit pack")
    if not (settings.stripe_secret_key and settings.stripe_webhook_secret):
        raise HTTPException(503, "Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)")
    base = (settings.public_base_url or base_url).rstrip("/")
    form = {
        "mode": "payment",
        "success_url": f"{base}/settings?tab=credits&credits=purchased",
        "cancel_url": f"{base}/settings?tab=credits",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(pack["usd_cents"]),
        "line_items[0][price_data][product_data][name]": f"{pack['label']} pack — {pack['credits']:,} credits",
        "metadata[credits]": str(pack["credits"]),
        "metadata[pack]": pack_id,
    }
    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.post(
            "https://api.stripe.com/v1/checkout/sessions",
            data=form,
            auth=(settings.stripe_secret_key, ""),
        )
    if resp.status_code != 200:
        log.warning("stripe checkout creation failed: %s %s", resp.status_code, resp.text[:300])
        raise HTTPException(502, "couldn't start the Stripe checkout")
    return resp.json()["url"]


def _verify_signature(payload: bytes, header: str, secret: str) -> bool:
    """Verify a Stripe-Signature header (t=...,v1=... HMAC-SHA256 scheme).

    During signing-secret rotation Stripe includes one v1 signature per active
    secret — the request is valid when ANY of them matches ours."""
    timestamp = ""
    signatures: list[str] = []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp.isdigit() or not signatures:
        return False
    if abs(time.time() - int(timestamp)) > WEBHOOK_TOLERANCE_SECS:
        return False
    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


@router.post("/stripe-webhook")
async def stripe_webhook(request: Request):
    """Credit the wallet when a Checkout Session completes (signature-verified)."""
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Stripe webhook not configured")
    payload = await request.body()
    header = request.headers.get("stripe-signature", "")
    if not _verify_signature(payload, header, settings.stripe_webhook_secret):
        raise HTTPException(400, "invalid signature")
    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(400, "invalid payload")

    if event.get("type") == "checkout.session.completed":
        session = (event.get("data") or {}).get("object") or {}
        credits_str = (session.get("metadata") or {}).get("credits", "")
        if session.get("payment_status") == "paid" and credits_str.isdigit():
            mc = int(credits_str) * 1000
            granted = await get_store().adjust_credits(
                mc,
                {
                    "kind": "grant",
                    "mc": mc,
                    "note": f"Stripe: {(session.get('metadata') or {}).get('pack', 'pack')}",
                    "ref": session.get("id"),
                },
            )
            if granted:
                log.info("credited %s credits from Stripe session %s", credits_str, session.get("id"))
    return {"received": True}
