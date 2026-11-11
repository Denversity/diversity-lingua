// Construit extension/dist (chargeable via chrome://extensions → « Charger l'extension non empaquetée »).
// Variables : DL_MATCHES="https://*.example.cm/*,http://localhost/*" restreint les pages où le script est injecté
//             DL_API_ORIGINS="https://api.exemple.cm/*" ajoute des permissions d'hôte pour le backend
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
const common = { bundle: true, format: "iife", target: "chrome110", sourcemap: false, minify: false, logLevel: "info", loader: { ".css": "text" } };
await build({ ...common, entryPoints: { background: "src/background/index.ts", content: "src/content/index.ts", popup: "src/popup/popup.ts", options: "src/options/options.ts" }, outdir: "dist" });
cpSync("public", "dist", { recursive: true });
// CSS : un seul design system (jetons + composants) assemblé pour les pages de l'extension ; le panneau injecté l'embarque dans son Shadow DOM.
const css = (...f) => f.map((x) => readFileSync(`src/ui/${x}`, "utf-8")).join("\n");
writeFileSync("dist/popup.css", css("tokens.css", "components.css", "popup.css"));
writeFileSync("dist/options.css", css("tokens.css", "components.css", "options.css"));
const m = JSON.parse(readFileSync("manifest.template.json", "utf-8"));
const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
if (process.env.DL_MATCHES) m.content_scripts[0].matches = split(process.env.DL_MATCHES);
if (process.env.DL_API_ORIGINS) m.host_permissions.push(...split(process.env.DL_API_ORIGINS));
writeFileSync("dist/manifest.json", JSON.stringify(m, null, 2));
console.log("OK → dist/ ; glossaire local :", existsSync("dist/glossary") ? "présent" : "absent");
