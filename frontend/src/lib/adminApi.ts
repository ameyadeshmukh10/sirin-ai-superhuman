// Client for the settings view's backend (/api/admin/*). When the backend has
// ADMIN_TOKEN set, requests need the token — held in memory and sent as an
// X-Admin-Token header; a 401 throws AdminAuthError so the page can prompt.

import type { BrandTheme, Wordmark } from "../brand";
import type { BrandOverride } from "./useBrand";

export type AdminPersona = {
  id: string;
  image_url: string | null;
  // the env-configured fallback voice; lets the UI show it as "Server default"
  default_voice_id: string;
  name: string;
  company: string;
  website: string;
  tagline: string;
  description: string;
  greeting: string;
  default_topics: string[];
  mic_disclaimer: string;
  voice_id: string;
};

export type AdminContentItem = {
  id: string;
  type: "slide_deck" | "video";
  title: string;
  description: string;
  assets: string[];
  presenter_notes: string[];
  custom: boolean;
  edited: boolean;
};

export type AvatarItem = {
  id: string;
  name: string;
  preview_url: string;
  portrait: boolean;
};

export type AvatarState = {
  selected_id: string | null;
  selected_name: string | null;
  env_default_id: string | null;
  heygen_configured: boolean;
};

export type AdminConfig = {
  store: string;
  persona: AdminPersona;
  brand: BrandOverride;
  theme: BrandTheme;
  gtm: { default: string; custom: string | null };
  avatar: AvatarState;
  content: AdminContentItem[];
};

export type CreditPack = {
  id: string;
  label: string;
  credits: number;
  usd_cents: number;
};

export type CreditEntry = {
  ts: number;
  kind: "grant" | "use";
  service: "claude" | "tts" | "avatar" | null;
  units: number | null;
  credits: number;
  note: string | null;
};

export type CreditsSummary = {
  balance: number;
  granted: number;
  used: {
    claude: { credits: number; tokens: number };
    tts: { credits: number; chars: number };
    avatar: { credits: number; minutes: number };
  };
  credit_usd: number;
  enabled: boolean;
  low_threshold: number;
  stripe_configured: boolean;
  packs: CreditPack[];
  recent: CreditEntry[];
};

export class AdminAuthError extends Error {
  constructor() {
    super("admin token required");
  }
}

// In memory only — never persisted to localStorage/sessionStorage, where any
// same-origin script could read it. The cost is re-entering the token after a
// full page reload.
let adminToken = "";

/**
 * Get the current admin token from memory.
 */
export function getAdminToken(): string {
  return adminToken;
}

/**
 * Store the admin token in memory for subsequent API requests.
 */
export function setAdminToken(token: string) {
  adminToken = token;
}

/**
 * Make an authenticated request to the admin API, throwing on auth or HTTP errors.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAdminToken();
  if (token) headers.set("x-admin-token", token);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new AdminAuthError();
  if (!res.ok) {
    let detail = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(detail);
  }
  return res.json();
}

/**
 * Build a RequestInit for a JSON request with the given method and body.
 */
function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Build a RequestInit for a multipart file upload with optional extra fields.
 */
function upload(file: File, extra: Record<string, string> = {}): RequestInit {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return { method: "POST", body: form };
}

export const adminApi = {
  getConfig: () => request<AdminConfig>("/api/admin/config"),

  updatePersona: (fields: Partial<AdminPersona>) =>
    request<{ persona: AdminPersona }>("/api/admin/persona", json("PUT", fields)),
  uploadPersonaImage: (file: File) =>
    request<{ image_url: string }>("/api/admin/persona/image", upload(file)),

  updateBrand: (fields: { wordmark?: Wordmark; book_meeting_url?: string }) =>
    request<{ brand: BrandOverride }>("/api/admin/brand", json("PUT", fields)),
  uploadLogo: (file: File) =>
    request<{ brand: BrandOverride }>("/api/admin/brand/logo", upload(file)),

  updateTheme: (theme: BrandTheme) =>
    request<{ theme: BrandTheme }>("/api/admin/theme", json("PUT", theme)),

  updateGtm: (text: string | null) =>
    request<{ gtm: AdminConfig["gtm"] }>("/api/admin/gtm", json("PUT", { text })),

  getAvatars: () => request<{ avatars: AvatarItem[] } & AvatarState>("/api/admin/avatars"),
  setAvatar: (avatar_id: string | null) =>
    request<AvatarState>("/api/admin/avatar", json("PUT", { avatar_id })),

  updateContent: (
    id: string,
    fields: { title?: string; description?: string; presenter_notes?: string[] },
  ) => request<{ content: AdminContentItem[] }>(`/api/admin/content/${id}`, json("PUT", fields)),
  uploadVideo: (file: File, title: string, description: string) =>
    request<{ content: AdminContentItem[] }>(
      "/api/admin/content/video",
      upload(file, { title, description }),
    ),
  uploadDeck: (files: File[], title: string, description: string) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("title", title);
    form.append("description", description);
    return request<{ content: AdminContentItem[] }>("/api/admin/content/deck", {
      method: "POST",
      body: form,
    });
  },
  replaceDeckSlides: (id: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<{ content: AdminContentItem[] }>(`/api/admin/content/${id}/slides`, {
      method: "POST",
      body: form,
    });
  },
  deleteContent: (id: string) =>
    request<{ content: AdminContentItem[] }>(`/api/admin/content/${id}`, { method: "DELETE" }),

  getCredits: () => request<CreditsSummary>("/api/admin/credits"),
  grantCredits: (credits: number, note?: string) =>
    request<CreditsSummary>("/api/admin/credits/grant", json("POST", { credits, note })),
  creditsCheckout: (pack: string) =>
    request<{ url: string }>("/api/admin/credits/checkout", json("POST", { pack })),
  updateCreditsSettings: (fields: { enabled?: boolean; low_threshold?: number }) =>
    request<CreditsSummary>("/api/admin/credits/settings", json("PUT", fields)),

  resetOverride: (key: "persona" | "brand" | "gtm" | "theme" | `content:${string}`) =>
    request<AdminConfig>(`/api/admin/overrides/${key}`, { method: "DELETE" }),
};
