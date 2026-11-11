// Interfaces qui évoluent : SPA, navigation interne, modale, toasts, horloge réécrite, Shadow DOM, multilingue, repères, restauration.
import { resolve } from "node:path";
import { launch } from "./lib/browser.mjs";
import { openWithExtension, command, wait } from "./lib/page.mjs";
import { serve } from "./lib/server.mjs";

const srv = await serve(resolve("tests-browser/fixtures"));
const browser = await launch();
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("   ✗", m); } };
const calls = (arr) => arr.filter((c) => c.type === "dl/translate");

// ---------------------------------------------------------------- A. SPA
{
  console.log("A. Application à navigation interne (SPA)");
  const { page, calls: log } = await openWithExtension(browser, `${srv.url}/spa-app.html`, { ratio: 1.0, viewport: { width: 1100, height: 700 } });
  await wait(700);
  await command(page, { type: "dl/activate", target: "ff" }); await wait(800);
  const txt = () => page.evaluate(() => document.body.innerText);
  ok((await txt()).includes("[TEST~] Bonjour, bienvenue"), "A1: la vue d'accueil (rendue avant l'activation) est traduite");
  const n0 = calls(log).length;
  await page.click('a[data-r="/transfer"]'); await wait(1300);
  const t2 = await txt();
  ok(t2.includes("[TEST~] Confirmer l'envoi"), "A2: après navigation interne (pushState), la nouvelle vue est traduite");
  ok(!/\[TEST~\] \[TEST~\]/.test(t2), "A3: aucune traduction en double");
  const inputPh = await page.$eval('input[placeholder]', (e) => e.getAttribute("placeholder"));
  ok(inputPh.startsWith("[TEST~]"), "A4: le placeholder de la nouvelle vue est traduit");
  await page.click('a[data-r="/home"]'); await wait(900);
  await page.click("#open"); await wait(700);
  ok((await txt()).includes("[TEST~] Les frais sont indiqués avant chaque confirmation."), "A5: le contenu d'une modale ouverte après coup est traduit");
  await page.click("#close"); await wait(300);
  await page.evaluate(() => window.__toast("Transfert effectué avec succès")); await wait(700);
  ok((await txt()).includes("[TEST~] Transfert effectué avec succès"), "A6: un toast est traduit");
  const nBefore = calls(log).length;
  await wait(6500);                                   // l'horloge du site réécrit son texte ~9 fois
  const ticks = await page.evaluate(() => window.__ticks);
  const extra = calls(log).length - nBefore;
  ok(ticks >= 8, `A7: le site a bien réécrit l'horloge (${ticks} fois)`);
  ok(extra <= 8, `A8: pas de tempête d'appels malgré les réécritures du site (${extra} requêtes supplémentaires)`);
  const clock = await page.$eval("#clock", (e) => e.textContent);
  ok(!/\[TEST~\] \[TEST~\]/.test(clock), "A9: l'horloge n'est jamais double-traduite");
  const st = await command(page, { type: "dl/get-state" });
  ok(st.coverage.total > 5 && st.coverage.total === st.coverage.verified + st.coverage.unverified + st.coverage.kept, `A10: couverture cohérente sur la page ACTUELLE (${JSON.stringify(st.coverage)})`);
  await command(page, { type: "dl/deactivate" }); await wait(300);
  const after = await page.evaluate(() => ({ body: document.body.innerText, clock: document.getElementById("clock").textContent, host: !!document.getElementById("dl-root"), hl: [...CSS.highlights.keys()] }));
  ok(!after.body.includes("[TEST~]"), "A11: après restauration, aucun texte traduit ne subsiste");
  ok(/Dernière mise à jour : 12:00:\d\d/.test(after.clock), `A12: l'horloge garde la DERNIÈRE valeur écrite par le site (« ${after.clock} »)`);
  ok(!after.host && after.hl.length === 0, "A13: aucun panneau ni repère résiduel");
  await page.close();
}

// ---------------------------------------------------------------- B. Shadow DOM
{
  console.log("B. Composants web (Shadow DOM)");
  const { page } = await openWithExtension(browser, `${srv.url}/webcomponents.html`, { ratio: 1.0, viewport: { width: 900, height: 500 } });
  await command(page, { type: "dl/activate", target: "ff" }); await wait(700);
  const shadow = () => page.evaluate(() => [...document.querySelectorAll("balance-card")].map((c) => c.shadowRoot.textContent));
  ok((await shadow())[0].includes("[TEST~] Solde disponible"), "B1: le texte DANS un Shadow DOM est traduit");
  await page.evaluate(() => window.__addCard()); await wait(900);
  const s2 = await shadow();
  ok(s2.length === 2 && s2[1].includes("[TEST~] Solde disponible") && s2[1].includes("[TEST~] Ce compte est un compte d'épargne."), "B2: une carte ajoutée APRÈS l'activation (et son contenu ajouté dans sa racine) est traduite");
  ok(!s2.some((t) => /\[TEST~\] \[TEST~\]/.test(t)), "B3: pas de double traduction");
  await command(page, { type: "dl/deactivate" }); await wait(200);
  ok((await shadow()).every((t) => !t.includes("[TEST~]")), "B4: restauration exacte dans les Shadow DOM");
  await page.close();
}

// ---------------------------------------------------------------- C. Multilingue
{
  console.log("C. Page multilingue");
  const { page, calls: log } = await openWithExtension(browser, `${srv.url}/mixed-language.html`, { ratio: 1.0 });
  await command(page, { type: "dl/activate", target: "ff" }); await wait(800);
  const by = {}; for (const c of calls(log)) by[c.source] = (by[c.source] ?? []).concat(c.segments.map((s) => s.text));
  ok(!!by.fr && !!by.en, `C1: les segments sont envoyés avec leur langue propre (langues vues : ${Object.keys(by)})`);
  ok((by.en ?? []).every((t) => /received|security|always|recipient/.test(t)) && (by.fr ?? []).every((t) => !/received money|always check/.test(t)), "C2: aucun mélange de langues sources");
  await page.close();
}

// ---------------------------------------------------------------- D. Repères (Highlight API) — aucun style sur les éléments du site
{
  console.log("D. Repères de fiabilité");
  const { page } = await openWithExtension(browser, `${srv.url}/bank-classic.html`, { ratio: 1.0 });
  const before = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).textDecorationLine);
  await command(page, { type: "dl/activate", target: "ff" }); await wait(800);
  const info = await page.evaluate(() => ({
    keys: [...CSS.highlights.keys()], size: CSS.highlights.get("dl-auto")?.size ?? 0,
    deco: getComputedStyle(document.querySelector("h1")).textDecorationLine,
    rules: [...document.adoptedStyleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).concat([...document.querySelectorAll("style[id^=dl-]")].flatMap((s) => [...s.sheet.cssRules].map((r) => r.cssText))),
  }));
  ok(info.keys.includes("dl-auto") && info.size > 5, `D1: les textes automatiques portent un repère (${info.size} plages)`);
  ok(info.deco === before, `D2: le style calculé du texte du site est inchangé (« ${info.deco} »)`);
  ok(info.rules.length > 0 && info.rules.every((r) => r.startsWith("::highlight(")), `D3: la seule règle CSS ajoutée est ::highlight() (${info.rules.length} règles)`);
  await command(page, { type: "dl/deactivate" }); await wait(200);
  ok(await page.evaluate(() => CSS.highlights.size === 0 && document.adoptedStyleSheets.length === 0 && !document.querySelector("style[id^=dl-]")), "D4: repères et feuille retirés à la désactivation");
  await page.close();
}

await browser.close(); srv.close();
console.log(failed ? `\n${failed} VÉRIFICATION(S) EN ÉCHEC (${passed} réussies)` : `\nScénarios dynamiques : ${passed} vérifications réussies.`);
process.exit(failed ? 1 : 0);
