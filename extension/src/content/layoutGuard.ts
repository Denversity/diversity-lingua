/**
 * Garde de mise en page : empêche une traduction de dégrader l'interface visitée.
 *
 * Méthode (lecture → écriture → lecture, en lots pour limiter les recalculs de mise en page) :
 *   1. snapshot() de l'élément ET de 2 ancêtres avant d'appliquer le lot ;
 *   2. application des textes ;
 *   3. snapshot() après ; judge() compare. Un texte fautif est RÉTABLI (repli propre) — jamais de police réduite,
 *      jamais de CSS forcé. Seules les dégradations NOUVELLES sont sanctionnées (un texte déjà tronqué par le site l'était avant).
 * judge() est une fonction pure (testable sans navigateur) ; le comportement réel est vérifié dans Chromium (tests-browser/).
 */
export interface Box {
  w: number; h: number; sw: number; cw: number; sh: number; ch: number;
  ox: string; oy: string; nowrap: boolean; ellipsis: boolean; control: boolean; inline: boolean;
}
export interface Snapshot { chain: Box[] }
export type Verdict = null | { code: "clip_x" | "clip_y" | "control_wrap" | "page_overflow"; level: number };

const CONTROL_TAGS = new Set(["BUTTON", "SELECT", "SUMMARY"]);
const CONTROL_ROLES = new Set(["button", "tab", "menuitem", "option", "switch", "link"]);
const CONTROL_CLASS = /(^|[\s_-])(btn|button|chip|pill|tag|badge|tab)([\s_-]|$)/i;
const SLACK = 1; // px de tolérance (arrondis de sous-pixels)

export class LayoutGuard {
  constructor(private win: Window = window) {}

  /** Élément dont la mise en page peut être affectée par un changement de texte de ce nœud. */
  static elementFor(node: Node): Element | null {
    let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (el && (el.tagName === "OPTION" || el.tagName === "OPTGROUP")) el = el.closest("select") ?? el;
    return el;
  }

  /** Mesure d'un élément (publique : sert aussi à surveiller les victimes collatérales). */
  measure(el: Element): Box { return this.box(el); }

  private box(el: Element): Box {
    let cs: CSSStyleDeclaration | null = null;
    try { cs = this.win.getComputedStyle(el); } catch { /* ignore */ }
    const r = el.getBoundingClientRect();
    const role = el.getAttribute("role") ?? "";
    const inline = (el as HTMLElement).clientWidth === 0 && (el as HTMLElement).clientHeight === 0;
    return {
      w: r.width, h: r.height, sw: (el as HTMLElement).scrollWidth ?? 0, cw: (el as HTMLElement).clientWidth ?? 0,
      sh: (el as HTMLElement).scrollHeight ?? 0, ch: (el as HTMLElement).clientHeight ?? 0,
      ox: cs?.overflowX ?? "visible", oy: cs?.overflowY ?? "visible",
      nowrap: /nowrap|pre\b/.test(cs?.whiteSpace ?? ""), ellipsis: cs?.textOverflow === "ellipsis",
      control: CONTROL_TAGS.has(el.tagName) || CONTROL_ROLES.has(role) || CONTROL_CLASS.test(el.getAttribute("class") ?? ""),
      inline,
    };
  }

  snapshot(el: Element): Snapshot {
    const chain: Box[] = [];
    for (let e: Element | null = el, i = 0; e && i < 3; e = e.parentElement, i++) chain.push(this.box(e));
    return { chain };
  }

  /** Conteneur dont les pistes (colonnes/lignes) sont partagées : table, flex, grille. Un texte qui grandit y réduit la place des voisins. */
  containerOf(el: Element): Element | null {
    for (let e = el.parentElement, i = 0; e && i < 8; e = e.parentElement, i++) {
      let d = "";
      try { d = this.win.getComputedStyle(e).display; } catch { return null; }
      if (/^(table|inline-table|flex|inline-flex|grid|inline-grid)$/.test(d)) return e;
    }
    return null;
  }

  /** Éléments susceptibles de TRONQUER leur contenu (overflow ≠ visible + nowrap/ellipsis) dans un conteneur. */
  collectClippable(container: Element, limit = 400): Element[] {
    const out: Element[] = [];
    const all = container.querySelectorAll("*");
    for (let i = 0; i < all.length && i < limit * 4 && out.length < limit; i++) {
      const e = all[i];
      let cs: CSSStyleDeclaration;
      try { cs = this.win.getComputedStyle(e); } catch { continue; }
      if ((cs.overflowX !== "visible" || cs.overflowY !== "visible") && (/nowrap/.test(cs.whiteSpace) || cs.textOverflow === "ellipsis")) out.push(e);
    }
    return out;
  }

  /**
   * Troncature NOUVELLE ou AGGRAVÉE sur l'axe horizontal : le contenu dépasse davantage qu'avant, dans un élément qui coupe (overflow caché,
   * ellipsis) ou qui déborde sur ses voisins (nowrap). Les zones défilantes (auto/scroll) ne perdent rien : elles sont ignorées.
   */
  static worsenedX(b: Box, a: Box): boolean {
    const clips = a.ox === "hidden" || a.ox === "clip" || a.ellipsis || (a.ox === "visible" && a.nowrap);
    return !a.inline && clips && a.sw - a.cw > Math.max(0, b.sw - b.cw) + SLACK;
  }
  /** Idem sur l'axe vertical (hauteur fixe + overflow caché : le texte est coupé). */
  static worsenedY(b: Box, a: Box): boolean {
    return !a.inline && (a.oy === "hidden" || a.oy === "clip") && a.sh - a.ch > Math.max(0, b.sh - b.ch) + SLACK;
  }
  isNewClip(b: Box, a: Box): boolean { return LayoutGuard.worsenedX(b, a); }

  pageOverflowsX(): boolean {
    const d = this.win.document.documentElement;
    return d.scrollWidth > d.clientWidth + SLACK;
  }

  /** Comparaison avant/après — fonction pure. */
  judge(before: Snapshot, after: Snapshot): Verdict {
    for (let i = 0; i < Math.min(before.chain.length, after.chain.length); i++) {
      const b = before.chain[i], a = after.chain[i];
      if (a.inline) continue; // boîte en ligne : pas de métriques de défilement exploitables
      if (LayoutGuard.worsenedX(b, a)) return { code: "clip_x", level: i };
      if (LayoutGuard.worsenedY(b, a)) return { code: "clip_y", level: i };
      if (a.control && a.h - b.h > Math.max(6, 0.3 * b.h)) return { code: "control_wrap", level: i };
    }
    return null;
  }
}
