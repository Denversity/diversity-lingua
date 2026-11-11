// Interface injectée (panneau, bulle, carte « Comprendre », signalement) : interactions vérifiées + captures RÉELLES.
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./lib/browser.mjs";
import { openWithExtension, command, wait } from "./lib/page.mjs";
import { serve } from "./lib/server.mjs";

const OUT = process.argv[2] ?? "test-results/screenshots";
mkdirSync(OUT, { recursive: true });
const concepts = JSON.parse(readFileSync(resolve("../data/concepts.json"), "utf-8")).concepts;
const fees = concepts.find((c) => c.id === "fees");
const UNAVAIL = (id) => ({ id, status: "unavailable", translation: null, translation_status: "unavailable", reason: "no_validated_translation" });
const feedback = [];
const pin = concepts.find((c) => c.id === "pin");
const bg = async (m) => {
  if (m.type === "dl/explain" && /sécurité|PIN/i.test(m.text))
    return { ok: true, data: { found: true, concept_id: "pin", term: "code pin", explanation_source: pin.definition.fr, explanation_source_reviewed: false, example_source: pin.example.fr, translation: UNAVAIL("explanation"), term_translation: UNAVAIL("t0") } };
  if (m.type === "dl/explain")
    return /frais/i.test(m.text)
      ? { ok: true, data: { found: true, concept_id: "fees", term: "frais de transaction", explanation_source: fees.definition.fr, explanation_source_reviewed: false, example_source: fees.example.fr, translation: UNAVAIL("explanation"), term_translation: UNAVAIL("t0") } }
      : { ok: true, data: { found: false, concept_id: null, term: null, explanation_source: null, explanation_source_reviewed: false, example_source: null, translation: null, term_translation: UNAVAIL("t0") } };
  if (m.type === "dl/feedback") { feedback.push(m.payload); return { ok: true, data: { status: "pending_review" } }; }
  if (m.type === "dl/languages") return { ok: true, data: [{ code: "ff", name: "Fulfulde", availability: "awaiting_validation", approved_targets: 0 }] };
};
const srv = await serve(resolve("tests-browser/fixtures"));
const browser = await launch();
let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("   ✗", m); } };
const sh = (page, fn, ...a) => page.evaluate((src, ...args) => { const r = document.getElementById("dl-root")?.shadowRoot; return new Function("r", "args", `return (${src})(r, ...args)`)(r, args); }, fn.toString(), ...a);
const OPEN = "window.__DL_TEST_OPEN = true;";

const { page } = await openWithExtension(browser, `${srv.url}/bank-classic.html`, { ratio: 1.0, bg, init: OPEN, viewport: { width: 1100, height: 760, deviceScaleFactor: 2 } });
await command(page, { type: "dl/activate", target: "ff" }); await wait(900);
await page.screenshot({ path: `${OUT}/inpage-01-translated.png` });

// --- 1. panneau
ok(await sh(page, (r) => !!r.querySelector(".launcher"), 0), "U1: la puce est présente quand la traduction est active");
await sh(page, (r) => r.querySelector(".launcher").click()); await wait(200);
const panel = await sh(page, (r) => r.querySelector(".panel").textContent);
ok(/Couverture de cette page/.test(panel) && /Revenir à l'original/.test(panel), "U2: le panneau affiche la couverture et « Revenir à l'original »");
ok(!/approved|automatic|pending_validation/.test(panel), "U3: aucun terme technique dans le panneau");
await page.screenshot({ path: `${OUT}/inpage-02-panel.png` });
await sh(page, (r) => r.querySelector(".launcher").click()); await wait(100);

// --- 2. sélection d'un texte DÉJÀ TRADUIT → bulle → carte (qui remonte à l'original)
const select = (sel) => page.evaluate((s) => { const el = document.querySelector(s); const t = el.firstChild; const r = document.createRange(); r.selectNodeContents(t); const g = getSelection(); g.removeAllRanges(); g.addRange(r); document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); }, sel);
const shownNote = await page.$eval(".note", (e) => e.textContent);
ok(shownNote.startsWith("[TEST~] Pour votre sécurité"), "U3b: la phrase de sécurité est bien traduite dans la page");
await select(".note"); await wait(300);
ok(await sh(page, (r) => !r.querySelector(".bubble").hidden), "U4: une bulle « Comprendre » apparaît à la sélection");
await page.screenshot({ path: `${OUT}/inpage-03-bubble.png` });
await sh(page, (r) => r.querySelector(".bubble").click()); await wait(500);
const card = await sh(page, (r) => r.querySelector(".card").textContent);
ok(/Pour votre sécurité/.test(card) && !/\[TEST~\] Pour votre sécurité[^]*Pour votre sécurité[^]*\[TEST~\] Pour/.test(card), "U5: la carte remonte au texte d'ORIGINE");
ok(/Automatique/.test(card) && /Aucun locuteur natif ne l'a encore vérifiée/.test(card), "U6: la fiabilité est expliquée en langage clair (automatique, non vérifiée)");
ok(card.includes(pin.definition.fr.slice(0, 40)) && card.includes(pin.example.fr.slice(0, 30)), "U7: explication simple ET exemple concret affichés");
ok(/en cours de relecture par un expert/.test(card), "U8: l'explication est identifiée comme non encore relue");
ok(/Signaler un problème/.test(card), "U9: le signalement est proposé");
await page.screenshot({ path: `${OUT}/inpage-04-explain.png` });

// --- 3. signalement
await sh(page, (r) => [...r.querySelectorAll(".card button")].find((b) => /Signaler/.test(b.textContent)).click()); await wait(200);
await page.screenshot({ path: `${OUT}/inpage-05-report.png` });
await sh(page, (r) => r.querySelector('.card input[type=radio][value=terminology]').click());
await sh(page, (r) => { const i = r.querySelector('.card input[type=text]'); i.value = "Proposition de l'utilisateur 5000 FCFA"; });
await sh(page, (r) => [...r.querySelectorAll(".card button")].find((b) => /Envoyer/.test(b.textContent)).click()); await wait(400);
ok(feedback.length === 1, "U10: un seul signalement est transmis");
const fb = feedback[0] ?? {};
ok(fb.category === "terminology" && fb.concept_id === "pin" && fb.translation_status === "automatic", `U11: catégorie, concept et statut transmis (${fb.category}/${fb.concept_id}/${fb.translation_status})`);
ok(/^Pour votre sécurité/.test(fb.source_text) && /^\[TEST~\] Pour votre sécurité/.test(fb.shown_translation ?? ""), "U12: texte d'origine ET traduction affichée transmis");
ok(!/\d/.test((fb.suggested_translation ?? "").replace(/\{\{P\d+\}\}/g, "")) && /utilisateur \{\{P0\}\}/.test(fb.suggested_translation ?? ""), `U13: les montants de la proposition sont masqués avant envoi (« ${fb.suggested_translation} »)`);
ok(/Merci/.test(await sh(page, (r) => r.querySelector(".card").textContent)), "U14: confirmation affichée");
await page.screenshot({ path: `${OUT}/inpage-06-thanks.png` });
ok(await sh(page, (r) => /ne change pas la traduction automatiquement/.test(r.querySelector(".card").textContent)), "U15: la confirmation précise qu'aucune traduction n'est modifiée automatiquement");

// --- 3b. contenu préservé : la carte explique pourquoi il ne doit pas être modifié
await page.keyboard.press("Escape"); await wait(100);
await select(".cards .card:nth-child(2) h2"); await wait(300);
await sh(page, (r) => r.querySelector(".bubble").click()); await wait(500);
const keptCard = await sh(page, (r) => r.querySelector(".card").textContent);
ok(/conservé à l'identique/i.test(keptCard) && /Données sensibles à ne pas modifier/i.test(keptCard), "U15b: un texte préservé est expliqué avec le libellé actuel");
await page.screenshot({ path: `${OUT}/inpage-06b-kept.png` });
await sh(page, (r) => r.querySelector(".card button[aria-label='Fermer']").click()); await wait(100);

// --- 4. Échap, terme inconnu, champs
await page.keyboard.press("Escape"); await wait(150);
ok(await sh(page, (r) => r.querySelector(".card").hidden), "U16: Échap ferme la carte");
await select("h1"); await wait(300); await sh(page, (r) => r.querySelector(".bubble").click()); await wait(500);
const unk = await sh(page, (r) => r.querySelector(".card").textContent);
ok(/Pas d'explication disponible/.test(unk) && !/Exemple/.test(unk), "U17: terme inconnu → on le dit, aucune explication inventée");
await sh(page, (r) => r.querySelector(".card button[aria-label='Fermer']").click());
await page.evaluate(() => { const i = document.getElementById("to"); i.focus(); i.select(); document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); }); await wait(300);
ok(await sh(page, (r) => r.querySelector(".bubble").hidden), "U18: aucune bulle pour une sélection dans un champ de saisie (confidentialité)");

// --- 5. mouvement réduit
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); await wait(100);
const dur = await sh(page, (r) => getComputedStyle(r.querySelector(".launcher")).transitionDuration);
ok(parseFloat(dur) < 0.001, `U19: prefers-reduced-motion respecté (durée de transition ${dur})`);
await page.emulateMediaFeatures([]);

// --- 6. restauration : plus aucune trace
await sh(page, (r) => r.querySelector(".launcher").click()); await wait(150);
await sh(page, (r) => [...r.querySelectorAll(".panel button")].find((b) => /Revenir à l'original/.test(b.textContent)).click()); await wait(300);
ok(await page.evaluate(() => !document.getElementById("dl-root") && !document.body.textContent.includes("[TEST~]")), "U20: « Revenir à l'original » depuis le panneau : texte restauré et panneau démonté");
await page.close();

// --- 7. mobile
{
  const m = await openWithExtension(browser, `${srv.url}/mobile-money.html`, { ratio: 1.0, bg, init: OPEN, viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } });
  await command(m.page, { type: "dl/activate", target: "ff" }); await wait(900);
  await sh(m.page, (r) => r.querySelector(".launcher").click()); await wait(200);
  await m.page.screenshot({ path: `${OUT}/inpage-07-mobile-panel.png` });
  const fits = await sh(m.page, (r) => { const p = r.querySelector(".panel").getBoundingClientRect(); return p.left >= 0 && p.right <= innerWidth && p.top >= 0; });
  ok(fits, "U21: sur mobile (390 px) le panneau reste entièrement dans l'écran");
  await m.page.close();
}
await browser.close(); srv.close();
console.log(failed ? `\n${failed} VÉRIFICATION(S) EN ÉCHEC (${passed} réussies)` : `\nInterface injectée : ${passed} vérifications réussies.`);
process.exit(failed ? 1 : 0);
