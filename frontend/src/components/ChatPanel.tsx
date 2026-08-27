import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../hooks/useSession";
import MessageBubble from "./MessageBubble";
import TopicChips from "./TopicChips";

type Props = {
  messages: ChatMessage[];
  topics: string[];
  status: "idle" | "thinking" | "speaking";
  micDisclaimer: string;
  interim: string;
  onSend: (text: string, source: "typed" | "topic") => void;
};

export default function ChatPanel({ messages, topics, status, micDisclaimer, interim, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft, "typed");
    setDraft("");
  };

  return (
    <aside className="flex w-[380px] min-w-[300px] flex-col border-r border-line bg-panel">
      <div className="eyebrow border-b border-line px-5 py-3.5 text-center">
        Conversation
      </div>

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="rounded-xl bg-panel-2/70 px-4 py-3 text-[12px] leading-relaxed text-muted">
          {micDisclaimer}
        </div>
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {status === "thinking" && (
          <div className="fade-up flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-panel-2 px-4 py-3">
              <span className="inline-flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="typing-dot h-1.5 w-1.5 rounded-full bg-muted"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-line px-4 py-4">
        <TopicChips topics={topics} disabled={status === "thinking"} onPick={(t) => onSend(t, "topic")} />
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={interim || draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={interim ? "" : "Type here"}
            className="flex-1 rounded-full border border-line bg-panel-2/70 px-4 py-2.5 text-sm text-body placeholder-muted/70 outline-none transition focus:border-accent/50 focus:bg-panel"
          />
          <button
            type="submit"
            aria-label="Send"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-panel-2 text-accent transition hover:bg-accent hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
