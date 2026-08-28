// Settings view: runtime configuration for brand, persona, messaging and
// content. Talks to /api/admin/* (see backend/app/routes/admin.py); edits apply
// to new sessions immediately and persist across restarts when MongoDB is
// configured.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BODY_FONTS,
  DEFAULT_BODY_FONT,
  DEFAULT_HEADING_FONT,
  HEADING_FONTS,
  THEME_COLORS,
  brand as brandDefaults,
  type BrandTheme,
  type Wordmark,
} from "../brand";
import WordmarkView from "../components/Wordmark";
import {
  AdminAuthError,
  adminApi,
  getAdminToken,
  setAdminToken,
  type AdminConfig,
  type AdminContentItem,
  type AdminPersona,
  type AvatarItem,
  type AvatarState,
  type CreditsSummary,
} from "../lib/adminApi";
import { fontsHref, useBrand } from "../lib/useBrand";

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-body outline-none transition focus:border-accent/60";
const btnCls =
  "rounded-full bg-accent px-5 py-2 text-sm font-semibold text-ink transition hover:bg-accent-dim disabled:opacity-50";
const btnGhostCls =
  "rounded-full border border-line bg-panel px-4 py-2 text-sm text-muted transition hover:border-accent/50 hover:text-accent disabled:opacity-50";

type SaveState = "idle" | "saving" | "saved";

/**
 * Hook for managing save state and errors, ensuring one operation at a time.
 */
function useSave(onAuthNeeded: () => void) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async (action: () => Promise<void>) => {
    // one in-flight action per section: a save, reset, upload or delete that
    // overlaps another could apply out of order and leave stale state behind
    if (busy.current) return;
    busy.current = true;
    setState("saving");
    setError(null);
    try {
      await action();
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("idle");
      if (err instanceof AdminAuthError) {
        onAuthNeeded();
        setError("Admin token required.");
      } else {
        setError(err instanceof Error ? err.message : "Request failed.");
      }
    } finally {
      busy.current = false;
    }
  };
  return { state, error, run };
}

/**
 * Submit button that shows saving/saved state.
 */
function SaveButton({ state, label = "Save" }: { state: SaveState; label?: string }) {
  return (
    <button type="submit" disabled={state === "saving"} className={btnCls}>
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : label}
    </button>
  );
}

/**
 * Container section with title and optional hint text.
 */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card rounded-2xl p-7">
      <h2 className="font-display text-[22px] font-medium">{title}</h2>
      {hint && <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">{hint}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Form field with label.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * Display an error message if present.
 */
function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-red-800">{error}</p> : null;
}

// ---------- brand ----------

/**
 * Section for managing brand settings (wordmark and book-a-meeting URL).
 */
function BrandSection({
  config,
  onConfig,
  onAuthNeeded,
}: {
  config: AdminConfig;
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const { refresh } = useBrand();
  const save = useSave(onAuthNeeded);
  const effective = config.brand.wordmark ?? brandDefaults.wordmark;
  const [mode, setMode] = useState<"text" | "logo">(effective.kind);
  const [text, setText] = useState(effective.kind === "text" ? effective.text : "");
  const [accentStart, setAccentStart] = useState(
    effective.kind === "text" ? effective.accentStart : 0,
  );
  const [accentEnd, setAccentEnd] = useState<number | "">(
    effective.kind === "text" ? (effective.accentEnd ?? "") : "",
  );
  const [alt, setAlt] = useState(effective.kind === "logo" ? effective.alt : "");
  const [bookUrl, setBookUrl] = useState(
    config.brand.book_meeting_url ?? brandDefaults.bookMeetingUrl,
  );
  const logoSrc = config.brand.wordmark?.kind === "logo" ? config.brand.wordmark.src : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      let wordmark: Wordmark | undefined;
      if (mode === "text") {
        if (!text.trim()) throw new Error("Wordmark text is required.");
        wordmark = {
          kind: "text",
          text: text.trim(),
          accentStart: Math.max(0, accentStart || 0),
          ...(accentEnd === "" ? {} : { accentEnd: Math.max(0, accentEnd) }),
        };
      } else if (logoSrc) {
        wordmark = { kind: "logo", src: logoSrc, alt: alt.trim() || "logo" };
      } else {
        throw new Error("Upload a logo image first.");
      }
      const res = await adminApi.updateBrand({ wordmark, book_meeting_url: bookUrl.trim() });
      onConfig({ brand: res.brand });
      refresh();
    });
  };

  const uploadLogo = (file: File) =>
    save.run(async () => {
      const res = await adminApi.uploadLogo(file);
      onConfig({ brand: res.brand });
      setMode("logo");
      refresh();
    });

  const reset = () =>
    save.run(async () => {
      const fresh = await adminApi.resetOverride("brand");
      onConfig(fresh);
      setMode(brandDefaults.wordmark.kind);
      if (brandDefaults.wordmark.kind === "text") {
        setText(brandDefaults.wordmark.text);
        setAccentStart(brandDefaults.wordmark.accentStart);
        setAccentEnd(brandDefaults.wordmark.accentEnd ?? "");
      }
      setBookUrl(brandDefaults.bookMeetingUrl);
      refresh();
    });

  return (
    <Section
      title="Brand"
      hint="The wordmark shown in the app header, and where “Book a Meeting” sends people."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-5 text-sm">
          <span className="text-[12px] font-medium tracking-wide text-muted">Wordmark</span>
          {(["text", "logo"] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="wordmark-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-(--color-accent)"
              />
              {m === "text" ? "Text" : "Logo image"}
            </label>
          ))}
          <span className="ml-auto flex items-center gap-2 text-[13px] text-muted">
            Current: <WordmarkView className="text-base" />
          </span>
        </div>

        {mode === "text" ? (
          <div className="grid grid-cols-[1fr_110px_110px] gap-3">
            <Field label="Text">
              <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Accent from">
              <input
                type="number"
                min={0}
                value={accentStart}
                onChange={(e) => setAccentStart(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field label="Accent to">
              <input
                type="number"
                min={0}
                placeholder="end"
                value={accentEnd}
                onChange={(e) =>
                  setAccentEnd(e.target.value === "" ? "" : Number(e.target.value))
                }
                className={inputCls}
              />
            </Field>
          </div>
        ) : (
          <div className="flex items-end gap-4">
            {logoSrc ? (
              <img src={logoSrc} alt="logo" className="h-10 rounded bg-panel-2 p-1" />
            ) : (
              <p className="text-sm text-muted">No logo uploaded yet.</p>
            )}
            <FilePicker
              label={logoSrc ? "Replace logo…" : "Upload logo…"}
              accept="image/*,.svg"
              onPick={uploadLogo}
              disabled={save.state === "saving"}
            />
            <div className="flex-1">
              <Field label="Alt text">
                <input value={alt} onChange={(e) => setAlt(e.target.value)} className={inputCls} />
              </Field>
            </div>
          </div>
        )}

        <Field label="Book-a-meeting URL">
          <input value={bookUrl} onChange={(e) => setBookUrl(e.target.value)} className={inputCls} />
        </Field>

        <div className="flex items-center gap-3">
          <SaveButton state={save.state} />
          <button
            type="button"
            onClick={reset}
            disabled={save.state === "saving"}
            className={btnGhostCls}
          >
            Reset to defaults
          </button>
          <ErrorText error={save.error} />
        </div>
      </form>
    </Section>
  );
}

// ---------- appearance (colors & fonts) ----------

const HEX_INPUT_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Normalize #rgb/#rrggbb input to lowercase #rrggbb; null when not a hex code.
 */
function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!HEX_INPUT_RE.test(v)) return null;
  const hex = v.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return `#${full.toLowerCase()}`;
}

/**
 * Derive the appearance form's state from a stored theme override.
 */
function themeForm(theme: BrandTheme) {
  return {
    colors: Object.fromEntries(
      THEME_COLORS.map((c) => [c.key, theme.colors?.[c.key] ?? c.default]),
    ) as Record<string, string>,
    headingFont: theme.heading_font ?? DEFAULT_HEADING_FONT,
    bodyFont: theme.body_font ?? DEFAULT_BODY_FONT,
  };
}

/**
 * Section for theming the experience: hex codes for each color token and
 * Google Font pickers for heading and body text.
 */
function AppearanceSection({
  theme,
  onConfig,
  onAuthNeeded,
}: {
  theme: BrandTheme;
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const { refresh } = useBrand();
  const save = useSave(onAuthNeeded);
  const [form, setForm] = useState(() => themeForm(theme));
  const setColor = (key: string, value: string) =>
    setForm({ ...form, colors: { ...form.colors, [key]: value } });

  // Load every catalog font once so the pickers can preview their choices.
  useEffect(() => {
    if (document.getElementById("font-preview-css")) return;
    const link = document.createElement("link");
    link.id = "font-preview-css";
    link.rel = "stylesheet";
    link.href = fontsHref([...HEADING_FONTS, ...BODY_FONTS]);
    document.head.appendChild(link);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      // only differences from the code defaults are stored, so a code-level
      // rebrand keeps flowing through for anything left untouched here
      const colors: Record<string, string> = {};
      for (const c of THEME_COLORS) {
        const normalized = normalizeHex(form.colors[c.key] ?? "");
        if (!normalized) throw new Error(`${c.label}: enter a hex code like ${c.default}.`);
        if (normalized !== c.default) colors[c.key] = normalized;
      }
      const res = await adminApi.updateTheme({
        colors,
        heading_font: form.headingFont === DEFAULT_HEADING_FONT ? null : form.headingFont,
        body_font: form.bodyFont === DEFAULT_BODY_FONT ? null : form.bodyFont,
      });
      onConfig({ theme: res.theme });
      setForm(themeForm(res.theme)); // reflect the normalized stored values
      refresh();
    });
  };

  const reset = () =>
    save.run(async () => {
      const fresh = await adminApi.resetOverride("theme");
      onConfig(fresh);
      setForm(themeForm(fresh.theme));
      refresh();
    });

  const headingSerif = HEADING_FONTS.find((f) => f.name === form.headingFont)?.serif ?? true;
  const bodySerif = BODY_FONTS.find((f) => f.name === form.bodyFont)?.serif ?? false;

  return (
    <Section
      title="Appearance"
      hint="The colors and typography of the whole experience. Enter a hex code for each element (or use the swatch picker), choose the fonts, and save — every visitor sees the new look immediately."
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEME_COLORS.map((c) => {
            const value = form.colors[c.key] ?? "";
            const normalized = normalizeHex(value);
            return (
              <label key={c.key} className="block" title={c.hint}>
                <span className="mb-1.5 block text-[12px] font-medium tracking-wide text-muted">
                  {c.label}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={normalized ?? c.default}
                    onChange={(e) => setColor(c.key, e.target.value)}
                    aria-label={`${c.label} color picker`}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-panel-2 p-1"
                  />
                  <input
                    value={value}
                    onChange={(e) => setColor(c.key, e.target.value)}
                    placeholder={c.default}
                    spellCheck={false}
                    className={`${inputCls} font-mono text-[13px] ${
                      normalized ? "" : "border-red-800/50"
                    }`}
                  />
                </div>
              </label>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Heading font">
            <select
              value={form.headingFont}
              onChange={(e) => setForm({ ...form, headingFont: e.target.value })}
              className={inputCls}
            >
              {HEADING_FONTS.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                  {f.name === DEFAULT_HEADING_FONT ? " (default)" : ""}
                </option>
              ))}
            </select>
            <p
              className="mt-2 truncate text-xl text-body"
              style={{ fontFamily: `"${form.headingFont}", ${headingSerif ? "serif" : "sans-serif"}` }}
            >
              A headline in {form.headingFont}
            </p>
          </Field>
          <Field label="Body font">
            <select
              value={form.bodyFont}
              onChange={(e) => setForm({ ...form, bodyFont: e.target.value })}
              className={inputCls}
            >
              {BODY_FONTS.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                  {f.name === DEFAULT_BODY_FONT ? " (default)" : ""}
                </option>
              ))}
            </select>
            <p
              className="mt-2 truncate text-sm text-body"
              style={{ fontFamily: `"${form.bodyFont}", ${bodySerif ? "serif" : "sans-serif"}` }}
            >
              Body copy set in {form.bodyFont} for easy reading.
            </p>
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <SaveButton state={save.state} />
          <button
            type="button"
            onClick={reset}
            disabled={save.state === "saving"}
            className={btnGhostCls}
          >
            Reset to defaults
          </button>
          <ErrorText error={save.error} />
        </div>
      </form>
    </Section>
  );
}

// ---------- persona ----------

// Curated ElevenLabs voices for the persona. The dropdown shows only the
// names; the voice ID is what gets stored and sent to ElevenLabs.
const VOICES: { name: string; id: string }[] = [
  { name: "Ezekiel", id: "psFPhSqnHmRieM88O1NC" },
  { name: "Freddie", id: "YImgdHB2KYPPVa2Ew8pp" },
  { name: "Rupert", id: "dI6Ldou06iqSFGEJjKW0" },
  { name: "Michael", id: "YxV306TE3Zjvmce8pOII" },
  { name: "Elliot", id: "8gNL8wXI7PQOc82yBLOg" },
  { name: "Kelly", id: "XlHDwyzsCODU3TfhB5es" },
  { name: "Eliza", id: "ut2XM2wJyIZLTtW6lFzZ" },
  { name: "Anna", id: "L39mCFEANiRSjBYTGelY" },
  { name: "Lucy", id: "Gv42yFG3G6CHLsU5y8g6" },
  { name: "Posh", id: "3Drdg7QWqr45nZmYpXRP" },
  { name: "Samantha", id: "LJwPgeJYv0dNJzEtXVO6" },
  { name: "Emmaline", id: "nDJIICjR9zfJExIFeSCN" },
  { name: "Zara", id: "jqcCZkN6Knx8BJ5TBdYR" },
];

/**
 * Section for managing persona details (name, company, greeting, topics, etc).
 */
function PersonaSection({
  persona,
  onConfig,
  onAuthNeeded,
}: {
  persona: AdminPersona;
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [form, setForm] = useState({
    name: persona.name ?? "",
    company: persona.company ?? "",
    website: persona.website ?? "",
    tagline: persona.tagline ?? "",
    description: persona.description ?? "",
    greeting: persona.greeting ?? "",
    mic_disclaimer: persona.mic_disclaimer ?? "",
    voice_id: persona.voice_id ?? "",
    topics: (persona.default_topics ?? []).join("\n"),
  });
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const { topics, ...fields } = form;
      const res = await adminApi.updatePersona({
        ...fields,
        default_topics: topics.split("\n").map((t) => t.trim()).filter(Boolean),
      });
      onConfig({ persona: res.persona });
    });
  };

  const uploadImage = (file: File) =>
    save.run(async () => {
      const res = await adminApi.uploadPersonaImage(file);
      // cache-buster: the file name is fixed, so force the preview to refetch
      onConfig({ persona: { ...persona, image_url: `${res.image_url}?v=${Date.now()}` } });
    });

  const reset = () =>
    save.run(async () => {
      const fresh = await adminApi.resetOverride("persona");
      onConfig(fresh);
      setForm({
        name: fresh.persona.name ?? "",
        company: fresh.persona.company ?? "",
        website: fresh.persona.website ?? "",
        tagline: fresh.persona.tagline ?? "",
        description: fresh.persona.description ?? "",
        greeting: fresh.persona.greeting ?? "",
        mic_disclaimer: fresh.persona.mic_disclaimer ?? "",
        voice_id: fresh.persona.voice_id ?? "",
        topics: (fresh.persona.default_topics ?? []).join("\n"),
      });
    });

  return (
    <Section
      title="Persona"
      hint="Who the AI guide is and how it opens the conversation. Changes apply to new sessions."
    >
      <div className="flex items-center gap-4">
        {persona.image_url ? (
          <img
            src={persona.image_url}
            alt={persona.name}
            className="h-16 w-16 rounded-full border border-line object-cover"
          />
        ) : (
          <div className="orb-fill h-16 w-16 rounded-full" />
        )}
        <FilePicker
          label={persona.image_url ? "Replace photo…" : "Upload photo…"}
          accept="image/png,image/jpeg,image/webp"
          onPick={uploadImage}
          disabled={save.state === "saving"}
        />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input value={form.name} onChange={set("name")} className={inputCls} />
          </Field>
          <Field label="Tagline">
            <input value={form.tagline} onChange={set("tagline")} className={inputCls} />
          </Field>
          <Field label="Company">
            <input value={form.company} onChange={set("company")} className={inputCls} />
          </Field>
          <Field label="Website">
            <input value={form.website} onChange={set("website")} className={inputCls} />
          </Field>
        </div>
        <Field label="Description (shown on the landing page)">
          <textarea value={form.description} onChange={set("description")} rows={3} className={inputCls} />
        </Field>
        <Field label="Greeting (spoken at the start of every session)">
          <textarea value={form.greeting} onChange={set("greeting")} rows={3} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Suggested topics (one per line)">
            <textarea value={form.topics} onChange={set("topics")} rows={3} className={inputCls} />
          </Field>
          <Field label="Mic disclaimer">
            <textarea value={form.mic_disclaimer} onChange={set("mic_disclaimer")} rows={3} className={inputCls} />
          </Field>
        </div>
        <Field label="Voice (how the persona sounds)">
          <select value={form.voice_id} onChange={set("voice_id")} className={inputCls}>
            {!VOICES.some((v) => v.id === form.voice_id) && (
              <option value={form.voice_id}>Server default</option>
            )}
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center gap-3">
          <SaveButton state={save.state} />
          <button
            type="button"
            onClick={reset}
            disabled={save.state === "saving"}
            className={btnGhostCls}
          >
            Reset to defaults
          </button>
          <ErrorText error={save.error} />
        </div>
      </form>
    </Section>
  );
}

// ---------- avatar ----------

/**
 * Section for browsing and selecting an avatar from the HeyGen catalog.
 */
function AvatarSection({
  avatar,
  onConfig,
  onAuthNeeded,
}: {
  avatar: AvatarState;
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [avatars, setAvatars] = useState<AvatarItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // the avatar new sessions actually get: explicit selection, else env default
  const inUseId = avatar.selected_id ?? avatar.env_default_id;

  useEffect(() => {
    adminApi
      .getAvatars()
      .then((res) => {
        setAvatars(res.avatars);
        setFocusId((current) => current ?? res.selected_id ?? res.env_default_id ?? res.avatars[0]?.id ?? null);
      })
      .catch((err) => {
        if (err instanceof AdminAuthError) onAuthNeeded();
        else setLoadError("Couldn't load the avatar catalog.");
      });
  }, [onAuthNeeded]);

  const filtered = useMemo(() => {
    if (!avatars) return [];
    const q = query.trim().toLowerCase();
    return q ? avatars.filter((a) => a.name.toLowerCase().includes(q)) : avatars;
  }, [avatars, query]);

  const focused =
    filtered.find((a) => a.id === focusId) ?? filtered[0] ?? null;

  // keep the focused thumbnail visible while paging with the arrows
  useEffect(() => {
    if (!focused) return;
    railRef.current
      ?.querySelector(`[data-avatar-id="${focused.id}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [focused]);

  const step = (delta: number) => {
    if (!focused || filtered.length === 0) return;
    const index = filtered.findIndex((a) => a.id === focused.id);
    const next = filtered[(index + delta + filtered.length) % filtered.length];
    setFocusId(next.id);
  };

  const choose = (id: string | null) =>
    save.run(async () => {
      const res = await adminApi.setAvatar(id);
      onConfig({ avatar: res });
    });

  return (
    <Section
      title="Avatar"
      hint="The HeyGen presenter that speaks as your guide in avatar mode. Browse the public catalog and pick one; new sessions use it right away."
    >
      {!avatar.heygen_configured && (
        <p className="rounded-xl border border-amber-700/25 bg-amber-600/10 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
          HEYGEN_API_KEY isn't set on the server, so sessions run audio-only for
          now. Your selection is saved and takes effect as soon as the key is
          configured.
        </p>
      )}

      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search avatars…"
          className={`${inputCls} max-w-xs`}
        />
        <span className="text-[12px] text-muted">
          {avatars ? `${filtered.length} of ${avatars.length}` : "Loading…"}
        </span>
        <span className="ml-auto text-[13px] text-muted">
          In use:{" "}
          <span className="font-medium text-body">
            {avatar.selected_name ??
              (avatar.env_default_id ? "server default" : "none — audio-only")}
          </span>
        </span>
      </div>

      {loadError && <ErrorText error={loadError} />}

      {focused && (
        <div className="relative flex h-80 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel-2/40">
          <img
            key={focused.id}
            src={focused.preview_url}
            alt={focused.name}
            className="fade-up h-full w-full object-contain"
          />
          {filtered.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous avatar"
                className="glass absolute left-4 top-1/2 -translate-y-1/2 rounded-full p-2.5 text-muted transition hover:border-accent/50 hover:text-accent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next avatar"
                className="glass absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-2.5 text-muted transition hover:border-accent/50 hover:text-accent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          {focused.id === inUseId && (
            <span className="glass absolute right-4 top-4 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
              In use
            </span>
          )}
        </div>
      )}

      {focused && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-medium">{focused.name}</p>
            <p className="text-[12px] text-muted">{focused.portrait ? "Portrait" : "Landscape"}</p>
          </div>
          <button
            type="button"
            onClick={() => choose(focused.id)}
            disabled={save.state === "saving" || focused.id === avatar.selected_id}
            className={btnCls}
          >
            {save.state === "saving"
              ? "Saving…"
              : focused.id === avatar.selected_id
                ? "Selected ✓"
                : "Use this avatar"}
          </button>
          {avatar.selected_id && (
            <button
              type="button"
              onClick={() => choose(null)}
              disabled={save.state === "saving"}
              className={btnGhostCls}
            >
              Clear selection
            </button>
          )}
          <ErrorText error={save.error} />
        </div>
      )}

      {filtered.length > 0 && (
        <div ref={railRef} className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              data-avatar-id={a.id}
              onClick={() => setFocusId(a.id)}
              title={a.name}
              className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition ${
                a.id === focused?.id
                  ? "border-accent ring-1 ring-accent/40"
                  : a.id === inUseId
                    ? "border-accent/50"
                    : "border-line hover:border-stone"
              }`}
            >
              <img
                src={a.preview_url}
                alt={a.name}
                loading="lazy"
                className="h-full w-full bg-panel-2 object-cover"
              />
              {a.id === inUseId && (
                <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </div>
      )}

      {avatars && filtered.length === 0 && (
        <p className="text-sm text-muted">No avatars match “{query}”.</p>
      )}
    </Section>
  );
}

// ---------- messaging (GTM knowledge) ----------

/**
 * Section for editing GTM knowledge that guides the AI's conversations.
 */
function MessagingSection({
  gtm,
  onConfig,
  onAuthNeeded,
}: {
  gtm: AdminConfig["gtm"];
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [text, setText] = useState(gtm.custom ?? gtm.default);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const value = text.trim() === gtm.default.trim() ? null : text;
      const res = await adminApi.updateGtm(value);
      onConfig({ gtm: res.gtm });
    });
  };

  const reset = () =>
    save.run(async () => {
      const res = await adminApi.updateGtm(null);
      onConfig({ gtm: res.gtm });
      setText(res.gtm.default);
    });

  return (
    <Section
      title="Messaging — GTM knowledge"
      hint="The company knowledge the AI sells from: positioning, objection handling, journeys and hard rules. This is injected into the system prompt of every conversation."
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-muted">
          {gtm.custom != null ? (
            <span className="text-accent">Using custom messaging.</span>
          ) : (
            "Using the built-in default."
          )}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          className={`${inputCls} font-mono text-[13px] leading-relaxed`}
        />
        <div className="flex items-center gap-3">
          <SaveButton state={save.state} />
          <button
            type="button"
            onClick={reset}
            disabled={save.state === "saving"}
            className={btnGhostCls}
          >
            Reset to default
          </button>
          <ErrorText error={save.error} />
        </div>
      </form>
    </Section>
  );
}

// ---------- credits ----------

const SERVICE_LABELS: Record<string, string> = {
  claude: "Conversation",
  tts: "Voice",
  avatar: "Avatar",
};

/**
 * Format a credit amount for display with thousands separators.
 */
function fmtCredits(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Section showing the credit balance, per-service consumption, purchase
 * options (Stripe packs or manual grants), and recent wallet activity.
 */
function CreditsSection({ onAuthNeeded }: { onAuthNeeded: () => void }) {
  const save = useSave(onAuthNeeded); // manual-grant form
  const billing = useSave(onAuthNeeded); // enforcement toggle + pack checkout
  const [summary, setSummary] = useState<CreditsSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState("");
  const purchased = useMemo(
    () => new URLSearchParams(window.location.search).get("credits") === "purchased",
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setSummary(await adminApi.getCredits());
      setLoadError(null);
    } catch (err) {
      if (err instanceof AdminAuthError) onAuthNeeded();
      else setLoadError(err instanceof Error ? err.message : "Couldn't load credits.");
    }
  }, [onAuthNeeded]);

  useEffect(() => {
    refresh();
    if (purchased) {
      // the Stripe webhook can land a few seconds after the redirect back
      const timers = [3000, 8000].map((ms) => window.setTimeout(refresh, ms));
      return () => timers.forEach((t) => window.clearTimeout(t));
    }
  }, [refresh, purchased]);

  const toggleEnforce = () =>
    billing.run(async () => {
      if (!summary) return;
      setSummary(await adminApi.updateCreditsSettings({ enabled: !summary.enabled }));
    });

  const buy = (pack: string) =>
    billing.run(async () => {
      const { url } = await adminApi.creditsCheckout(pack);
      window.location.href = url;
    });

  const grant = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const amount = Math.floor(Number(grantAmount));
      if (!Number.isFinite(amount) || amount < 1) throw new Error("Enter a credit amount.");
      setSummary(await adminApi.grantCredits(amount));
      setGrantAmount("");
    });
  };

  const usedTotal = summary
    ? summary.used.claude.credits + summary.used.tts.credits + summary.used.avatar.credits
    : 0;
  const low = summary && summary.balance < summary.low_threshold;

  return (
    <Section
      title="Credits & usage"
      hint="Every conversation consumes credits for the AI, voice and avatar services behind it (1 credit ≈ 1¢ of usage). Buy credits here; when enforcement is on, the experience pauses politely once the balance runs out."
    >
      {purchased && (
        <p className="rounded-xl border border-moss/30 bg-moss/10 px-4 py-3 text-[13px] text-body">
          Payment received — credits appear below as soon as Stripe confirms it (a few
          seconds).
        </p>
      )}
      {loadError && <ErrorText error={loadError} />}
      {summary && (
        <>
          {summary.enabled && summary.balance <= 0 && (
            <p className="rounded-xl border border-red-800/25 bg-red-800/5 px-4 py-3 text-[13px] text-red-900">
              The balance is empty and enforcement is on — new conversations are paused
              until credits are added.
            </p>
          )}
          {summary.enabled && summary.balance > 0 && low && (
            <p className="rounded-xl border border-amber-700/25 bg-amber-600/10 px-4 py-3 text-[13px] text-amber-900">
              Running low: fewer than {fmtCredits(summary.low_threshold)} credits remain.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel-2/40 p-5">
              <p className="eyebrow">Remaining</p>
              <p className="mt-1 font-display text-4xl font-medium">
                {fmtCredits(summary.balance)}
                <span className="ml-2 text-base text-muted">credits</span>
              </p>
              <p className="mt-1 text-[12px] text-muted">
                ≈ ${fmtCredits(summary.balance * summary.credit_usd)} of API usage ·{" "}
                {fmtCredits(summary.granted)} granted all-time
              </p>
            </div>
            <div className="rounded-xl border border-line bg-panel-2/40 p-5">
              <p className="eyebrow">Consumed so far</p>
              <p className="mt-1 font-display text-4xl font-medium">
                {fmtCredits(usedTotal)}
                <span className="ml-2 text-base text-muted">credits</span>
              </p>
              <div className="mt-2 space-y-0.5 text-[12px] text-muted">
                <p>
                  Conversation {fmtCredits(summary.used.claude.credits)} cr ·{" "}
                  {summary.used.claude.tokens.toLocaleString()} tokens
                </p>
                <p>
                  Voice {fmtCredits(summary.used.tts.credits)} cr ·{" "}
                  {summary.used.tts.chars.toLocaleString()} characters
                </p>
                <p>
                  Avatar {fmtCredits(summary.used.avatar.credits)} cr ·{" "}
                  {summary.used.avatar.minutes.toLocaleString()} min
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={summary.enabled}
              onChange={toggleEnforce}
              disabled={billing.state === "saving"}
              className="h-4 w-4 accent-[#8c7354]"
            />
            Pause new conversations when the balance runs out
          </label>
          <ErrorText error={billing.error} />

          <div className="space-y-3 rounded-xl border border-dashed border-line p-4">
            <p className="text-sm font-medium">Buy credits</p>
            {summary.stripe_configured ? (
              <div className="flex flex-wrap gap-3">
                {summary.packs.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => buy(pack.id)}
                    disabled={billing.state === "saving"}
                    className={btnGhostCls}
                  >
                    {pack.label} — {pack.credits.toLocaleString()} cr · $
                    {(pack.usd_cents / 100).toLocaleString()}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12px] leading-relaxed text-muted">
                Card checkout is not configured. Set STRIPE_SECRET_KEY and
                STRIPE_WEBHOOK_SECRET on the backend to sell credit packs here — or add
                credits manually below.
              </p>
            )}
            <form onSubmit={grant} className="flex items-end gap-3">
              <div className="w-44">
                <Field label="Add credits manually">
                  <input
                    type="number"
                    min={1}
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    placeholder="e.g. 1000"
                    className={inputCls}
                  />
                </Field>
              </div>
              <SaveButton state={save.state} label="Add" />
              <ErrorText error={save.error} />
            </form>
          </div>

          {summary.recent.length > 0 && (
            <div>
              <p className="mb-2 text-[12px] font-medium tracking-wide text-muted">
                Recent activity
              </p>
              <ul className="divide-y divide-line rounded-xl border border-line text-[13px]">
                {summary.recent.map((entry, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2">
                    <span className={entry.kind === "grant" ? "text-moss" : "text-body"}>
                      {entry.kind === "grant" ? "+" : "−"}
                      {fmtCredits(entry.credits)} cr
                    </span>
                    <span className="text-muted">
                      {entry.kind === "grant"
                        ? (entry.note ?? "granted")
                        : `${SERVICE_LABELS[entry.service ?? ""] ?? entry.service} · ${
                            entry.service === "avatar"
                              ? `${Math.round((entry.units ?? 0) / 6) / 10} min`
                              : `${Math.round(entry.units ?? 0).toLocaleString()} ${
                                  entry.service === "claude" ? "tokens" : "chars"
                                }`
                          }`}
                    </span>
                    <span className="ml-auto text-[11px] text-muted">
                      {new Date(entry.ts * 1000).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {!summary && !loadError && <p className="text-sm text-muted">Loading…</p>}
    </Section>
  );
}

// ---------- content: slide decks ----------

/**
 * Expandable card for editing a slide deck's metadata and presenter notes.
 */
function DeckCard({
  item,
  onConfig,
  onAuthNeeded,
}: {
  item: AdminContentItem;
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [notes, setNotes] = useState(item.assets.map((_, i) => item.presenter_notes[i] ?? ""));
  const replaceRef = useRef<HTMLInputElement>(null);

  const replaceSlides = (files: File[]) => {
    save.run(async () => {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (pdfs.length > 0 && files.length > 1)
        throw new Error("Upload either one PDF or images — not both.");
      const res = await adminApi.replaceDeckSlides(item.id, files);
      onConfig({ content: res.content });
      const fresh = res.content.find((c) => c.id === item.id);
      if (fresh) setNotes(fresh.assets.map((_, i) => fresh.presenter_notes[i] ?? ""));
      if (replaceRef.current) replaceRef.current.value = "";
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const res = await adminApi.updateContent(item.id, {
        title,
        description,
        presenter_notes: notes,
      });
      onConfig({ content: res.content });
    });
  };

  const reset = () =>
    save.run(async () => {
      const fresh = await adminApi.resetOverride(`content:${item.id}`);
      onConfig(fresh);
      const restored = fresh.content.find((c) => c.id === item.id);
      if (restored) {
        setTitle(restored.title);
        setDescription(restored.description);
        setNotes(restored.assets.map((_, i) => restored.presenter_notes[i] ?? ""));
      }
    });

  const remove = () => {
    if (!window.confirm(`Delete “${item.title}” and its slides? This can't be undone.`)) return;
    save.run(async () => {
      const res = await adminApi.deleteContent(item.id);
      onConfig({ content: res.content });
    });
  };

  return (
    <div className="rounded-xl border border-line bg-panel-2/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`text-muted transition ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="font-medium">{title}</span>
        <span className="text-[12px] text-muted">
          {item.assets.length} slides
          {item.custom ? " · uploaded" : item.edited ? " · edited" : ""}
        </span>
      </button>
      {open && (
        <form onSubmit={submit} className="space-y-4 border-t border-line p-4">
          <div className="grid grid-cols-[240px_1fr] gap-3">
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Description (tells the AI when to show this deck)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="space-y-3">
            {item.assets.map((asset, i) => (
              <div key={asset} className="grid grid-cols-[130px_1fr] items-start gap-3">
                <img src={asset} alt={`slide ${i + 1}`} className="w-full rounded border border-line" />
                <Field label={`Slide ${i + 1} presenter notes (spoken verbatim)`}>
                  <textarea
                    value={notes[i] ?? ""}
                    onChange={(e) => setNotes(notes.map((n, j) => (j === i ? e.target.value : n)))}
                    rows={3}
                    className={inputCls}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border border-dashed border-line p-3">
            <p className="text-[13px] font-medium">Replace slides</p>
            <p className="text-[12px] leading-relaxed text-muted">
              Upload a new PDF or set of images to swap out every slide
              {item.custom ? "" : " — Reset to defaults brings the originals back"}.
              Presenter notes are kept when the slide count stays the same, otherwise
              they're cleared.
            </p>
            <input
              ref={replaceRef}
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              disabled={save.state === "saving"}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length === 0) return;
                if (!window.confirm(`Replace all ${item.assets.length} slides of “${title}”?`)) {
                  if (replaceRef.current) replaceRef.current.value = "";
                  return;
                }
                replaceSlides(picked);
              }}
              className="block text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-panel-2 file:px-4 file:py-2 file:text-sm file:text-body"
            />
          </div>
          <div className="flex items-center gap-3">
            <SaveButton state={save.state} />
            {item.custom ? (
              <button
                type="button"
                onClick={remove}
                disabled={save.state === "saving"}
                className="rounded-full border border-red-800/30 px-4 py-2 text-sm text-red-800 transition hover:bg-red-800/5 disabled:opacity-50"
              >
                Delete deck
              </button>
            ) : (
              <button
                type="button"
                onClick={reset}
                className={btnGhostCls}
                disabled={!item.edited || save.state === "saving"}
              >
                Reset to defaults
              </button>
            )}
            <ErrorText error={save.error} />
          </div>
        </form>
      )}
    </div>
  );
}

function DeckUpload({
  onConfig,
  onAuthNeeded,
}: {
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      if (files.length === 0)
        throw new Error("Choose a PDF or a set of slide images (.png, .jpg, .webp).");
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (pdfs.length > 0 && files.length > 1)
        throw new Error("Upload either one PDF or images — not both.");
      if (!title.trim() || !description.trim())
        throw new Error("Title and description are required.");
      const res = await adminApi.uploadDeck(files, title.trim(), description.trim());
      onConfig({ content: res.content });
      setFiles([]);
      setTitle("");
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-dashed border-line p-4">
      <p className="text-sm font-medium">Add a deck</p>
      <p className="text-[12px] leading-relaxed text-muted">
        One PDF (each page becomes a slide) or several images, ordered by filename.
        After uploading, open the deck to write per-slide presenter notes — the exact
        talk track spoken during a walkthrough.
      </p>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="block text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-panel-2 file:px-4 file:py-2 file:text-sm file:text-body"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Description (tells the AI when to show it)">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SaveButton state={save.state} label="Upload" />
        {files.length > 0 && (
          <span className="text-[12px] text-muted">
            {files.length === 1 ? files[0].name : `${files.length} files`}
          </span>
        )}
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

// ---------- content: videos ----------

/**
 * Card for editing a video's title and description, with option to delete.
 */
function VideoCard({
  item,
  onConfig,
  onAuthNeeded,
}: {
  item: AdminContentItem;
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      const res = await adminApi.updateContent(item.id, { title, description });
      onConfig({ content: res.content });
    });
  };

  const remove = () => {
    if (!window.confirm(`Delete “${item.title}” and its file? This can't be undone.`)) return;
    save.run(async () => {
      const res = await adminApi.deleteContent(item.id);
      onConfig({ content: res.content });
    });
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel-2/40 p-4">
      <div className="grid grid-cols-[170px_1fr] gap-4">
        <video src={item.assets[0]} controls preload="metadata" className="w-full rounded border border-line" />
        <div className="space-y-3">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Description (tells the AI when to play this video)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </Field>
          <div className="flex items-center gap-3">
            <SaveButton state={save.state} />
            {item.custom && (
              <button
                type="button"
                onClick={remove}
                disabled={save.state === "saving"}
                className="rounded-full border border-red-800/30 px-4 py-2 text-sm text-red-800 transition hover:bg-red-800/5 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <ErrorText error={save.error} />
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * Form for uploading a new video clip with title and description.
 */
function VideoUpload({
  onConfig,
  onAuthNeeded,
}: {
  onConfig: (update: Partial<AdminConfig>) => void;
  onAuthNeeded: () => void;
}) {
  const save = useSave(onAuthNeeded);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      if (!file) throw new Error("Choose a video file (.mp4 or .webm).");
      if (!title.trim() || !description.trim())
        throw new Error("Title and description are required.");
      const res = await adminApi.uploadVideo(file, title.trim(), description.trim());
      onConfig({ content: res.content });
      setFile(null);
      setTitle("");
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-dashed border-line p-4">
      <p className="text-sm font-medium">Add a video</p>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/webm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-panel-2 file:px-4 file:py-2 file:text-sm file:text-body"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Description (tells the AI when to play it)">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SaveButton state={save.state} label="Upload" />
        <ErrorText error={save.error} />
      </div>
    </form>
  );
}

// ---------- shared ----------

/**
 * Button that triggers a hidden file input and calls onPick when a file is selected.
 */
function FilePicker({
  label,
  accept,
  onPick,
  disabled = false,
}: {
  label: string;
  accept: string;
  onPick: (file: File) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={disabled}
        className={btnGhostCls}
      >
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </>
  );
}

// ---------- page ----------

/**
 * Settings page for configuring brand, persona, avatar, messaging, and content.
 */
export default function SettingsPage() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [tokenInput, setTokenInput] = useState(getAdminToken());
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    adminApi
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setNeedToken(false);
      })
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          setNeedToken(true);
          if (getAdminToken()) setLoadError("That admin token was rejected.");
        } else if (err instanceof Error && err.message && !(err instanceof TypeError)) {
          setLoadError(err.message); // server-reported detail (e.g. a 500)
        } else {
          setLoadError("Couldn't reach the backend — is it running?");
        }
      });
  }, []);

  useEffect(load, [load]);

  const onConfig = useCallback((update: Partial<AdminConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...update } : prev));
  }, []);
  const onAuthNeeded = useCallback(() => setNeedToken(true), []);

  const decks = config?.content.filter((c) => c.type === "slide_deck") ?? [];
  const videos = config?.content.filter((c) => c.type === "video") ?? [];

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto w-[min(880px,94vw)] pb-16">
        <header className="relative flex items-center justify-center py-5">
          <Link
            to="/"
            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full border border-line bg-panel px-4 py-2 text-sm text-muted transition hover:border-accent/50 hover:text-accent"
          >
            ← Back
          </Link>
          <WordmarkView className="text-2xl" />
        </header>

        <h1 className="mb-1.5 font-display text-4xl font-medium">Settings</h1>
        <p className="mb-8 text-sm text-muted">
          Configure the brand, persona, messaging and content. Edits apply to new sessions.
        </p>

        {needToken && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAdminToken(tokenInput.trim());
              load();
            }}
            className="card mb-6 flex items-end gap-3 rounded-2xl border-accent/40 p-5"
          >
            <div className="flex-1">
              <Field label="This backend requires an admin token (ADMIN_TOKEN)">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Admin token"
                  className={inputCls}
                />
              </Field>
            </div>
            <button type="submit" className={btnCls}>
              Unlock
            </button>
          </form>
        )}

        {loadError && <p className="mb-6 text-sm text-red-800">{loadError}</p>}

        {config && (
          <div className="space-y-6">
            {config.store === "memory" && (
              <p className="rounded-xl border border-amber-700/25 bg-amber-600/10 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
                The backend is using the in-memory store — edits below are lost when it
                restarts. Set MONGODB_URL to persist them. Uploaded files are saved to the
                uploads directory either way (mount a persistent volume there in
                production to keep them across redeploys).
              </p>
            )}

            <BrandSection config={config} onConfig={onConfig} onAuthNeeded={onAuthNeeded} />
            <AppearanceSection
              theme={config.theme}
              onConfig={onConfig}
              onAuthNeeded={onAuthNeeded}
            />
            <PersonaSection
              persona={config.persona}
              onConfig={onConfig}
              onAuthNeeded={onAuthNeeded}
            />
            <AvatarSection avatar={config.avatar} onConfig={onConfig} onAuthNeeded={onAuthNeeded} />
            <CreditsSection onAuthNeeded={onAuthNeeded} />
            <MessagingSection gtm={config.gtm} onConfig={onConfig} onAuthNeeded={onAuthNeeded} />

            <Section
              title="Slide decks"
              hint="Titles and descriptions steer when the AI shows a deck; presenter notes are the exact talk track it speaks on each slide. Upload your own slideware as a PDF or a set of images."
            >
              {decks.length ? (
                decks.map((deck) => (
                  <DeckCard
                    key={deck.id}
                    item={deck}
                    onConfig={onConfig}
                    onAuthNeeded={onAuthNeeded}
                  />
                ))
              ) : (
                <p className="text-sm text-muted">No slide decks are loaded.</p>
              )}
              <DeckUpload onConfig={onConfig} onAuthNeeded={onAuthNeeded} />
            </Section>

            <Section
              title="Videos"
              hint="Clips the AI can play in the media pane. The description tells it when a clip is relevant."
            >
              {videos.map((video) => (
                <VideoCard
                  key={video.id}
                  item={video}
                  onConfig={onConfig}
                  onAuthNeeded={onAuthNeeded}
                />
              ))}
              <VideoUpload onConfig={onConfig} onAuthNeeded={onAuthNeeded} />
            </Section>
          </div>
        )}

        {!config && !needToken && !loadError && (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
    </div>
  );
}
