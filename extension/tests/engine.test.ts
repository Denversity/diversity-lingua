import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomExtractor } from "../src/content/domExtractor";
import { LayoutGuard, type Box, type Snapshot } from "../src/content/layoutGuard";
import { Ledger } from "../src/content/ledger";
import { HighlightMarks, MARK_RULES } from "../src/content/marks";
import { RouteWatcher } from "../src/content/routes";
import { collectShadowRoots } from "../src/content/shadow";

const box = (o: Partial<Box> = {}): Box => ({ w: 100, h: 30, sw: 100, cw: 100, sh: 30, ch: 30, ox: "visible", oy: "visible", nowrap: false, ellipsis: false, control: false, inline: false, ...o });
const snap = (...b: Box[]): Snapshot => ({ chain: b });
const guard = new LayoutGuard(window);

describe("LayoutGuard.judge — règles de préservation (fonction pure)", () => {
  it("aucun changement → aucun grief", () => expect(guard.judge(snap(box()), snap(box()))).toBeNull());
  it("troncature NOUVELLE (ellipsis) → clip_x", () => {
    expect(guard.judge(snap(box({ ellipsis: true, ox: "hidden" })), snap(box({ ellipsis: true, ox: "hidden", sw: 180, cw: 100 })))).toMatchObject({ code: "clip_x" });
  });
  it("troncature AGGRAVÉE (déjà coupé avant, davantage après) → sanctionnée ; inchangée → tolérée", () => {
    const before = box({ ox: "hidden", nowrap: true, sw: 150, cw: 100 });
    expect(guard.judge(snap(before), snap(box({ ox: "hidden", nowrap: true, sw: 210, cw: 100 })))).toMatchObject({ code: "clip_x" });
    expect(guard.judge(snap(before), snap(box({ ox: "hidden", nowrap: true, sw: 150, cw: 100 })))).toBeNull();
  });
  it("hauteur fixe + overflow caché : texte coupé → clip_y ; zone défilante (auto) → ignorée", () => {
    expect(guard.judge(snap(box({ oy: "hidden" })), snap(box({ oy: "hidden", sh: 80, ch: 30 })))).toMatchObject({ code: "clip_y" });
    expect(guard.judge(snap(box({ oy: "auto" })), snap(box({ oy: "auto", sh: 400, ch: 30 })))).toBeNull();
  });
  it("texte qui s'enroule sans couper (bloc normal) → toléré", () => {
    expect(guard.judge(snap(box({ h: 20 })), snap(box({ h: 60 })))).toBeNull();
  });
  it("bouton/onglet/badge qui passe sur 2 lignes → control_wrap", () => {
    expect(guard.judge(snap(box({ control: true, h: 40 })), snap(box({ control: true, h: 70 })))).toMatchObject({ code: "control_wrap" });
    expect(guard.judge(snap(box({ control: true, h: 40 })), snap(box({ control: true, h: 44 })))).toBeNull();
  });
  it("les ancêtres comptent (menu nowrap + overflow caché autour d'un lien)", () => {
    const child = box(), parentBefore = box({ ox: "hidden", nowrap: true }), parentAfter = box({ ox: "hidden", nowrap: true, sw: 300, cw: 100 });
    expect(guard.judge(snap(child, parentBefore), snap(child, parentAfter))).toMatchObject({ code: "clip_x", level: 1 });
  });
  it("boîte en ligne (clientWidth 0) : pas de métriques exploitables → ignorée", () => {
    expect(guard.judge(snap(box({ inline: true })), snap(box({ inline: true, sw: 500, cw: 0, ox: "hidden" })))).toBeNull();
  });
  it("overflow visible + nowrap qui déborde sur les voisins → sanctionné", () => {
    expect(guard.judge(snap(box({ nowrap: true })), snap(box({ nowrap: true, sw: 220, cw: 100 })))).toMatchObject({ code: "clip_x" });
  });
});

describe("LayoutGuard — éléments et conteneurs", () => {
  it("un <option> mesure son <select> ; un nœud texte mesure son parent", () => {
    document.body.innerHTML = '<select id="s"><option value="a">Un</option></select><p id="p">Texte</p>';
    expect(LayoutGuard.elementFor(document.querySelector("option")!.firstChild!)?.id).toBe("s");
    expect(LayoutGuard.elementFor(document.getElementById("p")!.firstChild!)?.id).toBe("p");
  });
  it("containerOf trouve le conteneur de pistes partagées (flex/grid/table) le plus proche ; collectClippable les éléments qui coupent", () => {
    document.body.innerHTML = '<div id="f" style="display:flex"><div><span id="a">x</span><span id="b" style="overflow:hidden;white-space:nowrap">y</span><span id="c" style="overflow:hidden">z</span></div></div>';
    expect(guard.containerOf(document.getElementById("a")!)?.id).toBe("f");
    expect(guard.collectClippable(document.getElementById("f")!).map((e) => e.id)).toEqual(["b"]);
  });
});

describe("Ledger — couverture de la page ACTUELLE", () => {
  it("compte par statut, agrège les raisons et ignore les nœuds retirés de la page", () => {
    document.body.innerHTML = "<p>a</p><p>b</p><p>c</p><p>d</p>";
    const [a, b, c, d] = [...document.querySelectorAll("p")].map((p) => p.firstChild!);
    const l = new Ledger();
    l.set(a, undefined, { status: "approved" }); l.set(b, undefined, { status: "automatic", testData: true });
    l.set(c, undefined, { status: "layout", reason: "layout" }); l.set(d, undefined, { status: "unavailable", reason: "no_validated_translation" });
    expect(l.summary()).toMatchObject({ verified: 1, unverified: 1, kept: 2, total: 4, testData: true, reasons: { layout: 1, no_validated_translation: 1 } });
    d.parentElement!.remove(); l.prune();
    expect(l.summary().total).toBe(3);
  });
  it("un attribut et son élément ont des entrées distinctes", () => {
    const el = document.createElement("input"); document.body.append(el);
    const l = new Ledger(); l.set(el, "placeholder", { status: "automatic" }); l.set(el, "title", { status: "unavailable" });
    expect(l.summary().total).toBe(2);
  });
});

describe("HighlightMarks — repères sans toucher au site", () => {
  class FakeHighlight { s = new Set<Range>(); add(r: Range) { this.s.add(r); } delete(r: Range) { this.s.delete(r); } get size() { return this.s.size; } }
  let store: Map<string, FakeHighlight>;
  beforeEach(() => {
    document.head.innerHTML = ""; document.body.innerHTML = "";
    store = new Map();
    (window as any).Highlight = FakeHighlight;
    (window as any).CSS = { highlights: { set: (k: string, v: FakeHighlight) => store.set(k, v), delete: (k: string) => store.delete(k), has: (k: string) => store.has(k) } };
  });
  afterEach(() => { delete (window as any).Highlight; delete (window as any).CSS; });
  const txt = () => { document.body.innerHTML = "<p>Bonjour</p>"; return document.querySelector("p")!.firstChild as Text; };

  it("marque, démarque, puis nettoie tout (plages et feuille)", () => {
    const m = new HighlightMarks(document, () => "unvalidated"); const n = txt();
    m.mark(n, "auto");
    expect(store.get("dl-auto")!.size).toBe(1);
    m.unmark(n); expect(store.get("dl-auto")!.size).toBe(0);
    m.mark(n, "auto"); m.clear();
    expect(store.size).toBe(0); expect(document.querySelector("style[id^=dl-]")).toBeNull();
  });
  it("modes : « unvalidated » ne marque pas les vérifiés ; « all » les marque ; « none » rien", () => {
    const n = txt();
    const a = new HighlightMarks(document, () => "unvalidated"); a.mark(n, "verified"); expect(store.has("dl-verified")).toBe(false);
    const b = new HighlightMarks(document, () => "all"); b.mark(n, "verified"); expect(store.get("dl-verified")!.size).toBe(1);
    store.clear(); const c = new HighlightMarks(document, () => "none"); c.mark(n, "auto"); expect(store.size).toBe(0);
  });
  it("la SEULE règle CSS installée est de la forme ::highlight() et n'ajoute aucun attribut au texte", () => {
    const n = txt(); const attrs = document.body.innerHTML;
    new HighlightMarks(document, () => "unvalidated").mark(n, "auto");
    expect(document.body.innerHTML).toBe(attrs);
    const rules = MARK_RULES.split("}").map((r) => r.trim()).filter(Boolean);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.startsWith("::highlight(")).toBe(true);
  });
  it("navigateur sans Highlight API : aucune action, aucune erreur", () => {
    delete (window as any).Highlight;
    const m = new HighlightMarks(document, () => "all"); expect(m.supported).toBe(false);
    expect(() => m.mark(txt(), "auto")).not.toThrow(); expect(document.querySelector("style")).toBeNull();
  });
});

describe("RouteWatcher — navigation sans rechargement", () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  const fakeWin = (nav = false) => {
    const w: any = new EventTarget(); w.location = { href: "https://x/a" }; if (nav) w.navigation = new EventTarget(); return w;
  };
  it("popstate/hashchange déclenchent UN rappel (anti-rebond)", () => {
    const w = fakeWin(true), cb = vi.fn(); const r = new RouteWatcher(w, cb, 100); r.start();
    w.dispatchEvent(new Event("popstate")); w.dispatchEvent(new Event("hashchange")); vi.advanceTimersByTime(150);
    expect(cb).toHaveBeenCalledTimes(1); r.stop();
  });
  it("Navigation API : navigatesuccess déclenche le rappel", () => {
    const w = fakeWin(true), cb = vi.fn(); const r = new RouteWatcher(w, cb, 100); r.start();
    w.navigation.dispatchEvent(new Event("navigatesuccess")); vi.advanceTimersByTime(150); expect(cb).toHaveBeenCalledTimes(1); r.stop();
  });
  it("sans Navigation API : surveillance de l'URL (pushState invisible depuis un content script)", () => {
    const w = fakeWin(false), cb = vi.fn(); const r = new RouteWatcher(w, cb, 100, 200); r.start();
    vi.advanceTimersByTime(600); expect(cb).not.toHaveBeenCalled();
    w.location.href = "https://x/b"; vi.advanceTimersByTime(500); expect(cb).toHaveBeenCalledTimes(1); r.stop();
  });
  it("stop() retire écouteurs et minuteries", () => {
    const w = fakeWin(false), cb = vi.fn(); const r = new RouteWatcher(w, cb, 100, 200); r.start(); r.stop();
    w.location.href = "https://x/c"; w.dispatchEvent(new Event("popstate")); vi.advanceTimersByTime(2000); expect(cb).not.toHaveBeenCalled();
  });
});

describe("Shadow DOM", () => {
  const ex = (o: any = {}) => new DomExtractor({ attributes: true, ...o });
  it("traverse les racines ouvertes, y compris imbriquées, et les signale", () => {
    document.body.innerHTML = '<div id="h1"></div>';
    const r1 = document.getElementById("h1")!.attachShadow({ mode: "open" });
    r1.innerHTML = '<p>Solde disponible</p><div id="h2"></div>';
    const r2 = r1.getElementById("h2")!.attachShadow({ mode: "open" }); r2.innerHTML = "<span>Historique des opérations</span>";
    const seen: ShadowRoot[] = [];
    expect(ex({ onShadowRoot: (r: ShadowRoot) => seen.push(r) }).extract(document).map((r) => r.original).sort()).toEqual(["Historique des opérations", "Solde disponible"]);
    expect(seen).toHaveLength(2);
  });
  it("racines FERMÉES accessibles via chrome.dom.openOrClosedShadowRoot (content script)", () => {
    document.body.innerHTML = '<div id="h"></div>'; const h = document.getElementById("h")!;
    const closed = h.attachShadow({ mode: "closed" }); closed.innerHTML = "<p>Mes bénéficiaires enregistrés</p>";
    expect(h.shadowRoot).toBeNull();
    (globalThis as any).chrome = { dom: { openOrClosedShadowRoot: (el: Element) => (el === h ? closed : null) } };
    try { expect(ex().extract(document).map((r) => r.original)).toEqual(["Mes bénéficiaires enregistrés"]); } finally { delete (globalThis as any).chrome; }
  });
  it("un hôte marqué data-dl-ignore n'est pas parcouru", () => {
    document.body.innerHTML = '<div id="h" data-dl-ignore></div>';
    document.getElementById("h")!.attachShadow({ mode: "open" }).innerHTML = "<p>Texte à ignorer ici</p>";
    expect(ex().extract(document)).toEqual([]);
  });
  it("collectShadowRoots ignore le panneau Diversity Lingua", () => {
    document.body.innerHTML = '<div id="dl-root"></div><div id="x"></div>';
    document.getElementById("dl-root")!.attachShadow({ mode: "open" }); document.getElementById("x")!.attachShadow({ mode: "open" });
    expect(collectShadowRoots(document.body, (e) => e.id === "dl-root")).toHaveLength(1);
  });
});

describe("Exclusions pour interfaces inconnues", () => {
  const texts = (html: string, o: any = {}) => { document.body.innerHTML = html; return new DomExtractor({ attributes: false, ...o }).extract(document).map((r) => r.original.trim()); };
  it("icônes : classes de bibliothèques d'icônes et ligatures en police d'icônes", () => {
    expect(texts('<i class="material-icons">arrow_forward</i><i class="fa fa-home">home</i><span class="icon-left">Retour accueil</span><i style="font-family:\'Material Icons\'">add_circle</i><p>Voir le détail</p>')).toEqual(["Voir le détail"]);
  });
  it("glyphes de zone privée (icônes par code) ignorés", () => expect(texts("<span>\uE001 Menu principal</span><p>Menu</p>")).toEqual(["Menu"]));
  it("logos et marques ignorés (classe/id logo, brand), y compris en profondeur", () => {
    expect(texts('<div class="site-logo"><span>Banque Exemple</span></div><header id="brand"><b>BE</b> Mon espace</header><p>Mon profil</p>')).toEqual(["Mon profil"]);
  });
  it("lettres isolées (pastilles, logos) ignorées ; mots courts conservés", () => expect(texts("<span>B</span><span>OK</span><span>Non</span>")).toEqual(["OK", "Non"]));
  it("éléments déjà dans la langue cible (lang=ff) ignorés ; autres langues conservées", () => {
    expect(texts('<p lang="ff-CM">Déjà dans la langue cible</p><p lang="en">Hello there my friend</p>', { targetLang: "ff" })).toEqual(["Hello there my friend"]);
  });
  it("faux positifs évités : « catalogue » n'est pas un logo, « fabrication » n'est pas une icône", () => {
    expect(texts('<div class="catalogue-liste"><p>Liste des produits</p></div><div class="fabrication"><p>Mode de paiement</p></div>')).toEqual(["Liste des produits", "Mode de paiement"]);
  });
});
