import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PersonaVisual from "../components/PersonaVisual";
import Wordmark from "../components/Wordmark";
import { player } from "../lib/pcmPlayer";
import { OutOfCreditsError, createSession, fetchPersona, type Persona } from "../lib/protocol";

/**
 * Landing page: introduces the persona and starts a session.
 */
export default function Landing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?embed=1: the page is iframed on someone's website (see Settings → Embed) —
  // visitors there shouldn't see a door into the settings view.
  const embedded = searchParams.get("embed") === "1";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);

  useEffect(() => {
    fetchPersona()
      .then(setPersona)
      .catch(() => setError("Couldn't reach the backend — is it running?"));
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    player.unlock(); // the click is the user gesture that unlocks audio
    try {
      const session = await createSession();
      navigate(`/session/${session.id}`);
    } catch (err) {
      setError(
        err instanceof OutOfCreditsError
          ? "This experience is taking a short break — please check back soon."
          : "Couldn't start a session — is the backend running?",
      );
      setBusy(false);
    }
  };

  const name = persona?.name ?? "";

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex items-center justify-center py-6">
        <Wordmark className="text-2xl" />
        {!embedded && (
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded-full border border-line p-2.5 text-muted transition hover:border-accent/50 hover:text-accent"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
          </Link>
        )}
      </header>

      <main className="card mx-auto mb-8 flex w-[min(1200px,94vw)] flex-1 flex-col overflow-hidden rounded-3xl lg:flex-row">
        <section className="flex min-w-0 flex-col justify-center px-8 py-12 sm:px-14 sm:py-16 lg:w-[44%] lg:min-w-[340px]">
          <p className="eyebrow mb-6">Meet your guide</p>

          <h1 className="font-display text-[3.4rem] font-medium leading-[1.08] tracking-[-0.01em]">
            {persona && (
              <>
                {persona.name},
                <br />
                {persona.tagline.replace(/^Your /, "your ")}
              </>
            )}
          </h1>

          <p className="mt-7 max-w-md text-[15px] leading-[1.75] text-muted">
            {persona?.description ?? ""}
          </p>

          <div className="mt-10">
            <button
              onClick={start}
              disabled={busy || !persona}
              className="rounded-full bg-accent px-8 py-3.5 text-[15px] font-semibold text-ink transition hover:bg-accent-dim disabled:opacity-60"
            >
              {busy ? "Connecting…" : `Ask ${name || "Me"} Anything`}
            </button>
            {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
          </div>

          <p className="mt-8 max-w-md border-t border-line pt-5 text-xs leading-relaxed text-muted/80">
            By continuing you agree to this demo's terms of use. Conversations are
            processed by third-party AI services.
          </p>
        </section>

        <section className="stage-backdrop relative flex min-h-[300px] flex-1 items-center justify-center border-t border-line lg:border-l lg:border-t-0">
          <PersonaVisual name={name} imageUrl={persona?.image_url} speaking={false} size={340} />
        </section>
      </main>
    </div>
  );
}
