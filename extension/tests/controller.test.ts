import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FR_PAGE, fakeBackend, makeTranslator, wait } from "./helpers";

beforeEach(() => { document.documentElement.innerHTML = `<head><title>T</title></head><body>${FR_PAGE}</body>`; });
afterEach(() => { document.documentElement.removeAttribute("data-dl-marks"); });

describe("PageTranslator — parcours complet", () => {
  it("traduit, restaure à l'identique, conserve les événements", async () => {
    const before = document.documentElement.outerHTML;
    let clicked = 0;
    const btn = document.getElementById("b1")!; btn.addEventListener("click", () => clicked++);
    const { tr, states } = makeTranslator(fakeBackend());
    await tr.activate("xx-test");
    expect(btn.textContent).toBe("[TEST] Envoyer de l'argent");
    expect(document.getElementById("p1")!.textContent).toMatch(/^\[TEST~\] Vous avez reçu/);
    expect(document.getElementById("b1")).toBe(btn); // même nœud : pas de remplacement de HTML
    btn.click(); expect(clicked).toBe(1);
    expect(states).toContain("translating"); expect(tr.getState().phase).toBe("done");
    tr.deactivate();
    expect(document.documentElement.outerHTML).toBe(before);
    expect(tr.getState().phase).toBe("inactive");
  });

  it("données financières et secrets : jamais envoyés, restitués intacts, champs non modifiés", async () => {
    const fake = fakeBackend();
    const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    const sent = JSON.stringify(fake.calls);
    for (const s of ["125 000", "FCFA", "677 12 34 56", "4821"]) expect(sent).not.toContain(s);
    expect(document.getElementById("amt")!.textContent).toContain("125 000 FCFA");
    expect((document.getElementById("ph") as HTMLInputElement).value).toBe("677 12 34 56");
    expect((document.getElementById("pin") as HTMLInputElement).value).toBe("4821");
    expect(document.getElementById("ta")!.textContent).toBe("Message pour le destinataire");
    expect(document.getElementById("ce")!.textContent).toBe("Texte éditable par l'utilisateur");
    expect(document.getElementById("ph")!.getAttribute("placeholder")).toMatch(/^\[TEST~\]/);
  });

  it("Comprendre détecte la langue du terme même si la page est détectée dans une autre langue", async () => {
    document.documentElement.setAttribute("lang", "en");
    document.body.innerHTML = "<p>Your account is ready.</p>";
    const fake = fakeBackend();
    const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");

    const result = await tr.explainText("Frais de transaction");

    expect(result).toMatchObject({ ok: true, sourceLang: "fr" });
    expect(fake.calls.at(-1)).toMatchObject({ type: "dl/explain", source: "fr", text: "Frais de transaction" });
  });

  it("traduit Bonjour et Hello selon leur langue même si la langue globale de la page est différente", async () => {
    document.documentElement.setAttribute("lang", "en");
    document.body.innerHTML = "<p id='fr'>Bonjour, Mariam</p><p id='en'>Hello, Mariam</p>";
    const fake = fakeBackend();
    const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");

    expect(fake.calls.flatMap((call) => call.type === "dl/translate" ? call.segments.map((s) => [call.source, s.text]) : []))
      .toEqual(expect.arrayContaining([["fr", "Bonjour, Mariam"], ["en", "Hello, Mariam"]]));
  });

  it("détecte une ligne de frais en anglais même sur une page déclarée en français", async () => {
    document.documentElement.setAttribute("lang", "fr");
    document.body.innerHTML = "<p>2% fee (min. 200 FCFA, max. 5,000 FCFA)</p>";
    const fake = fakeBackend();
    const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");

    expect(fake.calls.flatMap((call) => call.type === "dl/translate" ? call.segments.map((s) => [call.source, s.text]) : []))
      .toContainEqual(["en", expect.stringContaining("fee")]);
  });

  it("une traduction qui perd un jeton est rejetée côté client (montant jamais altéré)", async () => {
    const { tr } = makeTranslator(fakeBackend({ mutate: (_id, text) => text.replace(/\{\{P\d+\}\}/g, "") }));
    await tr.activate("xx-test");
    expect(document.getElementById("amt")!.textContent).toBe("Solde disponible : 125 000 FCFA");
  });

  it("aucune trace sur les éléments du site : ni attribut, ni feuille de style ciblant ses éléments", async () => {
    const attrs = () => [...document.querySelectorAll("*")].map((e) => e.tagName + ":" + e.getAttributeNames().sort().join()).join("|");
    const before = attrs();
    const { tr } = makeTranslator(fakeBackend());
    await tr.activate("xx-test");
    expect(attrs()).toBe(before);                       // pas de data-dl-*, pas de classe, pas de style inline
    expect(document.documentElement.getAttribute("data-dl-marks")).toBeNull();
    expect(document.getElementById("dl-marks-style")).toBeNull();
    tr.deactivate();
    expect(attrs()).toBe(before);
  });

  it("contenus dynamiques : ajouts, réécriture par le site, sans boucle", async () => {
    const fake = fakeBackend();
    const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    const n0 = fake.calls.length;
    const toast = document.createElement("div"); toast.id = "toast"; toast.textContent = "Transfert effectué avec succès";
    document.body.appendChild(toast);
    await wait(80); await tr.idle();
    expect(toast.textContent).toBe("[TEST~] Transfert effectué avec succès");
    expect(fake.calls.length).toBe(n0 + 1);
    // le site réécrit un texte déjà traduit
    (document.getElementById("p1")!.firstChild as Text).nodeValue = "Nouveau message du site pour vous";
    await wait(80); await tr.idle();
    expect(document.getElementById("p1")!.textContent).toBe("[TEST~] Nouveau message du site pour vous");
    // aucun appel supplémentaire spontané : pas de boucle de traduction
    const n1 = fake.calls.length; await wait(150);
    expect(fake.calls.length).toBe(n1);
    tr.deactivate();
    expect(toast.textContent).toBe("Transfert effectué avec succès");
  });

  it("garde anti-boucle : un site qui réécrit sans cesse un nœud n'entraîne pas de tempête d'appels", async () => {
    const fake = fakeBackend();
    const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    const node = document.getElementById("p1")!.firstChild as Text;
    for (let i = 0; i < 15; i++) { node.nodeValue = `Compteur ${i} du site pour vous`; await wait(30); await tr.idle(); }
    expect(fake.calls.length).toBeLessThan(12);
  });

  it("erreur réseau : état « error », page intacte", async () => {
    const before = document.body.innerHTML;
    const { tr } = makeTranslator(fakeBackend({ fail: true }));
    await tr.activate("xx-test");
    expect(tr.getState().phase).toBe("error");
    expect(document.body.innerHTML).toBe(before);
  });

  it("deux échecs consécutifs : on n'insiste pas lot après lot", async () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<p>Vous avez ${i} message dans le compte numéro un</p>`).join("");
    const fake = fakeBackend({ fail: true });
    const { tr } = makeTranslator(fake);
    (tr as any).d.batchSize = 1;
    await tr.activate("xx-test");
    expect(fake.calls.length).toBe(2);
    expect(tr.getState().counts.error).toBe(6);
  });

  it("traduction partielle puis indisponible", async () => {
    document.body.innerHTML = "<p>Vous avez reçu le solde de votre compte</p><p>texte indispo pour le test et pour vous</p>";
    const { tr } = makeTranslator(fakeBackend());
    await tr.activate("xx-test");
    expect(tr.getState().phase).toBe("partial");
    document.body.innerHTML = "<p>texte indispo pour le test et pour vous</p>";
    const t2 = makeTranslator(fakeBackend()); await t2.tr.activate("xx-test");
    expect(t2.tr.getState().phase).toBe("unavailable");
  });

  it("langue de page non prise en charge : aucun appel réseau", async () => {
    document.body.innerHTML = "<p>Dies ist ein deutscher Text über Ihr Konto und Ihr Guthaben.</p>";
    document.documentElement.setAttribute("lang", "de");
    const fake = fakeBackend(); const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    expect(tr.getState().phase).toBe("unavailable"); expect(tr.getState().message).toBe("unsupportedSource"); expect(fake.calls).toHaveLength(0);
    document.documentElement.removeAttribute("lang");
  });

  it("désactivation pendant une requête : résultats tardifs ignorés", async () => {
    const before = document.body.innerHTML;
    const { tr } = makeTranslator(fakeBackend({ delay: 60 }));
    const p = tr.activate("xx-test"); await wait(10);
    tr.deactivate(); await p; await tr.idle();
    expect(document.body.innerHTML).toBe(before);
    expect(tr.getState().phase).toBe("inactive");
  });

  it("changer de langue restaure puis retraduit", async () => {
    const { tr } = makeTranslator(fakeBackend());
    await tr.activate("xx-test"); await tr.activate("xx-test");
    expect(document.getElementById("p1")!.textContent).toMatch(/^\[TEST~\] Vous avez reçu/);
    expect(document.getElementById("p1")!.textContent).not.toMatch(/\[TEST~\] \[TEST~\]/);
  });

  it("traduction sélective : le montant sélectionné reste intact", async () => {
    const fake = fakeBackend(); const { tr } = makeTranslator(fake);
    const { result } = await tr.translateText("Frais de 500 FCFA vers 677 12 34 56");
    expect(JSON.stringify(fake.calls)).not.toContain("500 FCFA");
    expect(result.translation).toBe("[TEST~] Frais de 500 FCFA vers 677 12 34 56");
  });
});
