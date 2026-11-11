// SONDE DE COUVERTURE sur n'importe quelle page/application : content script RÉEL (dist) dans Chromium + code RÉEL du service worker
// (lib/realbg.mjs) + backend RÉEL. Pour chaque étape d'un scénario (clics), mesure : textes traduits / non traduits (liste), montants et
// nombres conservés, ruptures de mise en page. Ne modifie jamais la page testée.
// Usage : CHROME_PATH=... node tests-browser/probe-site.mjs <url | scenario.json> [--backend http://localhost:8000] [--json rapport.json]
//   scenario.json : {"steps":[{"label":"…","clicks":[["css"],…],"waitMs":500}], "dir":"dossier local","page":"index.html"} ou {"url":"https://…","steps":[…]}
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { openWithExtension, command, wait } from "./lib/page.mjs";
import { collect, judge } from "./lib/metrics.mjs";
import { serve } from "./lib/server.mjs";
import { makeRealBackground } from "./lib/realbg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const target = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--backend" && args[args.indexOf(a) - 1] !== "--json");
if (!target) { console.error("Usage : node tests-browser/probe-site.mjs <url | scenario.json> [--backend URL] [--json fichier]"); process.exit(2); }
const BACKEND = opt("--backend", "http://localhost:8000");

let scenario, srv = null;
if (target.endsWith(".json")) {
  scenario = JSON.parse(readFileSync(resolve(target), "utf-8"));
  if (scenario.dir) { srv = await serve(resolve(dirname(resolve(target)), scenario.dir)); scenario.url = `${srv.url}/${scenario.page || "index.html"}`; }
} else scenario = { url: target, steps: [{ label: "page" }] };

const dist = await serve(resolve(HERE, "../dist"));
const browser = await launch();
const settings = { backendUrl: BACKEND, targetLang: "ff", marks: "unvalidated", useLocalGlossary: true, layoutGuard: true };
const textNodes = () => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentElement; if (!p || p.closest("#dl-root,script,style,noscript")) continue;
    const t = n.nodeValue.replace(/\s+/g, " ").trim(); if (!t) continue;
    out.push({ t, vis: p.getClientRects().length > 0 && getComputedStyle(p).visibility !== "hidden" });
  }
  return out;
};
const digits = (s) => (s.match(/\d[\d\s.,]*\d|\d/g) || []).map((x) => x.replace(/\D/g, "")).filter(Boolean);
const rows = [], gaps = new Map();
for (const step of scenario.steps) {
  const bg = await makeRealBackground({ settings, distUrl: dist.url });
  const { page } = await openWithExtension(browser, scenario.url, { settings, bg, viewport: { width: 1100, height: 800 }, init: () => { window.__DL_TEST_OPEN = true; } });
  await wait(500);
  for (const c of step.clicks || []) { await page.click(c[0]).catch(() => {}); await wait(step.waitMs ?? 400); }
  const before = await page.evaluate(textNodes), lay0 = await page.evaluate(collect);
  await command(page, { type: "dl/activate", target: "ff" });
  let st = null;
  for (let i = 0; i < 100; i++) { st = await command(page, { type: "dl/get-state" }); if (st && ["done", "partial", "error", "unavailable", "empty"].includes(st.phase)) break; await wait(300); }
  await wait(600);
  const after = await page.evaluate(textNodes), lay1 = await page.evaluate(collect);
  const j = judge(lay0, lay1);
  const vis = before.map((b, i) => ({ b, a: after[i] })).filter((x) => x.b.vis && x.a && /\p{L}{2,}/u.test(x.b.t));
  const changed = vis.filter((x) => x.a.t !== x.b.t), kept = vis.filter((x) => x.a.t === x.b.t);
  const numLost = changed.filter((x) => digits(x.b.t).join() !== digits(x.a.t).join()).map((x) => x.b.t);
  kept.forEach((x) => gaps.set(x.b.t, (gaps.get(x.b.t) || 0) + 1));
  rows.push({ étape: step.label, phase: st?.phase, "langue détectée": st?.detectedLang, visibles: vis.length, traduits: changed.length, "non traduits": kept.length,
    "nombres altérés": numLost.length, ruptures: (j.styleChanges || 0) + (j.newClip?.length || 0) + (j.controlWrap?.length || 0) + (j.docOverflow ? 1 : 0) + (j.structure ? 0 : 1), _numLost: numLost });
  await page.close();
}
console.table(rows.map(({ _numLost, ...r }) => r));
const g = [...gaps.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nTextes visibles NON traduits (${g.length} distincts) — absents des ressources validées, laissés dans la langue d'origine :`);
for (const [t, n] of g) console.log(`  ${n > 1 ? `×${n} ` : ""}${t}`);
const lost = rows.flatMap((r) => r._numLost.map((t) => `${r.étape} : ${t}`));
if (lost.length) console.log("\n⚠ Nombres altérés :", lost);
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ rows: rows.map(({ _numLost, ...r }) => r), nonTraduits: g }, null, 1));
srv?.close(); dist.close(); await browser.close();
process.exit(lost.length || rows.some((r) => r.ruptures) ? 1 : 0);
