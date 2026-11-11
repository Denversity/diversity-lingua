import { describe, expect, it } from "vitest";
import { renderCoverage, renderReasons } from "../src/ui/coverage";
import { deriveView } from "../src/ui/view";
import { emptyCounts, type PageState } from "../src/shared/types";

const st = (p: Partial<PageState> = {}): PageState => ({ phase: "done", target: "ff", detectedLang: "fr", total: 10, counts: emptyCounts(), testData: false,
  coverage: { verified: 0, unverified: 0, kept: 0, total: 0 }, reasons: {}, ...p });
const ff = { name: "Fulfulde", availability: "awaiting_validation", approved: 0, isTest: false };
const view = (state: PageState | null, o: any = {}) => deriveView({ state, reachable: true, lang: "fr", language: ff, ...o });

describe("dérivation d'écran — les 9 états du popup", () => {
  it("page injoignable (pages protégées du navigateur)", () => {
    const v = view(null, { reachable: false });
    expect(v.kind).toBe("unreachable"); expect(v.primary.id).toBe("none"); expect(v.notices).toEqual([]);
  });
  it("page ordinaire ouverte avant l'installation : proposer de recharger (et non « incompatible »)", () => {
    const v = view(null, { reachable: false, reloadable: true });
    expect(v.kind).toBe("unreachable"); expect(v.primary).toEqual({ id: "reload", label: "Recharger la page" }); expect(v.title).toMatch(/Rechargez/);
  });
  it("initial : action unique « Traduire cette page » + avis de référentiel incomplet", () => {
    const v = view(st({ phase: "inactive" }));
    expect(v.kind).toBe("idle"); expect(v.primary).toEqual({ id: "translate", label: "Traduire cette page" });
    expect(v.notices[0].title).toMatch(/en préparation/);
  });
  it("détection puis traduction en cours avec progression", () => {
    expect(view(st({ phase: "detecting" })).kind).toBe("detecting");
    const v = view(st({ phase: "translating", total: 10, counts: { ...emptyCounts(), pending: 4 } }));
    expect(v.kind).toBe("translating"); expect(v.progress).toBeCloseTo(0.6); expect(v.primary.id).toBe("restore");
  });
  it("terminée : ton « vérifié » seulement s'il n'y a aucune traduction non vérifiée", () => {
    expect(view(st({ coverage: { verified: 5, unverified: 0, kept: 0, total: 5 } }), { language: { ...ff, approved: 5 } }).tone).toBe("verified");
    const v = view(st({ coverage: { verified: 2, unverified: 3, kept: 0, total: 5 } }));
    expect(v.tone).toBe("auto"); expect(v.coverage!.unverified).toBe(3);
  });
  it("partielle : raisons en langage clair, jamais de code technique", () => {
    const v = view(st({ phase: "partial", coverage: { verified: 0, unverified: 6, kept: 4, total: 10 }, reasons: { no_validated_translation: 3, layout: 1 } }));
    expect(v.kind).toBe("partial");
    expect(v.reasons.map((r) => r.label)).toEqual(["Contenu d'origine préservé", "Données sensibles à ne pas modifier (contenu préservé)"]);
    expect(JSON.stringify(v)).not.toMatch(/traduction disponible/i);
    expect(v.notices.some((n) => n.tone === "layout" && /1 élément est conservé : données sensibles à ne pas modifier ou mise en page protégée/.test(n.text))).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/approved|automatic|pending_validation/);
  });
  it("erreur : message compréhensible, action « Réessayer » ; variantes accès refusé / quota", () => {
    expect(view(st({ phase: "error", message: "network" }))).toMatchObject({ kind: "error", tone: "error", primary: { id: "retry" } });
    expect(view(st({ phase: "error", message: "unauthorized" })).title).toBe("Accès refusé");
    expect(view(st({ phase: "error", message: "rate_limited" })).title).toBe("Trop de demandes");
    expect(view(st({ phase: "error" })).message).toMatch(/Votre page n'a pas été modifiée/);
    const e = view(st({ phase: "error", coverage: { verified: 0, unverified: 0, kept: 12, total: 12 }, reasons: { network: 12 } }));
    expect(e.coverage).toBeNull(); expect(e.reasons).toEqual([]); expect(e.notices).toEqual([]);   // pas de bruit autour du message d'erreur
  });
  it("aucun contenu traduisible / langue non prise en charge / rien de traduit", () => {
    expect(view(st({ phase: "empty" })).kind).toBe("empty");
    expect(view(st({ phase: "unavailable", message: "unsupportedSource" })).kind).toBe("unsupported");
    const v = view(st({ phase: "unavailable", coverage: { verified: 0, unverified: 0, kept: 8, total: 8 }, reasons: { no_validated_translation: 8 } }));
    expect(v.kind).toBe("unavailable"); expect(v.message).toMatch(/champs sensibles/i);
  });
  it("langue de test : avis explicite « pas une vraie langue » (et pas l'avis de référentiel)", () => {
    const v = view(st(), { language: { name: "Langue de test", availability: "test_only", approved: 28, isTest: true } });
    expect(v.notices).toHaveLength(1); expect(v.notices[0].tone).toBe("test");
  });
  it("anglais : textes traduits, mêmes états", () => {
    expect(view(st({ phase: "inactive" }), { lang: "en" }).primary.label).toBe("Translate this page");
    expect(view(st({ phase: "empty" }), { lang: "en" }).title).toBe("Nothing to translate here");
  });
});

describe("jauge de couverture (DOM)", () => {
  const v = view(st({ coverage: { verified: 2, unverified: 6, kept: 2, total: 10 }, reasons: { layout: 2 } }));
  it("trois segments, légende chiffrée et alternative textuelle", () => {
    const el = renderCoverage(document, v, "fr")!;
    expect(el.querySelectorAll(".dl-meter > span")).toHaveLength(3);
    expect(el.querySelector(".dl-meter")!.getAttribute("aria-label")).toMatch(/2 Vérifiés.*6 Traduits automatiquement.*2 Contenus conservés \(données sensibles ou mise en page\)/);
    expect([...el.querySelectorAll(".dl-legend b")].map((b) => b.textContent)).toEqual(["2", "6", "2"]);
  });
  it("l'aide précise que la jauge ne mesure pas la compréhension et s'ouvre au clavier", () => {
    const el = renderCoverage(document, v, "fr")!;
    const btn = el.querySelector("button")!; const note = el.querySelector(".dl-covnote") as HTMLElement;
    expect(note.hidden).toBe(true); btn.click();
    expect(note.hidden).toBe(false); expect(btn.getAttribute("aria-expanded")).toBe("true"); expect(note.textContent).toMatch(/ne mesure pas votre compréhension/);
  });
  it("rien à afficher sans données ; raisons rendues par textContent", () => {
    expect(renderCoverage(document, view(st({ phase: "inactive" })), "fr")).toBeNull();
    expect(renderReasons(document, view(st({ reasons: {} })), "fr")).toBeNull();
    const r = renderReasons(document, v, "fr")!;
    expect(r.textContent).toContain("Données sensibles à ne pas modifier");
  });
});
