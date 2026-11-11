/** Formulaire de signalement linguistique (2 clics) : aucune proposition n'est appliquée automatiquement — elle part en file de revue. */
import { t, type Lang } from "../shared/i18n";
import { h } from "./dom";
import { icon } from "./icons";

export type Category = "meaning" | "naturalness" | "terminology" | "other";
export interface ReportInput { category: Category; suggestion: string | null; comment: string | null }
export type SendResult = { ok: true } | { ok: false; code: string };

let uid = 0;
export function renderReportForm(doc: Document, lang: Lang, send: (r: ReportInput) => Promise<SendResult>, onDone: () => void): HTMLElement {
  const id = `dl-rep-${++uid}`;
  const cats: [Category, "f_meaning" | "f_naturalness" | "f_terminology" | "f_other"][] = [["meaning", "f_meaning"], ["naturalness", "f_naturalness"], ["terminology", "f_terminology"], ["other", "f_other"]];
  const msg = h(doc, "p", { class: "dl-reperr", role: "alert" }); msg.hidden = true;
  const radios = cats.map(([v, k], i) => {
    const input = h(doc, "input", { type: "radio", name: id, value: v, id: `${id}-${v}` });
    return h(doc, "label", { class: "dl-radio", for: `${id}-${v}` }, input, h(doc, "span", {}, t(k, lang)));
  });
  const suggest = h(doc, "input", { class: "dl-field", type: "text", id: `${id}-s`, maxlength: "300", autocomplete: "off" });
  const comment = h(doc, "textarea", { class: "dl-field", id: `${id}-c`, maxlength: "500", rows: "2" });
  const submit = h(doc, "button", { class: "dl-btn dl-btn--primary dl-btn--sm", type: "button" }, icon(doc, "send"), t("f_send", lang));
  const cancel = h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button" }, t("f_cancel", lang));
  const form = h(doc, "div", { class: "dl-report", role: "group", "aria-labelledby": `${id}-t` },
    h(doc, "h3", { id: `${id}-t` }, t("f_title", lang)),
    h(doc, "fieldset", { class: "dl-fieldset" }, h(doc, "legend", {}, t("f_what", lang)), ...radios),
    h(doc, "label", { for: `${id}-s`, class: "dl-lbl" }, t("f_suggest", lang)), suggest,
    h(doc, "label", { for: `${id}-c`, class: "dl-lbl" }, t("f_comment", lang)), comment,
    h(doc, "p", { class: "dl-muted dl-xnote" }, t("f_privacy", lang)),
    msg, h(doc, "div", { class: "dl-xfoot" }, submit, cancel));

  const showErr = (text: string) => { msg.textContent = text; msg.hidden = false; };
  cancel.addEventListener("click", onDone);
  submit.addEventListener("click", async () => {
    const picked = (form.querySelector(`input[name="${id}"]:checked`) as HTMLInputElement | null)?.value as Category | undefined;
    if (!picked) return showErr(t("f_pick", lang));
    msg.hidden = true; submit.setAttribute("disabled", "");
    const r = await send({ category: picked, suggestion: suggest.value.trim() || null, comment: comment.value.trim() || null });
    if (r.ok) {
      form.replaceChildren(h(doc, "div", { role: "status", class: "dl-thanks" }, icon(doc, "check"),
        h(doc, "div", {}, h(doc, "b", {}, t("f_thanks_t", lang)), h(doc, "p", {}, t("f_thanks", lang))),
      ), h(doc, "div", { class: "dl-xfoot" }, (() => { const b = h(doc, "button", { class: "dl-btn dl-btn--secondary dl-btn--sm", type: "button" }, t("close", lang)); b.addEventListener("click", onDone); return b; })()));
    } else { submit.removeAttribute("disabled"); showErr(r.code === "rate_limited" ? t("f_limit", lang) : t("f_error", lang)); }
  });
  return form;
}
