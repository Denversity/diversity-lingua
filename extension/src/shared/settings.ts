/** Settings Manager : préférences utilisateur persistées dans chrome.storage.local. */
export interface Settings {
  backendUrl: string;
  apiToken: string;
  targetLang: string;
  marks: "unvalidated" | "all" | "none";
  translateAttributes: boolean;
  useLocalGlossary: boolean;
  showBadge: boolean;
  panelSide: "left" | "right";
  layoutGuard: boolean; // diagnostic : désactiver la garde de mise en page (ne jamais le faire en usage normal)
}
export const DEFAULT_SETTINGS: Settings = {
  backendUrl: "http://localhost:8000",
  apiToken: "",
  targetLang: "ff",
  marks: "unvalidated",
  translateAttributes: true,
  useLocalGlossary: true,
  showBadge: true,
  panelSide: "right",
  layoutGuard: true,
};

export function normalizeBaseUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("URL http(s) requise");
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol === "http:" && !local) throw new Error("HTTPS obligatoire hors localhost");
  return u.origin + u.pathname.replace(/\/+$/, "");
}

export function sanitizeSettings(input: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  try { s.backendUrl = normalizeBaseUrl(s.backendUrl); } catch { s.backendUrl = DEFAULT_SETTINGS.backendUrl; }
  if (!["unvalidated", "all", "none"].includes(s.marks)) s.marks = "unvalidated";
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(s.targetLang)) s.targetLang = DEFAULT_SETTINGS.targetLang;
  s.layoutGuard = s.layoutGuard !== false;
  if (s.panelSide !== "left" && s.panelSide !== "right") s.panelSide = "right";
  s.apiToken = String(s.apiToken ?? "").trim();
  return s;
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get("settings");
  return sanitizeSettings((raw.settings as Partial<Settings>) ?? {});
}
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitizeSettings({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ settings: next });
  return next;
}
