import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageTranslator } from "../src/content/controller";
import { LayoutGuard, type Box, type Snapshot } from "../src/content/layoutGuard";
import type { PageState } from "../src/shared/types";
import { FR_PAGE, fakeBackend, wait } from "./helpers";

const B = (o: Partial<Box> = {}): Box => ({ w: 0, h: 20, sw: 0, cw: 0, sh: 0, ch: 0, ox: "visible", oy: "visible", nowrap: false, ellipsis: false, control: false, inline: false, ...o });

/** Fausse garde : « data-tight » = élément à largeur fixe qui coupe son texte dès qu'il s'allonge de plus de 5 caractères. */
class TightGuard extends LayoutGuard {
  constructor() { super(window); }
  /** Même mesure pour snapshot() et measure() (comme la vraie garde) : « largeur » = nombre de caractères ; data-tight = 33 de large, coupe. */
  measure(el: Element): Box {
    const len = (el.textContent ?? "").length, tight = el.hasAttribute("data-tight");
    return B({ w: len, sw: len, cw: tight ? 33 : 10_000, ox: tight ? "hidden" : "visible" });
  }
  snapshot(el: Element): Snapshot { return { chain: [this.measure(el)] }; }
  pageOverflowsX() { return false; }
}

function make(fake: ReturnType<typeof fakeBackend>, guard: LayoutGuard | null = new TightGuard()) {
  const states: PageState[] = [];
  const tr = new PageTranslator({ doc: document, send: fake.send, mutationDelayMs: 10, batchSize: 50, guard, marks: null,
    settings: () => ({ translateAttributes: true, marks: "unvalidated" }), defaultTarget: () => "xx-test", onState: (s) => states.push(s) });
  return { tr, states };
}
const FR = "Vous avez reçu de l'argent sur votre compte et le solde est disponible pour vos paiements.";
beforeEach(() => { document.documentElement.innerHTML = '<head><title>T</title></head><body></body>'; });
afterEach(() => { document.documentElement.removeAttribute("lang"); });

describe("garde de mise en page — intégration contrôleur", () => {
  it("un texte qui dégraderait la mise en page est rétabli, compté, expliqué — et traduit nulle part ailleurs", async () => {
    document.body.innerHTML = `<p id="p">${FR}</p><button id="b" data-tight>Envoyer de l'argent à un proche</button>`;
    const fake = fakeBackend(); const { tr } = make(fake);
    await tr.activate("xx-test");
    expect(document.getElementById("p")!.textContent).toMatch(/^\[TEST~\]/);
    expect(document.getElementById("b")!.textContent).toBe("Envoyer de l'argent à un proche");   // repli propre : original conservé
    const st = tr.getState();
    expect(st.reasons).toEqual({ layout: 1 }); expect(st.coverage).toMatchObject({ unverified: 1, kept: 1, total: 2 }); expect(st.phase).toBe("partial");
    expect(tr.inspectNode(document.getElementById("b")!.firstChild!)).toMatchObject({ status: "layout" });
  });
  it("un texte conservé n'est PAS retraduit en boucle (le rétablissement n'est pas pris pour une modification du site)", async () => {
    document.body.innerHTML = `<p>${FR}</p><button data-tight>Envoyer de l'argent à un proche</button>`;
    const fake = fakeBackend(); const { tr } = make(fake);
    await tr.activate("xx-test"); await wait(120); await tr.idle(); await wait(120);
    expect(fake.calls.filter((c) => c.type === "dl/translate")).toHaveLength(1);
  });
  it("si le SITE réécrit ensuite un texte conservé, il est de nouveau traité", async () => {
    document.body.innerHTML = `<p>${FR}</p><button id="b" data-tight>Envoyer de l'argent à un proche</button>`;
    const fake = fakeBackend(); const { tr } = make(fake);
    await tr.activate("xx-test");
    document.getElementById("b")!.firstChild!.nodeValue = "Annuler";                    // court : ne dépasse plus la contrainte
    await wait(120); await tr.idle();
    expect(document.getElementById("b")!.textContent).toBe("[TEST~] Annuler".length > 22 ? "Annuler" : "[TEST~] Annuler");
    expect(fake.calls.filter((c) => c.type === "dl/translate").length).toBe(2);
  });
  it("victimes collatérales : la traduction qui étrangle un voisin est rétablie, les autres sont gardées", async () => {
    document.body.innerHTML = `<table id="t"><tr><td id="culprit">${FR}</td><td id="other">Historique des opérations récentes</td><td id="v">Ligne tronquable ici</td></tr></table>`;
    const victim = document.getElementById("v")!, culprit = document.getElementById("culprit")!;
    class VictimGuard extends TightGuard {
      containerOf() { return document.getElementById("t"); }
      collectClippable() { return [victim]; }
      measure(el: Element): Box { return el === victim ? B({ sw: (culprit.textContent ?? "").startsWith("[TEST~]") ? 300 : 100, cw: 200, ox: "hidden" }) : super.measure(el); }
    }
    const fake = fakeBackend(); const { tr } = make(fake, new VictimGuard());
    await tr.activate("xx-test");
    expect(culprit.textContent).toBe(FR);                                               // le coupable est rétabli
    expect(document.getElementById("other")!.textContent).toMatch(/^\[TEST~\]/);       // le minimum nécessaire seulement
    expect(tr.getState().reasons.layout).toBeGreaterThanOrEqual(1);
  });
  it("garde désactivée (diagnostic) : tout est appliqué", async () => {
    document.body.innerHTML = `<button data-tight>Envoyer de l'argent à un proche</button><p>${FR}</p>`;
    const { tr } = make(fakeBackend(), null);
    await tr.activate("xx-test");
    expect(document.querySelector("button")!.textContent).toMatch(/^\[TEST~\]/);
  });
});

describe("phases, couverture et contenus évolutifs", () => {
  it("détection → traduction → terminé ; la couverture reflète la page ACTUELLE", async () => {
    document.body.innerHTML = `<p id="a">${FR}</p><p id="b">Envoyer de l'argent</p>`;
    const { tr, states } = make(fakeBackend(), null);
    await tr.activate("xx-test");
    expect(states.map((s) => s.phase).slice(0, 2)).toEqual(["detecting", "translating"]);
    expect(tr.getState()).toMatchObject({ phase: "done", coverage: { verified: 1, unverified: 1, kept: 0, total: 2 }, testData: true });
    document.getElementById("a")!.remove();
    expect(tr.getState().coverage.total).toBe(1);                                      // un texte retiré par le site ne compte plus
  });
  it("page sans texte traduisible : phase « empty » ; le contenu qui arrive ensuite est traduit", async () => {
    document.body.innerHTML = "<div id='c'></div>";
    const { tr } = make(fakeBackend(), null);
    document.documentElement.setAttribute("lang", "fr");
    await tr.activate("xx-test");
    expect(tr.getState().phase).toBe("empty");
    document.getElementById("c")!.textContent = FR; await wait(120); await tr.idle();
    expect(document.getElementById("c")!.textContent).toMatch(/^\[TEST~\]/); expect(tr.getState().phase).toBe("done");
  });
  it("langue détectée AVANT activation (popup) et page non prise en charge → aucun appel réseau", async () => {
    document.body.innerHTML = `<p>${FR}</p>`;
    const { tr } = make(fakeBackend(), null);
    expect(tr.getState().detectedLang).toBe("fr");
    document.body.innerHTML = "<p>Dies ist ein deutscher Text über Ihr Konto und Ihr Guthaben bei der Bank.</p>"; document.documentElement.setAttribute("lang", "de");
    const fake = fakeBackend(); const t2 = make(fake, null); await t2.tr.activate("xx-test");
    expect(t2.tr.getState()).toMatchObject({ phase: "unavailable", message: "unsupportedSource" }); expect(fake.calls).toHaveLength(0);
  });
  it("navigation interne : rescan() traite le nouveau contenu et oublie l'ancien", async () => {
    document.body.innerHTML = `<main id="m"><p>${FR}</p></main>`;
    const { tr } = make(fakeBackend(), null);
    await tr.activate("xx-test");
    document.getElementById("m")!.innerHTML = "<p>Pour votre sécurité, vérifiez toujours le numéro du bénéficiaire avant de confirmer.</p>";
    await tr.rescan(); await tr.idle();
    expect(document.querySelector("p")!.textContent).toMatch(/^\[TEST~\] Pour votre sécurité/); expect(tr.getState().coverage.total).toBe(1);
  });
  it("page multilingue : chaque segment part avec SA langue", async () => {
    document.body.innerHTML = `<p>${FR}</p><p>You have received money on your account and the balance is available for the transfer to your family.</p>`;
    document.documentElement.setAttribute("lang", "fr");
    const fake = fakeBackend(); const { tr } = make(fake, null); await tr.activate("xx-test");
    const by = Object.fromEntries(fake.calls.filter((c) => c.type === "dl/translate").map((c: any) => [c.source, c.segments.length]));
    expect(by).toEqual({ fr: 1, en: 1 });
  });
  it("désactivation : DOM identique, plus aucune trace ; l'état revient à « inactif »", async () => {
    document.body.innerHTML = FR_PAGE; const before = document.documentElement.outerHTML;
    const { tr } = make(fakeBackend()); await tr.activate("xx-test"); tr.deactivate();
    expect(document.documentElement.outerHTML).toBe(before); expect(tr.getState()).toMatchObject({ phase: "inactive", coverage: { total: 0 } });
  });
});
