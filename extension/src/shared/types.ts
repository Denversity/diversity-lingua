export type Status = "validated" | "machine_unvalidated" | "unavailable" | "unchanged";
export type UiPhase = "inactive" | "active" | "detecting" | "translating" | "done" | "partial" | "error" | "unavailable" | "empty";

export interface ElementContext {
  kind: "text" | "attribute";
  attr?: string;
  tag?: string;
  role?: string;
  region?: string;
}
export interface SegmentRequest { id: string; text: string; context?: ElementContext }
export interface SegmentResult {
  id: string;
  translation: string | null;
  status: Status;
  translation_status?: "approved" | "automatic" | "pending_validation" | "unavailable" | "rejected" | null;
  concept_id?: string | null;
  alternatives?: string[];
  origin?: "glossary" | "memory" | "provider" | "none" | "local-glossary";
  provider?: string | null;
  confidence?: number | null;
  test_data?: boolean;
  reason?: string | null;
  notes?: string[];
  entry_id?: string | null;
  protected?: string[];
}
export interface TranslateResponse {
  request_id: string; source_lang: string; target_lang: string;
  results: SegmentResult[]; summary: Record<string, number>; took_ms: number;
}
export interface ExplainResponse {
  found: boolean; concept_id: string | null; term: string | null;
  source_lang?: string | null;
  explanation_source: string | null; explanation_source_reviewed: boolean;
  translation: SegmentResult | null;
  example_source?: string | null;
  term_translation?: SegmentResult | null;
}
export interface FeedbackPayload {
  source_lang: string; target_lang: string; source_text: string;
  shown_translation?: string | null; suggested_translation?: string | null; comment?: string | null;
  category?: "meaning" | "naturalness" | "terminology" | "other" | null;
  concept_id?: string | null;
  translation_status?: "approved" | "automatic" | "pending_validation" | "unavailable" | "rejected" | null;
}
export interface LanguageInfo {
  code: string; name: string; native_name: string; variety: string; availability: string;
  validated_entries?: number; approved_targets?: number; pending_entries?: number; notes?: string;
}

/** Résultat par segment côté extension : un SegmentResult ou une erreur de transport. */
export type ClientResult = SegmentResult | { id: string; status: "error"; translation: null; reason: string };

export interface PageCounts {
  validated: number; machine_unvalidated: number; unavailable: number; unchanged: number; error: number; pending: number; layout: number;
}
/** Couverture de la page ACTUELLE, en 3 groupes lisibles par le grand public. */
export interface Coverage { verified: number; unverified: number; kept: number; total: number }
export interface PageState {
  phase: UiPhase;
  target: string | null;
  detectedLang: "fr" | "en" | "unknown";
  total: number;
  counts: PageCounts;
  testData: boolean;
  message?: string;
  coverage: Coverage;
  reasons: Record<string, number>; // raisons des textes laissés dans la langue d'origine (code → nombre)
}

// ---- Messages
export type BgRequest =
  | { type: "dl/translate"; source: string; target: string; segments: SegmentRequest[] }
  | { type: "dl/explain"; source: string; target: string; text: string }
  | { type: "dl/feedback"; payload: FeedbackPayload }
  | { type: "dl/languages" }
  | { type: "dl/health" }
  | { type: "dl/hello" }
  | { type: "dl/tab-state"; active: boolean; target: string | null; phase?: UiPhase };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code: string };

export type ContentCommand =
  | { type: "dl/activate"; target: string }
  | { type: "dl/deactivate" }
  | { type: "dl/get-state" }
  | { type: "dl/get-selection" }
  | { type: "dl/translate-selection"; text: string }
  | { type: "dl/explain-selection"; text: string };

export const emptyCounts = (): PageCounts => ({
  validated: 0, machine_unvalidated: 0, unavailable: 0, unchanged: 0, error: 0, pending: 0, layout: 0,
});
