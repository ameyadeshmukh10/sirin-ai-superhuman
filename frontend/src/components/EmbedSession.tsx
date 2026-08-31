// Live conversation inside the embed widget. Two layouts over one session:
// the compact panel (avatar strip on top, chat below) and the expanded
// near-fullscreen experience (stage with slides/video beside the chat), like
// the standalone session page. Media arriving auto-expands the widget so
// slides and video always get room.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Persona } from "../lib/protocol";
import { useSession } from "../hooks/useSession";
import { useVoiceChat } from "../hooks/useVoiceChat";
import { player } from "../lib/pcmPlayer";
import AvatarVideo from "./AvatarVideo";
import EmbedChat from "./EmbedChat";
import MediaOverlay from "./MediaOverlay";
import PersonaVisual from "./PersonaVisual";

type Props = {
  sessionId: string;
  expanded: boolean;
  // Shown in the header until the session's own persona fetch lands.
  personaFallback: Persona | null;
  initialMicOn: boolean;
  initialMessage: string | null;
  onToggleExpand: () => void;
  onClose: () => void;
  onEnded: () => void;
  onExpired: () => void;
};

/**
 * A live session rendered as the widget's panel or expanded layout.
 */
export default function EmbedSession({
  sessionId,
  expanded,
  personaFallback,
  initialMicOn,
  initialMessage,
  onToggleExpand,
  onClose,
  onEnded,
  onExpired,
}: Props) {
  const { state, sendMessage, interrupt, sendAnalytics, endSession, setMedia } =
    useSession(sessionId);
  const [speakerOn, setSpeakerOn] = useState(true);

  const onMicToggle = useCallback(
    (on: boolean) => sendAnalytics("mic_toggled", { on }),
    [sendAnalytics],
  );
  const { micOn, setMicOn, toggleMic, speech } = useVoiceChat({
    state,
    sendMessage,
    interrupt,
    onMicToggle,
  });

  useEffect(() => {
    if (initialMicOn) setMicOn(true);
    // mount-time intent from the teaser's "Speak now" — apply once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A question typed into the teaser becomes the first turn as soon as the
  // socket is up (SessionSocket.send drops messages while connecting).
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !sentInitialRef.current && state.connection === "open") {
      sentInitialRef.current = true;
      sendMessage(initialMessage, "typed");
    }
  }, [initialMessage, state.connection, sendMessage]);

  useEffect(() => {
    player.setMuted(!speakerOn);
  }, [speakerOn]);

  useEffect(() => {
    if (state.phase === "gone") onExpired();
  }, [state.phase, onExpired]);

  // New media (a deck or clip, not slide navigation) expands the widget once;
  // the visitor can still compress it and keep the media in the small stage.
  const mediaKey = state.media
    ? state.media.kind === "slides"
      ? `slides:${state.media.title}`
      : `video:${state.media.video.id}`
    : null;
  const expandedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (mediaKey && mediaKey !== expandedForRef.current) {
      expandedForRef.current = mediaKey;
      if (!expanded) onToggleExpand();
    }
  }, [mediaKey, expanded, onToggleExpand]);

  const persona = state.persona ?? personaFallback;
  const name = persona?.name ?? "";

  const handleEnd = () => {
    endSession();
    onEnded();
  };

  const mediaOverlay = state.media && (
    <MediaOverlay
      media={state.media}
      onNavigate={(delta) =>
        setMedia((m) =>
          m && m.kind === "slides"
            ? { ...m, index: Math.min(m.slides.length - 1, Math.max(0, m.index + delta)) }
            : m,
        )
      }
      onClose={() => {
        sendAnalytics("media_closed");
        setMedia(() => null);
      }}
      onVideoEnded={() => sendAnalytics("video_completed")}
    />
  );

  const controls = (
    <div className="glass absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5">
      {speech.supported && (
        <ControlIcon
          label={micOn ? "Turn mic off" : "Turn mic on"}
          active={micOn}
          pulse={speech.listening}
          onClick={toggleMic}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
            {!micOn && <path d="M4 4l16 16" strokeLinecap="round" stroke="#9b3d3d" />}
          </svg>
        </ControlIcon>
      )}
      <ControlIcon
        label={speakerOn ? "Mute" : "Unmute"}
        active={speakerOn}
        onClick={() => setSpeakerOn((on) => !on)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 10v4h4l5 4V6L8 10H4z" strokeLinejoin="round" />
          {speakerOn ? (
            <path d="M16 9a4 4 0 0 1 0 6" strokeLinecap="round" />
          ) : (
            <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
          )}
        </svg>
      </ControlIcon>
      <button
        onClick={handleEnd}
        className="ml-1 rounded-full px-3 py-1.5 text-[12px] font-semibold text-red-900 transition hover:bg-red-800/10"
      >
        End
      </button>
    </div>
  );

  const stageVisual = state.avatar ? (
    <AvatarVideo
      url={state.avatar.url}
      token={state.avatar.token}
      speaking={state.playing}
      muted={!speakerOn}
      name={name || "E"}
      className={
        expanded
          ? "aspect-video w-[min(560px,80%)] rounded-2xl border-2"
          : "h-full w-full rounded-none border-0"
      }
    />
  ) : (
    <PersonaVisual
      name={name || "E"}
      imageUrl={persona?.image_url}
      speaking={state.playing}
      size={expanded ? 260 : 130}
    />
  );

  const reconnecting = state.connection !== "open" && state.phase === "ready" && (
    <div className="glass absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] text-atlantic">
      Reconnecting…
    </div>
  );

  return (
    <div className="card flex h-full flex-col overflow-hidden rounded-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        {persona?.image_url ? (
          <img
            src={persona.image_url}
            alt={name}
            className="h-8 w-8 rounded-full border border-line object-cover"
          />
        ) : (
          <div className="orb-fill flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold text-accent">
            {name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-medium leading-tight">{name}</p>
          <p className="truncate text-[11px] text-muted">{persona?.tagline ?? ""}</p>
        </div>
        <HeaderIcon label={expanded ? "Compress" : "Expand"} onClick={onToggleExpand}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </HeaderIcon>
        <HeaderIcon label="Close" onClick={onClose}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </HeaderIcon>
      </header>

      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <section className="stage-backdrop relative flex min-h-[220px] flex-1 items-center justify-center">
            <div
              className={`transition-all duration-500 ${
                state.media ? "absolute bottom-5 right-5 z-20 origin-bottom-right scale-[0.35]" : ""
              }`}
            >
              {stageVisual}
            </div>
            {mediaOverlay}
            {controls}
            {reconnecting}
          </section>
          <EmbedChat
            personaName={name}
            messages={state.messages}
            topics={state.topics}
            status={state.status}
            micDisclaimer={persona?.mic_disclaimer ?? ""}
            interim={speech.interim}
            ctaHighlight={state.ctaHighlight}
            onSend={sendMessage}
            onBook={() => sendAnalytics("cta_click", { cta: "book_meeting" })}
            className="w-full border-t border-line sm:w-[360px] sm:border-l sm:border-t-0"
          />
        </div>
      ) : (
        <>
          <section className="stage-backdrop relative flex h-[220px] shrink-0 items-center justify-center">
            {stageVisual}
            {mediaOverlay}
            {controls}
            {reconnecting}
          </section>
          <EmbedChat
            personaName={name}
            messages={state.messages}
            topics={state.topics}
            status={state.status}
            micDisclaimer={persona?.mic_disclaimer ?? ""}
            interim={speech.interim}
            ctaHighlight={state.ctaHighlight}
            onSend={sendMessage}
            onBook={() => sendAnalytics("cta_click", { cta: "book_meeting" })}
            className="min-h-0 flex-1 border-t border-line"
          />
        </>
      )}
    </div>
  );
}

/**
 * Round icon toggle for the floating control pill (mic, speaker).
 */
function ControlIcon({
  label,
  active,
  pulse,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  pulse?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative flex h-8 w-8 items-center justify-center rounded-full transition ${
        active ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel-2 hover:text-body"
      }`}
    >
      {pulse && <span className="speaking-ring absolute inset-0 rounded-full border border-accent/60" />}
      {children}
    </button>
  );
}

/**
 * Icon button in the widget header (expand/compress, close).
 */
function HeaderIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-panel-2 hover:text-body"
    >
      {children}
    </button>
  );
}
