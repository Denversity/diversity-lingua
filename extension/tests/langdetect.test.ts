import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/shared/langdetect";

const seg = (t: string) => detectLanguage(t, null, 2, 0.85);

describe("détection de langue par segment (libellés financiers courts)", () => {
  it.each(["Send money", "Transfer amount", "Confirm payment"])("« %s » → anglais", (t) => {
    expect(seg(t)).toMatchObject({ lang: "en", source: "text" });
  });
  it.each(["Envoyer de l'argent", "Montant des frais", "Confirmer le paiement", "Annuler la transaction"])("« %s » → français", (t) => {
    expect(seg(t)).toMatchObject({ lang: "fr", source: "text" });
  });
  it("libellé d'un seul mot : indécis (la page ou l'attribut lang tranche)", () => {
    expect(seg("Cancel").source).toBe("none");
    expect(seg("Annuler").source).toBe("none");
  });
  it.each([["Frais", "fr"], ["Bénéficiaire", "fr"], ["Numéro de compte", "fr"], ["Fees", "en"], ["fee", "en"], ["Beneficiary", "en"], ["Account number", "en"]] as const)(
    "terme financier sélectionné « %s » → %s",
    (term, lang) => expect(detectLanguage(term, null, 1, 1)).toMatchObject({ lang, source: "text" }),
  );
  it.each([["Bonjour, {{P0}}", "fr"], ["Hello, {{P0}}", "en"]] as const)(
    "détecte le salut d'une formule courte « %s » même avec une langue de page contraire",
    (text, lang) => expect(detectLanguage(text.replace(/\{\{P\d+\}\}/g, " "), "en", 1, 1)).toMatchObject({ lang, source: "text" }),
  );
  it("mot commun aux deux langues : jamais tranché à tort", () => {
    expect(seg("Transaction").source).toBe("none");
    expect(seg("Total").source).toBe("none");
  });
  it("phrases longues inchangées", () => {
    expect(detectLanguage("Vous avez reçu un paiement sur votre compte").lang).toBe("fr");
    expect(detectLanguage("You have received a payment on your account").lang).toBe("en");
  });
});
