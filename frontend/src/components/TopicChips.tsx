type Props = {
  topics: string[];
  disabled: boolean;
  onPick: (topic: string) => void;
};

export default function TopicChips({ topics, disabled, onPick }: Props) {
  if (topics.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2.5">Suggested topics</p>
      <div className="flex flex-wrap gap-2">
        {topics.map((topic) => (
          <button
            key={topic}
            disabled={disabled}
            onClick={() => onPick(topic)}
            className="rounded-full border border-line bg-panel px-3.5 py-1.5 text-[13px] text-accent-soft-2 transition hover:border-accent/40 hover:bg-accent/10 disabled:opacity-40"
          >
            {topic}
          </button>
        ))}
      </div>
    </div>
  );
}
