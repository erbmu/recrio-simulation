const resolvedBase =
  (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

export const API_BASE = resolvedBase.replace(/\/+$/, "");

export const buildApiUrl = (path: string) => {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${trimmed}`;
};
