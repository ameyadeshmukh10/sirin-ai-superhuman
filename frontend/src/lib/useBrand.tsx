// Runtime brand config: static defaults from brand.ts, overridden by whatever
// the settings view has saved (served by GET /api/brand). Components read the
// merged result via useBrand(); the settings page calls refresh() after saving.
// Theme overrides (colors/fonts) are applied as CSS custom properties on <html>
// so every page picks them up without touching index.css.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BODY_FONTS,
  HEADING_FONTS,
  THEME_COLORS,
  brand as defaults,
  type BrandTheme,
  type FontOption,
  type Wordmark,
} from "../brand";

export type BrandConfig = { wordmark: Wordmark; bookMeetingUrl: string; theme: BrandTheme };

export type BrandOverride = {
  wordmark?: Wordmark | null;
  book_meeting_url?: string | null;
  theme?: BrandTheme | null;
};

export function mergeBrand(override: BrandOverride | null | undefined): BrandConfig {
  return {
    wordmark: override?.wordmark ?? defaults.wordmark,
    bookMeetingUrl: override?.book_meeting_url ?? defaults.bookMeetingUrl,
    theme: override?.theme ?? {},
  };
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const FALLBACK_SANS =
  '-apple-system, "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", sans-serif';
const FALLBACK_SERIF = '"Iowan Old Style", "Georgia", "Times New Roman", serif';
const DEFAULT_THEME_COLOR = "#f7f5ef"; // index.html <meta name="theme-color">

/**
 * Build a Google Fonts css2 stylesheet URL for the given catalog entries.
 */
export function fontsHref(fonts: FontOption[]): string {
  const families = fonts.map((f) => `family=${f.query}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

/**
 * Ensure a stylesheet <link id=...> exists with the given href; remove it when
 * href is null.
 */
function setStylesheet(id: string, href: string | null) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

/**
 * Apply a theme override to the document: set the --color and --font custom
 * properties on <html> (inline styles win over the index.css @theme values),
 * derive the secondary shades the palette needs, and load the chosen Google
 * Fonts. An empty theme removes everything, restoring the code defaults.
 */
export function applyTheme(theme: BrandTheme) {
  const root = document.documentElement.style;
  const colors: Record<string, string> = {};
  for (const token of THEME_COLORS) {
    const value = theme.colors?.[token.key];
    if (value && HEX_RE.test(value)) colors[token.key] = value.toLowerCase();
  }

  // Derived shades: only computed when their base token is overridden, so an
  // untouched theme leaves the hand-tuned defaults from index.css in place.
  // Ratios approximate the shipped palette's relationships.
  const derived: Record<string, string | null> = {
    "--color-accent-dim": colors.accent ? `color-mix(in srgb, ${colors.accent} 86%, black)` : null,
    "--color-accent-soft": colors.accent ? `color-mix(in srgb, ${colors.accent} 66%, black)` : null,
    "--color-accent-soft-2": colors.accent
      ? `color-mix(in srgb, ${colors.accent} 76%, black)`
      : null,
    "--color-orb-glow": colors.accent
      ? `color-mix(in srgb, ${colors.accent} 15%, transparent)`
      : null,
    "--color-stage-from":
      colors.ink || colors.panel
        ? "color-mix(in srgb, var(--color-panel) 50%, var(--color-ink))"
        : null,
    "--color-stage-to": colors["panel-2"] ? "var(--color-panel-2)" : null,
    "--color-stone":
      colors.line || colors.muted
        ? "color-mix(in srgb, var(--color-line) 85%, var(--color-muted))"
        : null,
    "--color-scrollbar":
      colors.line || colors.muted
        ? "color-mix(in srgb, var(--color-line) 85%, var(--color-muted))"
        : null,
    "--color-orb-1":
      colors.line || colors.muted
        ? "color-mix(in srgb, var(--color-line) 95%, var(--color-muted))"
        : null,
    "--color-orb-2":
      colors.line || colors.muted
        ? "color-mix(in srgb, var(--color-line) 80%, var(--color-muted))"
        : null,
  };

  for (const token of THEME_COLORS) {
    if (colors[token.key]) root.setProperty(`--color-${token.key}`, colors[token.key]);
    else root.removeProperty(`--color-${token.key}`);
  }
  for (const [prop, value] of Object.entries(derived)) {
    if (value) root.setProperty(prop, value);
    else root.removeProperty(prop);
  }

  // Fonts: names resolve against the catalogs; unknown names are ignored so a
  // stale or hand-edited override can never inject an arbitrary fonts URL.
  const heading = HEADING_FONTS.find((f) => f.name === theme.heading_font);
  const bodyFont = BODY_FONTS.find((f) => f.name === theme.body_font);
  if (heading) {
    root.setProperty(
      "--font-display",
      `"${heading.name}", ${heading.serif ? FALLBACK_SERIF : FALLBACK_SANS}`,
    );
  } else {
    root.removeProperty("--font-display");
  }
  if (bodyFont) {
    root.setProperty(
      "--font-brand",
      `"${bodyFont.name}", ${bodyFont.serif ? FALLBACK_SERIF : FALLBACK_SANS}`,
    );
  } else {
    root.removeProperty("--font-brand");
  }
  const picked = [heading, bodyFont].filter((f): f is FontOption => f != null);
  setStylesheet("brand-fonts", picked.length ? fontsHref(picked) : null);

  // Keep the browser chrome color in step with the page background.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", colors.ink ?? DEFAULT_THEME_COLOR);
}

const BrandContext = createContext<{ brand: BrandConfig; refresh: () => void }>({
  brand: mergeBrand(null),
  refresh: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<BrandConfig>(() => mergeBrand(null));
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const gen = ++generation.current;
    fetch("/api/brand")
      .then((res) => (res.ok ? res.json() : null))
      .then((override: BrandOverride | null) => {
        // drop stale responses: only the latest refresh may apply its result
        if (gen === generation.current) setConfig(mergeBrand(override));
      })
      .catch(() => {}); // backend unreachable — static defaults stand
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    applyTheme(config.theme);
  }, [config.theme]);

  return (
    <BrandContext.Provider value={{ brand: config, refresh }}>{children}</BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
