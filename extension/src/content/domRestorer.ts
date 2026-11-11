/**
 * DOM Restorer : conserve les originaux et les restaure à l'identique.
 * - seul nodeValue / un attribut précis est modifié (jamais de HTML, jamais d'attribut ajouté au site) ;
 * - si le site a modifié lui-même un nœud depuis notre traduction, son contenu est respecté (pas d'écrasement).
 */
interface Rec { original: string; applied: string }

export class Restorer {
  private texts = new Map<Text, Rec>();
  private attrs = new Map<Element, Map<string, Rec>>();

  applyText(node: Text, original: string, applied: string): void {
    const prev = this.texts.get(node);
    node.nodeValue = applied;
    this.texts.set(node, { original: prev?.original ?? original, applied });
  }
  applyAttr(el: Element, attr: string, original: string, applied: string): void {
    const m = this.attrs.get(el) ?? new Map<string, Rec>();
    const prev = m.get(attr);
    el.setAttribute(attr, applied);
    m.set(attr, { original: prev?.original ?? original, applied });
    this.attrs.set(el, m);
  }
  /** Rétablit un nœud (repli de mise en page) et oublie sa trace. */
  revertText(node: Text): void {
    const r = this.texts.get(node);
    if (r && node.nodeValue === r.applied) node.nodeValue = r.original;
    this.texts.delete(node);
  }
  revertAttr(el: Element, attr: string): void {
    const r = this.attrs.get(el)?.get(attr);
    if (r && el.getAttribute(attr) === r.applied) el.setAttribute(attr, r.original);
    this.attrs.get(el)?.delete(attr);
  }

  /** Vrai si le nœud porte actuellement NOTRE traduction (permet d'ignorer nos propres mutations). */
  isApplied(node: Node, attr?: string): boolean {
    if (attr) return this.attrs.get(node as Element)?.get(attr)?.applied === (node as Element).getAttribute(attr);
    const r = this.texts.get(node as Text);
    return !!r && r.applied === node.nodeValue;
  }
  hasRecord(node: Node, attr?: string): boolean {
    return attr ? !!this.attrs.get(node as Element)?.has(attr) : this.texts.has(node as Text);
  }
  originalOf(node: Node): string | undefined { return this.texts.get(node as Text)?.original; }
  forget(node: Node, attr?: string): void {
    if (attr) this.attrs.get(node as Element)?.delete(attr);
    else this.texts.delete(node as Text);
  }
  get size(): number {
    let n = this.texts.size;
    for (const m of this.attrs.values()) n += m.size;
    return n;
  }
  prune(): void {
    for (const n of this.texts.keys()) if (!n.isConnected) this.texts.delete(n);
    for (const e of this.attrs.keys()) if (!e.isConnected) this.attrs.delete(e);
  }

  restoreAll(): { restored: number; respectedSiteChanges: number } {
    let restored = 0, respected = 0;
    for (const [node, r] of this.texts) {
      if (node.nodeValue === r.applied) { node.nodeValue = r.original; restored++; } else respected++;
    }
    for (const [el, m] of this.attrs) {
      for (const [a, r] of m) {
        if (el.getAttribute(a) === r.applied) { el.setAttribute(a, r.original); restored++; } else respected++;
      }
    }
    this.texts.clear(); this.attrs.clear();
    return { restored, respectedSiteChanges: respected };
  }
}
