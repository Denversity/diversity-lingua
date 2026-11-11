"use strict";
(() => {
  // src/shared/settings.ts
  var DEFAULT_SETTINGS = {
    backendUrl: "http://localhost:8000",
    apiToken: "",
    targetLang: "ff",
    marks: "unvalidated",
    translateAttributes: true,
    useLocalGlossary: true,
    showBadge: true,
    panelSide: "right",
    layoutGuard: true
  };
  function normalizeBaseUrl(raw) {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("URL http(s) requise");
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol === "http:" && !local) throw new Error("HTTPS obligatoire hors localhost");
    return u.origin + u.pathname.replace(/\/+$/, "");
  }
  function sanitizeSettings(input) {
    const s = { ...DEFAULT_SETTINGS, ...input };
    try {
      s.backendUrl = normalizeBaseUrl(s.backendUrl);
    } catch {
      s.backendUrl = DEFAULT_SETTINGS.backendUrl;
    }
    if (!["unvalidated", "all", "none"].includes(s.marks)) s.marks = "unvalidated";
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(s.targetLang)) s.targetLang = DEFAULT_SETTINGS.targetLang;
    s.layoutGuard = s.layoutGuard !== false;
    if (s.panelSide !== "left" && s.panelSide !== "right") s.panelSide = "right";
    s.apiToken = String(s.apiToken ?? "").trim();
    return s;
  }
  async function getSettings() {
    const raw = await chrome.storage.local.get("settings");
    return sanitizeSettings(raw.settings ?? {});
  }
  async function saveSettings(patch) {
    const next = sanitizeSettings({ ...await getSettings(), ...patch });
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  // src/options/options.ts
  var $ = (id) => document.getElementById(id);
  var say = (m, ok = true) => {
    const e = $("msg");
    e.textContent = m;
    e.className = ok ? "ok" : "ko";
  };
  async function load() {
    const s = await getSettings();
    $("url").value = s.backendUrl;
    $("token").value = s.apiToken;
    $("marks").value = s.marks;
    $("attrs").checked = s.translateAttributes;
    $("local").checked = s.useLocalGlossary;
    $("badge").checked = s.showBadge;
  }
  $("save").addEventListener("click", async () => {
    try {
      const url = normalizeBaseUrl($("url").value);
      const origin = new URL(url).origin + "/*";
      if (!["http://localhost:8000/*", "http://127.0.0.1:8000/*"].includes(origin)) {
        const ok = await chrome.permissions.request({ origins: [origin] });
        if (!ok) return say("Permission refus\xE9e pour ce serveur.", false);
      }
      await saveSettings({
        backendUrl: url,
        apiToken: $("token").value,
        marks: $("marks").value,
        translateAttributes: $("attrs").checked,
        useLocalGlossary: $("local").checked,
        showBadge: $("badge").checked
      });
      say("Param\xE8tres enregistr\xE9s.");
    } catch (e) {
      say(e.message, false);
    }
  });
  $("test").addEventListener("click", async () => {
    say("Test en cours\u2026");
    const r = await chrome.runtime.sendMessage({ type: "dl/health" }).catch(() => null);
    r?.ok ? say(`Serveur joignable (version ${r.data.version}).`) : say("Serveur injoignable ou refus\xE9.", false);
  });
  load();
})();
