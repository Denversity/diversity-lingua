/**
 * Protection des données sensibles côté navigateur.
 * MIROIR EXACT de backend/app/services/protection.py (vérifié par shared/protection_vectors.json).
 * Les montants, devises, numéros, identifiants, codes secrets, e-mails et URL sont remplacés par {{Pn}}
 * AVANT envoi au backend : leurs valeurs ne quittent jamais la page.
 */
export const PLACEHOLDER_RE = /\{\{P(\d+)\}\}/g;

const CUR_SUFFIX = "(?:FCFA|F\\s?CFA|XAF|XOF|CFA|EUR|USD|€|\\$|FC|F)";
const CUR_PREFIX = "(?:FCFA|F\\s?CFA|XAF|XOF|CFA|EUR|USD|€|\\$)";
const NUM = "\\d+(?:[ \\u00a0\\u202f.,]\\d+)*";

const PATTERN = new RegExp(
  [
    "(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)",
    "(?<url>(?:https?://|www\\.)[^\\s<>\"']+)",
    "(?<secret>(?:pin|otp|cvv|mot de passe|password|passcode|code secret)\\s*[:=]\\s*)(?<secretval>\\S+)",
    "(?<codectx>\\b(?:code|otp|pin)\\b[^\\d\\n]{0,25})(?<codeval>\\d{4,8})(?!\\d)",
    `(?<amount>(?:(?<![A-Za-z0-9\\u00c0-\\u00ff])${CUR_PREFIX}\\s?${NUM}|${NUM}\\s?${CUR_SUFFIX})(?![A-Za-z0-9\\u00c0-\\u00ff]))`,
    "(?<phone>(?:(?:\\+|00)237[ .-]?)?(?<![\\d])[26](?:[ .-]?\\d){8}(?!\\d))",
    "(?<percent>\\d+(?:[.,]\\d+)?\\s?%)",
    "(?<date>\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b\\d{1,2}[h:]\\d{2}\\b)",
    "(?<id>\\b[A-Z]{2,6}[-_]?\\d[A-Za-z0-9_-]{2,}\\b|\\b\\d{6,}\\b)",
    "(?<currency>\\b(?:FCFA|F\\s?CFA|XAF|XOF|CFA|EUR|USD)\\b|€|\\$)",
    "(?<number>\\d+(?:[ \\u00a0\\u202f.,]\\d{3})*(?:[.,]\\d+)?)",
  ].join("|"),
  "gid",
);

const GROUPS = ["secretval", "codeval", "email", "url", "amount", "phone", "percent", "date", "id", "currency", "number"] as const;
const KIND: Record<string, string> = {
  email: "email", url: "url", secretval: "secret", codeval: "secret", amount: "amount", phone: "phone",
  percent: "number", date: "number", id: "identifier", currency: "currency", number: "number",
};

export type Token = [placeholder: string, value: string, kind: string];
export interface MaskResult { masked: string; tokens: Token[]; external: string[] }

function maskRaw(text: string): MaskResult {
  const ext = [...text.matchAll(PLACEHOLDER_RE)].map((m) => Number(m[1]));
  let counter = ext.length ? Math.max(...ext) + 1 : 0;
  const tokens: Token[] = [];
  let out = "";
  let pos = 0;
  for (const m of text.matchAll(PATTERN)) {
    const groups = m.groups as Record<string, string | undefined>;
    const g = GROUPS.find((n) => groups[n] !== undefined);
    if (!g) continue;
    const idx = (m as any).indices.groups[g] as [number, number];
    const [start, end] = idx;
    if (start < pos) continue;
    const ph = `{{P${counter++}}}`;
    tokens.push([ph, text.slice(start, end), KIND[g]]);
    out += text.slice(pos, start) + ph;
    pos = end;
  }
  out += text.slice(pos);
  return { masked: out, tokens, external: [] };
}

/** Masque les données sensibles en préservant les jetons déjà présents dans le texte. */
export function maskText(text: string): MaskResult {
  const extMatches = [...text.matchAll(PLACEHOLDER_RE)];
  if (!extMatches.length) return maskRaw(text);
  const sentinels = new Map<string, string>();
  const stashed = text.replace(PLACEHOLDER_RE, (full, digits: string) => {
    const key = "\ue000" + [...digits].map((d) => String.fromCharCode(0xe010 + Number(d))).join("") + "\ue001";
    sentinels.set(key, full);
    return key;
  });
  const res = maskRaw(stashed);
  const base = Math.max(...extMatches.map((m) => Number(m[1]))) + 1;
  const mapping = new Map<string, string>();
  const tokens: Token[] = res.tokens.map(([ph, v, k], i) => {
    const np = `{{P${base + i}}}`;
    mapping.set(ph, np);
    return [np, v, k] as Token;
  });
  let masked = res.masked.replace(PLACEHOLDER_RE, (m) => mapping.get(m) ?? m);
  for (const [key, original] of sentinels) masked = masked.split(key).join(original);
  return { masked, tokens, external: extMatches.map((m) => m[0]) };
}

export function unmask(text: string, tokens: Token[]): string {
  const map = new Map(tokens.map(([ph, v]) => [ph, v]));
  return text.replace(PLACEHOLDER_RE, (m) => map.get(m) ?? m);
}

export function placeholdersOf(text: string): Map<string, number> {
  const c = new Map<string, number>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) c.set(m[0], (c.get(m[0]) ?? 0) + 1);
  return c;
}

/** Les jetons de la traduction doivent être exactement ceux de la source (même nombre). */
export function placeholdersMatch(source: string, translated: string): boolean {
  const a = placeholdersOf(source), b = placeholdersOf(translated);
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export function hasTranslatableLetters(masked: string): boolean {
  return /[\p{L}]/u.test(masked.replace(PLACEHOLDER_RE, ""));
}
