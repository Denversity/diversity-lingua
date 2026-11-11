// Non-régression visuelle dans un VRAI Chromium : 5 pages de structures différentes × 3 allongements × garde activée/désactivée.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./lib/browser.mjs";
import { openWithExtension, command, wait } from "./lib/page.mjs";
import { collect, judge } from "./lib/metrics.mjs";
import { serve } from "./lib/server.mjs";

const SHOTS = process.argv[2] ?? process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PAGES = [
  ["bank-classic", { width: 1100, height: 760 }], ["spa-app", { width: 1100, height: 700 }], ["webcomponents", { width: 900, height: 500 }],
  ["mixed-language", { width: 900, height: 600 }], ["mobile-money", { width: 390, height: 844 }],
];
const RATIOS = [1.0, 1.6, 2.4];
const srv = await serve(resolve("tests-browser/fixtures"));
const browser = await launch();
const rows = []; let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.log("   ✗", msg); } };

for (const [name, vp] of PAGES) {
  for (const ratio of RATIOS) {
    for (const guard of [true, false]) {
      const { page } = await openWithExtension(browser, `${srv.url}/${name}.html`, { ratio, settings: { layoutGuard: guard }, viewport: { ...vp, deviceScaleFactor: 1 } });
      await wait(name === "spa-app" ? 700 : 100);
      const before = await page.evaluate(collect);
      const htmlBefore = await page.evaluate(() => document.documentElement.outerHTML);
      if (SHOTS && name === "bank-classic" && ratio === 1.6) await page.screenshot({ path: `${SHOTS}/preservation-before.png` });
      await command(page, { type: "dl/activate", target: "ff" });
      await wait(900);
      const state = await command(page, { type: "dl/get-state" });
      const after = await page.evaluate(collect);
      if (SHOTS && name === "bank-classic" && ratio === 1.6) await page.screenshot({ path: `${SHOTS}/preservation-after-guard-${guard ? "on" : "off"}.png` });
      const v = name === "spa-app" ? null : judge(before, after);
      if (v) {
        rows.push({ page: name, ratio, guard, translated: state.coverage.verified + state.coverage.unverified, keptLayout: state.reasons.layout ?? 0, ruptures: v.ruptures, newClip: v.newClip.length, controlWrap: v.controlWrap.length, docOverflow: v.docOverflow });
        if (guard) {
          const tag = `${name} ×${ratio}`;
          check(v.structure, `${tag}: la structure du DOM a changé`);
          check(v.styleChanges === 0, `${tag}: ${v.styleChanges} styles calculés modifiés`);
          check(v.attrChanges === 0, `${tag}: ${v.attrChanges} éléments avec attributs modifiés`);
          check(v.ruptures === 0, `${tag}: ruptures de mise en page → clip=${v.newClip.join(",")} wrap=${v.controlWrap.join(",")} page=${v.docOverflow}`);
          check(!v.inputsChanged, `${tag}: valeurs de champs modifiées`);
          check(after.adopted <= before.adopted + 1 && v.headDelta <= 1, `${tag}: ajout inattendu de feuille de style/élément <head> (head ${v.headDelta}, adopted ${after.adopted - before.adopted})`);
          check(state.coverage.verified + state.coverage.unverified > 0, `${tag}: rien n'a été traduit`);
        }
      }
      // Restauration : DOM identique à l'octet près (pages statiques) et aucun résidu
      await command(page, { type: "dl/deactivate" }); await wait(150);
      const restored = await page.evaluate(() => ({ html: document.documentElement.outerHTML, host: !!document.getElementById("dl-root"), adopted: (document.adoptedStyleSheets || []).length, hl: window.CSS?.highlights ? [...CSS.highlights.keys()] : [], residue: document.body.textContent.includes("[TEST~]") }));
      if (guard) {
        const tag = `${name} ×${ratio} (restauration)`;
        if (name !== "spa-app") check(restored.html === htmlBefore, `${tag}: le DOM restauré diffère de l'original`);
        check(!restored.host, `${tag}: panneau Diversity Lingua encore présent`);
        check(restored.hl.length === 0, `${tag}: highlights résiduels ${restored.hl}`);
        check(!restored.residue, `${tag}: texte traduit résiduel`);
        check(restored.adopted === before.adopted, `${tag}: feuilles de style adoptées résiduelles`);
      }
      await page.close();
    }
  }
}
await browser.close(); srv.close();
console.table(rows.map((r) => ({ page: r.page, "allongement": "×" + r.ratio, garde: r.guard ? "ON" : "off", "traduits": r.translated, "conservés (mise en page)": r.keptLayout, "ruptures": r.ruptures, "tronqués": r.newClip, "boutons déformés": r.controlWrap, "débord page": r.docOverflow ? "oui" : "non" })));
if (process.env.JSON_OUT) writeFileSync(process.env.JSON_OUT, JSON.stringify(rows, null, 1));
console.log(failed ? `\n${failed} VÉRIFICATION(S) EN ÉCHEC` : "\nPréservation : toutes les vérifications (garde ON) sont satisfaites.");
process.exit(failed ? 1 : 0);
