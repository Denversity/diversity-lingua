import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stubSource, pseudoTranslate } from "./stub.mjs";

/** Ouvre une page, installe l'API chrome simulée et charge le VRAI bundle content.js. `bg(msg)` simule le service worker. */
export async function openWithExtension(browser, url, { ratio = 1.0, settings = {}, bg, viewport, init } = {}) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  const calls = [];
  await page.exposeFunction("__dlBg", async (m) => {
    calls.push(m);
    if (bg) { const r = await bg(m); if (r !== undefined) return r; }
    if (m.type === "dl/translate") return { ok: true, data: m.segments.map((s) => ({ id: s.id, status: "machine_unvalidated", translation_status: "automatic", translation: pseudoTranslate(s.text, ratio), test_data: true })) };
    if (m.type === "dl/hello") return { ok: true, data: { active: false, target: null } };
    return { ok: true, data: null };
  });
  await page.exposeFunction("__dlTab", async () => null);
  await page.evaluateOnNewDocument(stubSource(settings));
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(url, { waitUntil: "load" });
  await page.addScriptTag({ content: readFileSync(resolve("dist/content.js"), "utf-8") });
  await new Promise((r) => setTimeout(r, 150));
  return { page, calls };
}

/** Envoie une commande au content script comme le ferait le popup. */
export const command = (page, msg) => page.evaluate((m) => new Promise((res) => {
  let answered = false;
  for (const fn of window.__dlRuntimeListeners) fn(m, { id: "stub" }, (r) => { answered = true; res(r); });
  setTimeout(() => !answered && res(null), 4000);
}), msg);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
