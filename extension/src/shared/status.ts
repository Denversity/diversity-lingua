/** Statut canonique (contrat linguistique) : approved | automatic | pending_validation | unavailable | rejected. */
import type { ClientResult } from "./types";

export type Canonical = "approved" | "automatic" | "pending_validation" | "unavailable" | "rejected" | "unchanged" | "error";

const LEGACY: Record<string, Canonical> = { validated: "approved", machine_unvalidated: "automatic", unavailable: "unavailable", unchanged: "unchanged", error: "error" };

/** Utilise `translation_status` s'il est fourni par le serveur, sinon déduit de l'ancien champ `status`. */
export function canonicalStatus(r: Pick<ClientResult, "status"> & { translation_status?: string | null }): Canonical {
  const ts = r.translation_status;
  if (ts === "approved" || ts === "automatic" || ts === "pending_validation" || ts === "unavailable" || ts === "rejected") return ts;
  return LEGACY[r.status] ?? "unavailable";
}

/** Une seule règle d'affichage du texte : jamais de texte pour unavailable / rejected / error. */
export const hasDisplayableText = (c: Canonical): boolean => c === "approved" || c === "automatic" || c === "pending_validation";
