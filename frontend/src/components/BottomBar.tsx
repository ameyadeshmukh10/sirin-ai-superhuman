import { useBrand } from "../lib/useBrand";

type Props = {
  micOn: boolean;
  micSupported: boolean;
  listening: boolean;
  speakerOn: boolean;
  ctaHighlight: boolean;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onBookMeeting: () => void;
  onEnd: () => void;
};

export default function BottomBar(props: Props) {
  const {
    micOn, micSupported, listening, speakerOn, ctaHighlight,
    onToggleMic, onToggleSpeaker, onBookMeeting, onEnd,
  } = props;
  const { brand } = useBrand();

  return (
    <div className="flex items-center justify-between border-t border-line bg-panel px-6 py-3.5">
      <a
        href={brand.bookMeetingUrl}
        target="_blank"
        rel="noreferrer"
        onClick={onBookMeeting}
        className={`rounded-full px-6 py-2.5 font-semibold text-ink transition ${
          ctaHighlight
            ? "bg-accent shadow-[0_0_24px_-4px_var(--color-accent)]"
            : "bg-accent/90 hover:bg-accent"
        }`}
      >
        Book a Meeting
      </a>

      <div className="flex items-center gap-8">
        {micSupported && (
          <ControlButton
            label="Mic"
            active={micOn}
            pulse={listening}
            onClick={onToggleMic}
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                {!micOn && <path d="M4 4l16 16" strokeLinecap="round" stroke="#f87171" />}
              </svg>
            }
          />
        )}
        <ControlButton
          label="Speaker"
          active={speakerOn}
          onClick={onToggleSpeaker}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 10v4h4l5 4V6L8 10H4z" strokeLinejoin="round" />
              {speakerOn ? (
                <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" strokeLinecap="round" />
              ) : (
                <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
              )}
            </svg>
          }
        />
      </div>

      <button
        onClick={onEnd}
        className="flex items-center gap-2 rounded-full border border-red-500/40 px-5 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">✕</span>
        End
      </button>
    </div>
  );
}

function ControlButton({
  label, active, pulse, onClick, icon,
}: {
  label: string;
  active: boolean;
  pulse?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-1">
      <span
        className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition ${
          active
            ? "border-accent/60 text-accent"
            : "border-line text-gray-400 group-hover:text-gray-200"
        }`}
      >
        {pulse && <span className="speaking-ring absolute inset-0 rounded-full border border-accent/60" />}
        {icon}
      </span>
      <span className="text-[11px] text-gray-400">{label}</span>
    </button>
  );
}
