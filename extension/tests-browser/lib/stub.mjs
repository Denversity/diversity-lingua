// API `chrome.*` SIMULÉE injectée avant le chargement des scripts de l'extension (ce n'est PAS le navigateur qui charge l'extension :
// on exécute les vrais bundles content.js / popup.js dans un vrai moteur de rendu, avec un « faux » service worker côté Node).
export const stubSource = (settings = {}, tabUrl = "https://banque.exemple/") => `(() => {
  const listeners = [];
  const S = ${JSON.stringify({ backendUrl: "http://localhost:8000", targetLang: "ff", marks: "unvalidated", translateAttributes: true, useLocalGlossary: true, showBadge: true, ...settings })};
  window.__dlRuntimeListeners = listeners;
  window.chrome = {
    runtime: { id: "stub", getURL: (p) => p, openOptionsPage() {},
      sendMessage: (m) => window.__dlBg(m),
      onMessage: { addListener: (fn) => listeners.push(fn) } },
    tabs: { query: async () => [{ id: 1, url: ${JSON.stringify(tabUrl)} }], sendMessage: (_id, m) => window.__dlTab(m), reload: async () => {} },
    storage: { local: { get: async () => ({ settings: S }), set: async () => {} }, session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener() {} } },
    i18n: { getUILanguage: () => "fr" },
  };
})();`;

/** Traducteur factice : allonge les textes (ratio) pour simuler un Fulfulde plus long — SANS inventer de langue. Préfixe « [TEST~] ». */
export function pseudoTranslate(text, ratio = 1.0) {
  const base = "[TEST~] " + text;
  if (ratio <= 1) return base;
  const extra = Math.round(text.length * (ratio - 1));
  const pad = "ɓɗŋɲƴ ".repeat(Math.ceil(extra / 6)).slice(0, extra);  // caractères latins étendus : teste aussi le rendu des glyphes
  return base + (extra ? " " + pad.trim() : "");
}
