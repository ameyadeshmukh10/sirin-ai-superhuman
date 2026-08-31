import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AvatarVideo from "../components/AvatarVideo";
import BottomBar from "../components/BottomBar";
import ChatPanel from "../components/ChatPanel";
import LoadingScreen from "../components/LoadingScreen";
import MediaOverlay from "../components/MediaOverlay";
import PersonaVisual from "../components/PersonaVisual";
import Wordmark from "../components/Wordmark";
import { useSession } from "../hooks/useSession";
import { useVoiceChat } from "../hooks/useVoiceChat";
import { player } from "../lib/pcmPlayer";

/**
 * The standalone conversation page: chat panel beside the persona stage.
 */
export default function SessionPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { state, sendMessage, interrupt, sendAnalytics, endSession, setMedia } =
    useSession(sessionId);
  const [speakerOn, setSpeakerOn] = useState(true);

  const onMicToggle = useCallback(
    (on: boolean) => sendAnalytics("mic_toggled", { on }),
    [sendAnalytics],
  );
  const { micOn, toggleMic, speech } = useVoiceChat({
    state,
    sendMessage,
    interrupt,
    onMicToggle,
  });

  useEffect(() => {
    player.setMuted(!speakerOn);
  }, [speakerOn]);

  const handleEnd = useCallback(() => {
    endSession();
    navigate("/");
  }, [endSession, navigate]);

  if (state.phase === "gone") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5">
        <p className="font-display text-2xl text-body">This session has expired.</p>
        <Link to="/" className="rounded-full bg-accent px-6 py-2.5 font-semibold text-ink transition hover:bg-accent-dim">
          Start a new conversation
        </Link>
      </div>
    );
  }

  const persona = state.persona;

  return (
    <div className="flex h-full flex-col">
      {state.phase === "boot" && <LoadingScreen label={`Waking up ${persona?.name ?? "your guide"}…`} />}

      <header className="flex items-center justify-center py-5">
        <Wordmark className="text-xl" />
      </header>

      <main className="card mx-auto mb-6 flex w-[min(1280px,96vw)] flex-1 flex-col overflow-hidden rounded-3xl">
        <div className="flex min-h-0 flex-1">
          <ChatPanel
            messages={state.messages}
            topics={state.topics}
            status={state.status}
            micDisclaimer={persona?.mic_disclaimer ?? ""}
            interim={speech.interim}
            onSend={(text, source) => sendMessage(text, source)}
          />

          <section className="stage-backdrop relative flex flex-1 items-center justify-center">
            <div
              className={`transition-all duration-500 ${
                state.media ? "absolute bottom-6 right-6 z-20 scale-[0.35] origin-bottom-right" : ""
              }`}
            >
              {state.avatar ? (
                <AvatarVideo
                  url={state.avatar.url}
                  token={state.avatar.token}
                  speaking={state.playing}
                  muted={!speakerOn}
                  name={persona?.name ?? "E"}
                />
              ) : (
                <PersonaVisual
                  name={persona?.name ?? "E"}
                  imageUrl={persona?.image_url}
                  speaking={state.playing}
                  size={300}
                />
              )}
            </div>
            {!state.media && persona && (
              <div className="pointer-events-none absolute bottom-9 text-center">
                <p className="font-display text-xl font-medium text-body">{persona.name}</p>
                <p className="mt-1 text-[13px] tracking-wide text-muted">{persona.tagline}</p>
              </div>
            )}

            {state.media && (
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
            )}

            {state.connection !== "open" && state.phase === "ready" && (
              <div className="glass absolute top-4 rounded-full px-4 py-1 text-xs text-atlantic">
                Reconnecting…
              </div>
            )}
          </section>
        </div>

        <BottomBar
          micOn={micOn}
          micSupported={speech.supported}
          listening={speech.listening}
          speakerOn={speakerOn}
          ctaHighlight={state.ctaHighlight}
          onToggleMic={toggleMic}
          onToggleSpeaker={() => setSpeakerOn((on) => !on)}
          onBookMeeting={() => sendAnalytics("cta_click", { cta: "book_meeting" })}
          onEnd={handleEnd}
        />
      </main>
    </div>
  );
}
