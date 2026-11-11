import { getSettings, normalizeBaseUrl, saveSettings } from "../shared/settings";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (m: string, ok = true) => { const e = $("msg"); e.textContent = m; e.className = ok ? "ok" : "ko"; };

async function load() {
  const s = await getSettings();
  $<HTMLInputElement>("url").value = s.backendUrl; $<HTMLInputElement>("token").value = s.apiToken;
  $<HTMLSelectElement>("marks").value = s.marks; $<HTMLInputElement>("attrs").checked = s.translateAttributes;
  $<HTMLInputElement>("local").checked = s.useLocalGlossary; $<HTMLInputElement>("badge").checked = s.showBadge;
}
$("save").addEventListener("click", async () => {
  try {
    const url = normalizeBaseUrl($<HTMLInputElement>("url").value);
    const origin = new URL(url).origin + "/*";
    if (!["http://localhost:8000/*", "http://127.0.0.1:8000/*"].includes(origin)) {
      const ok = await chrome.permissions.request({ origins: [origin] }); // permission demandée uniquement pour CE serveur
      if (!ok) return say("Permission refusée pour ce serveur.", false);
    }
    await saveSettings({ backendUrl: url, apiToken: $<HTMLInputElement>("token").value, marks: $<HTMLSelectElement>("marks").value as any,
      translateAttributes: $<HTMLInputElement>("attrs").checked, useLocalGlossary: $<HTMLInputElement>("local").checked, showBadge: $<HTMLInputElement>("badge").checked });
    say("Paramètres enregistrés.");
  } catch (e) { say((e as Error).message, false); }
});
$("test").addEventListener("click", async () => {
  say("Test en cours…");
  const r = await chrome.runtime.sendMessage({ type: "dl/health" }).catch(() => null);
  r?.ok ? say(`Serveur joignable (version ${r.data.version}).`) : say("Serveur injoignable ou refusé.", false);
});
load();
