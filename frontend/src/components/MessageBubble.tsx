import type { ChatMessage } from "../hooks/useSession";

export default function MessageBubble({ message }: { message: ChatMessage }) {
  if (!message.text) return null;
  const isUser = message.role === "user";
  return (
    <div className={`fade-up flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
          isUser
            ? "rounded-br-md bg-accent/10 text-accent-soft"
            : "rounded-bl-md bg-panel-2 text-body"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}
