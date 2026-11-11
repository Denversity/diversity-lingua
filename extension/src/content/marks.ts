/**
 * Repères visuels de fiabilité via le CSS Custom Highlight API (Chrome ≥ 105).
 * Garanties : aucun attribut ni style ajouté aux éléments du site, aucune mutation de nœud, aucun effet sur la mise en page.
 * La seule règle de style installée est de la forme `::highlight(dl-…)` : elle ne peut cibler AUCUN élément.
 */
export type MarkMode = "unvalidated" | "all" | "none";
export type MarkKind = "verified" | "auto";
const NAMES: Record<MarkKind, string> = { verified: "dl-verified", auto: "dl-auto" };
export const MARK_RULES = `
::highlight(dl-auto) { text-decoration: underline dotted rgba(201, 138, 18, .85); text-decoration-thickness: 1px; }
::highlight(dl-verified) { text-decoration: underline dotted rgba(47, 154, 99, .8); text-decoration-thickness: 1px; }
`;
const STYLE_ID = "dl-highlight-style";

export class HighlightMarks {
  private ranges = new Map<Node, { range: Range; kind: MarkKind }>();
  private sheet: CSSStyleSheet | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private highlights = new Map<MarkKind, any>();

  constructor(private doc: Document, private mode: () => MarkMode) {}

  get supported(): boolean {
    const w = this.doc.defaultView as any;
    return !!w && typeof w.Highlight === "function" && !!w.CSS?.highlights;
  }

  private install(): void {
    if (this.sheet || this.styleEl) return;
    const w = this.doc.defaultView as any;
    try {
      const sheet = new w.CSSStyleSheet() as CSSStyleSheet;
      sheet.replaceSync(MARK_RULES);
      (this.doc as any).adoptedStyleSheets = [...((this.doc as any).adoptedStyleSheets ?? []), sheet];
      this.sheet = sheet;
    } catch {
      const s = this.doc.createElement("style");
      s.id = STYLE_ID; s.textContent = MARK_RULES;
      (this.doc.head ?? this.doc.documentElement).appendChild(s);
      this.styleEl = s;
    }
  }

  mark(node: Text, kind: MarkKind): void {
    const m = this.mode();
    if (!this.supported || m === "none" || (kind === "verified" && m !== "all")) return;
    this.install();
    const w = this.doc.defaultView as any;
    this.unmark(node);
    const range = this.doc.createRange();
    range.selectNodeContents(node);
    let hl = this.highlights.get(kind);
    if (!hl) { hl = new w.Highlight(); this.highlights.set(kind, hl); w.CSS.highlights.set(NAMES[kind], hl); }
    hl.add(range);
    this.ranges.set(node, { range, kind });
  }

  unmark(node: Node): void {
    const r = this.ranges.get(node);
    if (!r) return;
    this.highlights.get(r.kind)?.delete(r.range);
    this.ranges.delete(node);
  }

  clear(): void {
    const w = this.doc.defaultView as any;
    for (const [kind] of this.highlights) w.CSS?.highlights?.delete(NAMES[kind]);
    this.highlights.clear(); this.ranges.clear();
    if (this.sheet) (this.doc as any).adoptedStyleSheets = ((this.doc as any).adoptedStyleSheets as CSSStyleSheet[]).filter((s) => s !== this.sheet);
    this.styleEl?.remove();
    this.sheet = null; this.styleEl = null;
  }
}
