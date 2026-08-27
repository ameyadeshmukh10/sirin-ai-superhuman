import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PersonaVisual from "../components/PersonaVisual";
import Wordmark from "../components/Wordmark";
import { player } from "../lib/pcmPlayer";
import { createSession, fetchPersona, type Persona } from "../lib/protocol";

export default function Landing() {
  const navigate = useNavigate();
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
    } catch {
      setError("Couldn't start a session — is the backend running?");
      setBusy(false);
    }
  };

  const name = persona?.name ?? "";

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex items-center justify-center py-5">
        <Wordmark className="text-2xl" />
        <Link
          to="/settings"
          aria-label="Settings"
          title="Settings"
          className="absolute right-6 top-1/2 -translate-y-1/2 rounded-full border border-line p-2.5 text-gray-400 transition hover:border-accent/60 hover:text-accent"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </Link>
      </header>

      <main className="mx-auto mb-6 flex w-[min(1200px,94vw)] flex-1 overflow-hidden rounded-3xl border border-accent/60 bg-panel shadow-[0_0_60px_-20px_var(--color-accent)]">
        <section className="flex w-[42%] min-w-[320px] flex-col justify-between p-10">
          <h1 className="text-5xl font-semibold leading-tight">
            {persona && (
              <>
                Meet {persona.name},
                <br />
                {persona.tagline}
              </>
            )}
          </h1>

          <div className="space-y-6">
            <p className="max-w-md text-[15px] leading-relaxed text-gray-400">
              {persona?.description ?? ""}
            </p>
            <button
              onClick={start}
              disabled={busy || !persona}
              className="rounded-full bg-accent px-8 py-3.5 text-lg font-semibold text-ink transition hover:bg-accent-dim disabled:opacity-60"
            >
              {busy ? "Connecting…" : `Ask ${name || "Me"} Anything`}
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <p className="text-xs text-gray-500">
              By continuing you agree to this demo's terms of use. Conversations are
              processed by third-party AI services.
            </p>
          </div>
        </section>

        <section className="stage-backdrop relative flex flex-1 items-center justify-center">
          <PersonaVisual name={name} imageUrl={persona?.image_url} speaking={false} size={340} />
        </section>
      </main>
    </div>
  );
}
