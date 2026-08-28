// Mirrors backend/app WebSocket events. Binary frames: 8-byte header
// (uint32 BE gen, uint32 BE seq) followed by PCM s16le mono samples.

export type Slide = { id: string; url: string; title: string };
export type VideoClip = { id: string; url: string; title: string };

export type ServerEvent =
  | { type: "pong"; gen: number }
  | { type: "state"; gen: number; status: "idle" | "thinking" | "speaking" }
  | { type: "assistant_start"; gen: number; message_id: string }
  | { type: "sentence"; gen: number; seq: number; text: string }
  | { type: "audio_start"; gen: number; seq: number; format: string; sample_rate: number }
  | { type: "audio_end"; gen: number; seq: number }
  | { type: "audio_failed"; gen: number; seq: number }
  | { type: "show_slides"; gen: number; seq: number; deck_id: string; title: string; slides: Slide[] }
  | { type: "go_to_slide"; gen: number; seq: number; index: number }
  | { type: "play_video"; gen: number; seq: number; video: VideoClip }
  | { type: "suggested_topics"; gen: number; seq: number; topics: string[] }
  | { type: "show_cta"; gen: number; seq: number; cta: string }
  | { type: "assistant_end"; gen: number; stop_reason: string }
  | { type: "interrupted"; gen: number }
  | { type: "avatar"; gen: number; url: string; token: string }
  | { type: "avatar_ended"; gen: number }
  | { type: "speak_started"; gen: number; seq: number }
  | { type: "speak_ended"; gen: number; seq: number }
  | { type: "error"; gen: number; code: string; message: string; fatal: boolean };

export type Persona = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  image_url: string | null;
  default_topics: string[];
  mic_disclaimer: string;
};

export type SessionInfo = { id: string; persona: Persona };

export async function fetchPersona(): Promise<Persona> {
  const res = await fetch("/api/persona");
  if (!res.ok) throw new Error(`fetch persona failed: ${res.status}`);
  return res.json();
}

export class OutOfCreditsError extends Error {
  constructor() {
    super("out of credits");
  }
}

export async function createSession(): Promise<SessionInfo> {
  const res = await fetch("/api/sessions", { method: "POST" });
  if (res.status === 402) throw new OutOfCreditsError();
  if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  return res.json();
}

export async function fetchSession(id: string): Promise<
  SessionInfo & { status: string; messages: { role: string; text: string }[] }
> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) throw new Error(`session not found: ${res.status}`);
  return res.json();
}
