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

// Runtime appearance override, stored by the settings view (Appearance section)
// and served to every visitor via GET /api/brand as `theme`. Colors are keyed
// by the --color-<key> tokens below; fonts are Google Font names resolved
// against the catalogs below (unknown names are ignored).
export type BrandTheme = {
  colors?: Record<string, string>;
  heading_font?: string | null;
  body_font?: string | null;
};

// The color tokens the settings view exposes. `key` maps to --color-<key> in
// index.css; `default` mirrors the value there (keep the two in sync — the
// form prefills from this list, and only values that differ get stored).
export const THEME_COLORS: { key: string; label: string; hint: string; default: string }[] = [
  { key: "accent", label: "Accent", hint: "Buttons, highlights, wordmark accent", default: "#8c7354" },
  { key: "ink", label: "Page background", hint: "Behind everything", default: "#f7f5ef" },
  { key: "panel", label: "Card background", hint: "Raised cards and panels", default: "#fdfcf9" },
  { key: "panel-2", label: "Inputs & bubbles", hint: "Form fields, chat bubbles", default: "#efece3" },
  { key: "line", label: "Borders", hint: "Hairlines around cards and inputs", default: "#ddd8cc" },
  { key: "body", label: "Text", hint: "Default text color", default: "#1e1f20" },
  { key: "muted", label: "Secondary text", hint: "Captions, hints, labels", default: "#5e6464" },
  { key: "moss", label: "Positive accent", hint: "Quiet positive emphasis", default: "#64715c" },
  { key: "atlantic", label: "Link accent", hint: "Links, cool emphasis", default: "#2d4757" },
];

// Google Fonts the settings view offers. `query` is the css2 family fragment
// (weights each family actually ships); `serif` picks the fallback stack.
export type FontOption = { name: string; query: string; serif: boolean };

export const HEADING_FONTS: FontOption[] = [
  { name: "Source Serif 4", query: "Source+Serif+4:opsz,wght@8..60,400..700", serif: true },
  { name: "Playfair Display", query: "Playfair+Display:wght@400..700", serif: true },
  { name: "Lora", query: "Lora:wght@400..700", serif: true },
  { name: "Merriweather", query: "Merriweather:wght@400;700", serif: true },
  { name: "Libre Baskerville", query: "Libre+Baskerville:wght@400;700", serif: true },
  { name: "Cormorant Garamond", query: "Cormorant+Garamond:wght@400;500;600;700", serif: true },
  { name: "DM Serif Display", query: "DM+Serif+Display", serif: true },
  { name: "Space Grotesk", query: "Space+Grotesk:wght@400..700", serif: false },
  { name: "Poppins", query: "Poppins:wght@400;500;600;700", serif: false },
  { name: "Montserrat", query: "Montserrat:wght@400..700", serif: false },
];

export const BODY_FONTS: FontOption[] = [
  { name: "Inter", query: "Inter:wght@400..700", serif: false },
  { name: "Roboto", query: "Roboto:wght@400..700", serif: false },
  { name: "Open Sans", query: "Open+Sans:wght@400..700", serif: false },
  { name: "Source Sans 3", query: "Source+Sans+3:wght@400..700", serif: false },
  { name: "Nunito Sans", query: "Nunito+Sans:opsz,wght@6..12,400..700", serif: false },
  { name: "Work Sans", query: "Work+Sans:wght@400..700", serif: false },
  { name: "IBM Plex Sans", query: "IBM+Plex+Sans:wght@400;500;600;700", serif: false },
  { name: "Karla", query: "Karla:wght@400..700", serif: false },
  { name: "DM Sans", query: "DM+Sans:opsz,wght@9..40,400..700", serif: false },
  { name: "Manrope", query: "Manrope:wght@400..700", serif: false },
];

// Defaults (what index.css already loads and sets — treated as "no override").
export const DEFAULT_HEADING_FONT = "Source Serif 4";
export const DEFAULT_BODY_FONT = "Inter";
