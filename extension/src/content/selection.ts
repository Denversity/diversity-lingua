/** Lecture de la sélection de l'utilisateur. Sélectionner un texte DÉJÀ TRADUIT remonte à son original (nœud entier). */
import type { LedgerStatus } from "./ledger";
import { HOST_ID } from "./domExtractor";

export interface SelectionInfo {
  text: string;                 // ce que l'utilisateur voit sélectionné
  original: string;             // texte d'origine (= text si le texte n'a pas été traduit)
  shown: string | null;         // texte traduit affiché (null si non traduit)
  status: LedgerStatus | null;
  testData: boolean;
  rect: { left: number; top: number; right: number; bottom: number };
}
type Inspect = (n: Node) => { original: string; shown: string; status: LedgerStatus | null; testData: boolean } | null;

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function readSelection(win: Window, inspect: Inspect): SelectionInfo | null {
  const sel = win.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = squash(sel.toString());
  if (text.length < 2 || text.length > 300 || (text.match(/\p{L}/gu) ?? []).length < 2) return null;
  const elOf = (n: Node | null) => (n && n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n?.parentElement ?? null);
  for (const n of [sel.anchorNode, sel.focusNode]) {
    const el = elOf(n);
    if (el && (el.closest(`#${HOST_ID}`) || el.closest(FIELD))) return null;           // jamais dans nos panneaux ni dans un champ
  }
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
  else {
    const w = win.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (range.intersectsNode(n) && (n.nodeValue ?? "").trim()) nodes.push(n as Text);
  }
  const parts = nodes.map((n) => ({ n, info: inspect(n) }));
  const ours = parts.filter((p) => p.info);
  let rect = { left: 0, top: 0, right: 0, bottom: 0 };
  try { const r = range.getBoundingClientRect(); rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; } catch { /* jsdom */ }
  if (!ours.length) return { text, original: text, shown: null, status: null, testData: false, rect };
  const original = squash(parts.map((p) => p.info?.original ?? (p.n.nodeValue ?? "")).join(" "));
  const allKept = ours.every((p) => p.info!.status === "layout"); // rien n'a été remplacé dans la page
  return { text, original: original.slice(0, 480), shown: allKept ? null : text, status: ours[0].info!.status, testData: ours.some((p) => p.info!.testData), rect };
}
