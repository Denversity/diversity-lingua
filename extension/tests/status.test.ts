import { describe, expect, it } from "vitest";
import { parseTranslateResponse } from "../src/background/apiClient";
import { canonicalStatus, hasDisplayableText } from "../src/shared/status";

describe("statuts canoniques côté extension", () => {
  it("utilise translation_status s'il est présent, sinon déduit de l'ancien champ", () => {
    expect(canonicalStatus({ status: "validated" })).toBe("approved");
    expect(canonicalStatus({ status: "machine_unvalidated" })).toBe("automatic");
    expect(canonicalStatus({ status: "machine_unvalidated", translation_status: "pending_validation" })).toBe("pending_validation");
    expect(canonicalStatus({ status: "unavailable", translation_status: "rejected" })).toBe("rejected");
    expect(canonicalStatus({ status: "error" })).toBe("error");
  });
  it("un texte n'est jamais affiché pour unavailable / rejected / error", () => {
    for (const c of ["unavailable", "rejected", "error", "unchanged"] as const) expect(hasDisplayableText(c)).toBe(false);
    for (const c of ["approved", "automatic", "pending_validation"] as const) expect(hasDisplayableText(c)).toBe(true);
  });
  it("la réponse du serveur conserve les champs canoniques et neutralise un texte « unavailable »", () => {
    const r = parseTranslateResponse({ request_id: "r", source_lang: "fr", target_lang: "ff", took_ms: 1, summary: {}, results: [
      { id: "a", status: "unavailable", translation: "fuite", translation_status: "rejected", concept_id: "c.x", alternatives: [] }] });
    expect(r.results[0].translation).toBeNull();
    expect(r.results[0].translation_status).toBe("rejected");
  });
});
