/**
 * Interface injectée par Diversity Lingua : puce discrète → panneau de couverture, bulle « Comprendre », carte d'explication.
 * Shadow DOM fermé, texte via textContent uniquement, aucun style ni attribut ajouté aux éléments du site.
 * Monté à l'activation, DÉMONTÉ à la désactivation (aucune trace résiduelle).
 */
import { t, type Lang } from "../shared/i18n";
import type { PageState } from "../shared/types";
import componentsCss from "../ui/components.css";
import { renderCoverage, renderReasons } from "../ui/coverage";
import { h } from "../ui/dom";
import { icon, markSvg } from "../ui/icons";
import overlayCss from "../ui/overlay.css";
import tokensCss from "../ui/tokens.css";
import { deriveView, type LanguageContext, type View } from "../ui/view";
import { HOST_ID } from "./domExtractor";

export interface OverlayHandlers { onRestore: () => void; onHide: () => void; onRetry: () => void }

export class Overlay {
  private host: HTMLElement | null = null;
  private layer!: HTMLElement; private launcher!: HTMLButtonElement; private lbl!: HTMLElement; private dot!: HTMLElement;
  private panel!: HTMLElement; private card!: HTMLElement; private bubble!: HTMLButtonElement;
  private panelOpen = false;
  private lastKey = "";
  private cleanup: Array<() => void> = [];
  private language: LanguageContext | null = null;
  private dragCleanup: (() => void) | null = null;

  constructor(private doc: Document, private lang: Lang, private hd: OverlayHandlers) {}

  get mounted(): boolean { return !!this.host?.isConnected; }
  get cardOpen(): boolean { return this.mounted && !this.card.hidden; }
  setLanguage(l: LanguageContext | null): void { this.language = l; }

  private mount(): void {
    if (this.mounted) return;
    const d = this.doc;
    this.host = h(d, "div", { id: HOST_ID, "data-dl-ignore": true });
    const root = this.host.attachShadow({ mode: (this.doc.defaultView as any)?.__DL_TEST_OPEN ? "open" : "closed" }); // « open » uniquement pour les tests navigateur
    const style = h(d, "style", {}); style.textContent = `${tokensCss}\n${componentsCss}\n${overlayCss}`;
    this.dot = h(d, "span", { class: "dot" }); this.lbl = h(d, "span", { class: "lbl" });
    this.launcher = h(d, "button", { class: "launcher", type: "button", "aria-expanded": "false", "aria-label": t("p_open", this.lang) }, markSvg(d, 22), this.dot, this.lbl) as HTMLButtonElement;
    this.panel = h(d, "section", { class: "panel dl-root", role: "region", "aria-label": t("appName", this.lang) }); this.panel.hidden = true;
    this.card = h(d, "div", { class: "card dl-root", role: "dialog", "aria-label": t("understand", this.lang), tabindex: "-1" }); this.card.hidden = true;
    this.bubble = h(d, "button", { class: "bubble", type: "button", "aria-label": t("bubbleHint", this.lang) }, icon(d, "book"), t("bubble", this.lang)) as HTMLButtonElement; this.bubble.hidden = true;
    this.layer = h(d, "div", { class: "layer dl-root" }, this.panel, this.card, this.bubble, this.launcher);
    root.append(style, this.layer);
    this.launcher.addEventListener("click", () => this.togglePanel());
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { if (!this.card.hidden) this.hideCard(); else if (this.panelOpen) this.togglePanel(false); } };
    const away = (e: Event) => {
      if (!e.composedPath().includes(this.host!)) {
        if (this.panelOpen) this.togglePanel(false);
        this.hideCard(); this.hideBubble();
      }
    };
    const dragStart = (e: PointerEvent) => this.startDrag(e);
    this.doc.addEventListener("keydown", esc, true); this.doc.addEventListener("pointerdown", away, true);
    this.layer.addEventListener("pointerdown", dragStart);
    this.cleanup.push(() => this.doc.removeEventListener("keydown", esc, true), () => this.doc.removeEventListener("pointerdown", away, true),
      () => this.layer.removeEventListener("pointerdown", dragStart));
    this.doc.documentElement.appendChild(this.host);
  }

  private startDrag(e: PointerEvent): void {
    if (e.button !== 0 || !this.layer) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    const handle = target.closest(".phead, .dl-xhead");
    const element = target.closest(".panel, .card") as HTMLElement | null;
    if (!handle || !element || element.hidden) return;
    this.dragCleanup?.();
    e.preventDefault();
    const rect = element.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY, left = rect.left, top = rect.top;
    element.style.left = `${left}px`; element.style.top = `${top}px`;
    element.style.right = "auto"; element.style.bottom = "auto";
    handle.classList.add("is-dragging");
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      const maxLeft = Math.max(0, this.doc.documentElement.clientWidth - element.offsetWidth);
      const maxTop = Math.max(0, this.doc.documentElement.clientHeight - element.offsetHeight);
      element.style.left = `${Math.max(0, Math.min(maxLeft, left + event.clientX - startX))}px`;
      element.style.top = `${Math.max(0, Math.min(maxTop, top + event.clientY - startY))}px`;
      event.preventDefault();
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      this.dragCleanup?.();
    };
    this.dragCleanup = () => {
      this.doc.removeEventListener("pointermove", move, true);
      this.doc.removeEventListener("pointerup", finish, true);
      this.doc.removeEventListener("pointercancel", finish, true);
      handle.classList.remove("is-dragging");
      this.dragCleanup = null;
    };
    this.doc.addEventListener("pointermove", move, true);
    this.doc.addEventListener("pointerup", finish, true);
    this.doc.addEventListener("pointercancel", finish, true);
  }

  destroy(): void {
    this.dragCleanup?.();
    for (const c of this.cleanup) c();
    this.cleanup = [];
    this.host?.remove(); this.host = null; this.panelOpen = false; this.lastKey = "";
  }

  // ---------------------------------------------------------------- puce + panneau
  render(state: PageState, hidden: boolean): void {
    if (state.phase === "inactive" || hidden) { if (this.mounted && state.phase === "inactive") this.destroy(); else if (this.mounted) this.launcher.hidden = true; return; }
    this.mount();
    this.launcher.hidden = false;
    const v = deriveView({ state, reachable: true, lang: this.lang, language: this.language });
    const c = v.coverage;
    const short = v.kind === "translating" ? `${v.title}${v.progress != null ? ` · ${Math.round(v.progress * 100)} %` : ""}`
      : (v.kind === "done" || v.kind === "partial") && c ? `${c.verified + c.unverified} ${t("p_translated", this.lang)}` : v.title;
    this.lbl.textContent = short;
    this.dot.className = `dot ${v.tone === "verified" ? "is-verified" : v.tone === "auto" ? "is-auto" : v.tone === "error" ? "is-error" : v.tone === "progress" ? "is-progress" : ""}`;
    const key = JSON.stringify([v, this.panelOpen]);
    if (key !== this.lastKey) { this.lastKey = key; if (this.panelOpen) this.renderPanel(v); }
  }

  private togglePanel(force?: boolean): void {
    this.panelOpen = force ?? !this.panelOpen;
    this.panel.hidden = !this.panelOpen;
    this.launcher.setAttribute("aria-expanded", String(this.panelOpen));
    if (this.panelOpen) { this.lastKey = ""; this.hideCard(); this.hideBubble(); this.onNeedPanel?.(); }
  }
  onNeedPanel: (() => void) | null = null;

  renderPanelFor(state: PageState): void { this.renderPanel(deriveView({ state, reachable: true, lang: this.lang, language: this.language })); }

  private renderPanel(v: View): void {
    const d = this.doc, L = this.lang;
    const close = h(d, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-label": t("close", L) }, icon(d, "close")); close.addEventListener("click", () => this.togglePanel(false));
    const kids: Node[] = [
      h(d, "div", { class: "phead", title: t("p_drag", L) }, markSvg(d, 24), h(d, "strong", {}, t("appName", L)), close),
      h(d, "div", {}, h(d, "h2", {}, v.title), h(d, "p", { class: "msg" }, v.message)),
    ];
    if (v.kind === "translating") { const pct = v.progress == null ? 0 : Math.round(v.progress * 100); kids.push(h(d, "div", { class: "dl-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, h(d, "span", { style: `width:${pct}%` }))); }
    const cov = renderCoverage(d, v, L); if (cov) kids.push(cov);
    const reasons = renderReasons(d, v, L); if (reasons) kids.push(h(d, "div", {}, reasons));
    for (const n of v.notices) kids.push(h(d, "div", { class: `dl-notice dl-notice--${n.tone}`, role: "note" }, icon(d, n.tone === "test" ? "alert" : n.tone === "layout" ? "keep" : "info"), h(d, "div", {}, n.title ? h(d, "b", {}, n.title) : null, n.text)));
    const row = h(d, "div", { class: "row" });
    if (v.primary.id === "restore") { const b = h(d, "button", { class: "dl-btn dl-btn--secondary", type: "button" }, icon(d, "undo"), v.primary.label); b.addEventListener("click", this.hd.onRestore); row.append(b); }
    if (v.primary.id === "retry") { const b = h(d, "button", { class: "dl-btn dl-btn--primary", type: "button" }, v.primary.label); b.addEventListener("click", this.hd.onRetry); row.append(b); const r = h(d, "button", { class: "dl-btn dl-btn--ghost", type: "button" }, t("restore", L)); r.addEventListener("click", this.hd.onRestore); row.append(r); }
    const hide = h(d, "button", { class: "dl-btn dl-btn--ghost", type: "button" }, t("hide", L)); hide.addEventListener("click", () => { this.togglePanel(false); this.hd.onHide(); }); row.append(hide);
    kids.push(row);
    this.panel.replaceChildren(...kids);
  }

  // ---------------------------------------------------------------- bulle « Comprendre » + carte
  showBubble(rect: { left: number; top: number; right: number; bottom: number }, onClick: () => void): void {
    this.mount();
    if (this.cardOpen) { this.hideBubble(); return; }
    const vw = this.doc.documentElement.clientWidth || 1024, vh = this.doc.documentElement.clientHeight || 768;
    const w = 124, hgt = 36;
    const left = Math.min(Math.max(8, rect.right - w / 2), vw - w - 8);
    const above = rect.top - hgt - 8 > 8;
    this.bubble.style.left = `${left}px`; this.bubble.style.top = `${above ? rect.top - hgt - 8 : Math.min(rect.bottom + 8, vh - hgt - 8)}px`;
    this.bubble.onclick = () => { this.hideBubble(); onClick(); };
    this.bubble.hidden = false;
  }
  hideBubble(): void { if (this.bubble) { this.bubble.hidden = true; this.bubble.onclick = null; } }

  showCard(content: HTMLElement, near?: { left: number; top: number; right: number; bottom: number }): void {
    this.mount();
    this.hideBubble();
    this.card.replaceChildren(content);
    const vw = this.doc.documentElement.clientWidth || 1024, vh = this.doc.documentElement.clientHeight || 768;
    const w = Math.min(340, Math.max(0, vw - 24));
    const margin = 12;
    const maxLeft = Math.max(margin, vw - w - margin);
    this.card.style.maxHeight = `${Math.max(0, vh - margin * 2)}px`;
    this.card.style.left = `${near ? Math.max(margin, Math.min(maxLeft, near.left)) : Math.max(margin, vw - w - 16)}px`;
    this.card.hidden = false;
    const measuredHeight = this.card.getBoundingClientRect().height || this.card.offsetHeight;
    const height = Math.min(measuredHeight || Math.min(vh * 0.72, 600), Math.max(0, vh - margin * 2));
    const maxTop = Math.max(margin, vh - height - margin);
    let top = near ? near.bottom + 10 : 80;
    if (near && top > maxTop) top = near.top - height - 10;
    this.card.style.top = `${Math.max(margin, Math.min(maxTop, top))}px`;
    this.card.focus({ preventScroll: true });
  }
  hideCard(): void { if (this.card) this.card.hidden = true; }
}
