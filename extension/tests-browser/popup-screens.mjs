// Rend le VRAI popup.js dans Chromium pour chaque état et enregistre une capture.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./lib/browser.mjs";
import { stubSource } from "./lib/stub.mjs";
import { STATES, LANGS } from "./lib/states.mjs";

const out = process.argv[2] ?? "test-results/screenshots";
mkdirSync(out, { recursive: true });
const only = process.argv[3]?.split(",");
const browser = await launch();
const jobs = [
  ["popup-01-idle", "idle_detected", "ff"], ["popup-02-detecting", "detecting", "ff"], ["popup-03-translating", "translating", "ff"],
  ["popup-04-done", "done_auto", "ff"], ["popup-05-partial", "partial", "ff"], ["popup-06-unavailable", "unavailable", "ff"],
  ["popup-07-error", "error", "ff"], ["popup-08-empty", "empty", "ff"], ["popup-09-unsupported", "unsupported", "ff"],
  ["popup-10-verified", "done_verified", "test"], ["popup-11-unreachable-reload", null, "ff"], ["popup-12-unreachable-protected", null, "ff", "chrome://extensions/"],
];
for (const [name, st, langs, url] of jobs) {
  if (only && !only.includes(name)) continue;
  const page = await browser.newPage(); await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 });
  await page.exposeFunction("__dlBg", async (m) => m.type === "dl/languages" ? { ok: true, data: LANGS[langs] } : { ok: true, data: null });
  await page.exposeFunction("__dlTab", async (m) => { if (!st) throw new Error("injoignable"); return m.type === "dl/get-selection" ? { text: "" } : STATES[st]; });
  await page.evaluateOnNewDocument(stubSource({ targetLang: LANGS[langs][0].code }, url ?? "https://banque.exemple/"));
  await page.goto("file://" + resolve("dist/popup.html")); await new Promise((r) => setTimeout(r, 500));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewport({ width: 360, height: Math.max(h, 200), deviceScaleFactor: 2 });
  await page.screenshot({ path: `${out}/${name}.png` }); await page.close();
}
await browser.close(); console.log("ok");
