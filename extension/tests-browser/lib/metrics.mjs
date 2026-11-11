// Mesures de mise en page exécutées DANS la page (vrai moteur de rendu).
export const collect = () => {
  const items = [...document.querySelectorAll("body *")].filter((e) => e.id !== "dl-root" && !e.closest("#dl-root"));
  const cs = (e) => getComputedStyle(e);
  const CTRL = "button,[role=tab],.btn,.fab,select,.badge";
  return {
    n: items.length,
    styles: items.map((e) => { const c = cs(e); return [c.color, c.fontSize, c.fontFamily, c.fontWeight, c.backgroundColor, c.borderRadius, c.padding, c.position, c.lineHeight, c.letterSpacing].join("|"); }),
    attrs: items.map((e) => e.getAttributeNames().sort().join(",")),
    rects: items.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
    clip: items.map((e) => { const c = cs(e); return { dx: e.clientWidth > 0 ? e.scrollWidth - e.clientWidth : 0, dy: e.clientHeight > 0 ? e.scrollHeight - e.clientHeight : 0, ox: c.overflowX, oy: c.overflowY, nowrap: /nowrap/.test(c.whiteSpace), ell: c.textOverflow === "ellipsis" }; }),
    ctrl: items.map((e) => e.matches(CTRL)),
    names: items.map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "")),
    inputs: [...document.querySelectorAll("input,textarea,select")].map((e) => e.value),
    doc: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight },
    head: document.head.children.length, adopted: (document.adoptedStyleSheets || []).length, host: !!document.getElementById("dl-root"),
  };
};

/** Compare avant/après : ne retient que les RUPTURES (pas les simples changements de taille inévitables avec une autre langue). */
export function judge(b, a) {
  const out = { styleChanges: 0, attrChanges: 0, newClip: [], controlWrap: [], docOverflow: false, structure: a.n === b.n, inputsChanged: JSON.stringify(a.inputs) !== JSON.stringify(b.inputs), headDelta: a.head - b.head };
  if (!out.structure) return out;
  for (let i = 0; i < b.n; i++) {
    if (a.styles[i] !== b.styles[i]) out.styleChanges++;
    if (a.attrs[i] !== b.attrs[i]) out.attrChanges++;
    const bc = b.clip[i], ac = a.clip[i];
    // Rupture = troncature NOUVELLE ou AGGRAVÉE (de plus de 1 px) dans un élément qui coupe son contenu.
    const clipsX = ac.ox === "hidden" || ac.ox === "clip" || ac.ell || (ac.ox === "visible" && ac.nowrap);
    const clipsY = ac.oy === "hidden" || ac.oy === "clip";
    if ((clipsX && ac.dx > Math.max(0, bc.dx) + 1) || (clipsY && ac.dy > Math.max(0, bc.dy) + 1)) out.newClip.push(a.names[i]);
    if (a.ctrl[i] && a.rects[i][3] - b.rects[i][3] > Math.max(6, 0.3 * b.rects[i][3])) out.controlWrap.push(a.names[i]);
  }
  out.docOverflow = a.doc.sw > a.doc.cw + 1 && !(b.doc.sw > b.doc.cw + 1);
  out.ruptures = out.newClip.length + out.controlWrap.length + (out.docOverflow ? 1 : 0);
  return out;
}
