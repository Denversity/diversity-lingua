/**
 * PageTranslator : extraction → traduction par lots → GARDE DE MISE EN PAGE → application → observation → restauration.
 * Toutes les communications réseau passent par le service worker (jamais d'appel direct depuis la page).
 */
import { detectLanguage } from "../shared/langdetect";
import { hasTranslatableLetters, maskText, placeholdersMatch, unmask } from "../shared/protect";
import { canonicalStatus, hasDisplayableText, type Canonical } from "../shared/status";
import {
  emptyCounts, type BgRequest, type BgResponse, type ClientResult, type ExplainResponse, type PageState, type SegmentRequest, type UiPhase,
} from "../shared/types";
import { DomExtractor, type SegmentRef } from "./domExtractor";
import { Restorer } from "./domRestorer";
import { Ledger, type LedgerStatus } from "./ledger";
import { LayoutGuard, type Box, type Snapshot } from "./layoutGuard";
import { HighlightMarks, type MarkMode } from "./marks";
import { DynamicObserver } from "./observer";
import { RouteWatcher } from "./routes";

export interface ControllerSettings { translateAttributes: boolean; marks: MarkMode; layoutGuard?: boolean }
export interface Deps {
  doc: Document;
  send: (req: BgRequest) => Promise<BgResponse<any>>;
  settings: () => ControllerSettings;
  defaultTarget: () => string;
  onState: (s: PageState) => void;
  batchSize?: number;
  mutationDelayMs?: number;
  guard?: LayoutGuard | null;      // null = désactivé (tests sans mise en page)
  marks?: HighlightMarks | null;   // null = pas de repères
  watchRoutes?: boolean;
}

interface Plan { ref: SegmentRef; final: string; status: Canonical; testData: boolean }
/** État partagé par tous les lots d'un même traitement : mise en page D'ORIGINE (mesurée avant toute écriture) et textes appliqués. */
interface GuardCtx {
  guard: LayoutGuard | null; baseline: Map<Element, Snapshot>; pageBefore: boolean; applied: Plan[]; reverted: Set<Plan>;
  victims: Map<Element, { box: Box; container: Element }>; // éléments tronquables des conteneurs concernés (victimes collatérales)
}

function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
const ledgerStatus = (c: Canonical): LedgerStatus => (c === "approved" || c === "automatic" || c === "pending_validation" || c === "rejected" || c === "unavailable" ? c : "error");

export class PageTranslator {
  private restorer = new Restorer();
  private ledger = new Ledger();
  private extractor: DomExtractor;
  private observer: DynamicObserver | null = null;
  private routes: RouteWatcher | null = null;
  private marks: HighlightMarks | null;
  private guard: LayoutGuard | null;
  private gen = 0;
  private active = false;
  private target: string | null = null;
  private source: "fr" | "en" | "unknown" = "unknown";
  private pendingCount = 0;
  private message: string | undefined;
  private phase: UiPhase = "inactive";
  private churn = new WeakMap<Node, { n: number; t: number }>();
  private blocked = new WeakSet<Node>();
  /** Textes volontairement conservés (mise en page) : tant que leur valeur n'a pas changé, on ne les retraite pas. */
  private kept = new WeakMap<Node, string>();
  private isKept(n: Node, attr?: string): boolean {
    const v = attr ? (n as Element).getAttribute(attr) : n.nodeValue;
    return this.kept.get(n) === v && v !== null;
  }
  private chain: Promise<void> = Promise.resolve(); // sérialise les traitements (lots + mutations + navigation)

  constructor(private d: Deps) {
    this.guard = d.guard === undefined ? new LayoutGuard(d.doc.defaultView as Window) : d.guard;
    this.marks = d.marks === undefined ? new HighlightMarks(d.doc, () => d.settings().marks) : d.marks;
    this.extractor = this.newExtractor();
  }

  private newExtractor(): DomExtractor {
    return new DomExtractor({
      attributes: this.d.settings().translateAttributes,
      targetLang: this.target ?? undefined,
      shouldSkip: (n, attr) => this.restorer.isApplied(n, attr) || this.blocked.has(n) || this.isKept(n, attr),
      onShadowRoot: (r) => this.observer?.addRoot(r),
    });
  }

  // ------------------------------------------------------------------ état
  /** Langue de la page avant toute activation (échantillon léger, mis en cache 5 s). */
  private peeked: { at: number; lang: "fr" | "en" | "unknown" } | null = null;
  peekLanguage(): "fr" | "en" | "unknown" {
    const now = Date.now();
    if (this.peeked && now - this.peeked.at < 5000) return this.peeked.lang;
    let sample = "";
    const body = this.d.doc.body;
    if (body) {
      const w = this.d.doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(n.parentElement?.tagName ?? "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      for (let n = w.nextNode(); n && sample.length < 4000; n = w.nextNode()) sample += " " + (n.nodeValue ?? "");
    }
    const lang = detectLanguage(sample, this.d.doc.documentElement.getAttribute("lang")).lang;
    this.peeked = { at: now, lang };
    return lang;
  }

  getState(): PageState {
    this.ledger.prune();
    const s = this.ledger.summary();
    const counts = { ...emptyCounts(), validated: s.approved, machine_unvalidated: s.unverified, unavailable: s.unavailable + s.rejected,
      layout: s.layout, error: s.error, pending: this.pendingCount };
    return { phase: this.phase, target: this.target, detectedLang: this.active ? this.source : this.peekLanguage(), total: s.total + this.pendingCount, counts, testData: s.testData,
      message: this.message, coverage: { verified: s.verified, unverified: s.unverified, kept: s.kept, total: s.total }, reasons: s.reasons };
  }
  private emit(phase?: UiPhase, message?: string): void {
    if (phase) this.phase = phase;
    this.message = message;
    this.d.onState(this.getState());
  }

  // ------------------------------------------------------------------ activation
  async activate(target: string): Promise<void> {
    if (this.active) this.deactivate();
    const gen = ++this.gen;
    this.active = true;
    this.target = target;
    this.pendingCount = 0;
    this.emit("detecting");
    this.extractor = this.newExtractor();
    const refs = this.extractor.extract(this.d.doc);
    this.source = this.pageLanguage(refs);
    if (this.source === "unknown") {
      this.emit("unavailable", "unsupportedSource");
      return;
    }
    this.observer = new DynamicObserver(this.d.doc.body ?? this.d.doc.documentElement,
      (nodes) => this.enqueue(() => this.onMutations(nodes, gen)), (n) => this.restorer.isApplied(n) || this.isKept(n), this.d.mutationDelayMs ?? 250);
    this.observer.start();
    if (this.d.watchRoutes !== false) {
      this.routes = new RouteWatcher(this.d.doc.defaultView as Window, () => this.enqueue(() => this.rescan(gen)));
      this.routes.start();
    }
    if (!refs.length) { this.emit("empty"); return; }
    this.emit("translating");
    await this.enqueue(() => this.process(refs, gen));
  }

  deactivate(): void {
    this.gen++;
    this.active = false;
    this.observer?.stop(); this.observer = null;
    this.routes?.stop(); this.routes = null;
    this.restorer.restoreAll();
    this.marks?.clear();
    this.ledger.clear();
    this.pendingCount = 0;
    this.blocked = new WeakSet(); this.churn = new WeakMap(); this.kept = new WeakMap();
    this.emit("inactive");
  }

  /** Attend la fin des traitements en cours (utile aux tests et à la restauration propre). */
  idle(): Promise<void> { return this.chain; }
  private enqueue(fn: () => Promise<void>): Promise<void> { this.chain = this.chain.then(fn, fn); return this.chain; }

  private pageLanguage(refs: SegmentRef[]): "fr" | "en" | "unknown" {
    const sample = refs.map((r) => r.masked.replace(/\{\{P\d+\}\}/g, " ")).join(" ").slice(0, 8000);
    return detectLanguage(sample, this.d.doc.documentElement.getAttribute("lang")).lang;
  }

  /** Langue d'un segment : détection fine si nette (pages multilingues), sinon langue de la page. */
  private segmentLang(ref: SegmentRef): "fr" | "en" {
    const d = detectLanguage(ref.masked.replace(/\{\{P\d+\}\}/g, " "), null, 1, 1);
    if (d.source === "text" && (d.lang === "fr" || d.lang === "en")) return d.lang;
    // Texte trop court pour trancher (« Send money ») : on respecte l'attribut lang posé par le site sur l'élément ou un ancêtre
    // (hors <html>, dont la langue sert déjà de repli global via this.source).
    const node = ref.node as Node;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const holder = el?.closest?.("[lang]") ?? null;
    const hl = holder && holder !== this.d.doc.documentElement ? (holder.getAttribute("lang") ?? "").toLowerCase().slice(0, 2) : "";
    return hl === "fr" || hl === "en" ? hl : (this.source as "fr" | "en");
  }

  // ------------------------------------------------------------------ contenus dynamiques et navigation
  private async onMutations(nodes: Node[], gen: number): Promise<void> {
    if (gen !== this.gen || !this.active) return;
    const now = Date.now();
    const refs: SegmentRef[] = [];
    for (const n of nodes) {
      if (!n.isConnected || this.blocked.has(n)) continue;
      if (n.nodeType === Node.TEXT_NODE && this.restorer.hasRecord(n) && !this.restorer.isApplied(n)) {
        // le site a réécrit un texte déjà traité : nouvel original. Garde anti-boucle (re-rendus en rafale).
        const c = this.churn.get(n) ?? { n: 0, t: now };
        if (now - c.t > 10_000) { c.n = 0; c.t = now; }
        c.n++;
        this.churn.set(n, c);
        if (c.n > 6) { this.blocked.add(n); continue; }
        this.restorer.forget(n); this.ledger.delete(n); this.marks?.unmark(n);
      }
      refs.push(...this.extractor.extract(n));
    }
    this.restorer.prune(); this.ledger.prune();
    // Le site peut changer de langue (bouton FR/EN) : si un lot important est nettement dans l'autre langue, on suit.
    const det = detectLanguage(refs.map((r) => r.masked.replace(/\{\{P\d+\}\}/g, " ")).join(" ").slice(0, 8000), null);
    if (det.source === "text" && (det.lang === "fr" || det.lang === "en") && det.lang !== this.source) this.source = det.lang;
    await this.process(refs, gen);
  }

  /** Nouveau balayage complet (navigation interne sans rechargement). */
  async rescan(gen = this.gen): Promise<void> {
    if (gen !== this.gen || !this.active) return;
    this.restorer.prune(); this.ledger.prune();
    this.blocked = new WeakSet(); this.churn = new WeakMap();
    const refs = this.extractor.extract(this.d.doc);
    const lang = this.pageLanguage(refs);
    if (lang !== "unknown") this.source = lang;
    if (!refs.length) { this.finalize(); return; }
    await this.process(refs, gen);
  }

  // ------------------------------------------------------------------ traitement par lots
  private async process(refs: SegmentRef[], gen: number): Promise<void> {
    if (!refs.length || gen !== this.gen) { if (gen === this.gen) this.finalize(); return; }
    this.pendingCount += refs.length;
    this.emit("translating");
    const target = this.target!;
    const ctx = this.newGuardCtx(refs);
    const groups = new Map<string, SegmentRef[]>();
    for (const r of refs) { const l = this.segmentLang(r); (groups.get(l) ?? groups.set(l, []).get(l)!).push(r); }
    let failures = 0, lastCode = "";
    for (const [source, list] of groups) {
      for (const batch of chunk(list, this.d.batchSize ?? 50)) {
        if (gen !== this.gen) return;
        let results: ClientResult[] | null = null;
        if (failures < 2) {
          const segments: SegmentRequest[] = batch.map((r) => ({ id: r.id, text: r.masked, context: r.context }));
          try {
            const resp = await this.d.send({ type: "dl/translate", source, target, segments });
            if (resp.ok) { results = resp.data as ClientResult[]; failures = 0; } else { failures++; lastCode = resp.code; }
          } catch { failures++; lastCode = "network"; }
          if (gen !== this.gen) return;
        } else lastCode ||= "network";
        const byId = new Map((results ?? []).map((r) => [r.id, r]));
        const plans: Plan[] = [];
        for (const ref of batch) {
          const res = byId.get(ref.id) ?? { id: ref.id, status: "error" as const, translation: null, reason: lastCode || "missing_result" };
          const plan = this.classify(ref, res);
          if (plan) plans.push(plan);
          this.pendingCount--;
        }
        this.applyBatch(plans, ctx);
        this.emit("translating");
      }
    }
    this.enforce(ctx); // stabilisation finale : l'interaction entre lots est jugée par rapport à la mise en page d'origine
    this.finalize(lastCode);
  }

  /** Décide du sort d'un résultat : plan d'application, ou entrée de registre (texte conservé). */
  private classify(ref: SegmentRef, res: ClientResult): Plan | null {
    const key = ref.kind === "text" ? ref.node : ref.node;
    const attr = ref.kind === "attr" ? ref.attr : undefined;
    const c = canonicalStatus(res as any);
    const reason = (res as any).reason ?? null;
    if (res.status === "error") { this.ledger.set(key, attr, { status: "error", reason }); return null; }
    if (res.status === "unchanged") return null;
    if (!hasDisplayableText(c) || res.translation == null) {
      this.ledger.set(key, attr, { status: ledgerStatus(c === "rejected" ? "rejected" : "unavailable"), reason });
      return null;
    }
    // Défense en profondeur : même si le serveur répond, on revérifie l'intégrité des jetons.
    if (!placeholdersMatch(ref.masked, res.translation)) { this.ledger.set(key, attr, { status: "unavailable", reason: "integrity_check_failed" }); return null; }
    // Le site a pu changer le nœud pendant la requête : l'observateur reprendra, on ne l'écrase pas.
    if (ref.kind === "text") {
      const n = ref.node as Text;
      if (!n.isConnected || n.nodeValue !== ref.original) return null;
    } else {
      const e = ref.node as Element;
      if (!e.isConnected || e.getAttribute(ref.attr!) !== ref.original) return null;
    }
    return { ref, final: ref.lead + unmask(res.translation, ref.tokens) + ref.trail, status: c, testData: !!(res as any).test_data };
  }

  private newGuardCtx(refs: SegmentRef[]): GuardCtx {
    const guard = this.d.settings().layoutGuard === false ? null : this.guard;
    const ctx: GuardCtx = { guard, baseline: new Map(), pageBefore: false, applied: [], reverted: new Set(), victims: new Map() };
    if (guard) {
      // Mesure UNIQUE de la mise en page d'origine, avant toute écriture (un seul recalcul pour tous les éléments concernés).
      for (const r of refs) { const e = LayoutGuard.elementFor(r.node); if (e && !ctx.baseline.has(e)) ctx.baseline.set(e, guard.snapshot(e)); }
      ctx.pageBefore = guard.pageOverflowsX();
      // Victimes collatérales : éléments tronquables partageant un conteneur (table, flex, grille) avec un texte traduit.
      const containers = new Set<Element>();
      for (const e of ctx.baseline.keys()) { const c = guard.containerOf(e); if (c) containers.add(c); }
      // Chaque victime est rattachée à son conteneur LE PLUS PROCHE (le tableau, pas la page entière) : on limite ainsi les rétablissements.
      const depth = (e: Element) => { let d = 0; for (let x: Element | null = e; x; x = x.parentElement) d++; return d; };
      for (const c of [...containers].sort((a, b) => depth(b) - depth(a)))
        for (const v of guard.collectClippable(c)) if (!ctx.victims.has(v)) ctx.victims.set(v, { box: guard.measure(v), container: c });
    }
    return ctx;
  }

  private revert(p: Plan, ctx: GuardCtx): void {
    this.kept.set(p.ref.node, p.ref.original);
    if (p.ref.kind === "text") { this.restorer.revertText(p.ref.node as Text); this.marks?.unmark(p.ref.node); }
    else this.restorer.revertAttr(p.ref.node as Element, p.ref.attr!);
    this.ledger.set(p.ref.node, p.ref.kind === "attr" ? p.ref.attr : undefined, { status: "layout", reason: "layout" });
    ctx.reverted.add(p);
  }

  /** Écriture d'un lot puis contrôle : les textes qui dégradent la mise en page sont rétablis. */
  private applyBatch(plans: Plan[], ctx: GuardCtx): void {
    if (!plans.length) return;
    for (const p of plans) {
      if (p.ref.kind === "text") this.restorer.applyText(p.ref.node as Text, p.ref.original, p.final);
      else this.restorer.applyAttr(p.ref.node as Element, p.ref.attr!, p.ref.original, p.final);
      const attr = p.ref.kind === "attr" ? p.ref.attr : undefined;
      this.ledger.set(p.ref.node, attr, { status: ledgerStatus(p.status), testData: p.testData });
    }
    ctx.applied.push(...plans);
    this.enforce(ctx);
    for (const p of plans) if (!ctx.reverted.has(p) && p.ref.kind === "text") this.marks?.mark(p.ref.node as Text, p.status === "approved" ? "verified" : "auto");
  }

  /**
   * Un texte qui grandit réduit la place de ses voisins (colonnes de tableau, éléments flex). Si un élément — traduit ou non —
   * se met à tronquer son contenu, on rétablit les traductions de son conteneur, les plus larges d'abord, jusqu'à résorption.
   */
  private protectVictims(ctx: GuardCtx): void {
    const guard = ctx.guard!;
    const elOf = (p: Plan) => LayoutGuard.elementFor(p.ref.node);
    const growth = (p: Plan) => { const e = elOf(p), b = e && ctx.baseline.get(e); return e && b ? guard.measure(e).w - b.chain[0].w : 0; };
    const ignored = new Set<Element>(); // victimes sans culprit parmi nos traductions (changement propre au site) : on n'insiste pas
    for (let iter = 0; iter < 80; iter++) {
      const hit = [...ctx.victims].filter(([v, info]) => !ignored.has(v) && v.isConnected && guard.isNewClip(info.box, guard.measure(v)));
      if (!hit.length) return;
      const [victim, info] = hit[0];
      // un par un, du texte qui a le plus élargi sa piste au moins large : on rétablit le MINIMUM nécessaire
      const cands = ctx.applied.filter((p) => !ctx.reverted.has(p) && elOf(p) && info.container.contains(elOf(p)!)).sort((a, b) => growth(b) - growth(a));
      if (!cands.length) { ignored.add(victim); continue; }
      this.revert(cands[0], ctx);
    }
  }

  /** Point fixe : rétablir un texte peut en faire déborder un autre (colonnes de tableau, flex…) → on re-juge tout jusqu'à stabilité. */
  private enforce(ctx: GuardCtx): void {
    const guard = ctx.guard;
    if (!guard) return;
    const elOf = (p: Plan) => LayoutGuard.elementFor(p.ref.node);
    let after = new Map<Element, Snapshot>();
    for (let pass = 0; pass < 6; pass++) {
      const live = ctx.applied.filter((p) => !ctx.reverted.has(p) && elOf(p)?.isConnected);
      if (!live.length) return;
      after = new Map<Element, Snapshot>();
      for (const e of new Set(live.map(elOf).filter((x): x is Element => !!x))) after.set(e, guard.snapshot(e));
      const bad = live.filter((p) => { const e = elOf(p); const b = e && ctx.baseline.get(e); return !!e && !!b && !!guard.judge(b, after.get(e)!); });
      if (!bad.length) break;
      for (const p of bad) this.revert(p, ctx);
    }
    this.protectVictims(ctx);
    if (!ctx.pageBefore && guard.pageOverflowsX()) {
      // la page déborde désormais en largeur : on rétablit les textes qui ont le plus grandi jusqu'à résorption
      const growth = (p: Plan) => { const e = elOf(p); const a = e && after.get(e), b = e && ctx.baseline.get(e); return a && b ? a.chain[0].w - b.chain[0].w : 0; };
      for (const p of ctx.applied.filter((x) => !ctx.reverted.has(x) && growth(x) > 4).sort((a, b) => growth(b) - growth(a))) {
        this.revert(p, ctx);
        if (!guard.pageOverflowsX()) break;
      }
    }
  }

  private finalize(lastCode = ""): void {
    this.ledger.prune();
    if (this.pendingCount > 0) return;
    const s = this.ledger.summary();
    const translated = s.verified + s.unverified;
    const other = s.unavailable + s.rejected + s.layout;
    let phase: UiPhase = "done";
    if (s.total === 0) phase = "empty";
    else if (translated === 0) phase = s.error > 0 && other === 0 ? "error" : "unavailable";
    else if (s.error > 0 || other > 0) phase = "partial";
    this.emit(phase, phase === "error" ? lastCode || "network" : undefined);
  }

  // ------------------------------------------------------------------ sélection (comprendre, traduire, signaler)
  private async ensureSource(text: string): Promise<"fr" | "en"> {
    const selection = detectLanguage(text, null, 1, 1);
    if (selection.source === "text" && selection.lang !== "unknown") return selection.lang;
    if (this.source !== "unknown") return this.source;
    const d = detectLanguage(text, this.d.doc.documentElement.getAttribute("lang"));
    return d.lang === "unknown" ? "fr" : d.lang;
  }
  get targetLang(): string { return this.target ?? this.d.defaultTarget(); }
  get sourceLang(): "fr" | "en" | "unknown" { return this.source; }
  get isActive(): boolean { return this.active; }

  /** Pour un nœud texte déjà traité : original, texte affiché et statut (la sélection d'un texte traduit doit remonter à l'ORIGINAL). */
  inspectNode(node: Node): { original: string; shown: string; status: LedgerStatus | null; testData: boolean } | null {
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const original = this.restorer.originalOf(node);
    const e = this.ledger.get(node);
    // Texte volontairement laissé tel quel pour préserver la mise en page : on le sait, et on pourra l'expliquer à l'utilisateur.
    if (original === undefined) return e?.status === "layout" ? { original: (node.nodeValue ?? "").trim(), shown: "", status: "layout", testData: !!e.testData } : null;
    return { original: original.trim(), shown: (node.nodeValue ?? "").trim(), status: e?.status ?? null, testData: !!e?.testData };
  }

  async translateText(text: string): Promise<{ original: string; result: ClientResult }> {
    const m = maskText(text.trim());
    if (!hasTranslatableLetters(m.masked)) return { original: text, result: { id: "sel", status: "unchanged", translation: text } };
    const source = await this.ensureSource(text);
    const resp = await this.d.send({ type: "dl/translate", source, target: this.targetLang,
      segments: [{ id: "sel", text: m.masked, context: { kind: "text", tag: "p" } }] });
    if (!resp.ok) return { original: text, result: { id: "sel", status: "error", translation: null, reason: resp.code } };
    const r = (resp.data as ClientResult[])[0];
    if (r && r.status !== "error" && r.translation != null) {
      if (!placeholdersMatch(m.masked, r.translation)) return { original: text, result: { id: "sel", status: "unavailable", translation: null, reason: "integrity_check_failed" } };
      return { original: text, result: { ...r, translation: unmask(r.translation, m.tokens) } };
    }
    return { original: text, result: r ?? { id: "sel", status: "error", translation: null, reason: "missing_result" } };
  }

  async explainText(text: string): Promise<{ ok: true; data: ExplainResponse; sourceLang: "fr" | "en" } | { ok: false; code: string }> {
    const m = maskText(text.trim());
    const source = await this.ensureSource(text);
    const resp = await this.d.send({ type: "dl/explain", source, target: this.targetLang, text: m.masked });
    return resp.ok ? { ok: true, data: resp.data as ExplainResponse, sourceLang: source } : { ok: false, code: resp.code };
  }
}
