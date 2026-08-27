// Frontend brand seam. Colors and fonts live in index.css (@theme block);
// persona identity and GTM knowledge live in the backend (seed_data.py, prompt.py).
// The brand-onboarding skill rewrites this file when re-theming for a company.

export type Wordmark =
  | { kind: "text"; text: string; accentStart: number; accentEnd?: number }
  | { kind: "logo"; src: string; alt: string };

export const brand = {
  // Text form: characters [accentStart, accentEnd) render in the accent color
  // (accentEnd defaults to the end of the string).
  wordmark: { kind: "text", text: "SIRIN AI", accentStart: 6 } as Wordmark,
  bookMeetingUrl: "https://calendly.com/cole-brooker-sirin-ai/30min",
};
