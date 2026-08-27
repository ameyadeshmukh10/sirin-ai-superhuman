import { useBrand } from "../lib/useBrand";

export default function Wordmark({ className = "" }: { className?: string }) {
  const mark = useBrand().brand.wordmark;
  if (mark.kind === "logo") {
    return <img src={mark.src} alt={mark.alt} className={`h-7 ${className}`} />;
  }
  const end = mark.accentEnd ?? mark.text.length;
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      {mark.text.slice(0, mark.accentStart)}
      <span className="text-accent">{mark.text.slice(mark.accentStart, end)}</span>
      {mark.text.slice(end)}
    </span>
  );
}
