/** Point d'entrée du content script : dormant tant que l'utilisateur n'a pas activé la traduction. */
import { maskText } from "../shared/protect";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from "../shared/settings";
import { t, uiLang } from "../shared/i18n";
import type { BgRequest, BgResponse, ContentCommand, FeedbackPayload, LanguageInfo, PageState } from "../shared/types";
import { buildExplainModel, renderExplain, renderLoading, renderMessage, type Reliability } from "../ui/explain";
import { h } from "../ui/dom";
import { renderReportForm } from "../ui/report";
import type { LanguageContext } from "../ui/view";
import { PageTranslator } from "./controller";
import { Overlay } from "./overlay";
import { readSelection, type SelectionInfo } from "./selection";

export function boot(win: Window & typeof globalThis = window as any): { translator: PageTranslator; overlay: Overlay } | null {
  if (win.top !== win || (win as any).__dlLoaded) return null;
  (win as any).__dlLoaded = true;
  const doc = win.document;
  const lang = uiLang();
  let settings: Settings = DEFAULT_SETTINGS;
  let hiddenPanel = false;
  let languageCtx: LanguageContext | null = null;
  let targetName = "";
  const send = (req: BgRequest): Promise<BgResponse<any>> => chrome.runtime.sendMessage(req);

  const overlay: Overlay = new Overlay(doc, lang, {
    onRestore: () => translator.deactivate(),
    onHide: () => { hiddenPanel = true; overlay.render(translator.getState(), true); },
    onRetry: () => { translator.activate(translator.getState().target ?? settings.targetLang); },
  });
  overlay.onNeedPanel = () => overlay.renderPanelFor(translator.getState());

  const translator = new PageTranslator({
    doc, send, settings: () => settings, defaultTarget: () => settings.targetLang,
    onState: (s: PageState) => {
      if (s.phase === "inactive") { hiddenPanel = false; selection.stop(); }
      else selection.start();
      overlay.render(s, hiddenPanel || !settings.showBadge);
      send({ type: "dl/tab-state", active: s.phase !== "inactive", target: s.target, phase: s.phase }).catch(() => {});
      chrome.runtime.sendMessage({ type: "dl/state", state: s }).catch(() => {});
    },
  });

  // ---------------------------------------------------------------- « Comprendre » (bulle → carte → signalement)
  const closeCard = () => { overlay.hideCard(); if (!translator.isActive) overlay.destroy(); };
  const relOf = (s: SelectionInfo["status"]): Reliability | null =>
    s === "approved" ? "approved" : s === "automatic" ? "automatic" : s === "pending_validation" ? "pending_validation" : s === "layout" ? "kept" : null;

  async function openExplain(info: Pick<SelectionInfo, "original" | "shown" | "status" | "rect">): Promise<void> {
    overlay.showCard(h(doc, "div", {}, renderLoading(doc, lang)), info.rect);
    const r = await translator.explainText(info.original);
    if (!r.ok) { overlay.showCard(renderMessage(doc, t("c_error", lang)), info.rect); return; }
    const src = r.data.source_lang === "fr" || r.data.source_lang === "en" ? r.data.source_lang : r.sourceLang;
    const model = buildExplainModel(r.data, { term: info.original, shownText: info.shown && info.shown !== info.original ? info.shown : null, targetName: targetName || translator.targetLang, targetLang: translator.targetLang, sourceLang: src, shownStatus: relOf(info.status) });
    const box = h(doc, "div", {});
    const show = () => box.replaceChildren(renderExplain(doc, model, lang, { onReport: openReport, onClose: closeCard }));
    const openReport = () => box.replaceChildren(renderReportForm(doc, lang, async (rep) => {
      const payload: FeedbackPayload = {
        source_lang: src, target_lang: translator.targetLang, source_text: maskText(info.original).masked,
        shown_translation: model.translation.text ? maskText(model.translation.text).masked : null,
        suggested_translation: rep.suggestion ? maskText(rep.suggestion).masked : null, comment: rep.comment, category: rep.category,
        concept_id: model.conceptId, translation_status: model.translation.reliability === "kept" ? "unavailable" : model.translation.reliability,
      };
      const resp = await send({ type: "dl/feedback", payload });
      return resp.ok ? { ok: true } : { ok: false, code: resp.code };
    }, show));
    show();
    overlay.showCard(box, info.rect);
  }

  // ---------------------------------------------------------------- sélection → bulle (uniquement quand la traduction est active)
  let timer: ReturnType<typeof setTimeout> | null = null;
  const evaluate = () => {
    if (overlay.cardOpen) { overlay.hideBubble(); return; }
    if (!translator.isActive) { overlay.hideBubble(); return; }
    const info = readSelection(win, (n) => translator.inspectNode(n));
    if (!info) { overlay.hideBubble(); return; }
    overlay.showBubble(info.rect, () => { openExplain(info); });
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(evaluate, 80); };
  const selection = {
    on: false,
    start() { if (this.on) return; this.on = true; doc.addEventListener("mouseup", schedule, true); doc.addEventListener("keyup", schedule, true); win.addEventListener("scroll", hideOnScroll, true); },
    stop() { if (!this.on) return; this.on = false; doc.removeEventListener("mouseup", schedule, true); doc.removeEventListener("keyup", schedule, true); win.removeEventListener("scroll", hideOnScroll, true); },
  };
  const hideOnScroll = () => overlay.hideBubble();

  // ---------------------------------------------------------------- initialisation
  getSettings().then(async (s) => {
    settings = s;
    const hello = await send({ type: "dl/hello" }).catch(() => null);
    if (hello?.ok && hello.data?.active && hello.data.target) translator.activate(hello.data.target);
  });
  send({ type: "dl/languages" }).then((r) => {
    if (!r.ok) return;
    const l = (r.data as LanguageInfo[]).find((x) => x.code === settings.targetLang);
    if (l) { targetName = l.name; languageCtx = { name: l.name, availability: l.availability, approved: l.approved_targets ?? l.validated_entries ?? 0, isTest: l.availability === "test_only" }; overlay.setLanguage(languageCtx); }
  }).catch(() => {});
  chrome.storage.onChanged.addListener(async (ch) => { if (ch.settings) settings = await getSettings(); });

  chrome.runtime.onMessage.addListener((msg: ContentCommand, _sender, respond) => {
    if (!msg || typeof msg.type !== "string") return false;
    switch (msg.type) {
      case "dl/activate": translator.activate(msg.target).then(() => respond(translator.getState())); return true;
      case "dl/deactivate": translator.deactivate(); respond(translator.getState()); return false;
      case "dl/get-state": respond(translator.getState()); return false;
      case "dl/get-selection": respond({ text: (win.getSelection()?.toString() ?? "").trim().slice(0, 300) }); return false;
      case "dl/translate-selection":
      case "dl/explain-selection": {
        const info = readSelection(win, (n) => translator.inspectNode(n));
        openExplain(info ?? { original: msg.text, shown: null, status: null, rect: { left: 80, top: 80, right: 80, bottom: 80 } });
        return false;
      }
    }
    return false;
  });
  return { translator, overlay };
}

// Démarrage automatique uniquement dans le contexte d'une extension (les tests appellent boot() eux-mêmes).
if (typeof chrome !== "undefined" && (chrome as any).runtime?.id) boot();
