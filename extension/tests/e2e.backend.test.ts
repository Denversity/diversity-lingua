/** Contrat extension ⇄ backend : exécute le VRAI ApiClient + TranslationManager contre un backend lancé (DL_E2E_URL). */
import { describe, expect, it } from "vitest";
import { ApiClient } from "../src/background/apiClient";
import { TranslationManager } from "../src/background/translationManager";
import { maskText, unmask } from "../src/shared/protect";

const URL_ = process.env.DL_E2E_URL;
describe.skipIf(!URL_)("extension ⇄ backend (réel)", () => {
  const api = new ApiClient(async () => ({ baseUrl: URL_!, token: "" }), fetch);
  const mgr = new TranslationManager(api, null, { minIntervalMs: 0 });

  it("health, langues (Fulfulde : couverture partielle, 146 concepts approuvés)", async () => {
    expect((await api.health()).status).toBe("ok");
    const ff = (await api.languages()).find((l) => l.code === "ff")!;
    expect(ff.availability).toBe("partial");
    expect(ff.approved_targets ?? ff.validated_entries).toBeGreaterThanOrEqual(146);
  });
  it("Fulfulde : ressources validées servies, texte inconnu = abstention (jamais de traduction inventée)", async () => {
    const ctx = { kind: "text" as const, tag: "button" };
    const r = await mgr.translate("fr", "ff", [{ id: "a", text: "Annuler", context: ctx },
      { id: "b", text: "Texte totalement inconnu qui ne figure dans aucune ressource", context: { kind: "text", tag: "p" } }]);
    expect(r[0].status).toBe("validated"); expect(r[0].translation).toBeTruthy();
    expect(r[1]).toMatchObject({ status: "unavailable", translation: null });
  });
  it("Fulfulde : phrases à variables — montant, numéro et nom restitués intacts, devise non dupliquée", async () => {
    const m = maskText("Vous allez envoyer 5 000 FCFA à 677 12 34 56.");
    const [a, b] = await mgr.translate("fr", "ff", [
      { id: "a", text: m.masked, context: { kind: "text", tag: "p" } },
      { id: "b", text: "Bienvenue, Amina", context: { kind: "text", tag: "h1" } }]);
    expect(a.status).toBe("validated");
    const out = unmask(a.translation!, m.tokens);
    expect(out).toContain("5 000 FCFA"); expect(out).toContain("677 12 34 56"); expect(out.match(/FCFA/g)).toHaveLength(1);
    expect(out).not.toContain("{{P");
    expect(b.status).toBe("validated"); expect(b.translation!.endsWith("Amina")).toBe(true);
  });
  it("langue de test : glossaire validé (test_data), machine non validée, montants intacts via masquage client", async () => {
    const m = maskText("Vous avez reçu 5 000 FCFA de 677 12 34 56");
    const r = await mgr.translate("fr", "xx-test", [
      { id: "a", text: "Envoyer de l'argent", context: { kind: "text", tag: "button" } }, { id: "b", text: m.masked, context: { kind: "text", tag: "p" } }]);
    expect(r[0]).toMatchObject({ status: "validated", test_data: true });
    expect(r[1].status).toBe("machine_unvalidated");
    expect(unmask(r[1].translation!, m.tokens)).toBe("[TEST~] Vous avez reçu 5 000 FCFA de 677 12 34 56");
  });
  it("explication « Je veux comprendre »", async () => {
    const e = await api.explain("fr", "ff", "Solde insuffisant");
    expect(e.found).toBe(true);
    expect(e.translation?.status).toBe("unavailable"); // la définition du concept n'a pas de traduction validée
    expect(e.term_translation?.translation_status).toBe("approved"); // le terme, lui, vient de la mémoire
  });
});
