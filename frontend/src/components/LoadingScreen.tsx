export default function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-ink">
      <div className="relative h-16 w-16">
        <span className="speaking-ring absolute inset-0 rounded-full border-2 border-accent/60" />
        <span className="absolute inset-3 rounded-full bg-accent/20" />
        <span className="absolute inset-5 rounded-full bg-accent" />
      </div>
      <p className="text-sm tracking-wide text-muted">{label}</p>
    </div>
  );
}
