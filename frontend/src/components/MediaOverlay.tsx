import type { MediaState } from "../hooks/useSession";

type Props = {
  media: Exclude<MediaState, null>;
  onNavigate: (delta: number) => void;
  onClose: () => void;
  onVideoEnded: () => void;
};

export default function MediaOverlay({ media, onNavigate, onClose, onVideoEnded }: Props) {
  return (
    <div className="glass fade-up absolute inset-4 z-10 flex flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <span className="text-[13px] font-medium tracking-wide text-muted">
          {media.kind === "slides"
            ? `${media.title} — ${media.index + 1}/${media.slides.length}`
            : media.video.title}
        </span>
        <button
          onClick={onClose}
          aria-label="Close media"
          className="rounded-full px-2.5 py-1 text-sm text-muted transition hover:bg-panel-2 hover:text-body"
        >
          ✕
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center p-4">
        {media.kind === "slides" ? (
          <>
            <img
              key={media.index}
              src={media.slides[media.index].url}
              alt={`Slide ${media.index + 1}`}
              className="fade-up max-h-full max-w-full rounded-lg object-contain"
            />
            {media.index > 0 && (
              <NavButton side="left" onClick={() => onNavigate(-1)} />
            )}
            {media.index < media.slides.length - 1 && (
              <NavButton side="right" onClick={() => onNavigate(1)} />
            )}
          </>
        ) : (
          <video
            src={media.video.url}
            controls
            autoPlay
            onEnded={onVideoEnded}
            className="max-h-full max-w-full rounded-lg"
          />
        )}
      </div>
    </div>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={`glass absolute top-1/2 -translate-y-1/2 rounded-full p-3 text-muted transition hover:border-accent/50 hover:text-accent ${
        side === "left" ? "left-6" : "right-6"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        {side === "left" ? (
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
