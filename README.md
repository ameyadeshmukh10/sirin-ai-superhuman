# Superhuman — a real-time AI sales rep for any B2B website

A 1mind.com-style AI "Superhuman": a voice-first, avatar-ready AI sales agent that
talks with website visitors in real time, presents slide decks the way a rep would,
plays demo videos, handles objections, and drives qualified visitors to book a
meeting. Built end-to-end — streaming voice pipeline, live avatar, agentic tool
use, no-code admin, embeddable widget, and usage-based monetization — and
rebrandable for any B2B company in one command.

**Stack**: Claude (Anthropic API) · ElevenLabs streaming TTS · HeyGen LiveAvatar +
LiveKit WebRTC · FastAPI (Python 3.12, asyncio) · React 18 + TypeScript + Vite +
Tailwind 4 · MongoDB · Stripe · Railway.

---

## What it can do

### 🗣️ Real-time voice conversation
Claude's token stream is chunked into sentences on the fly and piped through
ElevenLabs streaming TTS (`eleven_flash_v2_5`), so the persona starts *speaking*
while the model is still writing. Everything rides one WebSocket per session —
JSON events plus raw binary PCM audio frames — with sentences synthesized
concurrently (lookahead) but relayed in strict order. If a sentence's audio
fails, its text reveals instantly and the conversation keeps moving.

### 🧑‍💼 Photoreal live avatar mode
Flip two env vars and the static persona becomes a lip-synced, photoreal
streaming avatar (HeyGen LiveAvatar, rendered in-browser over LiveKit WebRTC) —
speaking with *your chosen ElevenLabs voice*, since the backend pushes its own
PCM into the avatar session. The runner rotates avatar sessions before the
provider's duration cap so they never die mid-sentence, restarts dead sessions,
and degrades gracefully to audio-only if the avatar can't come back. Pick the
presenter from a bundled avatar catalog right in the settings UI.

### 🎤 Full-duplex voice input with barge-in
The mic stays live while the persona speaks. The moment a visitor talks over it,
the persona hushes mid-sentence (a generation counter makes interrupts race-free
— stale audio and events are dropped, never played). Guards keep the persona's
own voice from triggering a self-interrupt, and if a visitor barges in but then
trails off, the persona waits a beat and warmly hands them the floor instead of
sitting in dead air. Interrupted replies are persisted as interrupted, so the
model knows what the visitor actually heard.

### 📊 Presents like a rep, not a chatbot
The agent has tools, and it uses them the way a good seller would:

- `show_slides` / `go_to_slide` — full deck walkthroughs where each slide's
  presenter notes are spoken **verbatim, server-side** as the scripted talk
  track. Slides advance exactly when the narration reaches them: in avatar mode
  a pacer walks the turn's timeline against each utterance's measured PCM
  duration, so a slide flip lands only after the sentence before it finishes
  playing.
- `play_video` — cue up demo clips in the media pane.
- `set_suggested_topics` — refreshes next-step topic chips after every reply.
- `show_book_meeting_cta` — lights up the booking button on buying signals.

Behind it sits a real GTM playbook in the system prompt: visitor journeys
(DISCOVER → DEMO → PRICING → CLOSE), objection handling, voice-first writing
rules, and hard no-fabrication guardrails (no invented customers, metrics, or
pricing — pricing questions route to a meeting, by design).

### 🎨 No-code runtime configuration
A `/settings` view (token-protected in production) edits the entire experience
live — no redeploy:

- **Brand & appearance** — wordmark or uploaded logo, booking URL, every core UI
  color, and heading/body fonts from a curated Google Fonts set, served to all
  visitors as a theme override.
- **Persona** — name, tagline, greeting, suggested topics, photo, and voice
  (picked from a curated ElevenLabs list).
- **Avatar** — browse the HeyGen public-avatar catalog and pick the presenter.
- **Messaging** — swap the GTM knowledge block injected into every conversation.
- **Content** — upload slideware as a PDF (pages rendered to slides server-side,
  up to 40 pages / 60MB) or as images, edit per-slide presenter notes (the talk
  track), and upload demo videos with descriptions that steer when the AI plays
  them. Every section has a one-click reset to defaults.

Edits are stored as overrides on top of seeded defaults, survive restarts with
MongoDB, and apply to new sessions immediately.

### 🔌 Embeds anywhere
One script tag —

```html
<script src="https://<your-deployment>/embed.js" async></script>
```

— drops a chat-bubble widget onto any site, animating through mini bubble →
teaser card → chat panel → full experience, with mobile-full-bleed handling and
mic/autoplay permissions wired through the iframe. The same product also runs as
a standalone destination URL or a full-page web experience.

### 💳 Metered, monetizable usage
Every conversation's real cost — Claude tokens, ElevenLabs characters, avatar
minutes — is metered into a credit wallet (1 credit ≈ 1¢ of provider cost,
tunable) backed by an idempotent, append-only ledger in integer millicredits, so
retries can't double-charge and float drift can't accumulate. Credits are sold
as Stripe Checkout packs with volume bonuses, or granted manually
(admin-token-gated, so an open deploy can never mint credits). Optional
enforcement pauses new conversations gracefully — with a polite handoff to the
booking CTA — when the balance runs out. A usage dashboard shows balance,
per-service consumption, and recent activity.

### 🤖 AI-powered brand onboarding
The repo ships a Claude Code skill (`.claude/skills/brand-onboarding/`) that
rebrands the entire experience for any B2B company from just its website URL:
ask Claude Code to *"onboard https://company.com"* and it researches the brand
(logo, colors, typography) and go-to-market content (positioning, proof points,
pricing posture) under a strict no-fabrication policy, reconfigures theme,
wordmark, persona, GTM knowledge, decks, and CTA, relaunches the app, and walks
through a validation checklist with you. New company, on-brand AI sales rep,
minutes not weeks.

### 📈 Session analytics & resilience
Full transcripts, interrupts, tool usage, and message sources (typed / voice /
topic chip) are logged per session to MongoDB (with an automatic in-memory
fallback for dev). The greeting is a scripted, zero-LLM opener — instant and
free. Missing API keys degrade gracefully instead of crashing: no Anthropic key
→ canned reply; no ElevenLabs key → text-only; no Mongo → in-memory store.

---

## Architecture

```
Browser (React SPA / embed widget)       FastAPI backend                     Services
┌────────────────────────────┐  WebSocket ┌──────────────────────────┐
│ Landing → /session/:id     │◄──────────►│ SessionRunner (per WS)   │──► Claude (Anthropic API)
│ chat / topics / mic        │ json + PCM │  Claude stream → sentence│──► ElevenLabs TTS (PCM)
│ Web Audio PCM player       │            │  chunker → TTS relay     │──► HeyGen LiveAvatar
│ Web Speech mic input       │  WebRTC    │  tools → UI events       │      (LiveKit WebRTC)
│ LiveKit avatar video       │◄─────────  │  credit metering         │──► Stripe (checkout + webhook)
└────────────────────────────┘            └──────────────────────────┘──► MongoDB (or in-memory)
```

The details that make it feel human:

- **One WebSocket per session**: JSON events + binary audio frames (8-byte
  header: `uint32 gen`, `uint32 seq`, then PCM s16le mono @ 22050 Hz).
- **Race-free interrupts**: a generation counter (`gen`) means any stale
  events/audio from a cancelled turn are simply dropped.
- **One ordering spine**: sentences and UI actions share a single `seq`
  ordering, so a slide appears right as the sentence introducing it starts
  playing — in avatar mode, a pacer times UI actions to the avatar's actual
  playback using exact PCM durations.
- **Deterministic narration**: deck walkthrough talk tracks are spoken verbatim
  from presenter notes by the server, not improvised by the model.
- **Single-process by design**: live sessions in memory, in-process file locks —
  one replica (`railway.json` pins `numReplicas: 1`), no distributed-state
  complexity until it's needed.

## Local development

Requirements: `uv` (Python 3.12) and Node 20+.

```bash
cp .env.example .env   # then fill in your API keys
```

Backend:

```bash
cd backend
uv venv --python 3.12 && uv pip install -r requirements.txt
uv run uvicorn app.main:app --reload --port 8000
```

Frontend (dev server proxies /api, /ws, /content to :8000):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

Without API keys the app still runs: no `ANTHROPIC_API_KEY` → the persona
replies with a canned error message; no `ELEVENLABS_API_KEY` → audio is skipped
and text appears immediately. Without `MONGODB_URL` an in-memory store is used
(sessions lost on restart).

## Content

- Slides: PNGs under `backend/content/slides/<deck_id>/`, registered in
  `backend/app/seed_data.py`. Placeholders are generated by
  `backend/scripts/generate_placeholder_slides.py`.
- Videos: drop MP4s into `backend/content/videos/` and register them in
  `seed_data.py` (video items whose file is missing are skipped at seed time).
- Persona image: drop `persona.jpg` (or .png) into `backend/content/` — the UI
  falls back to a generated avatar if absent.
- Persona voice, greeting, topics, and the GTM system prompt:
  `backend/app/seed_data.py` and `backend/app/orchestrator/prompt.py`.
- Runtime alternative: everything above is also editable without touching code
  in the settings view (below), including PDF/image deck uploads and video
  uploads.

## Settings view

The gear icon on the landing page (or `/settings`) opens the configuration view
described in "No-code runtime configuration" above. Sections are grouped into
tabs — Branding, Persona, Messaging, Content and Credits — with the active tab
kept in the URL (`?tab=…`) so links and reloads land on the right group.

Edits are stored as override documents on top of the seeded defaults
(`backend/app/seed_data.py` stays the base; `seed()` re-applies overrides on
startup), so they survive restarts when MongoDB is configured and apply to new
sessions immediately. Each section has a "Reset to defaults" that drops its
override. Uploaded files land under `backend/uploads/` (served at `/uploads`),
kept separate from the repo-baked assets in `backend/content/` so a persistence
volume can be mounted there: on Railway, attach a volume at `/srv/uploads` (or
point the `UPLOADS_DIR` env var at your mount) and uploads survive redeploys
along with the Mongo-backed edits. Without a volume they last until the next
redeploy.

Credit wallet notes: metering is post-hoc, so tiny overdrafts at turn boundaries
are expected; Stripe packs require `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
with the webhook pointed at `POST /api/billing/stripe-webhook` for
`checkout.session.completed`. Wallet mutations (manual grants, the enforcement
toggle) always require `ADMIN_TOKEN` to be set, even in otherwise-open local
dev — an open deploy must not be able to mint credits.

Set `ADMIN_TOKEN` to protect the settings API on a public deployment; the
settings page will prompt for the token. Unset means open access (local dev).

## Rebranding for a company

The whole experience (theme, wordmark, persona, GTM knowledge, decks, CTA) can
be reconfigured for any B2B company from its website URL with the
`brand-onboarding` Claude Code skill (`.claude/skills/brand-onboarding/`): ask
Claude Code to "onboard https://company.com". It researches the company with a
strict no-fabrication policy, applies the configuration, relaunches the app,
and then walks through a validation checklist with you
(`onboarding/<slug>/VALIDATION.md`, where `<slug>` is the lowercase hyphenated
company name). Brand seams it relies on: the `@theme` block in
`frontend/src/index.css`, `frontend/src/brand.ts`, and the two backend content
files above. The current build is configured for Sirin AI as the demo brand.

## Deploy (Railway)

1. Push this repo to GitHub; create a Railway project from it (Dockerfile is detected).
2. Add a **MongoDB** service to the project.
3. On the app service set variables:
   - `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`
   - avatar mode (optional): `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`
     (+ `HEYGEN_SANDBOX=true` for free watermarked testing)
   - `MONGODB_URL` = `${{ MongoDB.MONGO_URL }}` (private-network reference var)
   - `ADMIN_TOKEN` (recommended: protects the `/settings` view's API)
   - optional: `ANTHROPIC_MODEL`, `ELEVENLABS_VOICE_ID`
   - selling credits (optional): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
     `PUBLIC_BASE_URL` (the app's domain), with a Stripe webhook pointed at
     `https://<domain>/api/billing/stripe-webhook` for
     `checkout.session.completed`
4. To keep settings-view uploads (logo, persona photo, videos) across
   redeploys, add a **volume** to the app service mounted at `/srv/uploads`
   (or mount elsewhere and set `UPLOADS_DIR` to that path).
5. Healthcheck path is `/api/health` (set in `railway.json`). Generate a domain.

Keep the app at a single instance (`railway.json` pins `numReplicas: 1`): the
whole app is single-process by design — live sessions are held in memory, and
the settings view's file writes rely on in-process locking. Scaling out would
need shared session state and distributed locks, not just more replicas.

## Smoke test

```bash
cd backend
uv run python scripts/smoke.py http://localhost:8000
```

Creates a session, connects the WebSocket, asserts greeting/text/audio/topic
events, asks for pricing (expects `show_slides`), and interrupts mid-response.

## About

Designed and built end-to-end by [Ameya Deshmukh](https://github.com/ameyadeshmukh10)
as a GTM engineering project: one person shipping the full surface of an AI
revenue product — real-time voice orchestration, live avatar streaming, agentic
sales tooling, a no-code admin, an embeddable widget, usage-based billing, and
AI-assisted customer onboarding. See `roadmap.md` for how it was sequenced
(audio-first for cost discipline, avatar streaming once the conversation was
worth streaming) and what's next.
