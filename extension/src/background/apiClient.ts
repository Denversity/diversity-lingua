/** Client API : délais d'expiration, nouvelles tentatives bornées, validation stricte des réponses. */
import type { ExplainResponse, FeedbackPayload, LanguageInfo, SegmentResult, TranslateResponse } from "../shared/types";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); }
}
export interface ApiConfig { baseUrl: string; token: string }
export interface ApiOptions { timeoutMs: number; retries: number; backoffMs: number; sleep: (ms: number) => Promise<void> }
const DEFAULTS: ApiOptions = { timeoutMs: 15_000, retries: 2, backoffMs: 400, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const STATUSES = new Set(["validated", "machine_unvalidated", "unavailable", "unchanged"]);

function isSegmentResult(x: any): x is SegmentResult {
  return x && typeof x.id === "string" && STATUSES.has(x.status) && (x.translation === null || typeof x.translation === "string");
}
export function parseTranslateResponse(x: any): TranslateResponse {
  if (!x || !Array.isArray(x.results) || !x.results.every(isSegmentResult)) throw new ApiError("bad_response", "Réponse du serveur invalide");
  // Cohérence : une traduction fournie doit avoir un statut qui en porte une.
  for (const r of x.results as SegmentResult[]) {
    if (r.status === "unavailable" && r.translation !== null) r.translation = null;
  }
  return x as TranslateResponse;
}

export class ApiClient {
  private o: ApiOptions;
  constructor(private cfg: () => Promise<ApiConfig>, private fetchImpl: typeof fetch = (...a) => fetch(...a), opts: Partial<ApiOptions> = {}) {
    this.o = { ...DEFAULTS, ...opts };
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const { baseUrl, token } = await this.cfg();
    let lastErr: ApiError = new ApiError("network", "Échec réseau");
    for (let attempt = 0; attempt <= this.o.retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (token) headers["X-DL-Token"] = token;
        const res = await this.fetchImpl(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, credentials: "omit" });
        if (res.ok) {
          try { return (await res.json()) as T; } catch { throw new ApiError("bad_response", "Réponse JSON invalide"); }
        }
        if (res.status === 401 || res.status === 403) throw new ApiError("unauthorized", "Accès refusé", res.status);
        if (res.status === 429) {
          lastErr = new ApiError("rate_limited", "Trop de requêtes", 429);
          const ra = Number(res.headers.get("Retry-After")) || 0;
          if (attempt < this.o.retries) await this.o.sleep(Math.min(ra * 1000 || this.o.backoffMs * 2 ** attempt, 5000));
          continue;
        }
        if (res.status >= 500) {
          lastErr = new ApiError("server", `Erreur serveur ${res.status}`, res.status);
          if (attempt < this.o.retries) await this.o.sleep(this.o.backoffMs * 2 ** attempt);
          continue;
        }
        throw new ApiError(`http_${res.status}`, `Requête refusée (${res.status})`, res.status);
      } catch (e) {
        if (e instanceof ApiError && !["network", "timeout"].includes(e.code)) throw e;
        const aborted = (e as any)?.name === "AbortError";
        lastErr = new ApiError(aborted ? "timeout" : "network", aborted ? "Délai dépassé" : "Échec réseau");
        if (attempt < this.o.retries) await this.o.sleep(this.o.backoffMs * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  async translate(source: string, target: string, segments: { id: string; text: string; context?: unknown }[]): Promise<TranslateResponse> {
    return parseTranslateResponse(await this.request("POST", "/api/v1/translate", { source_lang: source, target_lang: target, segments }));
  }
  async explain(source: string, target: string, text: string): Promise<ExplainResponse> {
    const r = await this.request<ExplainResponse>("POST", "/api/v1/explain", { source_lang: source, target_lang: target, text });
    if (!r || typeof r.found !== "boolean") throw new ApiError("bad_response", "Réponse du serveur invalide");
    return r;
  }
  async feedback(p: FeedbackPayload): Promise<{ status: string }> {
    const r = await this.request<{ status: string }>("POST", "/api/v1/feedback", p);
    if (!r || r.status !== "pending_review") throw new ApiError("bad_response", "Réponse du serveur invalide");
    return r;
  }
  async languages(): Promise<LanguageInfo[]> {
    const r = await this.request<{ target_languages: LanguageInfo[] }>("GET", "/api/v1/languages");
    if (!Array.isArray(r?.target_languages)) throw new ApiError("bad_response", "Réponse du serveur invalide");
    return r.target_languages;
  }
  health(): Promise<{ status: string; version: string }> { return this.request("GET", "/api/v1/health"); }
}
