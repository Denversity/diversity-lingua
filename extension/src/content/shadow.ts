/** Accès aux racines Shadow DOM. Dans un content script, `chrome.dom.openOrClosedShadowRoot` donne aussi accès aux racines FERMÉES. */
export function shadowRootOf(el: Element): ShadowRoot | null {
  try {
    const dom = (globalThis as any).chrome?.dom;
    return (dom?.openOrClosedShadowRoot?.(el) as ShadowRoot | null) ?? el.shadowRoot ?? null;
  } catch { return el.shadowRoot ?? null; }
}

/** Parent « logique » : traverse la frontière d'un Shadow DOM (racine → hôte). */
export function parentOf(node: Node): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode?.();
  return root && (root as ShadowRoot).host ? (root as ShadowRoot).host : null;
}

/** Toutes les racines Shadow DOM sous `root` (récursif, hors panneau Diversity Lingua). */
export function collectShadowRoots(root: Node, skip: (el: Element) => boolean = () => false, out: ShadowRoot[] = []): ShadowRoot[] {
  const base = root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? (root as ParentNode) : null;
  if (!base) return out;
  const self = root.nodeType === Node.ELEMENT_NODE ? [root as Element] : [];
  for (const el of [...self, ...Array.from(base.querySelectorAll("*"))]) {
    if (skip(el)) continue;
    const sr = shadowRootOf(el);
    if (sr) { out.push(sr); collectShadowRoots(sr, skip, out); }
  }
  return out;
}
