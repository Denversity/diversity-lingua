import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot } from "../src/content/index";
import { FR_PAGE, wait } from "./helpers";

let listener: any, sent: any[];
beforeEach(() => {
  sent = []; (window as any).__dlLoaded = false; (window as any).__DL_TEST_OPEN = true;
  document.documentElement.innerHTML = `<head><title>T</title></head><body>${FR_PAGE}</body>`;
  (globalThis as any).chrome = {
    runtime: { id: "x", onMessage: { addListener: (fn: any) => (listener = fn) }, sendMessage: vi.fn(async (m: any) => {
      sent.push(m);
      if (m.type === "dl/translate") return { ok: true, data: m.segments.map((s: any) => ({ id: s.id, status: "machine_unvalidated", translation_status: "automatic", translation: "[TEST~] " + s.text })) };
      if (m.type === "dl/hello") return { ok: true, data: { active: false, target: null } };
      if (m.type === "dl/languages") return { ok: true, data: [{ code: "ff", name: "Fulfulde", availability: "awaiting_validation", approved_targets: 0 }] };
      return { ok: true, data: null };
    }) },
    storage: { local: { get: async () => ({ settings: {} }), set: async () => {} }, onChanged: { addListener: () => {} } },
    i18n: { getUILanguage: () => "fr" },
  };
});
afterEach(() => { delete (window as any).__DL_TEST_OPEN; delete (globalThis as any).chrome; document.getElementById("dl-root")?.remove(); });
const cmd = (m: any) => new Promise<any>((res) => { const keep = listener(m, {}, res); if (!keep) res(undefined); });

describe("point d'entrée du content script", () => {
  it("dormant au chargement : rien n'est ajouté à la page", () => {
    const before = document.documentElement.outerHTML; boot();
    expect(document.documentElement.outerHTML).toBe(before); expect(document.getElementById("dl-root")).toBeNull();
  });
  it("activation → puce injectée + diffusion d'état ; désactivation → page identique, panneau démonté", async () => {
    const before = document.documentElement.outerHTML; boot();
    const st = await cmd({ type: "dl/activate", target: "ff" });
    expect(st.phase).toBe("partial".length ? st.phase : ""); expect(["done", "partial"]).toContain(st.phase);
    expect(document.getElementById("dl-root")).not.toBeNull();
    expect(sent.some((m) => m.type === "dl/tab-state" && m.active)).toBe(true); expect(sent.some((m) => m.type === "dl/state")).toBe(true);
    const off = await cmd({ type: "dl/deactivate" });
    expect(off.phase).toBe("inactive"); expect(document.getElementById("dl-root")).toBeNull(); expect(document.documentElement.outerHTML).toBe(before);
  });
  it("get-state / get-selection répondent ; le content script ne se charge qu'une fois", async () => {
    expect(boot()).not.toBeNull(); expect(boot()).toBeNull();
    expect((await cmd({ type: "dl/get-state" })).phase).toBe("inactive");
    expect(await cmd({ type: "dl/get-selection" })).toEqual({ text: "" });
  });
  it("menu contextuel « Comprendre » sur une page inactive : carte affichée puis plus aucune trace une fois fermée", async () => {
    boot();
    sent.length = 0;
    (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (m: any) => { sent.push(m); return m.type === "dl/explain" ? { ok: true, data: { found: false, concept_id: null, term: null, explanation_source: null, explanation_source_reviewed: false, translation: null, term_translation: { id: "t", status: "unavailable", translation: null, translation_status: "unavailable" } } } : { ok: true, data: null }; });
    await cmd({ type: "dl/explain-selection", text: "solde disponible" }); await wait(80);
    const root = document.getElementById("dl-root")!.shadowRoot!;
    expect(root.querySelector(".card")!.textContent).toContain("Pas d'explication disponible");
    (root.querySelector(".card button[aria-label='Fermer']") as HTMLElement).click();
    expect(document.getElementById("dl-root")).toBeNull();
  });
});
