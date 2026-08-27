// Client for the settings view's backend (/api/admin/*). When the backend has
// ADMIN_TOKEN set, requests need the token — held in memory and sent as an
// X-Admin-Token header; a 401 throws AdminAuthError so the page can prompt.

import type { Wordmark } from "../brand";
import type { BrandOverride } from "./useBrand";

export type AdminPersona = {
  id: string;
  image_url: string | null;
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
  gtm: { default: string; custom: string | null };
  avatar: AvatarState;
  content: AdminContentItem[];
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

export function getAdminToken(): string {
  return adminToken;
}

export function setAdminToken(token: string) {
  adminToken = token;
}

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

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

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
  deleteContent: (id: string) =>
    request<{ content: AdminContentItem[] }>(`/api/admin/content/${id}`, { method: "DELETE" }),

  resetOverride: (key: "persona" | "brand" | "gtm" | `content:${string}`) =>
    request<AdminConfig>(`/api/admin/overrides/${key}`, { method: "DELETE" }),
};
