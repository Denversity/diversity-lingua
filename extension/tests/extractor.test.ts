import { beforeEach, describe, expect, it } from "vitest";
import { DomExtractor } from "../src/content/domExtractor";
import { FR_PAGE } from "./helpers";

beforeEach(() => { document.documentElement.innerHTML = `<head><title>T</title></head><body>${FR_PAGE}</body>`; });
const texts = (attrs = true) => new DomExtractor({ attributes: attrs }).extract(document);

describe("DOM Extractor", () => {
  it("extrait titres, paragraphes, boutons, libellés", () => {
    const originals = texts().filter((r) => r.kind === "text").map((r) => r.original.trim());
    expect(originals).toEqual(expect.arrayContaining(["Votre compte", "Envoyer de l'argent", "Numéro du destinataire"]));
  });
  it("ne touche jamais aux valeurs de champs, textarea, contenu éditable, scripts, translate=no, data-dl-ignore", () => {
    const all = texts().map((r) => r.original);
    for (const forbidden of ["677 12 34 56", "4821", "Message pour le destinataire", "Texte éditable", "Ne pas traduire", "Marque non traduisible", "Ignoré volontairement"]) {
      expect(all.some((o) => o.includes(forbidden))).toBe(false);
    }
  });
  it("traduit les attributs placeholder uniquement (jamais value)", () => {
    const attrs = texts().filter((r) => r.kind === "attr");
    expect(attrs.map((r) => r.attr)).toEqual(expect.arrayContaining(["placeholder"]));
    expect(attrs.every((r) => r.attr !== ("value" as any))).toBe(true);
    expect(texts(false).some((r) => r.kind === "attr")).toBe(false);
  });
  it("masque montants dans le texte envoyé et conserve les espaces de bord", () => {
    const r = texts().find((x) => x.original.includes("125 000"))!;
    expect(r.masked).toBe("Solde disponible : {{P0}}");
    expect(r.tokens[0][1]).toBe("125 000 FCFA");
    document.body.innerHTML = "<p>  Bonjour tout le monde \n </p>";
    const s = texts()[0];
    expect([s.lead, s.trail]).toEqual(["  ", " \n "]);
  });
  it("ignore les nombres seuls et plusieurs nœuds dans un même élément sont séparés", () => {
    document.body.innerHTML = "<p>12 500 F</p><p>Bonjour <b>Anthony</b>, vous avez <span>5 reçus</span></p>";
    const t = texts().map((r) => r.original);
    expect(t).not.toContain("12 500 F");
    expect(t).toEqual(expect.arrayContaining(["Bonjour ", "Anthony", ", vous avez ", "5 reçus"]));
  });
  it("respecte shouldSkip (nœuds déjà traduits)", () => {
    const ex = new DomExtractor({ attributes: false, shouldSkip: (n) => n.nodeValue === "Votre compte" });
    expect(ex.extract(document).some((r) => r.original === "Votre compte")).toBe(false);
  });
  it("une <option> sans attribut value n'est PAS traduite (sa valeur de formulaire serait modifiée) ; avec value, oui", () => {
    document.body.innerHTML = '<select id="a"><option>Compte courant</option><option value="sav">Compte épargne</option></select>';
    const t = texts().map((r) => r.original);
    expect(t).toEqual(["Compte épargne"]);
  });
  it("identifiants uniques, contexte de l'élément", () => {
    const refs = texts();
    expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
    expect(refs.find((r) => r.original === "Envoyer de l'argent")!.context.tag).toBe("button");
  });
});
