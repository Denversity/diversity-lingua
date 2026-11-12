/**
 * Translation Manager : glossaire local → cache → regroupement par lots → API.
 * Déduplique les textes identiques, limite le débit et la concurrence, ne met JAMAIS en cache les erreurs.
 */
import type { ApiClient } from "./apiClient";
import { ApiError } from "./apiClient";
import type { GlossaryClient } from "./glossaryClient";
import type { ClientResult, SegmentRequest, SegmentResult } from "../shared/types";

export interface ManagerOptions {
  batchSize: number; maxConcurrent: number; minIntervalMs: number;
  cacheTtlMs: number; unavailableTtlMs: number; cacheMax: number;
  now: () => number; sleep: (ms: number) => Promise<void>;
  useLocalGlossary: () => boolean;
}
const DEFAULTS: ManagerOptions = {
  batchSize: 50, maxConcurrent: 2, minIntervalMs: 120, cacheTtlMs: 30 * 60_000, unavailableTtlMs: 5 * 60_000, cacheMax: 3000,
  now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), useLocalGlossary: () => true,
};
const STABLE_UNAVAILABLE = new Set(["no_validated_translation", "language_unavailable", "unsupported_source_language"]);

interface CacheEntry { result: SegmentResult; expires: number }

export class TranslationManager {
  private o: ManagerOptions;
  private cache = new Map<string, CacheEntry>();
  private nextSlot = 0;
  public apiCalls = 0;

  constructor(private api: ApiClient, private glossary: GlossaryClient | null, opts: Partial<ManagerOptions> = {}) {
    this.o = { ...DEFAULTS, ...opts };
  }

  private key(source: string, target: string, s: SegmentRequest): string {
    const c = s.context;
    return `${source}|${target}|${c?.kind ?? ""}|${c?.tag ?? ""}|${c?.attr ?? ""}|${c?.role ?? ""}|${c?.region ?? ""}|${s.text}`;
  }
  private cacheGet(k: string): SegmentResult | null {
    const e = this.cache.get(k);
    if (!e) return null;
    if (e.expires < this.o.now()) { this.cache.delete(k); return null; }
    this.cache.delete(k); this.cache.set(k, e); // LRU
    return e.result;
  }
  private cachePut(k: string, r: SegmentResult): void {
    let ttl = 0;
    if (r.status === "validated" || r.status === "machine_unvalidated") ttl = this.o.cacheTtlMs;
    else if (r.status === "unavailable" && STABLE_UNAVAILABLE.has(r.reason ?? "")) ttl = this.o.unavailableTtlMs;
    if (!ttl) return;
    this.cache.set(k, { result: r, expires: this.o.now() + ttl });
    while (this.cache.size > this.o.cacheMax) this.cache.delete(this.cache.keys().next().value as string);
  }
  clearCache(): void { this.cache.clear(); }

  private async slot(): Promise<void> {
    const now = this.o.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.o.minIntervalMs;
    if (at > now) await this.o.sleep(at - now);
  }

  async translate(source: string, target: string, segments: SegmentRequest[]): Promise<ClientResult[]> {
    const out = new Map<string, ClientResult>();
    const groups = new Map<string, SegmentRequest[]>(); // clé → segments identiques à envoyer une seule fois
    for (const s of segments) {
      const k = this.key(source, target, s);
      if (this.o.useLocalGlossary() && this.glossary) {
        const hit = await this.glossary.lookup(s.text, source, target)
          ?? await this.glossary.lookupOtherSource(s.text, source, target);
        if (hit) {
          out.set(s.id, { id: s.id, translation: hit.translation, status: "validated", origin: "local-glossary", provider: null,
            test_data: !!hit.entry.test_data, entry_id: hit.entry.id, notes: hit.entry.test_data ? ["test_data"] : [] });
          continue;
        }
        const prefixHit = await this.glossary.lookupPrefix(s.text, source, target);
        if (prefixHit) {
          const expanded = await this.glossary.translateInlineTerms(prefixHit.translation, source, target);
          out.set(s.id, { id: s.id, translation: expanded?.translation ?? prefixHit.translation, status: "validated", origin: "local-glossary", provider: null,
            test_data: !!prefixHit.entry.test_data, entry_id: prefixHit.entry.id, notes: prefixHit.entry.test_data ? ["test_data"] : [] });
          continue;
        }
        const inlineHit = await this.glossary.translateInlineTerms(s.text, source, target);
        if (inlineHit) {
          out.set(s.id, { id: s.id, translation: inlineHit.translation, status: "validated", origin: "local-glossary", provider: null,
            test_data: !!inlineHit.entry.test_data, entry_id: inlineHit.entry.id, notes: inlineHit.entry.test_data ? ["test_data"] : [] });
          continue;
        }
      }
      const cached = this.cacheGet(k);
      if (cached) { out.set(s.id, { ...cached, id: s.id }); continue; }
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
    }

    const uniques = [...groups.entries()].map(([k, members], i) => ({ k, members, rid: `u${i}`, rep: members[0] }));
    const batches: typeof uniques[] = [];
    for (let i = 0; i < uniques.length; i += this.o.batchSize) batches.push(uniques.slice(i, i + this.o.batchSize));

    const runBatch = async (batch: typeof uniques) => {
      await this.slot();
      this.apiCalls++;
      try {
        const resp = await this.api.translate(source, target, batch.map((u) => ({ id: u.rid, text: u.rep.text, context: u.rep.context })));
        const byId = new Map(resp.results.map((r) => [r.id, r]));
        for (const u of batch) {
          const r = byId.get(u.rid);
          for (const m of u.members) {
            if (r) out.set(m.id, { ...r, id: m.id });
            else out.set(m.id, { id: m.id, status: "error", translation: null, reason: "missing_result" });
          }
          if (r) this.cachePut(u.k, r);
        }
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "network";
        for (const u of batch) for (const m of u.members) out.set(m.id, { id: m.id, status: "error", translation: null, reason: code });
      }
    };
    let idx = 0;
    const workers = Array.from({ length: Math.min(this.o.maxConcurrent, batches.length) }, async () => {
      while (idx < batches.length) await runBatch(batches[idx++]);
    });
    await Promise.all(workers);
    return segments.map((s) => out.get(s.id) ?? { id: s.id, status: "error" as const, translation: null, reason: "missing_result" });
  }
}
