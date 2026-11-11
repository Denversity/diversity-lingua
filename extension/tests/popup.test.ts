/** Interactions du popup : chrome.* simulé, vrai popup.ts exécuté dans jsdom. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATES, LANGS } from "../tests-browser/lib/states.mjs";

type Mode = { state: any | null; url: string; langs: any[]; explain?: any };
let mode: Mode, sent: any[], tabMsgs: any[], reloaded: number, stored: any;

function installChrome() {
  sent = []; tabMsgs = []; reloaded = 0; stored = {};
  (globalThis as any).chrome = {
    runtime: { id: "x", openOptionsPage: vi.fn(), onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(async (m: any) => {
        sent.push(m);
        if (m.type === "dl/languages") return { ok: true, data: mode.langs };
        if (m.type === "dl/explain") return mode.explain ?? { ok: false, code: "network", error: "" };
        if (m.type === "dl/feedback") return { ok: true, data: { status: "pending_review" } };
        return { ok: true, data: null };
      }) },
    tabs: { query: vi.fn(async () => [{ id: 7, url: mode.url }]), reload: vi.fn(async () => { reloaded++; }),
      sendMessage: vi.fn(async (_id: number, m: any) => { tabMsgs.push(m); if (mode.state === null) throw new Error("no receiver"); if (m.type === "dl/get-selection") return { text: "" }; return mode.state; }) },
    storage: { local: { get: vi.fn(async () => ({ settings: stored })), set: vi.fn(async (o: any) => { stored = o.settings ?? stored; }) }, onChanged: { addListener: vi.fn() } },
    i18n: { getUILanguage: () => "fr" },
  };
}
async function open(m: Partial<Mode>) {
  mode = { state: STATES.idle_detected, url: "https://banque.exemple/", langs: LANGS.ff, ...m };
  installChrome(); (window as any).close = vi.fn(); vi.resetModules(); document.body.innerHTML = '<div id="app"></div>';
  await import("../src/popup/popup");
  await vi.advanceTimersByTimeAsync(60);
}
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const text = () => document.body.textContent!;
const btn = (re: RegExp) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent!)) as HTMLButtonElement;

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true })); afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("popup — parcours « Activer → Comprendre → Utiliser »", () => {
  it("état initial : langue détectée, langue cible, action unique « Traduire cette page »", async () => {
    await open({});
    expect($("#src").textContent).toBe("français"); expect(($("#lang") as HTMLSelectElement).value).toBe("ff");
    expect(text()).toContain("Prête à traduire cette page"); expect(text()).toContain("Référentiel linguistique en préparation");
    expect(btn(/Traduire cette page/)).toBeTruthy(); expect(btn(/Revenir/)).toBeUndefined();
  });
  it("clic → commande d'activation envoyée à l'onglet avec la langue cible, retour visuel immédiat", async () => {
    await open({});
    btn(/Traduire cette page/).click(); await vi.advanceTimersByTimeAsync(30);
    expect(tabMsgs.find((m) => m.type === "dl/activate")).toEqual({ type: "dl/activate", target: "ff" });
  });
  it("traduction en cours : progression accessible ; terminée : couverture chiffrée et « Revenir à l'original »", async () => {
    await open({ state: STATES.translating });
    const pb = $("[role=progressbar]"); expect(pb.getAttribute("aria-valuenow")).toBe("60");
    mode.state = STATES.done_auto; await vi.advanceTimersByTimeAsync(900);
    expect(text()).toContain("Page traduite"); expect([...document.querySelectorAll(".dl-legend b")].map((b) => b.textContent)).toEqual(["0", "74", "0"]);
    expect(text()).toContain("Traduits automatiquement, pas encore vérifiés");
    btn(/Revenir à l'original/).click(); await vi.advanceTimersByTimeAsync(30);
    expect(tabMsgs.some((m) => m.type === "dl/deactivate")).toBe(true);
  });
  it("traduction partielle : raisons en langage clair dans un volet repliable ; avis « mise en page »", async () => {
    await open({ state: STATES.partial });
    expect(text()).toContain("Page traduite en partie"); expect($(".reasons-wrap")).toBeTruthy();
    expect(text()).toContain("Contenu d'origine préservé"); expect(text()).not.toContain("Pas encore de traduction disponible");
    expect(text()).toContain("4 éléments sont conservés : données sensibles à ne pas modifier ou mise en page protégée.");
  });
  it("erreur de connexion : message clair, « Réessayer », page non modifiée, pas de jauge", async () => {
    await open({ state: STATES.error });
    expect(text()).toContain("Connexion impossible"); expect(text()).toContain("Votre page n'a pas été modifiée"); expect($(".dl-coverage")).toBeNull();
    btn(/Réessayer/).click(); await vi.advanceTimersByTimeAsync(30); expect(tabMsgs.some((m) => m.type === "dl/activate")).toBe(true);
  });
  it("aucun contenu / langue non prise en charge / rien de traduit", async () => {
    await open({ state: STATES.empty }); expect(text()).toContain("Rien à traduire ici");
    await open({ state: STATES.unsupported }); expect(text()).toContain("Langue de la page non prise en charge");
    await open({ state: STATES.unavailable }); expect(text()).toContain("Contenus préservés");
    expect(text()).not.toMatch(/traduction disponible/i);
  });
  it("page ouverte avant l'installation → « Recharger la page » ; page protégée → aucune action", async () => {
    await open({ state: null, url: "https://banque.exemple/" });
    expect(text()).toContain("Rechargez la page"); btn(/Recharger la page/).click(); await vi.advanceTimersByTimeAsync(10); expect(reloaded).toBe(1);
    await open({ state: null, url: "chrome://extensions/" });
    expect(text()).toContain("Page non compatible"); expect(btn(/Recharger|Traduire/)).toBeUndefined();
  });
  it("langue de test : avis « pas une vraie langue » ; changement de langue enregistré et réappliqué si actif", async () => {
    await open({ state: STATES.done_verified, langs: [...LANGS.ff, ...LANGS.test] });
    const sel = $("#lang") as HTMLSelectElement; sel.value = "xx-test"; sel.dispatchEvent(new Event("change")); await vi.advanceTimersByTimeAsync(60);
    expect(stored.targetLang).toBe("xx-test"); expect(tabMsgs.find((m) => m.type === "dl/activate")).toEqual({ type: "dl/activate", target: "xx-test" });
    expect(text()).toContain("Ce n'est pas une vraie langue");
  });
  it("accessibilité : un seul h1, libellé du sélecteur, boutons nommés, région d'état annoncée", async () => {
    await open({});
    expect(document.querySelectorAll("h1")).toHaveLength(1); expect($("label[for=lang]")).toBeTruthy();
    for (const b of document.querySelectorAll("button")) expect((b.textContent ?? "").trim() || b.getAttribute("aria-label")).toBeTruthy();
    expect($("[aria-live=polite]")).toBeTruthy();
  });
});

describe("popup — « Comprendre un terme »", () => {
  const EXPL = { ok: true, data: { found: true, concept_id: "fees", term: "frais", explanation_source: "Les frais sont la somme que le service garde.", explanation_source_reviewed: false, example_source: "Pour envoyer 10 000 FCFA, les frais sont de 100 FCFA.", translation: { id: "e", status: "unavailable", translation: null, translation_status: "unavailable" }, term_translation: { id: "t", status: "unavailable", translation: null, translation_status: "unavailable" } } };
  it("la saisie est masquée avant envoi ; la carte affiche explication, exemple et fiabilité ; chargement visible", async () => {
    await open({ explain: EXPL });
    ($("details.understand") as HTMLDetailsElement).open = true;
    ($("#term") as HTMLTextAreaElement).value = "frais de 5 000 FCFA";
    btn(/^Expliquer$/).click(); await vi.advanceTimersByTimeAsync(30);
    const req = sent.find((m) => m.type === "dl/explain");
    expect(req.text).toBe("frais de {{P0}}"); expect(req.source).toBe("fr"); expect(req.target).toBe("ff");   // le montant ne quitte pas la page
    expect($("#xout").textContent).toContain("Explication simple"); expect($("#xout").textContent).toContain("Exemple"); expect($("#xout").textContent).toContain("Contenu préservé");
    expect($("#xout").textContent).not.toMatch(/traduction disponible/i);
  });
  it("service indisponible : message d'erreur, pas d'explication inventée", async () => {
    await open({}); ($("#term") as HTMLTextAreaElement).value = "solde"; btn(/^Expliquer$/).click(); await vi.advanceTimersByTimeAsync(30);
    expect($("#xout").textContent).toContain("Impossible d'obtenir l'explication");
  });
  it("signalement depuis le popup : charge utile masquée, catégorisée, statut transmis", async () => {
    await open({ explain: EXPL }); ($("#term") as HTMLTextAreaElement).value = "frais de 5 000 FCFA"; btn(/^Expliquer$/).click(); await vi.advanceTimersByTimeAsync(30);
    btn(/Signaler un problème/).click();
    (document.querySelector('input[value="meaning"]') as HTMLInputElement).click();
    (document.querySelector(".dl-report input[type=text]") as HTMLInputElement).value = "ma version 2000 FCFA";
    btn(/^Envoyer$/).click(); await vi.advanceTimersByTimeAsync(60);
    const fb = sent.find((m) => m.type === "dl/feedback").payload;
    expect(fb).toMatchObject({ source_text: "frais de {{P0}}", category: "meaning", concept_id: "fees", translation_status: "unavailable", target_lang: "ff" });
    expect(fb.suggested_translation).toBe("ma version {{P0}}");
    expect(text()).toContain("Merci");
  });
});
