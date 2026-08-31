// The embeddable chat-bubble widget, loaded inside an iframe by
// public/embed.js on third-party sites. Four states, sized by the loader from
// postMessage notifications:
//   mini   — a round avatar button
//   teaser — a card with the persona's photo, "Speak now", CTA and a composer
//   panel  — a live conversation (avatar strip + chat)
//   full   — the near-fullscreen experience with room for slides and video
// Closing the panel keeps the session id, so reopening resumes the
// conversation; End (or expiry) starts fresh next time.

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EmbedSession from "../components/EmbedSession";
import PersonaVisual from "../components/PersonaVisual";
import { player } from "../lib/pcmPlayer";
import { useBrand } from "../lib/useBrand";
import { OutOfCreditsError, createSession, fetchPersona, type Persona } from "../lib/protocol";

type WidgetState = "mini" | "teaser" | "panel" | "full";

const speechSupported = Boolean(
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition,
);

/**
 * Widget state machine: which state is showing, the session lifecycle, and
 * size notifications to the parent loader.
 */
export default function EmbedPage() {
  const [searchParams] = useSearchParams();
  const [widget, setWidget] = useState<WidgetState>(() =>
    searchParams.get("compact") === "1" ? "mini" : "teaser",
  );
  const [persona, setPersona] = useState<Persona | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingMic, setPendingMic] = useState(false);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { brand } = useBrand();

  // The host page shows through everywhere the widget doesn't paint.
  useEffect(() => {
    document.documentElement.classList.add("embed-widget");
    return () => document.documentElement.classList.remove("embed-widget");
  }, []);

  useEffect(() => {
    fetchPersona()
      .then(setPersona)
      .catch(() => setError("Couldn't reach the assistant."));
  }, []);

  const post = useCallback((payload: { state: WidgetState; height?: number }) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: "sirin-embed", ...payload }, "*");
    }
  }, []);

  useEffect(() => {
    post({ state: widget });
  }, [widget, post]);

  // The teaser's height depends on its content (photo, CTA, error text…);
  // report it so the loader can size the iframe exactly.
  const teaserRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (widget !== "teaser" || !teaserRef.current) return;
    const el = teaserRef.current;
    const observer = new ResizeObserver(() => {
      post({ state: "teaser", height: Math.ceil(el.getBoundingClientRect().height) + 12 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [widget, post, persona]);

  const open = useCallback(
    async (opts: { mic?: boolean; message?: string }) => {
      if (starting) return;
      player.unlock(); // the click is the user gesture that unlocks audio
      setStarting(true);
      setError(null);
      try {
        let id = sessionId;
        if (!id) {
          id = (await createSession()).id;
          setSessionId(id);
        }
        setPendingMic(Boolean(opts.mic));
        setPendingMsg(opts.message ?? null);
        setWidget("panel");
      } catch (err) {
        setError(
          err instanceof OutOfCreditsError
            ? "This experience is taking a short break — please check back soon."
            : "Couldn't start a conversation — please try again.",
        );
      } finally {
        setStarting(false);
      }
    },
    [sessionId, starting],
  );

  const closeToTeaser = useCallback(() => {
    // keep sessionId: reopening resumes the conversation
    setPendingMic(false);
    setPendingMsg(null);
    setWidget("teaser");
  }, []);

  const resetToTeaser = useCallback(() => {
    setSessionId(null);
    setPendingMic(false);
    setPendingMsg(null);
    setWidget("teaser");
  }, []);

  const name = persona?.name ?? "";

  if (widget === "panel" || widget === "full") {
    return (
      <div className="h-full w-full p-1.5">
        {sessionId && (
          <EmbedSession
            sessionId={sessionId}
            expanded={widget === "full"}
            personaFallback={persona}
            initialMicOn={pendingMic}
            initialMessage={pendingMsg}
            onToggleExpand={() => setWidget((w) => (w === "full" ? "panel" : "full"))}
            onClose={closeToTeaser}
            onEnded={resetToTeaser}
            onExpired={resetToTeaser}
          />
        )}
      </div>
    );
  }

  if (widget === "mini") {
    return (
      <div className="h-full w-full p-1.5">
        <button
          onClick={() => {
            player.unlock();
            setWidget(sessionId ? "panel" : "teaser");
          }}
          aria-label={name ? `Chat with ${name}` : "Open chat"}
          className="block h-full w-full overflow-hidden rounded-full border-2 border-accent/50 bg-panel shadow-lg transition hover:border-accent"
        >
          {persona?.image_url ? (
            <img src={persona.image_url} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span className="orb-fill flex h-full w-full items-center justify-center text-xl font-bold text-accent">
              {name.charAt(0)}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-1.5">
      <TeaserCard
        cardRef={teaserRef}
        persona={persona}
        bookMeetingUrl={brand.bookMeetingUrl}
        busy={starting}
        error={error}
        onOpen={() => open({})}
        onSpeak={() => open({ mic: true })}
        onAsk={(text) => open({ message: text })}
        onMinimize={() => setWidget("mini")}
      />
    </div>
  );
}

/**
 * The closed widget's invitation card: persona photo, "Speak now", booking
 * CTA and an ask-a-question composer.
 */
function TeaserCard({
  cardRef,
  persona,
  bookMeetingUrl,
  busy,
  error,
  onOpen,
  onSpeak,
  onAsk,
  onMinimize,
}: {
  cardRef: React.RefObject<HTMLDivElement>;
  persona: Persona | null;
  bookMeetingUrl: string;
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onSpeak: () => void;
  onAsk: (text: string) => void;
  onMinimize: () => void;
}) {
  const [draft, setDraft] = useState("");
  const name = persona?.name ?? "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onAsk(draft.trim());
    setDraft("");
  };

  return (
    <div ref={cardRef} className="card overflow-hidden rounded-2xl">
      <div className="relative">
        <button onClick={onOpen} disabled={busy} aria-label="Start a conversation" className="block w-full">
          {persona?.image_url ? (
            <img src={persona.image_url} alt={name} className="aspect-[4/3] w-full object-cover" />
          ) : (
            <span className="stage-backdrop flex aspect-[4/3] w-full items-center justify-center">
              <PersonaVisual name={name || "?"} speaking={false} size={110} />
            </span>
          )}
        </button>
        <button
          onClick={onMinimize}
          aria-label="Minimize"
          className="glass absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:text-body"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
        {speechSupported && (
          <button
            onClick={onSpeak}
            disabled={busy}
            className="glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold text-body transition hover:border-accent/60 hover:text-accent disabled:opacity-60"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
            </svg>
            {busy ? "Connecting…" : "Speak now"}
          </button>
        )}
      </div>

      <div className="space-y-2.5 p-3">
        <a
          href={bookMeetingUrl}
          target="_blank"
          rel="noreferrer"
          className="block rounded-full bg-accent px-5 py-2.5 text-center text-sm font-semibold text-ink transition hover:bg-accent-dim"
        >
          Book a Meeting
        </a>
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Ask ${name || "me"} a question`}
            disabled={busy}
            className="min-w-0 flex-1 rounded-full border border-line bg-panel-2/70 px-4 py-2.5 text-sm text-body placeholder-muted/70 outline-none transition focus:border-accent/50 focus:bg-panel"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel-2 text-accent transition hover:bg-accent hover:text-ink disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
        {error && <p className="text-[12px] leading-relaxed text-red-800">{error}</p>}
        <p className="text-center text-[10px] leading-relaxed text-muted/80">
          {name || "Your guide"} is an AI and can make mistakes. Conversations are processed by
          third-party AI services.
        </p>
      </div>
    </div>
  );
}
