import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "../src/content/overlay";
import { buildExplainModel, renderExplain } from "../src/ui/explain";
import { renderReportForm } from "../src/ui/report";
import { emptyCounts, type ExplainResponse, type PageState } from "../src/shared/types";

const U = (s = "unavailable"): any => ({ id: "x", status: s === "approved" ? "validated" : s === "automatic" ? "machine_unvalidated" : "unavailable", translation_status: s, translation: s === "unavailable" ? null : "TR", test_data: false });
const resp = (o: Partial<ExplainResponse> = {}): ExplainResponse => ({ found: true, concept_id: "fees", term: "frais", explanation_source: "Les frais sont…", explanation_source_reviewed: false, translation: U(), example_source: "Exemple 100 FCFA", term_translation: U(), ...o });
const opt = { term: "frais de transaction", targetName: "Fulfulde", targetLang: "ff", sourceLang: "fr" as const };

describe("« Je veux comprendre » — modèle", () => {
  it("aucune traduction → « indisponible », jamais de texte inventé", () => {
    const m = buildExplainModel(resp(), opt);
    expect(m.translation).toEqual({ text: null, reliability: "unavailable" }); expect(m.explanation!.reviewed).toBe(false); expect(m.example).toContain("100 FCFA");
    const el = renderExplain(document, m, "fr");
    expect(el.textContent).not.toMatch(/pas encore de traduction disponible|aucune version n'est disponible/i);
  });
  it("traduction approuvée du terme → fiabilité « approved » ; automatique → « automatic »", () => {
    expect(buildExplainModel(resp({ term_translation: U("approved") }), opt).translation).toEqual({ text: "TR", reliability: "approved" });
    expect(buildExplainModel(resp({ term_translation: U("automatic") }), opt).translation.reliability).toBe("automatic");
  });
  it("un texte DÉJÀ affiché garde le statut de CE texte (et non celui du terme)", () => {
    const m = buildExplainModel(resp({ term_translation: U("approved") }), { ...opt, shownText: "Affiché auto", shownStatus: "automatic" });
    expect(m.translation).toEqual({ text: "Affiché auto", reliability: "automatic" });
  });
  it("texte conservé pour la mise en page : indiqué, sans prétendre qu'il est traduit", () => {
    const m = buildExplainModel(resp(), { ...opt, shownStatus: "kept" });
    expect(m.keptForLayout).toBe(true); expect(m.translation.text).toBeNull();
  });
  it("expose l'explication traduite avec sa fiabilité, sans confondre traduction et source", () => {
    const m = buildExplainModel(resp({ translation: { ...U("approved"), translation: "Fasirka Fulfulde" } }), opt);
    expect(m.translatedExplanation).toEqual({ text: "Fasirka Fulfulde", reliability: "approved" });
  });
  it("affiche une périphrase Fulfulde même sans explication source", () => {
    const result = { ...U("approved"), translation: "huutorteedum ngam soodugo (kaalis)" };
    const response = resp({ explanation_source: null, translation: result });
    const model = buildExplainModel(response, opt);
    const el = renderExplain(document, model, "fr");

    expect(model.explanation).toBeNull();
    expect(el.querySelector(".dl-xdefinition")?.textContent).toBe(result.translation);
    expect(el.querySelectorAll(".dl-xlang button")).toHaveLength(1);
    expect(el.querySelector(".dl-xdefinition")?.getAttribute("lang")).toBe("ff");
  });
  it("terme inconnu : pas d'explication ni d'exemple", () => {
    const m = buildExplainModel(resp({ found: false, explanation_source: null, example_source: null }), opt);
    expect(m.explanation).toBeNull(); expect(m.example).toBeNull();
  });
});

describe("« Je veux comprendre » — rendu", () => {
  it("sections, fiabilité en langage clair, aucun terme technique", () => {
    const el = renderExplain(document, buildExplainModel(resp({ term_translation: U("automatic") }), opt), "fr", { onReport: () => {}, onClose: () => {} });
    const txt = el.textContent!;
    for (const s of ["Terme", "En Fulfulde", "Automatique", "Aucun locuteur natif", "Explication simple", "Exemple", "en cours de relecture", "Signaler un problème"]) expect(txt).toContain(s);
    expect(txt).not.toMatch(/machine_unvalidated|pending_validation|approved/);
  });
  it("du texte hostile reste du TEXTE (aucun HTML interprété)", () => {
    const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>';
    const el = renderExplain(document, buildExplainModel(resp(), { ...opt, term: evil }), "fr");
    document.body.append(el);
    expect(el.querySelector("img,script")).toBeNull(); expect(el.textContent).toContain(evil); expect((window as any).__pwn).toBeUndefined();
  });
  it("phrase longue : taille normale ; langue du terme déclarée (lecteurs d'écran)", () => {
    const el = renderExplain(document, buildExplainModel(resp(), { ...opt, term: "x".repeat(90) }), "fr");
    expect(el.querySelector(".dl-xterm")!.classList.contains("dl-xlong")).toBe(true); expect(el.querySelector(".dl-xterm")!.getAttribute("lang")).toBe("fr");
  });
  it("anglais", () => expect(renderExplain(document, buildExplainModel(resp(), { ...opt, sourceLang: "en" }), "en").textContent).toContain("Simple explanation"));
  it("permet de choisir l'explication source ou Fulfulde", () => {
    const el = renderExplain(document, buildExplainModel(resp({ translation: { ...U("approved"), translation: "Fasirka Fulfulde" } }), opt), "fr");
    const choices = el.querySelectorAll(".dl-xlang button");
    const definition = el.querySelector(".dl-xdefinition")!;
    expect(definition.textContent).toBe("Fasirka Fulfulde");
    expect(definition.getAttribute("lang")).toBe("ff");
    (choices[0] as HTMLButtonElement).click();
    expect(definition.textContent).toBe("Les frais sont…");
    expect(definition.getAttribute("lang")).toBe("fr");
  });
  it("un contenu conservé est présenté comme protégé, pas comme une traduction manquante", () => {
    const model = buildExplainModel(resp({ found: false, term_translation: null }), { ...opt, shownStatus: "kept" });
    const el = renderExplain(document, model, "fr");
    expect(el.textContent).toContain("Données sensibles protégées");
    expect(el.textContent).not.toContain("Pas encore de traduction disponible pour ce terme");
  });
});

describe("signalement linguistique", () => {
  const form = (send: any, done = vi.fn()) => { const f = renderReportForm(document, "fr", send, done); document.body.append(f); return { f, done }; };
  const pick = (f: HTMLElement, v: string) => (f.querySelector(`input[value="${v}"]`) as HTMLInputElement).click();
  const submit = (f: HTMLElement) => ([...f.querySelectorAll("button")].find((b) => /Envoyer/.test(b.textContent!))!).click();
  beforeEach(() => { document.body.innerHTML = ""; });

  it("sans type de problème : message, rien n'est envoyé", async () => {
    const send = vi.fn(); const { f } = form(send); submit(f); await Promise.resolve();
    expect(send).not.toHaveBeenCalled(); expect(f.querySelector(".dl-reperr")!.textContent).toMatch(/Choisissez/);
  });
  it("envoie catégorie + proposition + précisions, puis confirme sans promettre de modification", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true }); const { f, done } = form(send);
    pick(f, "terminology"); (f.querySelector("input[type=text]") as HTMLInputElement).value = "ma proposition"; (f.querySelector("textarea") as HTMLTextAreaElement).value = "précision";
    submit(f); await vi.waitFor(() => expect(f.textContent).toContain("Merci"));
    expect(send).toHaveBeenCalledWith({ category: "terminology", suggestion: "ma proposition", comment: "précision" });
    expect(f.textContent).toContain("ne change pas la traduction automatiquement");
    ([...f.querySelectorAll("button")].find((b) => b.textContent === "Fermer")!).click(); expect(done).toHaveBeenCalled();
  });
  it("trop de signalements / erreur : message adapté, le formulaire reste utilisable", async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: false, code: "rate_limited" }).mockResolvedValueOnce({ ok: false, code: "network" });
    const { f } = form(send); pick(f, "meaning");
    submit(f); await vi.waitFor(() => expect(f.querySelector(".dl-reperr")!.textContent).toMatch(/beaucoup de signalements/));
    submit(f); await vi.waitFor(() => expect(f.querySelector(".dl-reperr")!.textContent).toMatch(/Envoi impossible/));
    expect(f.querySelector("button[disabled]")).toBeNull();
  });
  it("annuler ferme sans envoyer ; chaque bouton radio a un libellé associé (accessibilité)", () => {
    const send = vi.fn(); const { f, done } = form(send);
    ([...f.querySelectorAll("button")].find((b) => b.textContent === "Annuler")!).click();
    expect(done).toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    for (const r of f.querySelectorAll("input[type=radio]")) expect(f.querySelector(`label[for="${(r as HTMLElement).id}"]`)).not.toBeNull();
    expect(f.querySelector("fieldset legend")).not.toBeNull();
  });
});

describe("Overlay — aucune trace quand l'extension est inactive", () => {
  const st = (p: Partial<PageState> = {}): PageState => ({ phase: "done", target: "ff", detectedLang: "fr", total: 5, counts: emptyCounts(), testData: false, coverage: { verified: 0, unverified: 4, kept: 1, total: 5 }, reasons: { layout: 1 }, ...p });
  let o: Overlay; const hd = { onRestore: vi.fn(), onHide: vi.fn(), onRetry: vi.fn() };
  beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = "<p>page</p>"; (window as any).__DL_TEST_OPEN = true; o = new Overlay(document, "fr", hd); });
  afterEach(() => {
    o.destroy();
    delete (document.documentElement as any).clientWidth;
    delete (document.documentElement as any).clientHeight;
    vi.restoreAllMocks();
    delete (window as any).__DL_TEST_OPEN;
  });
  const root = () => document.getElementById("dl-root")?.shadowRoot ?? null;

  it("monte une puce isolée (Shadow DOM) qui annonce le nombre de textes ; rien ailleurs dans la page", () => {
    const body = document.body.innerHTML, head = document.head.innerHTML;
    o.render(st(), false);
    expect(root()!.querySelector(".launcher")!.textContent).toContain("4 textes traduits");
    expect(document.getElementById("dl-root")!.hasAttribute("data-dl-ignore")).toBe(true);
    expect(document.body.innerHTML.replace(/<div id="dl-root"[^>]*><\/div>/, "")).toBe(body); expect(document.head.innerHTML).toBe(head);
  });
  it("inactif → démonté ; « masquer » → puce cachée ; reprise → visible", () => {
    o.render(st(), false); o.render(st({ phase: "inactive" }), false);
    expect(document.getElementById("dl-root")).toBeNull();
    o.render(st(), true); expect(document.getElementById("dl-root")).toBeNull();            // masquée dès le départ : rien n'est monté
    o.render(st(), false); o.render(st(), true); expect((root()!.querySelector(".launcher") as HTMLElement).hidden).toBe(true);
    o.render(st(), false); expect((root()!.querySelector(".launcher") as HTMLElement).hidden).toBe(false);
  });
  it("panneau : s'ouvre au clic (aria-expanded), affiche couverture et actions, et agit", () => {
    o.onNeedPanel = () => o.renderPanelFor(st());
    o.render(st(), false);
    const l = root()!.querySelector(".launcher") as HTMLButtonElement; l.click();
    expect(l.getAttribute("aria-expanded")).toBe("true");
    const p = root()!.querySelector(".panel") as HTMLElement;
    expect(p.hidden).toBe(false); expect(p.textContent).toContain("Couverture de cette page");
    ([...p.querySelectorAll("button")].find((b) => /Revenir à l'original/.test(b.textContent!))!).click(); expect(hd.onRestore).toHaveBeenCalled();
    ([...p.querySelectorAll("button")].find((b) => b.textContent === "Masquer")! as HTMLElement).click(); expect(hd.onHide).toHaveBeenCalled();
  });
  it("Échap ferme la carte ; la carte est un dialogue accessible", () => {
    o.render(st(), false); const card = document.createElement("div"); card.textContent = "contenu";
    o.showCard(card);
    const c = root()!.querySelector(".card") as HTMLElement;
    expect(c.hidden).toBe(false); expect(c.getAttribute("role")).toBe("dialog");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(c.hidden).toBe(true);
  });
  it("carte entièrement visible même si la sélection est proche du bas de l'écran", () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 600 });
    o.render(st(), false);
    const c = root()!.querySelector(".card") as HTMLElement;
    vi.spyOn(c, "getBoundingClientRect").mockReturnValue({ height: 500 } as DOMRect);
    o.showCard(document.createElement("div"), { left: 200, top: 540, right: 250, bottom: 555 });
    const top = parseFloat(c.style.top);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + 500).toBeLessThanOrEqual(588);
  });
  it("bulle « Comprendre » : positionnée dans l'écran, rappel au clic, puis masquée", () => {
    o.render(st(), false); const cb = vi.fn();
    o.showBubble({ left: 5000, top: 5, right: 5200, bottom: 20 }, cb);
    const b = root()!.querySelector(".bubble") as HTMLButtonElement;
    expect(b.hidden).toBe(false); expect(parseFloat(b.style.left)).toBeLessThan(document.documentElement.clientWidth || 1024);
    b.click(); expect(cb).toHaveBeenCalled(); expect(b.hidden).toBe(true);
  });
  it("la bulle reste masquée tant que la fenêtre Comprendre est ouverte", () => {
    o.render(st(), false);
    const b = root()!.querySelector(".bubble") as HTMLButtonElement;
    const showCard = vi.fn(() => o.showCard(document.createElement("div"), { left: 100, top: 100, right: 180, bottom: 120 }));
    o.showBubble({ left: 100, top: 100, right: 180, bottom: 120 }, showCard);
    expect(b.hidden).toBe(false);
    b.click();
    expect(showCard).toHaveBeenCalledOnce();
    expect((root()!.querySelector(".card") as HTMLElement).hidden).toBe(false);
    expect(b.hidden).toBe(true);
    o.showBubble({ left: 100, top: 100, right: 180, bottom: 120 }, vi.fn());
    expect(b.hidden).toBe(true);
    expect((root()!.querySelector(".card") as HTMLElement).hidden).toBe(false);
  });
  it("le panneau se ferme au clic extérieur et n'affiche plus de bouton de bascule", () => {
    o.onNeedPanel = () => o.renderPanelFor(st({ phase: "error", message: "network" }));
    o.render(st({ phase: "error", message: "network" }), false);
    (root()!.querySelector(".launcher") as HTMLButtonElement).click();
    const panel = root()!.querySelector(".panel") as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll(".phead button")).toHaveLength(1);
    document.querySelector("p")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(panel.hidden).toBe(true);
    expect(root()!.querySelector(".launcher")!.getAttribute("aria-expanded")).toBe("false");
  });
  it("le panneau peut être déplacé par sa barre d'en-tête", () => {
    o.onNeedPanel = () => o.renderPanelFor(st());
    o.render(st(), false);
    (root()!.querySelector(".launcher") as HTMLButtonElement).click();
    const panel = root()!.querySelector(".panel") as HTMLElement;
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1200 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 900 });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ left: 20, top: 30, right: 360, bottom: 500, width: 340, height: 470, x: 20, y: 30, toJSON: () => ({}) });
    panel.querySelector(".phead strong")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 30 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 70, clientY: 80 }));
    expect(panel.style.left).toBe("70px");
    expect(panel.style.top).toBe("80px");
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  });
  it("l'état d'erreur conserve l'action « Réessayer »", () => {
    o.onNeedPanel = () => o.renderPanelFor(st({ phase: "error", message: "network" }));
    o.render(st({ phase: "error", message: "network" }), false);
    (root()!.querySelector(".launcher") as HTMLButtonElement).click();
    ([...root()!.querySelectorAll(".panel button")].find((b) => b.textContent === "Réessayer")! as HTMLElement).click(); expect(hd.onRetry).toHaveBeenCalled();
  });
});
