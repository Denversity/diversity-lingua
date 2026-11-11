/** Jauge de couverture + raisons (DOM sans innerHTML). Partagée entre le popup et le panneau injecté. */
import { t, type Lang } from "../shared/i18n";
import { h } from "./dom";
import { icon } from "./icons";
import type { View } from "./view";

let uid = 0;

export function renderCoverage(doc: Document, view: View, lang: Lang): HTMLElement | null {
  const c = view.coverage;
  if (!c || c.total === 0) return null;
  const id = `dl-cov-${++uid}`;
  const pct = (n: number) => (n === 0 ? 0 : Math.max(3, Math.round((n / c.total) * 100)));
  const seg = (cls: string, n: number) => h(doc, "span", { class: cls, style: `flex-basis:${pct(n)}%;flex-grow:${n === 0 ? 0 : 1}` });
  const summary = `${c.verified} ${t("cov_verified", lang)}, ${c.unverified} ${t("cov_unverified", lang)}, ${c.kept} ${t("cov_kept", lang)}`;
  const note = h(doc, "p", { class: "dl-muted dl-covnote", id }, t("cov_note", lang));
  note.hidden = true;
  const help = h(doc, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-expanded": "false", "aria-controls": id, "aria-label": t("cov_help", lang) }, icon(doc, "info"));
  help.addEventListener("click", () => { const open = note.hidden; note.hidden = !open; help.setAttribute("aria-expanded", String(open)); });
  const row = (cls: string, label: string, n: number) =>
    h(doc, "li", {}, h(doc, "span", { class: `dot ${cls}` }), h(doc, "span", {}, label), h(doc, "b", {}, String(n)));
  return h(doc, "section", { class: "dl-coverage", "aria-label": t("cov_title", lang) },
    h(doc, "div", { class: "dl-covhead" }, h(doc, "h3", {}, `${t("cov_title", lang)} · ${c.total} ${t("cov_texts", lang)}`), help),
    h(doc, "div", { class: "dl-meter", role: "img", "aria-label": summary }, seg("is-verified", c.verified), seg("is-auto", c.unverified), seg("is-kept", c.kept)),
    h(doc, "ul", { class: "dl-legend" },
      row("is-verified", t("cov_verified", lang), c.verified), row("is-auto", t("cov_unverified", lang), c.unverified), row("is-kept", t("cov_kept", lang), c.kept)),
    note);
}

export function renderReasons(doc: Document, view: View, lang: Lang): HTMLElement | null {
  if (!view.reasons.length) return null;
  return h(doc, "section", { class: "dl-reasons", "aria-label": t("reasons_title", lang) },
    h(doc, "h3", {}, t("reasons_title", lang)),
    h(doc, "ul", {}, ...view.reasons.map((r) => h(doc, "li", {}, h(doc, "span", {}, r.label), h(doc, "b", {}, String(r.count))))));
}
