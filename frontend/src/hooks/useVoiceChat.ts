// Voice conversation glue shared by the session page and the embed widget.
// Full-duplex politeness: the mic stays live while the persona speaks. The
// moment the visitor talks over it we hush it (voice interrupt); their finished
// sentence then becomes the next turn. Guards keep the persona's own voice —
// leaking from the speakers into the mic — from triggering a self-interrupt.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionState } from "./useSession";
import { useSpeechInput, type SpeechInputState } from "./useSpeechInput";

type Options = {
  state: SessionState;
  sendMessage: (text: string, source: "typed" | "voice" | "topic") => void;
  interrupt: (source?: "voice") => void;
  onMicToggle?: (on: boolean) => void;
};

/**
 * Owns the mic toggle and speech input for a session, including barge-in on
 * interim transcripts and suppression of the persona's own echo.
 */
export function useVoiceChat({ state, sendMessage, interrupt, onMicToggle }: Options): {
  micOn: boolean;
  setMicOn: (on: boolean) => void;
  toggleMic: () => void;
  speech: SpeechInputState;
} {
  const [micOn, setMicOn] = useState(false);

  const activeRef = useRef(false); // persona speaking or thinking
  const stoppedAtRef = useRef(0);
  const bargedRef = useRef(false);
  const personaTextRef = useRef("");

  useEffect(() => {
    const active = state.playing || state.status !== "idle";
    if (activeRef.current && !active) stoppedAtRef.current = Date.now();
    // the barge-in achieved its interrupt; nothing left to suppress
    if (!active) bargedRef.current = false;
    activeRef.current = active;
  }, [state.playing, state.status]);

  useEffect(() => {
    // recognition stopped mid-utterance discards its pending final, which is
    // the only other place the flag clears
    if (!micOn) bargedRef.current = false;
  }, [micOn]);

  useEffect(() => {
    const lastAssistant = [...state.messages].reverse().find((m) => m.role === "assistant");
    personaTextRef.current = lastAssistant?.text ?? "";
  }, [state.messages]);

  const isPersonaEcho = useCallback((text: string) => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    const heard = norm(text);
    if (!heard) return true;
    const spoken = norm(personaTextRef.current);
    return spoken.length > 0 && spoken.includes(heard);
  }, []);

  const speech = useSpeechInput({
    enabled: micOn,
    onInterim: (text) => {
      if (!activeRef.current || bargedRef.current) return;
      if (text.trim().split(/\s+/).length < 2) return; // ignore blips and coughs
      if (isPersonaEcho(text)) return; // the persona's own voice through the speakers
      bargedRef.current = true;
      interrupt("voice");
    },
    onFinal: (text) => {
      bargedRef.current = false;
      // right after the persona stops, a final can still be its own trailing echo
      const echoWindow = activeRef.current || Date.now() - stoppedAtRef.current < 1500;
      if (echoWindow && isPersonaEcho(text)) return;
      sendMessage(text, "voice");
    },
  });

  // side effects stay out of the state updater (StrictMode re-invokes it)
  const toggleMic = useCallback(() => {
    const next = !micOn;
    setMicOn(next);
    onMicToggle?.(next);
  }, [micOn, onMicToggle]);

  return { micOn, setMicOn, toggleMic, speech };
}
