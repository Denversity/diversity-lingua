/** Création de DOM sans innerHTML : tout texte passe par textContent / createTextNode. */
export type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (v === true) el.setAttribute(k, "");
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(typeof c === "string" ? doc.createTextNode(c) : c);
  return el;
}
