import { describe, expect, it } from "vitest";
import { Restorer } from "../src/content/domRestorer";

describe("DOM Restorer", () => {
  it("restaure texte, attribut et repères à l'identique", () => {
    document.body.innerHTML = `<p id="a" title="Titre">  Bonjour </p>`;
    const before = document.body.innerHTML;
    const p = document.getElementById("a")!; const t = p.firstChild as Text;
    const r = new Restorer();
    r.applyText(t, t.nodeValue!, "  X "); r.applyAttr(p, "title", "Titre", "Y");
    expect(p.textContent).toBe("  X ");
    expect(r.restoreAll()).toEqual({ restored: 2, respectedSiteChanges: 0 });
    expect(document.body.innerHTML).toBe(before);
  });
  it("traduire deux fois garde le TOUT premier original", () => {
    document.body.innerHTML = "<p>Orig</p>"; const t = document.body.firstChild!.firstChild as Text; const r = new Restorer();
    r.applyText(t, "Orig", "A"); r.applyText(t, "A", "B"); r.restoreAll();
    expect(t.nodeValue).toBe("Orig");
  });
  it("ne réécrit pas un texte que le site a modifié depuis", () => {
    document.body.innerHTML = "<p>Orig</p>"; const t = document.body.firstChild!.firstChild as Text; const r = new Restorer();
    r.applyText(t, "Orig", "Traduit"); t.nodeValue = "Mis à jour par le site";
    expect(r.isApplied(t)).toBe(false);
    expect(r.restoreAll().respectedSiteChanges).toBe(1);
    expect(t.nodeValue).toBe("Mis à jour par le site");
  });
  it("revertText/revertAttr rétablissent un nœud sans toucher aux autres", () => {
    document.body.innerHTML = '<p id="a" title="T1">Un</p><p id="b">Deux</p>';
    const a = document.getElementById("a")!, b = document.getElementById("b")!; const r = new Restorer();
    r.applyText(a.firstChild as Text, "Un", "X1"); r.applyText(b.firstChild as Text, "Deux", "X2"); r.applyAttr(a, "title", "T1", "Y1");
    r.revertText(a.firstChild as Text); r.revertAttr(a, "title");
    expect([a.textContent, a.getAttribute("title"), b.textContent]).toEqual(["Un", "T1", "X2"]);
    expect(r.hasRecord(a.firstChild!)).toBe(false);
    expect(r.restoreAll().restored).toBe(1);
  });
  it("n'ajoute JAMAIS d'attribut ni de style aux éléments du site", () => {
    document.body.innerHTML = '<p id="a" class="c" style="color:red">Un</p>'; const p = document.getElementById("a")!;
    const attrsBefore = p.getAttributeNames().sort().join(); const r = new Restorer();
    r.applyText(p.firstChild as Text, "Un", "X");
    expect(p.getAttributeNames().sort().join()).toBe(attrsBefore);
  });
});
