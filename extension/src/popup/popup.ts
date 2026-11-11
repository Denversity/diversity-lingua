/** Popup : un geste principal, un écran d'état unique, la transparence linguistique, « Comprendre » et paramètres. */
import { detectLanguage } from "../shared/langdetect";
import { maskText } from "../shared/protect";
import { getSettings, saveSettings } from "../shared/settings";
import { t, uiLang, type Lang } from "../shared/i18n";
import type { BgResponse, ExplainResponse, FeedbackPayload, LanguageInfo, PageState } from "../shared/types";
import { renderCoverage, renderReasons } from "../ui/coverage";
import { h } from "../ui/dom";
import { buildExplainModel, renderExplain, renderLoading, renderMessage } from "../ui/explain";
import { icon } from "../ui/icons";
import { renderReportForm } from "../ui/report";
import { deriveView, type LanguageContext, type View } from "../ui/view";

const doc = document;
const lang: Lang = uiLang();
const FALLBACK: LanguageInfo[] = [{ code: "ff", name: "Fulfulde", native_name: "Fulfulde", variety: "", availability: "awaiting_validation" }];

let tabId: number | undefined;
let tabUrl = "";
let langs: LanguageInfo[] = FALLBACK;
let target = "ff";
let lastKey = "";
let state: PageState | null = null;
let reachable = false;

const bg = <T>(msg: unknown): Promise<BgResponse<T>> => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: "", code: "network" } as BgResponse<T>));
async function toTab<T>(msg: unknown): Promise<T | null> {
  if (tabId == null) return null;
  try { return ((await chrome.tabs.sendMessage(tabId, msg)) as T) ?? null; } catch { return null; }
}
const isWeb = (u: string) => /^https?:\/\//i.test(u) && !/^https:\/\/chrome(web)?store\.google\.com|^https:\/\/chromewebstore\.google\.com/i.test(u);
const langCtx = (): LanguageContext | null => {
  const l = langs.find((x) => x.code === target);
  return l ? { name: l.name, availability: l.availability, approved: l.approved_targets ?? l.validated_entries ?? 0, isTest: l.availability === "test_only" } : null;
};
const targetName = () => langs.find((x) => x.code === target)?.name ?? target;

// ---------------------------------------------------------------- squelette statique (ne se redessine pas : conserve focus, saisie, sélection)
const dyn = h(doc, "div", { id: "dyn", class: "pop-dyn" });
const select = h(doc, "select", { class: "dl-field", id: "lang", "aria-label": t("translateTo", lang) });
const srcBox = h(doc, "div", { class: "src", id: "src" });
const termInput = h(doc, "textarea", { class: "dl-field", id: "term", rows: "2", maxlength: "300", placeholder: t("understandPh", lang), "aria-label": t("understandTitle", lang) });
const explainOut = h(doc, "div", { id: "xout", "aria-live": "polite" });
const explainBtn = h(doc, "button", { class: "dl-btn dl-btn--secondary", type: "button" }, t("explain", lang));
const details = h(doc, "details", { class: "understand" },
  h(doc, "summary", {}, icon(doc, "book"), t("understandTitle", lang)),
  h(doc, "div", { class: "understand-body" }, h(doc, "p", { class: "hint" }, t("understandHint", lang)), termInput, explainBtn, explainOut));
const gear = h(doc, "button", { class: "dl-iconbtn", type: "button", "aria-label": t("settings", lang), title: t("settings", lang) }, icon(doc, "gear"));
gear.addEventListener("click", () => chrome.runtime.openOptionsPage());

const app = doc.getElementById("app")!;
app.className = "dl-root";
app.append(
  h(doc, "header", { class: "pop-head" }, h(doc, "img", { src: "icons/icon-48.png", alt: "", width: "36", height: "36" }),
    h(doc, "div", {}, h(doc, "h1", {}, t("appName", lang)), h(doc, "p", {}, t("tagline", lang))), gear),
  h(doc, "main", { class: "pop-main" },
    h(doc, "section", { class: "route", "aria-label": t("thisPage", lang) },
      h(doc, "div", {}, h(doc, "span", { class: "lbl" }, `${t("thisPage", lang)} · ${t("detected", lang)}`), srcBox),
      h(doc, "span", { class: "arrow" }, icon(doc, "arrow")),
      h(doc, "div", {}, h(doc, "label", { class: "lbl", for: "lang" }, t("translateTo", lang)), select)),
    dyn, details),
  h(doc, "footer", { class: "pop-foot" }, h(doc, "span", {}, "TEAM DIVERSITY · SAFINUM 2026")));

// ---------------------------------------------------------------- rendu dynamique
function renderDyn(v: View): void {
  const focusedPrimary = doc.activeElement?.id === "primary";
  const card = h(doc, "section", { class: `dl-card state state--${v.tone}`, "aria-live": "polite" },
    h(doc, "div", { class: "state-head" }, h(doc, "span", { class: "state-ico" }, icon(doc, v.icon)),
      h(doc, "div", {}, h(doc, "h2", {}, v.title), h(doc, "p", {}, v.message))));
  if (v.kind === "translating") {
    const pct = v.progress == null ? 0 : Math.round(v.progress * 100);
    card.append(h(doc, "div", { class: "dl-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
      h(doc, "span", { style: `width:${pct}%` })));
  }
  const cov = renderCoverage(doc, v, lang);
  if (cov) card.append(cov);
  const reasons = renderReasons(doc, v, lang);
  const nodes: Node[] = [card];
  if (reasons) nodes.push(h(doc, "details", { class: "reasons-wrap dl-card" }, h(doc, "summary", {}, t("reasons_title", lang)), reasons));
  for (const n of v.notices) {
    nodes.push(h(doc, "div", { class: `dl-notice dl-notice--${n.tone}`, role: "note" }, icon(doc, n.tone === "test" ? "alert" : n.tone === "layout" ? "keep" : "info"),
      h(doc, "div", {}, n.title ? h(doc, "b", {}, n.title) : null, n.text)));
  }
  if (v.primary.id !== "none") {
    const primary = h(doc, "button", { id: "primary", class: `dl-btn dl-btn--block ${v.primary.id === "restore" ? "dl-btn--secondary" : "dl-btn--primary"}`, type: "button" },
      icon(doc, v.primary.id === "restore" ? "undo" : v.primary.id === "reload" ? "undo" : "globe"), v.primary.label);
    primary.addEventListener("click", () => onPrimary(v.primary.id));
    nodes.push(primary);
  }
  dyn.replaceChildren(...nodes);
  if (focusedPrimary) doc.getElementById("primary")?.focus();
}

function refreshView(force = false): void {
  const v = deriveView({ state, reachable, reloadable: !reachable && isWeb(tabUrl), lang, language: langCtx() });
  srcBox.textContent = reachable && state && state.detectedLang !== "unknown" ? v.sourceLabel : "—";
  const key = JSON.stringify([v, target]);
  if (force || key !== lastKey) { lastKey = key; renderDyn(v); }
}

async function poll(): Promise<void> {
  const s = await toTab<PageState>({ type: "dl/get-state" });
  reachable = s !== null; state = s;
  refreshView();
}

async function onPrimary(id: string): Promise<void> {
  if (id === "reload") { if (tabId != null) await chrome.tabs.reload(tabId); window.close(); return; }
  if (id === "restore") await toTab({ type: "dl/deactivate" });
  else if (id === "translate" || id === "retry") {
    state = { ...(state ?? ({} as PageState)), phase: "detecting", detectedLang: state?.detectedLang ?? "unknown", target, total: 0, counts: state?.counts ?? ({} as any),
      testData: false, coverage: { verified: 0, unverified: 0, kept: 0, total: 0 }, reasons: {} } as PageState;
    refreshView();
    await toTab({ type: "dl/activate", target });
  }
  await poll();
}

// ---------------------------------------------------------------- « Comprendre »
function guessSource(text: string): "fr" | "en" {
  const d = detectLanguage(text, null, 1, 1);
  if (d.lang === "fr" || d.lang === "en") return d.lang;
  if (state && (state.detectedLang === "fr" || state.detectedLang === "en")) return state.detectedLang;
  return /[éèêàçùâîôû]|\b(le|la|les|des|frais|solde|bénéficiaire|beneficiaire|numéro|numero)\b/i.test(text) ? "fr" : "en";
}
async function doExplain(): Promise<void> {
  const raw = (termInput as HTMLTextAreaElement).value.trim();
  if (!raw) return;
  explainOut.replaceChildren(renderLoading(doc, lang));
  const m = maskText(raw);
  const source = guessSource(raw);
  const res = await bg<ExplainResponse>({ type: "dl/explain", source, target, text: m.masked });
  if (!res.ok) { explainOut.replaceChildren(renderMessage(doc, t("c_error", lang))); return; }
  const effectiveSource = res.data.source_lang === "fr" || res.data.source_lang === "en" ? res.data.source_lang : source;
  const model = buildExplainModel(res.data, { term: raw, targetName: targetName(), targetLang: target, sourceLang: effectiveSource });
  const box = h(doc, "div", { class: "dl-card" });
  const show = () => box.replaceChildren(renderExplain(doc, model, lang, { onReport: openReport }));
  const openReport = () => box.replaceChildren(renderReportForm(doc, lang, async (r) => {
    const payload: FeedbackPayload = { source_lang: effectiveSource, target_lang: target, source_text: m.masked, shown_translation: model.translation.text ? maskText(model.translation.text).masked : null,
      suggested_translation: r.suggestion ? maskText(r.suggestion).masked : null, comment: r.comment, category: r.category, concept_id: model.conceptId,
      translation_status: model.translation.reliability === "kept" ? "unavailable" : model.translation.reliability };
    const resp = await bg({ type: "dl/feedback", payload });
    return resp.ok ? { ok: true } : { ok: false, code: resp.code };
  }, show));
  show();
  explainOut.replaceChildren(box);
}
explainBtn.addEventListener("click", doExplain);
termInput.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) { e.preventDefault(); doExplain(); } });
details.addEventListener("toggle", async () => {
  if ((details as HTMLDetailsElement).open && !(termInput as HTMLTextAreaElement).value) {
    const s = await toTab<{ text: string }>({ type: "dl/get-selection" });
    if (s?.text) (termInput as HTMLTextAreaElement).value = s.text;
    termInput.focus();
  }
});

// ---------------------------------------------------------------- initialisation
async function init(): Promise<void> {
  doc.documentElement.lang = lang;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id; tabUrl = tab?.url ?? "";
  const settings = await getSettings();
  const r = await bg<LanguageInfo[]>({ type: "dl/languages" });
  if (r.ok && r.data.length) langs = r.data;
  for (const l of langs) select.append(h(doc, "option", { value: l.code }, l.availability === "test_only" ? `${l.name} (test)` : l.name));
  target = langs.some((l) => l.code === settings.targetLang) ? settings.targetLang : langs[0].code;
  (select as HTMLSelectElement).value = target;
  select.addEventListener("change", async () => {
    target = (select as HTMLSelectElement).value;
    await saveSettings({ targetLang: target });
    if (reachable && state && state.phase !== "inactive") await toTab({ type: "dl/activate", target });
    await poll(); refreshView(true);
  });
  await poll(); refreshView(true);
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === "dl/state") { state = m.state; reachable = true; refreshView(); } });
  setInterval(poll, 800);
}
init();
