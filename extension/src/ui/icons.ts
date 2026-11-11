/** Icônes (trait 1.8, 24×24) — construites via createElementNS, aucun innerHTML. */
const PATHS = {
  check: ["M5 12.5l4.2 4.2L19 7"],
  shield: ["M12 3l7 3v5.5c0 4.4-2.9 7.9-7 9.5-4.1-1.6-7-5.1-7-9.5V6l7-3z", "M8.6 12.2l2.5 2.5 4.4-4.6"],
  spark: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"],
  eye: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z"],
  globe: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M3.5 9h17M3.5 15h17", "M12 3c2.6 2.4 3.8 5.4 3.8 9s-1.2 6.6-3.8 9c-2.6-2.4-3.8-5.4-3.8-9S9.4 5.4 12 3z"],
  info: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M12 11v5.2", "M12 7.8v.1"],
  close: ["M6 6l12 12M18 6L6 18"],
  flag: ["M6 21V4", "M6 4.5h11l-2.2 4 2.2 4H6"],
  book: ["M5 4.5h10a3 3 0 013 3V20H8a3 3 0 01-3-3V4.5z", "M5 17a3 3 0 013-3h10"],
  undo: ["M9 7L4.5 11.5 9 16", "M5 11.5h9.5a5 5 0 010 10H12"],
  gear: ["M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z", "M19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 01-1.6.9l-.3 2h-3.6l-.3-2a7 7 0 01-1.6-.9l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 010-1.8L5 10.5l1.8-3.1 1.9.7a7 7 0 011.6-.9l.3-2h3.6l.3 2a7 7 0 011.6.9l1.9-.7 1.8 3.1-1.6 1.2a7 7 0 010 1.8z"],
  alert: ["M12 3.5l9.5 16.5h-19L12 3.5z", "M12 10v4.5", "M12 17.2v.1"],
  offline: ["M3 3l18 18", "M8.5 16.5a5 5 0 017-.2", "M5 12.8a9.5 9.5 0 014-2.4", "M12 20h.01"],
  lock: ["M6.5 10.5h11v9h-11z", "M8.5 10.5V8a3.5 3.5 0 017 0v2.5"],
  keep: ["M4 7h16M4 12h16M4 17h10"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  send: ["M4 12l16-7-6 15-2.5-6L4 12z"],
} as const;
export type IconName = keyof typeof PATHS;
const NS = "http://www.w3.org/2000/svg";
export function icon(doc: Document, name: IconName): SVGElement {
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "dl-icon"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  for (const d of PATHS[name]) { const p = doc.createElementNS(NS, "path"); p.setAttribute("d", d); svg.append(p); }
  return svg;
}

/** Marque Diversity Lingua (bulle de dialogue) — même dessin que l'icône de l'extension. */
export function markSvg(doc: Document, size = 20): SVGElement {
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const r = doc.createElementNS(NS, "rect"); r.setAttribute("width", "32"); r.setAttribute("height", "32"); r.setAttribute("rx", "9"); r.setAttribute("fill", "#0e6b5c");
  const b = doc.createElementNS(NS, "path"); b.setAttribute("d", "M7 8.5h18a2.5 2.5 0 012.5 2.5v8a2.5 2.5 0 01-2.5 2.5H15l-5 4.2v-4.2H7A2.5 2.5 0 014.5 19v-8A2.5 2.5 0 017 8.5z"); b.setAttribute("fill", "#fbfaf6");
  const d = doc.createElementNS(NS, "circle"); d.setAttribute("cx", "22.5"); d.setAttribute("cy", "22.5"); d.setAttribute("r", "4.2"); d.setAttribute("fill", "#d98e04");
  svg.append(r, b, d);
  return svg;
}
