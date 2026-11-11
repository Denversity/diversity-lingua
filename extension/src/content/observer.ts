/**
 * Dynamic Content Observer : détecte les nœuds ajoutés/modifiés par le site (SPA, toasts, tableaux, composants web).
 * Nos propres écritures sont ignorées (via isOurs) pour éviter toute boucle de traduction.
 * Chaque racine Shadow DOM découverte est observée via addRoot().
 */
import { HOST_ID } from "./domExtractor";

export class DynamicObserver {
  private mo: MutationObserver | null = null;
  private observed = new WeakSet<Node>();
  private pending = new Set<Node>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private root: Node,
    private onNodes: (nodes: Node[]) => void,
    private isOurs: (node: Node) => boolean,
    private delayMs = 250,
  ) {}

  start(): void {
    if (this.mo) return;
    this.mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") {
          if (!this.isOurs(r.target)) this.pending.add(r.target);
        } else {
          r.addedNodes.forEach((n) => {
            if ((n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) && !this.inHost(n)) this.pending.add(n);
          });
        }
      }
      if (this.pending.size && !this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs);
    });
    this.addRoot(this.root);
  }

  /** Observe une racine supplémentaire (Shadow DOM). Idempotent. */
  addRoot(root: Node): void {
    if (!this.mo || this.observed.has(root)) return;
    this.observed.add(root);
    this.mo.observe(root, { childList: true, characterData: true, subtree: true });
  }

  private inHost(n: Node): boolean {
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
    return !!el && (el.id === HOST_ID || !!el.closest(`#${HOST_ID}`));
  }

  private flush(): void {
    this.timer = null;
    const nodes = [...this.pending].filter((n) => n.isConnected);
    this.pending.clear();
    // ne garder que les nœuds racines (écarter ceux déjà contenus dans un autre nœud collecté)
    const roots = nodes.filter((n) => !nodes.some((o) => o !== n && o.nodeType === Node.ELEMENT_NODE && o.contains(n)));
    if (roots.length) this.onNodes(roots);
  }

  stop(): void {
    this.mo?.disconnect();
    this.mo = null;
    this.observed = new WeakSet();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
