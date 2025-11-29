export const getApiBase = () => {
  const override = import.meta.env.VITE_API_URL;
  if (override && typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "http://localhost:4000";
};

export const API_BASE = getApiBase();

export const buildApiUrl = (path: string) => {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${trimmed}`;
};
