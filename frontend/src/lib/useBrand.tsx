// Runtime brand config: static defaults from brand.ts, overridden by whatever
// the settings view has saved (served by GET /api/brand). Components read the
// merged result via useBrand(); the settings page calls refresh() after saving.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { brand as defaults, type Wordmark } from "../brand";

export type BrandConfig = { wordmark: Wordmark; bookMeetingUrl: string };

export type BrandOverride = {
  wordmark?: Wordmark | null;
  book_meeting_url?: string | null;
};

export function mergeBrand(override: BrandOverride | null | undefined): BrandConfig {
  return {
    wordmark: override?.wordmark ?? defaults.wordmark,
    bookMeetingUrl: override?.book_meeting_url ?? defaults.bookMeetingUrl,
  };
}

const BrandContext = createContext<{ brand: BrandConfig; refresh: () => void }>({
  brand: defaults,
  refresh: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<BrandConfig>(defaults);

  const refresh = useCallback(() => {
    fetch("/api/brand")
      .then((res) => (res.ok ? res.json() : null))
      .then((override: BrandOverride | null) => setConfig(mergeBrand(override)))
      .catch(() => {}); // backend unreachable — static defaults stand
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <BrandContext.Provider value={{ brand: config, refresh }}>{children}</BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
