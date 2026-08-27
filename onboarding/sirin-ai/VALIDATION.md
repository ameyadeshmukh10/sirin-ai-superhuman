# Sirin AI onboarding — validation

Try it first: open http://localhost:5174 (5173 was taken by another dev
server), click through the landing page, and have a real conversation with
Sage — ask what Sirin AI does, ask for pricing, ask a hard question, interrupt
mid-sentence.

Legend: [ ] open · [x] resolved · [~] deferred by user · [s] superseded

## Must confirm (facts the persona states out loud)
- [x] Proof allowlist — approve each line (from prompt.py "Proof you may cite"):
      - The site names no customers, metrics, or testimonials, so the
        allowlist is EMPTY: the persona cites no proof and offers to connect
        with the team when asked. (Northstar Systems / Acme Holdings /
        Meridian Systems on sirin-ai.com are fictional UI-demo names and are
        explicitly barred.) Confirm, or supply real customers/metrics I may
        add.
- [x] Pricing — the site publishes no pricing, so the persona deflects to a
      meeting ("pricing is tailored to the work the agent takes on") — confirm,
      or provide tiers I should state.
- [x] Booking URL — CTA points at https://calendly.com/cole-brooker-sirin-ai/30min
      (the "Start a conversation" link on sirin-ai.com). Confirm this is the
      right booking destination for this experience.
- [x] Security/compliance — the site makes no SOC 2 / GDPR / ISO claims, so
      Sage deflects security specifics to a meeting. Anything citable?
- [x] Integrations — the site names no specific systems ("the systems your
      teams already operate across"), so Sage names none. Any I may allow?
- [~] Keyless mode — no ANTHROPIC_API_KEY is set in this worktree, so Sage
      currently answers with the fallback line. Provide/export a key (backend
      .env) to talk to the real persona.

## Should review (identity and look)
- [x] Persona name "Sage" — alternatives: Wren, Skye, Cora
- [x] Greeting and suggested topics — say them out loud once
      (topics: "What is Sirin AI?" / "What can an agent take on?" / "How do we
      start?")
- [x] Colors — accent #a57c4f (Sirin's exact bronze; ink-on-accent 4.70:1,
      passes) on dark #17191a/#202124 (Sirin's own charcoals); muted text uses
      the brand's sage #a9b69c and the stage gradient is deep sage — confirm
      the sage notes feel right.
- [~] Wordmark — styled text "SIRIN AI" (cream + bronze "AI"), matching the
      site's text header; favicon is the site's own wave-mark favicon.svg —
      provide a dark-background logo file to upgrade the header to the wave
      mark + wordmark.
- [x] Typography — system sans stack (the site's actual body font; the site
      declares display serif "Canela" but never loads it, falling back to
      Georgia). Want "Cormorant Garamond" (their declared serif fallback, on
      Google Fonts) as the app's brand font instead, or font files for the
      licensed Canela?

## Materials you can provide (each upgrades the experience)
- [~] Real slide exports (PNG, 1600×900) to replace placeholders — per deck:
      - overview: 5 slides (built around your business → delivered whole →
        four layers → the work it's built for → prototype vs. operating)
      - how_it_works: 4 slides (brief-to-agent → custom agent → connected
        systems + UI → managed after deployment)
      - differentiation: 3 slides (prototype gap → not assembled → no
        platform evaluation)
      - trust: 2 slides (context·action·clarity·control → real operating
        conditions)
      - pricing: 2 slides (start with the work → start a conversation)
- [~] A demo video → backend/content/videos/demo.mp4 + a VIDEOS entry in
      seed_data.py (files without an entry are ignored at seed time; the old
      EverWorker reel was removed)
- [~] A persona image → backend/content/persona.png (else the initial-orb shows)
- [~] Voice: set ELEVENLABS_VOICE_ID in .env to a voice that fits Sage
      (env-only; the persona is silent-with-text without a key)

All items resolved or deferred on 2026-08-27 (validation loop with user).
