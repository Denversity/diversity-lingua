/** Service worker : orchestration des messages, appels API, menus contextuels, badge. */
import { getSettings } from "../shared/settings";
import { t } from "../shared/i18n";
import type { BgRequest, BgResponse, UiPhase } from "../shared/types";
import { ApiClient, ApiError } from "./apiClient";
import { GlossaryClient } from "./glossaryClient";
import { TranslationManager } from "./translationManager";

const api = new ApiClient(async () => {
  const s = await getSettings();
  return { baseUrl: s.backendUrl, token: s.apiToken };
});
let useLocal = true;
const glossary = new GlossaryClient(async (lang) => {
  try {
    const r = await fetch(chrome.runtime.getURL(`glossary/${encodeURIComponent(lang)}.json`));
    return r.ok ? await r.json() : null;
  } catch { return null; }
});
const manager = new TranslationManager(api, glossary, { useLocalGlossary: () => useLocal });
getSettings().then((s) => { useLocal = s.useLocalGlossary; });
chrome.storage.onChanged.addListener(async (ch) => {
  if (ch.settings) { useLocal = (await getSettings()).useLocalGlossary; manager.clearCache(); }
});

const MAX_SEGMENTS = 200, MAX_TEXT = 2000;
let feedbackLog: number[] = []; // horodatages des signalements récents (limite : 20/heure, 1 toutes les 1,5 s)
function validTranslate(m: any): boolean {
  return typeof m.source === "string" && typeof m.target === "string" && Array.isArray(m.segments) && m.segments.length <= MAX_SEGMENTS &&
    m.segments.every((s: any) => s && typeof s.id === "string" && typeof s.text === "string" && s.text.length <= MAX_TEXT);
}
const fail = (e: unknown): BgResponse<never> => {
  if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code };
  return { ok: false, error: "Erreur inattendue", code: "internal" };
};

async function handle(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<BgResponse<any>> {
  try {
    switch (msg.type) {
      case "dl/translate":
        if (!validTranslate(msg)) return { ok: false, error: "Requête invalide", code: "invalid_request" };
        return { ok: true, data: await manager.translate(msg.source, msg.target, msg.segments) };
      case "dl/explain":
        if (typeof msg.text !== "string" || msg.text.length > 500) return { ok: false, error: "Requête invalide", code: "invalid_request" };
        return { ok: true, data: await api.explain(msg.source, msg.target, msg.text) };
      case "dl/feedback": {
        const p = msg.payload;
        if (!p || typeof p.source_text !== "string" || !p.source_text.trim() || p.source_text.length > 2000 || (p.suggested_translation ?? "").length > 2000 || (p.comment ?? "").length > 1000)
          return { ok: false, error: "Requête invalide", code: "invalid_request" };
        const now = Date.now();
        feedbackLog = feedbackLog.filter((t) => now - t < 3_600_000);
        if (feedbackLog.length >= 20 || (feedbackLog.length && now - feedbackLog[feedbackLog.length - 1] < 1500)) return { ok: false, error: "Trop de signalements", code: "rate_limited" };
        const res = await api.feedback(p);
        feedbackLog.push(now);
        return { ok: true, data: res };
      }
      case "dl/languages": return { ok: true, data: await api.languages() };
      case "dl/health": return { ok: true, data: await api.health() };
      case "dl/hello": {
        const id = sender.tab?.id;
        const st = id != null ? (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] : null;
        return { ok: true, data: st ?? { active: false, target: null } };
      }
      case "dl/tab-state": {
        const id = sender.tab?.id;
        if (id == null) return { ok: true, data: null };
        await chrome.storage.session.set({ [`tab:${id}`]: { active: msg.active, target: msg.target } });
        const badge: Record<UiPhase, [string, string]> = {
          inactive: ["", "#0E6B5C"], active: ["ON", "#0E6B5C"], detecting: ["…", "#0E6B5C"], translating: ["…", "#0E6B5C"], done: ["ON", "#0E6B5C"],
          partial: ["½", "#7A4F00"], error: ["!", "#9E2229"], unavailable: ["–", "#3E4C57"], empty: ["∅", "#3E4C57"],
        };
        const [text, color] = badge[msg.phase as UiPhase] ?? ["", "#0E6B5C"];
        await chrome.action.setBadgeText({ tabId: id, text: msg.active ? text : "" });
        await chrome.action.setBadgeBackgroundColor({ tabId: id, color });
        return { ok: true, data: null };
      }
    }
  } catch (e) { return fail(e); }
  return { ok: false, error: "Message inconnu", code: "unknown_message" };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string" || !msg.type.startsWith("dl/")) return false;
  handle(msg, sender).then(sendResponse);
  return true; // réponse asynchrone
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "dl-translate-selection", title: "Diversity Lingua : traduire la sélection", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "dl-explain-selection", title: `Diversity Lingua : ${t("understand", "fr")}`, contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.selectionText) return;
  const type = info.menuItemId === "dl-explain-selection" ? "dl/explain-selection" : "dl/translate-selection";
  chrome.tabs.sendMessage(tab.id, { type, text: info.selectionText.slice(0, 1000) }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((id) => { chrome.storage.session.remove(`tab:${id}`); });
