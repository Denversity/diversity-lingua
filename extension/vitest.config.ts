import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
// Les fichiers .css importés par le code sont chargés comme TEXTE (comme le fait esbuild avec loader « text »).
const cssAsText = { name: "css-as-text", enforce: "pre" as const, transform(_: string, id: string) { if (id.endsWith(".css")) return `export default ${JSON.stringify(readFileSync(id, "utf-8"))};`; } };
export default defineConfig({ plugins: [cssAsText], test: { environment: "jsdom", include: ["tests/**/*.test.ts"], globals: true } });
