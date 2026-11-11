// VRAI code du service worker (src/background/index.ts : handle, TranslationManager, ApiClient, GlossaryClient + snapshot local de dist/)
// exécuté sous Node avec un `chrome.*` minimal en mémoire. Seules les API du navigateur sont simulées, jamais la logique de l'extension.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let n = 0;

export async function makeRealBackground({ settings, distUrl }) {
  const out = await build({ entryPoints: [resolve(ROOT, "src/background/index.ts")], bundle: true, write: false, format: "esm", platform: "node", loader: { ".css": "text" }, logLevel: "silent" });
  const file = `/tmp/dl-realbg-${process.pid}-${++n}.mjs`;
  writeFileSync(file, out.outputFiles[0].text);
  const store = { settings }, session = {}, listeners = [];
  const noop = { addListener() {} };
  globalThis.chrome = {
    runtime: { id: "real", getURL: (p) => `${distUrl}/${p}`, onMessage: { addListener: (fn) => listeners.push(fn) }, onInstalled: noop },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) },
               session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => Object.assign(session, o), remove: async () => {} }, onChanged: noop },
    contextMenus: { create() {}, onClicked: noop }, tabs: { onRemoved: noop, sendMessage: async () => null },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  await import(file);
  if (listeners.length !== 1) throw new Error("écouteur de messages du service worker introuvable");
  return (msg) => new Promise((res) => listeners[0](msg, { id: "real", tab: { id: 1 } }, res));
}
