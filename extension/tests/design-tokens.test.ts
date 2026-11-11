import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/ui/tokens.css", "utf-8");
const tok = (n: string) => new RegExp(`--dl-${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css)![1];
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("design system — accessibilité des couleurs (WCAG AA : 4.5:1)", () => {
  const pairs: [string, string, string][] = [
    ["verified-fg", "verified-bg", "badge vérifiée"], ["auto-fg", "auto-bg", "badge automatique"], ["unavail-fg", "unavail-bg", "badge indisponible"],
    ["kept-fg", "kept-bg", "badge conservé"], ["error-fg", "error-bg", "badge erreur"],
    ["ink-900", "paper-50", "texte principal"], ["ink-900", "paper-0", "texte sur carte"], ["ink-500", "paper-50", "texte secondaire"],
    ["ink-500", "paper-0", "texte secondaire sur carte"], ["paper-0", "jade-600", "bouton principal"], ["paper-0", "jade-700", "bouton principal (survol)"],
    ["jade-700", "paper-0", "lien/ghost"], ["jade-700", "jade-50", "ghost survol"], ["paper-50", "ink-900", "badge TEST"],
  ];
  for (const [fg, bg, label] of pairs) it(`${label} : ${fg} sur ${bg}`, () => expect(ratio(tok(fg), tok(bg))).toBeGreaterThanOrEqual(4.5));
  it("zone de clic minimale 44 px et prefers-reduced-motion respecté", () => {
    expect(css).toMatch(/--dl-hit:\s*44px/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
  it("les jetons ne ciblent aucun élément de page (uniquement :root / :host)", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^{@]+(?=\{)/gm)!.map((s) => s.trim())).toEqual([":root, :host"]);
  });
});
