/**
 * « Je veux comprendre » : modèle (pur) + rendu DOM partagés par le popup et la carte injectée.
 * Règles : traduction affichée seulement si elle existe (jamais inventée) ; explication toujours identifiée comme
 * rédigée par l'équipe et « en cours de relecture » tant que `reviewed` est faux ; fiabilité toujours indiquée.
 */
import { t, type Key, type Lang } from "../shared/i18n";
import { canonicalStatus, hasDisplayableText, type Canonical } from "../shared/status";
import type { ExplainResponse } from "../shared/types";
import { h } from "./dom";
import { icon } from "./icons";

export type Reliability = "approved" | "automatic" | "pending_validation" | "unavailable" | "rejected" | "kept";
export interface ExplainModel {
  term: string;                 // terme (ou texte d'origine d'un texte déjà traduit)
  shownText?: string | null;    // texte actuellement affiché dans la page (si différent de l'original)
  targetName: string;
  targetLang?: string;
  sourceLang: "fr" | "en";
  translation: { text: string | null; reliability: Reliability };
  explanation: { text: string; reviewed: boolean } | null;
  translatedExplanation: { text: string; reliability: Reliability } | null;
  example: string | null;
  testData: boolean;
  reportable: boolean;
  conceptId: string | null;
  keptForLayout: boolean;       // texte laissé dans la langue d'origine pour ne pas déformer la page
}

export function buildExplainModel(resp: ExplainResponse, o: { term: string; shownText?: string | null; targetName: string; targetLang?: string; sourceLang: "fr" | "en"; shownStatus?: Reliability | null }): ExplainModel {
  const tt = resp.term_translation;
  const c: Canonical = tt ? canonicalStatus(tt as any) : "unavailable";
  const hasText = !!tt && !!tt.translation && hasDisplayableText(c);
  const explanationStatus = resp.translation ? canonicalStatus(resp.translation) : "unavailable";
  const translatedExplanation = resp.translation?.translation && hasDisplayableText(explanationStatus)
    ? { text: resp.translation.translation, reliability: explanationStatus as Reliability }
    : null;
  // Un texte déjà affiché dans la page garde le statut de CE texte (le terme peut avoir un statut différent).
  const kept = o.shownStatus === "kept";
  const own: Reliability = hasText ? (c as Reliability) : c === "rejected" ? "rejected" : "unavailable";
  const reliability: Reliability = kept ? own : o.shownStatus ?? own;
  const text = kept ? (hasText ? tt!.translation : null) : o.shownText ?? (hasText ? tt!.translation : null);
  return {
    term: o.term, shownText: o.shownText ?? null, targetName: o.targetName, sourceLang: o.sourceLang,
    targetLang: o.targetLang,
    translation: { text: text ?? null, reliability: text ? reliability : (reliability === "rejected" ? "rejected" : "unavailable") },
    explanation: resp.found && resp.explanation_source ? { text: resp.explanation_source, reviewed: !!resp.explanation_source_reviewed } : null,
    translatedExplanation,
    example: resp.found ? resp.example_source ?? null : null,
    testData: !!(tt as any)?.test_data,
    reportable: true,
    conceptId: resp.concept_id ?? null,
    keptForLayout: kept,
  };
}

const REL: Record<Reliability, { badge: string; icon: "shield" | "spark" | "info" | "alert" | "keep"; title: Key; text: Key }> = {
  approved: { badge: "verified", icon: "shield", title: "q_approved_t", text: "q_approved" },
  automatic: { badge: "auto", icon: "spark", title: "q_automatic_t", text: "q_automatic" },
  pending_validation: { badge: "auto", icon: "info", title: "q_pending_t", text: "q_pending" },
  unavailable: { badge: "unavail", icon: "info", title: "q_unavailable_t", text: "q_unavailable" },
  rejected: { badge: "unavail", icon: "alert", title: "q_rejected_t", text: "q_rejected" },
  kept: { badge: "kept", icon: "keep", title: "q_kept_t", text: "q_kept" },
};
export const reliabilityBadge = (doc: Document, r: Reliability, lang: Lang) =>
  h(doc, "span", { class: `dl-badge dl-badge--${REL[r].badge}` }, icon(doc, REL[r].icon), t(REL[r].title, lang));

export interface ExplainHandlers { onReport?: () => void; onClose?: () => void }

export function renderExplain(doc: Document, m: ExplainModel, lang: Lang, hd: ExplainHandlers = {}): HTMLElement {
  const sec = (label: string, ...kids: (Node | string | null | undefined)[]) => h(doc, "section", { class: "dl-xsec" }, h(doc, "h3", {}, label), ...kids);
  const srcName = t(m.sourceLang === "fr" ? "srcfr" : "srcen", lang);
  const rel = REL[m.translation.reliability];
  const kids: (Node | null)[] = [];

  const head = h(doc, "div", { class: "dl-xhead" }, h(doc, "h2", {}, t("understand", lang)));
  if (m.testData) head.append(h(doc, "span", { class: "dl-badge dl-badge--test" }, t("badgeTest", lang)));
  if (hd.onClose) { const b = h(doc, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-label": t("close", lang) }, icon(doc, "close")); b.addEventListener("click", hd.onClose); head.append(b); }
  kids.push(head);

  const long = m.term.length > 70; // phrase entière sélectionnée : taille normale, pour garder l'explication visible
  kids.push(sec(t("c_term", lang), h(doc, "p", { class: `dl-xterm${long ? " dl-xlong" : ""}`, lang: m.sourceLang }, m.term)));
  const tr = m.translation;
  const translationItems: (Node | string | null | undefined)[] = [
    tr.text ? h(doc, "p", { class: `dl-xtrans${long ? " dl-xlong" : ""}` }, tr.text)
      : null,
    h(doc, "p", { class: "dl-xrel" }, reliabilityBadge(doc, m.keptForLayout ? "kept" : tr.reliability, lang),
      h(doc, "span", {}, t(m.keptForLayout ? "q_kept" : rel.text, lang))),
  ];
  kids.push(sec(`${t("c_in", lang)} ${m.targetName}`, ...translationItems));

  if (m.explanation || m.translatedExplanation) {
    const sourceButton = m.explanation
      ? h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button", "aria-pressed": "false" }, srcName)
      : null;
    const targetButton = m.translatedExplanation
      ? h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button", "aria-pressed": "false" }, m.targetName)
      : null;
    const choices = h(doc, "div", { class: "dl-xlang", role: "group", "aria-label": t("c_expl_language", lang) },
      ...(sourceButton ? [sourceButton] : []), ...(targetButton ? [targetButton] : []));
    const paragraph = h(doc, "p", { class: "dl-xdefinition" });
    const note = h(doc, "p", { class: "dl-muted dl-xnote" });
    const showExplanation = (target: boolean) => {
      const translated = target && m.translatedExplanation;
      const source = translated ? null : m.explanation;
      paragraph.textContent = translated ? translated.text : source?.text ?? "";
      paragraph.setAttribute("lang", translated ? (m.targetLang ?? "ff") : m.sourceLang);
      sourceButton?.setAttribute("aria-pressed", String(!!source));
      targetButton?.setAttribute("aria-pressed", String(!!translated));
      note.replaceChildren();
      if (translated) {
        note.append(reliabilityBadge(doc, translated.reliability, lang), h(doc, "span", {}, t(REL[translated.reliability].text, lang)));
      } else if (source) {
        note.textContent = source.reviewed ? t("c_expl_note_reviewed", lang) : t("c_expl_note", lang);
      }
    };
    sourceButton?.addEventListener("click", () => showExplanation(false));
    targetButton?.addEventListener("click", () => showExplanation(true));
    showExplanation(!!m.translatedExplanation);
    kids.push(sec(t("c_simple", lang), choices, paragraph, note));
    if (m.example) kids.push(sec(`${t("c_example", lang)} ${t("c_src_in", lang).replace("{lang}", srcName)}`, h(doc, "p", { class: "dl-xexample", lang: m.sourceLang }, m.example)));
  } else {
    kids.push(sec(t("c_simple", lang), h(doc, "p", {}, t("c_noexpl", lang)), h(doc, "p", { class: "dl-muted dl-xnote" }, t("c_noexpl_hint", lang))));
  }
  const foot = h(doc, "div", { class: "dl-xfoot" });
  if (hd.onReport && m.reportable) {
    const b = h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button" }, icon(doc, "flag"), t("f_open", lang));
    b.addEventListener("click", hd.onReport); foot.append(b);
  }
  kids.push(foot);
  return h(doc, "div", { class: "dl-explain" }, ...kids);
}

export function renderLoading(doc: Document, lang: Lang): HTMLElement {
  return h(doc, "div", { class: "dl-explain", role: "status" }, h(doc, "p", { class: "dl-muted" }, t("c_loading", lang)));
}
export function renderMessage(doc: Document, text: string): HTMLElement {
  return h(doc, "div", { class: "dl-explain", role: "alert" }, h(doc, "p", {}, text));
}
