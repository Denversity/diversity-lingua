/**
 * Registre de couverture : une entrée par texte/attribut traité, tant que son nœud est dans la page.
 * (Les compteurs reflètent donc la page ACTUELLE, pas un cumul — essentiel sur des interfaces dynamiques.)
 */
export type LedgerStatus = "approved" | "automatic" | "pending_validation" | "unavailable" | "rejected" | "layout" | "error";
export interface LedgerEntry { status: LedgerStatus; reason?: string | null; testData?: boolean }

export interface Summary {
  approved: number; automatic: number; pending_validation: number; unavailable: number; rejected: number; layout: number; error: number;
  total: number;
  verified: number;      // approuvées par un validateur
  unverified: number;    // automatiques + propositions en attente
  kept: number;          // laissées dans la langue d'origine (toutes raisons)
  reasons: Record<string, number>;
  testData: boolean;
}

export class Ledger {
  private m = new Map<Node, Map<string, LedgerEntry>>();
  set(node: Node, attr: string | undefined, e: LedgerEntry): void {
    const per = this.m.get(node) ?? new Map<string, LedgerEntry>();
    per.set(attr ?? "", e);
    this.m.set(node, per);
  }
  get(node: Node, attr?: string): LedgerEntry | undefined { return this.m.get(node)?.get(attr ?? ""); }
  delete(node: Node, attr?: string): void {
    const per = this.m.get(node);
    if (!per) return;
    per.delete(attr ?? "");
    if (!per.size) this.m.delete(node);
  }
  prune(): void { for (const n of [...this.m.keys()]) if (!n.isConnected) this.m.delete(n); }
  clear(): void { this.m.clear(); }

  summary(): Summary {
    const s: Summary = { approved: 0, automatic: 0, pending_validation: 0, unavailable: 0, rejected: 0, layout: 0, error: 0, total: 0,
      verified: 0, unverified: 0, kept: 0, reasons: {}, testData: false };
    for (const [node, per] of this.m) {
      if (!node.isConnected) continue;
      for (const e of per.values()) {
        s[e.status]++; s.total++;
        if (e.testData) s.testData = true;
        if (e.status === "unavailable" || e.status === "rejected" || e.status === "layout" || e.status === "error") {
          const k = e.status === "layout" ? "layout" : e.reason || e.status;
          s.reasons[k] = (s.reasons[k] ?? 0) + 1;
        }
      }
    }
    s.verified = s.approved;
    s.unverified = s.automatic + s.pending_validation;
    s.kept = s.unavailable + s.rejected + s.layout + s.error;
    return s;
  }
}
