/** Parcours de démonstration complet : vraie page de démo + vrai contrôleur + double du backend. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBackend, makeTranslator, wait } from "./helpers";

const demoDir = resolve(process.cwd(), "../demo");
function loadDemo() {
  const html = readFileSync(resolve(demoDir, "index.html"), "utf-8");
  const body = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/g, "");
  document.documentElement.innerHTML = `<head><title>Démo</title></head><body>${body}</body>`;
  document.documentElement.setAttribute("lang", "fr");
  new Function(readFileSync(resolve(demoDir, "app.js"), "utf-8"))(); // exécute app.js sur le document de test
}
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const settle = async (tr: { idle(): Promise<void> }) => { await wait(60); await tr.idle(); await wait(20); await tr.idle(); };

describe("parcours démo (critère final de réussite)", () => {
  beforeEach(loadDemo);

  it("activer → traduit → données financières et champs intacts → restauration identique", async () => {
    const before = document.documentElement.outerHTML;
    const fake = fakeBackend(); const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    expect($("bal").textContent).toBe("125 000 FCFA");                 // montant intact
    expect(document.querySelector('[data-i18n="bal_label"]')!.textContent).toMatch(/^\[TEST~?\]/); // libellé traduit
    expect($("s-pin").value).toBe("");
    expect($("s-to").value).toBe("670 12 34 56");                      // valeur de champ intacte
    expect($("s-to").getAttribute("placeholder")).toMatch(/^\[TEST~\]/); // placeholder traduit
    expect(JSON.stringify(fake.calls)).not.toMatch(/125 000|670 12 34 56|TX-2026-000/); // jamais envoyés
    expect(tr.getState().testData).toBe(true);
    expect(tr.getState().coverage.unverified).toBeGreaterThan(0);          // couverture : non validées
    tr.deactivate();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("transaction échouée : le message dynamique est traduit, référence et montants intacts", async () => {
    const fake = fakeBackend(); const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    $("s-to").value = "670 00 00 01"; $("s-amt").value = "5000"; $("s-pin").value = "1234";
    document.getElementById("s-go")!.click();
    await settle(tr);
    const msg = document.getElementById("s-msg")!;
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toMatch(/\[TEST~\]/);
    expect(msg.textContent).toContain("TX-2026-001001");              // référence intacte
    expect($("bal").textContent).toBe("119 900 FCFA");                // 125000 − (5000 + 100 de frais, minimum)
    expect(JSON.stringify(fake.calls)).not.toContain("TX-2026-001001");
    expect(document.getElementById("notifs")!.textContent).toMatch(/\[TEST~\]/);
  });

  it("réception simulée (toast dynamique) : traduit sans boucle", async () => {
    const fake = fakeBackend(); const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    document.getElementById("sim-recv")!.click();
    await settle(tr);
    expect(document.querySelector(".toast")!.textContent).toMatch(/\[TEST~\].* FCFA/);
    const n = fake.calls.length; await wait(200);
    expect(fake.calls.length).toBe(n);
  });

  it("le site change de langue (FR→EN) : la langue source suit", async () => {
    const fake = fakeBackend(); const { tr } = makeTranslator(fake);
    await tr.activate("xx-test");
    document.getElementById("l-en")!.click();
    await settle(tr);
    expect(fake.calls.some((c) => c.type === "dl/translate" && c.source === "en" &&
      c.segments.some((segment) => segment.text === "Send money"))).toBe(true);
  });
});
