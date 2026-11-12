/**
 * Glossary Client : glossaire LOCAL (instantané des entrées VALIDÉES embarqué dans l'extension).
 * Consulté avant le réseau → fonctionne hors ligne pour les termes validés.
 * Prudence : une entrée dont le terme a plusieurs traductions selon le contexte n'est pas utilisée ici
 * (la désambiguïsation contextuelle est faite par le serveur).
 */
import { placeholdersMatch } from "../shared/protect";

export interface GlossaryEntry { id: string; source_lang: string; source_text: string; translation: string; contexts?: string[]; test_data?: boolean }
export interface GlossarySnapshot { language: string; version: string; entries: GlossaryEntry[] }
export type SnapshotLoader = (lang: string) => Promise<GlossarySnapshot | null>;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function originalOffset(text: string, normalized: string, end: number): number {
  const wanted = normalized.slice(0, end);
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    if (text.slice(0, offset).normalize("NFC") === wanted) return offset;
  }
  return -1;
}

function normalizeExact(text: string): string {
  return text.normalize("NFC").replace(/\u2019/g, "'").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalize(text: string): string {
  return text.normalize("NFC").replace(/\u2019/g, "'").replace(/\u00a0/g, " ").replace(/\s+/g, " ")
    .replace(/^[ \t\r\n.:;…«»"']+|[ \t\r\n.:;…«»"']+$/g, "").toLowerCase();
}

export class GlossaryClient {
  private cache = new Map<string, { exact: Map<string, GlossaryEntry[]>; loose: Map<string, GlossaryEntry[]>; bySource: Map<string, GlossaryEntry[]> } | null>();
  constructor(private loader: SnapshotLoader) {}

  private async index(target: string) {
    if (!this.cache.has(target)) {
      let idx: { exact: Map<string, GlossaryEntry[]>; loose: Map<string, GlossaryEntry[]>; bySource: Map<string, GlossaryEntry[]> } | null = null;
      try {
        const snap = await this.loader(target);
        if (snap && Array.isArray(snap.entries)) {
          idx = { exact: new Map(), loose: new Map(), bySource: new Map() };
          for (const e of snap.entries) {
            if (!e || typeof e.source_text !== "string" || typeof e.translation !== "string" || !e.translation) continue;
            const exactKey = `${e.source_lang}|${normalizeExact(e.source_text)}`;
            const looseKey = `${e.source_lang}|${normalize(e.source_text)}`;
            (idx.exact.get(exactKey) ?? idx.exact.set(exactKey, []).get(exactKey)!).push(e);
            (idx.loose.get(looseKey) ?? idx.loose.set(looseKey, []).get(looseKey)!).push(e);
            (idx.bySource.get(e.source_lang) ?? idx.bySource.set(e.source_lang, []).get(e.source_lang)!).push(e);
          }
        }
      } catch { idx = null; }
      this.cache.set(target, idx);
    }
    return this.cache.get(target)!;
  }

  async lookup(masked: string, source: string, target: string): Promise<{ translation: string; entry: GlossaryEntry } | null> {
    const idx = await this.index(target);
    const c = idx?.exact.get(`${source}|${normalizeExact(masked)}`)
      ?? idx?.loose.get(`${source}|${normalize(masked)}`);
    if (!c?.length || new Set(c.map((e) => e.translation)).size !== 1) return null;
    const e = c[0];
    return placeholdersMatch(masked, e.translation) ? { translation: e.translation, entry: e } : null;
  }

  async lookupPrefix(masked: string, source: string, target: string): Promise<{ translation: string; entry: GlossaryEntry } | null> {
    const idx = await this.index(target);
    const matches: { entry: GlossaryEntry; end: number }[] = [];
    for (const entry of idx?.bySource.get(source) ?? []) {
      const words = entry.source_text.normalize("NFC").trim().split(/\s+/).map(escapeRegExp);
      if (!words.length || !words[0]) continue;
      const pattern = new RegExp(`^${words.join("\\s+")}(?=$|[^\\p{L}\\p{N}_])`, "iu");
      const match = pattern.exec(masked.normalize("NFC"));
      if (match) matches.push({ entry, end: match[0].length });
    }
    if (!matches.length) return null;

    const longest = Math.max(...matches.map((m) => m.end));
    const candidates = matches.filter((m) => m.end === longest);
    if (new Set(candidates.map((m) => m.entry.translation)).size !== 1) return null;
    const { entry, end } = candidates[0];
    const rawEnd = originalOffset(masked, masked.normalize("NFC"), end);
    if (rawEnd < 0) return null;
    const translation = entry.translation + masked.slice(rawEnd);
    return placeholdersMatch(masked, translation) ? { translation, entry } : null;
  }

  async translateInlineTerms(masked: string, source: string, target: string): Promise<{ translation: string; entry: GlossaryEntry } | null> {
    const idx = await this.index(target);
    const entries = (idx?.bySource.get(source) ?? []).filter((entry) => {
      const term = entry.source_text.trim();
      return /^\p{L}+(?:['’-]\p{L}+)*$/u.test(term) || /^\p{L}{1,4}\.$/u.test(term);
    });
    if (!entries.length) return null;

    const matches: { start: number; end: number; entries: GlossaryEntry[] }[] = [];
    for (const entry of entries) {
      const term = entry.source_text.trim();
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "giu");
      for (const match of masked.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const same = matches.find((candidate) => candidate.start === start && candidate.end === end);
        if (same) {
          if (!same.entries.some((candidate) => candidate.translation === entry.translation)) same.entries.push(entry);
        } else {
          matches.push({ start, end, entries: [entry] });
        }
      }
    }
    if (!matches.length) return null;

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    let cursor = 0;
    let changed = false;
    let translation = "";
    let firstEntry: GlossaryEntry | null = null;
    for (const match of matches) {
      if (match.start < cursor) continue;
      translation += masked.slice(cursor, match.start);
      if (new Set(match.entries.map((entry) => entry.translation)).size === 1) {
        translation += match.entries[0].translation;
        firstEntry ??= match.entries[0];
        changed = true;
      } else {
        translation += masked.slice(match.start, match.end);
      }
      cursor = match.end;
    }
    translation += masked.slice(cursor);

    return changed && firstEntry && placeholdersMatch(masked, translation) ? { translation, entry: firstEntry } : null;
  }

  async lookupOtherSource(masked: string, source: string, target: string): Promise<{ translation: string; entry: GlossaryEntry } | null> {
    if (source !== "fr" && source !== "en") return null;
    const other = source === "fr" ? "en" : "fr";
    const idx = await this.index(target);
    if (idx?.loose.has(`${source}|${normalize(masked)}`)) return null;
    return this.lookup(masked, other, target);
  }
}
