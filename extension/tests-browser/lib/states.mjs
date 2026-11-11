// États de page représentatifs (mêmes formes que PageState) pour rendre le popup et le panneau.
const counts = (o = {}) => ({ validated: 0, machine_unvalidated: 0, unavailable: 0, unchanged: 0, error: 0, pending: 0, layout: 0, ...o });
const base = { target: "ff", detectedLang: "fr", testData: false, reasons: {} };
export const STATES = {
  idle_detected: { phase: "inactive", target: null, detectedLang: "fr", testData: false, reasons: {}, total: 0, counts: counts(), coverage: { verified: 0, unverified: 0, kept: 0, total: 0 } },
  idle: { ...base, phase: "inactive", target: null, detectedLang: "unknown", total: 0, counts: counts(), coverage: { verified: 0, unverified: 0, kept: 0, total: 0 } },
  detecting: { ...base, phase: "detecting", total: 0, counts: counts(), coverage: { verified: 0, unverified: 0, kept: 0, total: 0 } },
  translating: { ...base, phase: "translating", total: 120, counts: counts({ pending: 48, machine_unvalidated: 50, unavailable: 22 }), coverage: { verified: 0, unverified: 50, kept: 22, total: 72 }, reasons: { no_validated_translation: 22 } },
  done_auto: { ...base, phase: "done", total: 74, counts: counts({ machine_unvalidated: 74 }), coverage: { verified: 0, unverified: 74, kept: 0, total: 74 } },
  done_verified: { ...base, phase: "done", total: 40, counts: counts({ validated: 40 }), coverage: { verified: 40, unverified: 0, kept: 0, total: 40 } },
  partial: { ...base, phase: "partial", total: 96, counts: counts({ machine_unvalidated: 80, unavailable: 12, layout: 4 }), coverage: { verified: 0, unverified: 80, kept: 16, total: 96 }, reasons: { no_validated_translation: 12, layout: 4 } },
  unavailable: { ...base, phase: "unavailable", total: 58, counts: counts({ unavailable: 58 }), coverage: { verified: 0, unverified: 0, kept: 58, total: 58 }, reasons: { no_validated_translation: 58 } },
  error: { ...base, phase: "error", message: "network", total: 12, counts: counts({ error: 12 }), coverage: { verified: 0, unverified: 0, kept: 12, total: 12 }, reasons: { network: 12 } },
  empty: { ...base, phase: "empty", total: 0, counts: counts(), coverage: { verified: 0, unverified: 0, kept: 0, total: 0 } },
  unsupported: { ...base, phase: "unavailable", message: "unsupportedSource", detectedLang: "unknown", total: 0, counts: counts(), coverage: { verified: 0, unverified: 0, kept: 0, total: 0 } },
};
export const LANGS = {
  ff: [{ code: "ff", name: "Fulfulde", availability: "awaiting_validation", approved_targets: 0 }],
  test: [{ code: "xx-test", name: "Langue de test", availability: "test_only", approved_targets: 28 }],
};
