/**
 * DOM Extractor : identifie les textes traduisibles (TreeWalker) sur des interfaces INCONNUES.
 *
 * Exclusions par défaut (sécurité + préservation du design) :
 *  champs (input/textarea/select → valeurs jamais lues), <option> sans attribut value (sa valeur serait modifiée), contenu éditable, scripts/styles/code,
 *  translate="no" / .notranslate / [data-dl-ignore], panneau Diversity Lingua,
 *  icônes (classes ou polices d'icônes, glyphes de zone privée), logos/marques, lettres isolées,
 *  éléments déjà en langue cible (lang="ff…").
 * Les racines Shadow DOM (ouvertes, ou fermées via chrome.dom) sont parcourues.
 */
import type { ElementContext } from "../shared/types";
import { hasTranslatableLetters, maskText, type Token } from "../shared/protect";
import { collectShadowRoots, parentOf } from "./shadow";

export const HOST_ID = "dl-root";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE", "KBD", "SAMP", "TEMPLATE", "IFRAME", "OBJECT", "HEAD", "TITLE", "CANVAS", "AUDIO", "VIDEO"]);
const IGNORE_SELECTOR = `[translate="no"], .notranslate, [data-dl-ignore], [contenteditable=""], [contenteditable="true"], #${HOST_ID}`;
export const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;

const ICON_CLASS = /(^|[\s_-])(icon|icons|fa|fas|far|fab|fal|fad|glyphicon|material-icons[\w-]*|material-symbols[\w-]*|mdi|bi|ti|ion|ri|feather|codicon|lucide)([\s_-]|$)/i;
const BRAND_CLASS = /(^|[\s_-])(logo|logotype|brand|brandmark|wordmark)([\s_-]|$)/i;
const PRIVATE_USE = /[\uE000-\uF8FF]/;
const LIGATURE = /^[a-z0-9_]{2,40}$/;

export interface SegmentRef {
  id: string;
  kind: "text" | "attr";
  node: Text | Element;
  attr?: string;
  original: string; // valeur complète d'origine (espaces compris) — base de la restauration
  lead: string;
  trail: string;
  masked: string; // texte envoyé au backend (données sensibles remplacées)
  tokens: Token[];
  context: ElementContext;
}

export interface ExtractorOptions {
  attributes: boolean;
  shouldSkip?: (node: Node, attr?: string) => boolean; // ex. nœuds déjà traduits par nous
  targetLang?: string; // les éléments déjà dans cette langue (attribut lang) sont ignorés
  onShadowRoot?: (root: ShadowRoot) => void; // appelé pour chaque racine découverte (pour l'observer)
}

function matchesIgnore(el: Element): boolean {
  try { return el.matches(IGNORE_SELECTOR); } catch { return false; }
}
function ancestorHas(el: Element | null, test: (e: Element) => boolean, depth = 99): boolean {
  for (let e = el, i = 0; e && i < depth; e = parentOf(e), i++) if (test(e)) return true;
  return false;
}
const classOf = (e: Element) => (e.getAttribute("class") ?? "") + " " + (e.id ?? "");

function isIgnored(el: Element | null, forAttr = false, targetLang?: string): boolean {
  for (let e = el; e; e = parentOf(e)) {
    // Pour un attribut (placeholder…), l'élément champ lui-même est autorisé : seule sa VALEUR est interdite.
    if (forAttr && e === el && (e.tagName === "INPUT" || e.tagName === "TEXTAREA")) continue;
    if (SKIP_TAGS.has(e.tagName.toUpperCase()) || matchesIgnore(e)) return true;
    const lang = e.getAttribute("lang");
    if (targetLang && lang && lang.toLowerCase().startsWith(targetLang.toLowerCase())) return true;
  }
  return false;
}

/** Icône ou logo : ne jamais traduire (une ligature « home » ou une lettre-logo serait détruite). */
function isIconOrBrand(el: Element | null, text: string): boolean {
  if (!el) return false;
  if (PRIVATE_USE.test(text)) return true;
  if (ancestorHas(el, (e) => ICON_CLASS.test(e.getAttribute("class") ?? ""), 2)) return true;
  if (ancestorHas(el, (e) => BRAND_CLASS.test(classOf(e)), 3)) return true;
  if (LIGATURE.test(text.trim()) && text.trim().length <= 40) {
    try {
      const ff = el.ownerDocument.defaultView?.getComputedStyle(el).fontFamily ?? "";
      if (/icon|symbol|material|awesome|glyph|feather/i.test(ff)) return true;
    } catch { /* jsdom */ }
  }
  return false;
}

const letterCount = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

export class DomExtractor {
  private counter = 0;
  constructor(private opts: ExtractorOptions) {}

  private make(partial: Omit<SegmentRef, "id" | "lead" | "trail" | "masked" | "tokens">, raw: string): SegmentRef | null {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw)!;
    const core = m[2].replace(/\s+/g, " ");
    if (!core) return null;
    const mask = maskText(core);
    if (!hasTranslatableLetters(mask.masked)) return null;
    if (letterCount(mask.masked.replace(/\{\{P\d+\}\}/g, "")) < 2) return null; // lettre isolée : logo, pastille, icône
    return { ...partial, id: `s${++this.counter}`, lead: m[1], trail: m[3], masked: mask.masked, tokens: mask.tokens };
  }

  extract(root: Node): SegmentRef[] {
    const out: SegmentRef[] = [];
    const tl = this.opts.targetLang;
    const handleText = (t: Text) => {
      const parent = t.parentElement ?? parentOf(t);
      if (!parent || isIgnored(parent, false, tl)) return;
      const raw = t.nodeValue ?? "";
      // <option> SANS attribut value : sa valeur de formulaire EST son texte — le traduire changerait la donnée soumise.
      if (parent.tagName === "OPTION" && !parent.hasAttribute("value")) return;
      if (this.opts.shouldSkip?.(t) || isIconOrBrand(parent, raw)) return;
      const ref = this.make({ kind: "text", node: t, original: raw, context: contextOf(parent, "text") }, raw);
      if (ref) out.push(ref);
    };
    const handleAttrs = (el: Element) => {
      if (isIgnored(el, true, tl)) return;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "hidden") return;
      for (const a of TRANSLATABLE_ATTRS) {
        const v = el.getAttribute(a);
        if (!v || this.opts.shouldSkip?.(el, a)) continue;
        if (a === "alt" && ancestorHas(el, (e) => BRAND_CLASS.test(classOf(e)), 3)) continue;
        const ref = this.make({ kind: "attr", node: el, attr: a, original: v, context: contextOf(el, "attribute", a) }, v);
        if (ref) out.push(ref);
      }
    };
    const walkRoot = (start: Node) => {
      const doc = start.ownerDocument ?? (start as Document);
      const walker = doc.createTreeWalker(start, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const e = n as Element;
            return SKIP_TAGS.has(e.tagName.toUpperCase()) || matchesIgnore(e) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) handleText(n as Text);
      if (this.opts.attributes) {
        if (start.nodeType === Node.ELEMENT_NODE) handleAttrs(start as Element);
        for (const el of Array.from((start as ParentNode).querySelectorAll(TRANSLATABLE_ATTRS.map((a) => `[${a}]`).join(",")))) handleAttrs(el);
      }
    };

    if (root.nodeType === Node.TEXT_NODE) {
      handleText(root as Text);
      return out;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return out;
    const start = root.nodeType === Node.DOCUMENT_NODE ? ((root as Document).body ?? (root as Document).documentElement) : root;
    if (!start) return out;
    if (start.nodeType === Node.ELEMENT_NODE && isIgnored(start as Element, false, tl)) return out;
    walkRoot(start);
    // Shadow DOM : chaque racine découverte est parcourue (sauf si son hôte est ignoré) et signalée pour observation.
    for (const sr of collectShadowRoots(start, (el) => el.id === HOST_ID || isIgnored(el, false, tl))) {
      this.opts.onShadowRoot?.(sr);
      walkRoot(sr);
    }
    return out;
  }
}

function contextOf(el: Element | null, kind: "text" | "attribute", attr?: string): ElementContext {
  const ctx: ElementContext = { kind };
  if (attr) ctx.attr = attr;
  if (!el) return ctx;
  ctx.tag = el.tagName.toLowerCase();
  const role = el.closest("[role]")?.getAttribute("role");
  if (role) ctx.role = role.slice(0, 32);
  if (el.closest("[role=alert],[role=status],[role=alertdialog]")) ctx.region = "alert";
  else if (el.closest("nav,[role=navigation]")) ctx.region = "nav";
  else if (el.closest("dialog,[role=dialog]")) ctx.region = "dialog";
  else if (el.closest("table")) ctx.region = "table";
  return ctx;
}
