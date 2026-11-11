/**
 * Dérivation d'écran (fonction PURE) : transforme l'état de la page + le contexte linguistique en un écran lisible.
 * Utilisée par le popup ET le panneau injecté : même vocabulaire partout. Aucun terme technique (approved/automatic…) n'est exposé.
 */
import { has, t, type Key, type Lang } from "../shared/i18n";
import type { Coverage, PageState } from "../shared/types";
import type { IconName } from "./icons";

export interface LanguageContext { name: string; availability: string; approved: number; isTest: boolean }
export interface ViewInput { state: PageState | null; reachable: boolean; reloadable?: boolean; lang: Lang; language?: LanguageContext | null }
export type ViewKind = "unreachable" | "idle" | "detecting" | "translating" | "done" | "partial" | "error" | "empty" | "unsupported" | "unavailable";
export interface Notice { tone: "info" | "test" | "layout"; title?: string; text: string }
export interface View {
  kind: ViewKind;
  tone: "neutral" | "progress" | "verified" | "auto" | "error";
  icon: IconName;
  title: string;
  message: string;
  progress: number | null; // 0..1 ; null = indéterminé / sans objet
  coverage: Coverage | null;
  reasons: { code: string; label: string; count: number }[];
  notices: Notice[];
  primary: { id: "translate" | "restore" | "retry" | "reload" | "none"; label: string };
  sourceLabel: string;
}

export function reasonLabel(code: string, lang: Lang): string {
  const k = `r_${code}`;
  return has(k, lang) ? t(k as Key, lang) : t("r_other", lang);
}

export function deriveView(i: ViewInput): View {
  const L = i.lang, tt = (k: Key) => t(k, L);
  const st = i.state;
  const src = st?.detectedLang === "fr" ? tt("srcfr") : st?.detectedLang === "en" ? tt("srcen") : tt("srcunknown");
  const base = { progress: null as number | null, coverage: null as Coverage | null, reasons: [] as View["reasons"], notices: [] as Notice[], sourceLabel: src };
  const notices: Notice[] = [];
  const cov = st?.coverage ?? { verified: 0, unverified: 0, kept: 0, total: 0 };

  if (i.language?.isTest) notices.push({ tone: "test", text: tt("n_test") });
  else if (i.language && i.language.availability === "awaiting_validation" && i.language.approved === 0)
    notices.push({ tone: "info", title: tt("n_reference_t"), text: cov.unverified > 0 || !st || st.phase === "inactive" ? tt("n_reference_auto") : tt("n_reference_none") });

  if (!i.reachable && i.reloadable)
    return { ...base, kind: "unreachable", tone: "neutral", icon: "undo", title: tt("s_reload_t"), message: tt("s_reload_m"), notices: [], primary: { id: "reload", label: tt("reload") } };
  if (!i.reachable)
    return { ...base, kind: "unreachable", tone: "neutral", icon: "lock", title: tt("s_unreachable_t"), message: tt("s_unreachable_m"), notices: [], primary: { id: "none", label: "" } };
  if (!st || st.phase === "inactive")
    return { ...base, kind: "idle", tone: "neutral", icon: "globe", title: tt("s_idle_t"), message: tt("s_idle_m"), notices, primary: { id: "translate", label: tt("translate") } };

  const reasons = Object.entries(st.reasons ?? {}).map(([code, count]) => ({ code, label: reasonLabel(code, L), count })).sort((a, b) => b.count - a.count);
  const layout = st.reasons?.layout ?? 0;
  if (layout > 0) notices.push({ tone: "layout", text: `${layout} ${tt(layout === 1 ? "n_layout_one" : "n_layout_many")}` });
  const withCov = { ...base, coverage: cov.total > 0 ? cov : null, reasons, notices };
  const restore = { id: "restore" as const, label: tt("restore") };

  switch (st.phase) {
    case "detecting":
      return { ...withCov, kind: "detecting", tone: "progress", icon: "eye", title: tt("s_detecting_t"), message: tt("s_detecting_m"), primary: { id: "none", label: "" } };
    case "translating": {
      const total = st.total || 0;
      return { ...withCov, kind: "translating", tone: "progress", icon: "spark", title: tt("s_translating_t"), message: tt("s_translating_m"),
        progress: total > 0 ? Math.max(0, Math.min(1, (total - st.counts.pending) / total)) : null, primary: restore };
    }
    case "done":
      return { ...withCov, kind: "done", tone: cov.unverified > 0 ? "auto" : "verified", icon: cov.unverified > 0 ? "shield" : "check", title: tt("s_done_t"), message: tt("s_done_m"), primary: restore };
    case "partial":
      return { ...withCov, kind: "partial", tone: "auto", icon: "alert", title: tt("s_partial_t"), message: tt("s_partial_m"), primary: restore };
    case "error": {
      const code = st.message === "unauthorized" ? "unauthorized" : st.message === "rate_limited" ? "rate_limited" : "";
      const tk = code ? (`s_error_${code}_t` as Key) : "s_error_t", mk = code ? (`s_error_${code}_m` as Key) : "s_error_m";
      // En cas d'erreur : le message principal seul (pas de jauge ni d'avis de référentiel, hors-sujet et anxiogènes).
      return { ...base, kind: "error", tone: "error", icon: code === "unauthorized" ? "lock" : "offline", title: tt(tk), message: tt(mk),
        notices: notices.filter((n) => n.tone === "test"), primary: { id: "retry", label: tt("retry") } };
    }
    case "empty":
      return { ...withCov, kind: "empty", tone: "neutral", icon: "eye", title: tt("s_empty_t"), message: tt("s_empty_m"), primary: restore };
    case "unavailable":
      if (st.message === "unsupportedSource")
        return { ...withCov, kind: "unsupported", tone: "neutral", icon: "globe", title: tt("s_unsupported_t"), message: tt("s_unsupported_m"), primary: restore };
      return { ...withCov, kind: "unavailable", tone: "neutral", icon: "info", title: tt("s_unavailable_t"), message: tt("s_unavailable_m"), primary: restore };
    default:
      return { ...withCov, kind: "idle", tone: "neutral", icon: "globe", title: tt("s_idle_t"), message: tt("s_idle_m"), primary: { id: "translate", label: tt("translate") } };
  }
}
