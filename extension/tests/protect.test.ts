import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasTranslatableLetters, maskText, placeholdersMatch, unmask } from "../src/shared/protect";

const vectors = JSON.parse(readFileSync(resolve(process.cwd(), "../shared/protection_vectors.json"), "utf-8"));

describe("protection des données — parité avec l'implémentation Python", () => {
  for (const v of vectors) {
    it(`vecteur : ${v.input}`, () => {
      const r = maskText(v.input);
      expect(r.masked).toBe(v.masked);
      expect(r.tokens).toEqual(v.tokens);
      expect(unmask(r.masked, r.tokens)).toBe(v.input);
    });
  }
});

describe("protection — comportements", () => {
  it("les secrets ne survivent jamais dans le texte masqué", () => {
    for (const [t, s] of [["PIN: 4821", "4821"], ["Votre code OTP est 123456", "123456"], ["mot de passe : S3cret!", "S3cret!"]]) {
      expect(maskText(t).masked).not.toContain(s);
    }
  });
  it("les jetons externes sont préservés et la numérotation ne collisionne pas", () => {
    const r = maskText("Reçu {{P0}} de {{P1}} le 12/10/2026");
    expect(r.masked).toBe("Reçu {{P0}} de {{P1}} le {{P2}}");
    expect(r.tokens.map((t) => t[0])).toEqual(["{{P2}}"]);
  });
  it("contrôle d'intégrité des jetons", () => {
    expect(placeholdersMatch("A {{P0}} {{P1}}", "X {{P1}} {{P0}}")).toBe(true);
    expect(placeholdersMatch("A {{P0}}", "X")).toBe(false);
    expect(placeholdersMatch("A {{P0}}", "X {{P0}} {{P0}}")).toBe(false);
  });
  it("texte sans lettres = rien à traduire", () => {
    expect(hasTranslatableLetters("{{P0}}")).toBe(false);
    expect(hasTranslatableLetters("{{P0}} reçus")).toBe(true);
  });
});
