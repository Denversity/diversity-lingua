// Content script RÉEL (extension/dist/content.js) dans un VRAI Chromium + code RÉEL du service worker (src/background, exécuté sous Node,
// cf. lib/realbg.mjs : seules les API chrome.* sont simulées) + VRAI backend (http://localhost:8000, ressources de data/) + page locale.
// NON couvert : le chargement du paquet par Chrome lui-même (chrome://extensions) — le Chromium disponible en CI/bac à sable est un
// « headless shell » qui ne charge pas les extensions. À vérifier manuellement dans Chrome.
// Prérequis : backend lancé sur le port 8000 (scripts/test_real_extension.sh le fait), CHROME_PATH défini, `npm run build` fait.
// Les traductions attendues sont relues dans l'archive de référence (aucun Fulfulde écrit dans ce fichier).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { openWithExtension, command } from "./lib/page.mjs";
import { makeRealBackground } from "./lib/realbg.mjs";
import { collect, judge } from "./lib/metrics.mjs";
import { serve } from "./lib/server.mjs";
import { wait } from "./lib/page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const MEM = JSON.parse(readFileSync(resolve(HERE, "../../data/references/linguistic-delivery/safinum_translation_memory_v1.json"), "utf-8"));
const mem = (lang, text) => MEM.segments.find((s) => s.source.lang === lang && s.source.text === text).targets[0].preferred;
const BACKEND = process.env.DL_BACKEND || "http://localhost:8000";

let failures = 0, checks = 0;
const ok = (cond, label, detail = "") => { checks++; if (!cond) { failures++; console.log(`  ✗ ${label} ${detail}`); } else console.log(`  ✓ ${label}`); };

const browser = await launch();
const srv = await serve(resolve(HERE, "fixtures"));
const dist = await serve(DIST);
const URL_ = `${srv.url}/real-resources.html`;
let page = null, bgSettings = null;
const openPage = async (settings) => {
  const bg = await makeRealBackground({ settings, distUrl: dist.url });
  const r = await openWithExtension(browser, URL_, { settings, bg, viewport: { width: 1000, height: 800 }, init: () => { window.__DL_TEST_OPEN = true; } }); // shadow root « open » : lecture du panneau par le test
  await wait(300);
  return r.page;
};
const toTab = (msg) => command(page, msg);
const T = (p, id) => p.evaluate((i) => document.getElementById(i).textContent.trim(), id);
async function untilDone(maxMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const st = await toTab({ type: "dl/get-state" }).catch(() => null);
    if (st && ["done", "partial", "error", "unavailable", "empty"].includes(st.phase)) return st;
    if (Date.now() - t0 > maxMs) return st;
    await wait(300);
  }
}

// ---------------------------------------------------------------- A. parcours nominal
console.log("\nA. Parcours nominal (backend joignable)");
page = await openPage({ backendUrl: BACKEND, targetLang: "ff", marks: "unvalidated", useLocalGlossary: true, layoutGuard: true });
const IDS = ["title", "welcome", "b-send", "b-balance", "b-history", "b-count", "l-amt", "l-pin", "warn", "sum-send", "sum-total", "sum-unknown", "b-ok", "b-cancel", "en-send", "en-sum"];
const original = Object.fromEntries(await Promise.all(IDS.map(async (i) => [i, await T(page, i)])));
const before = await page.evaluate(collect);
const inputsBefore = await page.evaluate(() => [...document.querySelectorAll("input")].map((e) => [e.value, e.placeholder]));

await toTab({ type: "dl/activate", target: "ff" });
const st = await untilDone();
console.log("  état final :", JSON.stringify(st));
ok(st && ["done", "partial"].includes(st.phase), "traduction terminée (phase done/partial)", JSON.stringify(st?.phase));

const exp = {
  title: mem("fr", "Choisissez une opération"), "b-send": mem("fr", "Envoyer de l'argent"), "b-balance": mem("fr", "Consulter mon solde"),
  "b-history": mem("fr", "Historique des transactions"), "b-count": mem("fr", "Continuer"), "l-amt": mem("fr", "Entrez le montant à envoyer."),
  "l-pin": mem("fr", "Entrez votre code PIN"), warn: mem("fr", "Ne partagez jamais votre code PIN."), "b-ok": mem("fr", "Confirmer"),
  "b-cancel": mem("fr", "Annuler"), "en-send": mem("en", "Send money"),
};
for (const [id, want] of Object.entries(exp)) { const got = await T(page, id); ok(got === want, `#${id} = traduction validée de l'expert`, `obtenu « ${got} »`); }

const sumSend = await T(page, "sum-send");
const wantSend = mem("fr", "Vous allez envoyer {{P0}} FCFA à {{P1}}.").replace("{{P0}}", "5 000").replace("{{P1}}", "677 12 34 56");
ok(sumSend === wantSend, "phrase à variables : montant et numéro restitués, texte de l'expert", `obtenu « ${sumSend} »`);
ok((sumSend.match(/FCFA/g) || []).length === 1, "devise non dupliquée");
const wel = await T(page, "welcome");
ok(wel === mem("fr", "Bienvenue, {{P0}}").replace("{{P0}}", "Amina"), "nom propre conservé dans la phrase d'accueil", `obtenu « ${wel} »`);
const enSum = await T(page, "en-sum");
ok(enSum === mem("en", "You are about to send {{P0}} FCFA to {{P1}}.").replace("{{P0}}", "12,500").replace("{{P1}}", "677123456"), "anglais : montant et numéro restitués", `obtenu « ${enSum} »`);

ok((await T(page, "sum-unknown")) === original["sum-unknown"], "texte inconnu : laissé en français (aucune invention)");
ok((await T(page, "sum-total")).includes("5 150 FCFA"), "montant du total débité conservé", `obtenu « ${await T(page, "sum-total")} »`);
const inputsAfter = await page.evaluate(() => [...document.querySelectorAll("input")].map((e) => [e.value, e.placeholder]));
ok(inputsAfter[0][0] === "5000" && inputsAfter[1][0] === "4821", "valeurs saisies (montant, PIN) intactes");
console.log(`  (placeholder avant « ${inputsBefore[0][1]} » → après « ${inputsAfter[0][1]} »)`);

// panneau / badge dans la page
const panel = await page.evaluate(() => { const r = document.getElementById("dl-root")?.shadowRoot; return r ? [...r.querySelectorAll("*:not(style):not(script)")].filter((e) => !e.children.length).map((e) => e.textContent.trim()).filter(Boolean).join(" | ") : null; });
ok(panel && panel.length > 0, "interface injectée présente (Shadow DOM isolé)");
ok(Number((/(\d+)\s+textes?\s+traduits?/i.exec(panel || "") || [])[1]) === st.counts.validated + st.counts.machine_unvalidated, "badge de la page : nombre de textes traduits = état interne", panel);
console.log("  texte du panneau :", (panel || "").slice(0, 260));

// préservation du DOM, du style et des événements
const after = await page.evaluate(collect);
const j = judge(before, after);
console.log("  jugement mise en page :", JSON.stringify({ structure: j.structure, styleChanges: j.styleChanges, attrChanges: j.attrChanges, newClip: j.newClip.length, controlWrap: j.controlWrap.length, docOverflow: j.docOverflow, inputsChanged: j.inputsChanged }));
ok(j.structure, "structure DOM identique (même nombre d'éléments)");
ok(j.styleChanges === 0, "styles calculés identiques (couleurs, polices, marges…)", String(j.styleChanges));
ok(j.newClip.length === 0 && j.controlWrap.length === 0 && !j.docOverflow, "aucun texte tronqué, bouton déformé ou débordement de page");
await page.click("#b-count"); await page.click("#b-count");
ok((await page.evaluate(() => document.body.dataset.clicks)) === "2", "événements (onclick) conservés après traduction");

// pas de double traduction
const snapshot = Object.fromEntries(await Promise.all(IDS.map(async (i) => [i, await T(page, i)])));
await toTab({ type: "dl/activate", target: "ff" }); await untilDone(); await wait(1500);
const again = Object.fromEntries(await Promise.all(IDS.map(async (i) => [i, await T(page, i)])));
ok(JSON.stringify(again) === JSON.stringify(snapshot), "ré-activation : aucune double traduction");

// contenu dynamique
await page.evaluate((t) => { const d = document.createElement("div"); d.className = "toast"; d.id = "toast1"; d.textContent = t; document.getElementById("notifications").appendChild(d); }, "Transaction réussie.");
await wait(3500);
ok((await T(page, "toast1")) === mem("fr", "Transaction réussie."), "notification injectée dynamiquement traduite", `obtenu « ${await T(page, "toast1")} »`);
await page.evaluate((t) => { const d = document.createElement("div"); d.className = "toast"; d.id = "toast2"; d.textContent = t; document.getElementById("notifications").appendChild(d); }, "Votre retrait de 20 000 FCFA a été effectué.");
await wait(3500);
const t2 = await T(page, "toast2");
ok(t2 === mem("fr", "Votre retrait de {{P0}} FCFA a été effectué.").replace("{{P0}} FCFA", "20 000 FCFA").replace("{{P0}}", "20 000 FCFA"), "notification dynamique à montant traduite, montant intact", `obtenu « ${t2} »`);

// restauration
await toTab({ type: "dl/deactivate" }); await wait(1200);
const restored = Object.fromEntries(await Promise.all(IDS.map(async (i) => [i, await T(page, i)])));
ok(JSON.stringify(restored) === JSON.stringify(original), "désactivation : tous les textes d'origine restaurés");
await page.click("#b-count");
ok((await page.evaluate(() => document.body.dataset.clicks)) === "3", "événements conservés après restauration");
await page.evaluate(() => document.querySelectorAll(".toast").forEach((e) => e.remove())); // notifications ajoutées par le test lui-même
const restoredLayout = judge(before, await page.evaluate(collect));
ok(restoredLayout.structure && restoredLayout.styleChanges === 0 && restoredLayout.attrChanges === 0, "DOM, styles et attributs identiques à l'original après restauration", JSON.stringify(restoredLayout));
await page.close();

// ---------------------------------------------------------------- B. backend injoignable
console.log("\nB. Erreur réseau (backend injoignable)");
page = await openPage({ backendUrl: "http://localhost:9", targetLang: "ff", marks: "unvalidated", useLocalGlossary: true, layoutGuard: true });
await toTab({ type: "dl/activate", target: "ff" });
const stB = await untilDone(45000);
console.log("  état final :", JSON.stringify(stB));
ok(stB && ["error", "partial", "done"].includes(stB.phase), "l'extension ne plante pas et signale un état", JSON.stringify(stB?.phase));
ok((await T(page, "sum-unknown")) === original["sum-unknown"], "texte non couvert localement : laissé en français");
ok((await T(page, "sum-send")) === original["sum-send"], "phrase à variables hors ligne : laissée en français (gabarit réservé au serveur)");
const offline = await T(page, "b-cancel");
console.log(`  hors ligne, « Annuler » → « ${offline} » (glossaire local : ${offline === exp["b-cancel"] ? "traduit, validé" : "non traduit"})`);
ok(offline === original["b-cancel"] || offline === exp["b-cancel"], "hors ligne : soit original, soit traduction VALIDÉE — jamais autre chose");
ok(!(await page.evaluate(() => document.body.innerText)).includes("[TEST"), "aucune sortie factice");
await toTab({ type: "dl/deactivate" }); await wait(800);
ok((await T(page, "b-cancel")) === original["b-cancel"], "restauration après erreur réseau");
await page.close();

srv.close(); dist.close(); await browser.close();
console.log(`\nExtension réelle : ${checks - failures}/${checks} vérifications réussies.`);
process.exit(failures ? 1 : 0);
