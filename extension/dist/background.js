"use strict";
(() => {
  // src/shared/settings.ts
  var DEFAULT_SETTINGS = {
    backendUrl: "http://localhost:8000",
    apiToken: "",
    targetLang: "ff",
    marks: "unvalidated",
    translateAttributes: true,
    useLocalGlossary: true,
    showBadge: true,
    panelSide: "right",
    layoutGuard: true
  };
  function normalizeBaseUrl(raw) {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("URL http(s) requise");
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol === "http:" && !local) throw new Error("HTTPS obligatoire hors localhost");
    return u.origin + u.pathname.replace(/\/+$/, "");
  }
  function sanitizeSettings(input) {
    const s = { ...DEFAULT_SETTINGS, ...input };
    try {
      s.backendUrl = normalizeBaseUrl(s.backendUrl);
    } catch {
      s.backendUrl = DEFAULT_SETTINGS.backendUrl;
    }
    if (!["unvalidated", "all", "none"].includes(s.marks)) s.marks = "unvalidated";
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(s.targetLang)) s.targetLang = DEFAULT_SETTINGS.targetLang;
    s.layoutGuard = s.layoutGuard !== false;
    if (s.panelSide !== "left" && s.panelSide !== "right") s.panelSide = "right";
    s.apiToken = String(s.apiToken ?? "").trim();
    return s;
  }
  async function getSettings() {
    const raw = await chrome.storage.local.get("settings");
    return sanitizeSettings(raw.settings ?? {});
  }

  // src/shared/i18n.ts
  var T = {
    fr: {
      appName: "Diversity Lingua",
      tagline: "Les services financiers, compris par tous.",
      // Actions
      translate: "Traduire cette page",
      restore: "Revenir \xE0 l'original",
      retry: "R\xE9essayer",
      settings: "Param\xE8tres",
      close: "Fermer",
      hide: "Masquer",
      // Langue
      thisPage: "Cette page",
      detected: "D\xE9tect\xE9e",
      translateTo: "Traduire vers",
      notDetected: "non d\xE9tect\xE9e",
      srcfr: "fran\xE7ais",
      srcen: "anglais",
      srcunknown: "langue inconnue",
      // États (titre / message)
      s_unreachable_t: "Page non compatible",
      s_unreachable_m: "Les pages internes du navigateur et le Chrome Web Store ne peuvent pas \xEAtre traduites. Ouvrez un site de services financiers.",
      s_reload_t: "Rechargez la page pour commencer",
      s_reload_m: "Diversity Lingua s'active au chargement d'une page. Cette page \xE9tait d\xE9j\xE0 ouverte : rechargez-la, puis rouvrez cette fen\xEAtre.",
      reload: "Recharger la page",
      s_idle_t: "Pr\xEAte \xE0 traduire cette page",
      s_idle_m: "Les textes sont traduits sans changer la pr\xE9sentation de la page. Vos montants, num\xE9ros et codes ne sont jamais modifi\xE9s ni envoy\xE9s.",
      s_detecting_t: "Analyse de la page\u2026",
      s_detecting_m: "Recherche des textes \xE0 traduire.",
      s_translating_t: "Traduction en cours",
      s_translating_m: "Les textes d\xE9j\xE0 traduits apparaissent au fur et \xE0 mesure.",
      s_done_t: "Page traduite",
      s_done_m: "Vous pouvez revenir \xE0 l'original \xE0 tout moment.",
      s_partial_t: "Page traduite en partie",
      s_partial_m: "Certains contenus restent inchang\xE9s : donn\xE9es sensibles \xE0 ne pas modifier ou \xE9l\xE9ments pr\xE9serv\xE9s pour prot\xE9ger la mise en page.",
      s_error_t: "Connexion impossible",
      s_error_m: "Le service de traduction ne r\xE9pond pas. V\xE9rifiez votre connexion ou l'adresse du serveur dans les param\xE8tres. Votre page n'a pas \xE9t\xE9 modifi\xE9e.",
      s_error_unauthorized_t: "Acc\xE8s refus\xE9",
      s_error_unauthorized_m: "Le serveur a refus\xE9 le jeton d'acc\xE8s. V\xE9rifiez-le dans les param\xE8tres.",
      s_error_rate_limited_t: "Trop de demandes",
      s_error_rate_limited_m: "Patientez quelques secondes puis r\xE9essayez.",
      s_empty_t: "Rien \xE0 traduire ici",
      s_empty_m: "Cette page ne contient pas encore de texte \xE0 traduire. Si du contenu appara\xEEt, il sera traduit automatiquement.",
      s_unsupported_t: "Langue de la page non prise en charge",
      s_unsupported_m: "Diversity Lingua traduit des pages en fran\xE7ais ou en anglais.",
      s_unavailable_t: "Contenus pr\xE9serv\xE9s",
      s_unavailable_m: "La page est conserv\xE9e sans modification afin de prot\xE9ger les champs sensibles et l'int\xE9grit\xE9 de la mise en page.",
      // Avis
      n_reference_t: "R\xE9f\xE9rentiel linguistique en pr\xE9paration",
      n_reference_auto: "Les traductions affich\xE9es sont valid\xE9es ou clairement signal\xE9es comme automatiques. Les champs sensibles restent inchang\xE9s.",
      n_reference_none: "Les champs sensibles et les contenus \xE0 pr\xE9server restent inchang\xE9s afin de prot\xE9ger l'information et la mise en page.",
      n_test: "Langue de test : sert \xE0 v\xE9rifier le fonctionnement. Ce n'est pas une vraie langue.",
      n_layout_one: "\xE9l\xE9ment est conserv\xE9 : donn\xE9es sensibles \xE0 ne pas modifier ou mise en page prot\xE9g\xE9e.",
      n_layout_many: "\xE9l\xE9ments sont conserv\xE9s : donn\xE9es sensibles \xE0 ne pas modifier ou mise en page prot\xE9g\xE9e.",
      // Couverture
      cov_title: "Couverture de cette page",
      cov_verified: "V\xE9rifi\xE9s par un locuteur natif",
      cov_unverified: "Traduits automatiquement, pas encore v\xE9rifi\xE9s",
      cov_kept: "Contenus conserv\xE9s (donn\xE9es sensibles ou mise en page)",
      cov_help: "Que signifie cette jauge ?",
      cov_note: "Elle indique quels textes ont \xE9t\xE9 traduits et avec quelle fiabilit\xE9. Elle ne mesure pas votre compr\xE9hension.",
      cov_texts: "textes",
      reasons_title: "Pourquoi certains contenus sont conserv\xE9s",
      r_no_validated_translation: "Contenu d'origine pr\xE9serv\xE9",
      r_pending_validation_only: "Contenu en attente de v\xE9rification",
      r_layout: "Donn\xE9es sensibles \xE0 ne pas modifier (contenu pr\xE9serv\xE9)",
      r_provider_error: "Service momentan\xE9ment indisponible",
      r_network: "Connexion impossible",
      r_integrity_check_failed: "\xC9cart\xE9s par s\xE9curit\xE9 (montants ou codes)",
      r_rejected_translation: "Traduction \xE9cart\xE9e par un validateur",
      r_ambiguous_context: "Sens ambigu : conserv\xE9s",
      r_provider_uncertain: "Le moteur n'\xE9tait pas s\xFBr",
      r_machine_translation_disabled: "Traduction automatique d\xE9sactiv\xE9e",
      r_rate_limited: "Trop de demandes",
      r_server: "Service momentan\xE9ment indisponible",
      r_timeout: "Le service a mis trop de temps",
      r_other: "Autres raisons",
      // Comprendre
      understand: "Comprendre",
      understandTitle: "Comprendre un terme financier",
      understandPh: "Ex. frais de transaction",
      explain: "Expliquer",
      understandHint: "Astuce : s\xE9lectionnez un mot sur la page, puis cliquez sur \xAB Comprendre \xBB.",
      c_term: "Terme",
      c_in: "En",
      c_simple: "Explication simple",
      c_example: "Exemple",
      c_reliability: "Fiabilit\xE9",
      c_original: "Texte d'origine",
      c_shown: "Texte affich\xE9",
      c_noexpl: "Pas d'explication disponible pour ce terme pour l'instant.",
      c_noexpl_hint: "Vous pouvez signaler ce terme pour que notre \xE9quipe l'ajoute.",
      c_expl_note: "Explication r\xE9dig\xE9e par l'\xE9quipe Diversity Lingua en langage simple. Elle est en cours de relecture par un expert financier.",
      c_expl_note_reviewed: "Explication relue par un expert.",
      c_expl_language: "Langue de l'explication",
      c_src_in: "(en {lang})",
      c_loading: "Recherche\u2026",
      c_error: "Impossible d'obtenir l'explication pour le moment.",
      c_not_in_page: "Cette s\xE9lection n'est pas un texte de la page.",
      // Fiabilité
      q_approved_t: "V\xE9rifi\xE9e",
      q_approved: "Cette traduction a \xE9t\xE9 v\xE9rifi\xE9e par un locuteur natif.",
      q_automatic_t: "Automatique",
      q_automatic: "Cette traduction a \xE9t\xE9 propos\xE9e par un programme. Aucun locuteur natif ne l'a encore v\xE9rifi\xE9e : restez prudent.",
      q_pending_t: "En attente",
      q_pending: "Cette traduction a \xE9t\xE9 propos\xE9e par une personne et attend la validation d'un locuteur natif.",
      q_unavailable_t: "Contenu pr\xE9serv\xE9",
      q_unavailable: "Le contenu d'origine est conserv\xE9 sans modification afin de prot\xE9ger les champs sensibles.",
      q_rejected_t: "Contenu pr\xE9serv\xE9",
      q_rejected: "Le contenu d'origine est conserv\xE9 sans modification afin de prot\xE9ger l'information.",
      q_kept_t: "Donn\xE9es sensibles prot\xE9g\xE9es",
      q_kept: "Donn\xE9es sensibles \xE0 ne pas modifier. Ce contenu est conserv\xE9 \xE0 l'identique.",
      badgeTest: "TEST",
      // Signalement
      f_open: "Signaler un probl\xE8me",
      f_title: "Signaler un probl\xE8me de traduction",
      f_what: "Quel est le probl\xE8me ?",
      f_meaning: "Le sens n'est pas correct",
      f_naturalness: "\xC7a ne sonne pas naturel",
      f_terminology: "Un mot financier est mal traduit",
      f_other: "Autre probl\xE8me",
      f_suggest: "Votre proposition (facultatif)",
      f_comment: "Pr\xE9cisions (facultatif)",
      f_send: "Envoyer",
      f_cancel: "Annuler",
      f_privacy: "Envoy\xE9 : le texte d'origine, la traduction affich\xE9e et votre message. Les montants, num\xE9ros et codes sont masqu\xE9s.",
      f_thanks_t: "Merci !",
      f_thanks: "Votre signalement sera relu par notre responsable linguistique. Il ne change pas la traduction automatiquement.",
      f_error: "Envoi impossible pour le moment. R\xE9essayez plus tard.",
      f_limit: "Vous avez envoy\xE9 beaucoup de signalements. R\xE9essayez un peu plus tard.",
      f_pick: "Choisissez le type de probl\xE8me.",
      // Panneau en page
      p_label: "Diversity Lingua",
      p_open: "Ouvrir le panneau Diversity Lingua",
      p_drag: "Faire glisser pour d\xE9placer le panneau",
      p_translated: "textes traduits",
      bubble: "Comprendre",
      bubbleHint: "Comprendre ce texte"
    },
    en: {
      appName: "Diversity Lingua",
      tagline: "Financial services, understood by everyone.",
      translate: "Translate this page",
      restore: "Restore original",
      retry: "Try again",
      settings: "Settings",
      close: "Close",
      hide: "Hide",
      thisPage: "This page",
      detected: "Detected",
      translateTo: "Translate to",
      notDetected: "not detected",
      srcfr: "French",
      srcen: "English",
      srcunknown: "unknown language",
      s_unreachable_t: "Page not supported",
      s_unreachable_m: "Browser internal pages and the Chrome Web Store cannot be translated. Open a financial services website.",
      s_reload_t: "Reload the page to start",
      s_reload_m: "Diversity Lingua starts when a page loads. This page was already open: reload it, then reopen this window.",
      reload: "Reload page",
      s_idle_t: "Ready to translate this page",
      s_idle_m: "Texts are translated without changing how the page looks. Your amounts, numbers and codes are never changed or sent.",
      s_detecting_t: "Analysing the page\u2026",
      s_detecting_m: "Looking for texts to translate.",
      s_translating_t: "Translating",
      s_translating_m: "Translated texts appear as they are ready.",
      s_done_t: "Page translated",
      s_done_m: "You can go back to the original at any time.",
      s_partial_t: "Page partly translated",
      s_partial_m: "Some content remains unchanged: sensitive data must not be modified, and some content is kept to protect the layout.",
      s_error_t: "Cannot connect",
      s_error_m: "The translation service is not responding. Check your connection or the server address in settings. Your page was not changed.",
      s_error_unauthorized_t: "Access denied",
      s_error_unauthorized_m: "The server refused the access token. Check it in settings.",
      s_error_rate_limited_t: "Too many requests",
      s_error_rate_limited_m: "Wait a few seconds, then try again.",
      s_empty_t: "Nothing to translate here",
      s_empty_m: "This page has no text to translate yet. If content appears, it will be translated automatically.",
      s_unsupported_t: "Page language not supported",
      s_unsupported_m: "Diversity Lingua translates pages in French or English.",
      s_unavailable_t: "Content preserved",
      s_unavailable_m: "The page is kept unchanged to protect sensitive fields and preserve the layout.",
      n_reference_t: "Language resources in preparation",
      n_reference_auto: "Displayed translations are validated or clearly marked as automatic. Sensitive fields are kept unchanged.",
      n_reference_none: "Sensitive fields and content requiring preservation are kept unchanged to protect information and layout.",
      n_test: "Test language: used to check that everything works. It is not a real language.",
      n_layout_one: "item is kept: sensitive data must not be modified, or the layout is protected.",
      n_layout_many: "items are kept: sensitive data must not be modified, or the layout is protected.",
      cov_title: "Coverage of this page",
      cov_verified: "Verified by a native speaker",
      cov_unverified: "Translated automatically, not yet verified",
      cov_kept: "Content kept (sensitive data or layout)",
      cov_help: "What does this gauge mean?",
      cov_note: "It shows which texts were translated and how reliable they are. It does not measure your understanding.",
      cov_texts: "texts",
      reasons_title: "Why some content is kept",
      r_no_validated_translation: "Original content preserved",
      r_pending_validation_only: "Content awaiting review",
      r_layout: "Sensitive data must not be modified (content preserved)",
      r_provider_error: "Service temporarily unavailable",
      r_network: "Cannot connect",
      r_integrity_check_failed: "Set aside for safety (amounts or codes)",
      r_rejected_translation: "Translation set aside by a validator",
      r_ambiguous_context: "Ambiguous meaning: kept",
      r_provider_uncertain: "The engine was not sure",
      r_machine_translation_disabled: "Automatic translation disabled",
      r_rate_limited: "Too many requests",
      r_server: "Service temporarily unavailable",
      r_timeout: "The service took too long",
      r_other: "Other reasons",
      understand: "Understand",
      understandTitle: "Understand a financial term",
      understandPh: "e.g. transaction fee",
      explain: "Explain",
      understandHint: 'Tip: select a word on the page, then click "Understand".',
      c_term: "Term",
      c_in: "In",
      c_simple: "Simple explanation",
      c_example: "Example",
      c_reliability: "Reliability",
      c_original: "Original text",
      c_shown: "Displayed text",
      c_noexpl: "No explanation available for this term yet.",
      c_noexpl_hint: "You can report this term so our team adds it.",
      c_expl_note: "Explanation written by the Diversity Lingua team in plain language. It is being reviewed by a financial expert.",
      c_expl_note_reviewed: "Explanation reviewed by an expert.",
      c_expl_language: "Explanation language",
      c_src_in: "(in {lang})",
      c_loading: "Searching\u2026",
      c_error: "Cannot get the explanation right now.",
      c_not_in_page: "This selection is not page text.",
      q_approved_t: "Verified",
      q_approved: "This translation was verified by a native speaker.",
      q_automatic_t: "Automatic",
      q_automatic: "This translation was suggested by a program. No native speaker has verified it yet: be careful.",
      q_pending_t: "Pending",
      q_pending: "This translation was suggested by a person and is waiting for a native speaker to validate it.",
      q_unavailable_t: "Content preserved",
      q_unavailable: "The original content is kept unchanged to protect sensitive fields.",
      q_rejected_t: "Content preserved",
      q_rejected: "The original content is kept unchanged to protect information.",
      q_kept_t: "Protected sensitive data",
      q_kept: "Sensitive data must not be modified. This content is kept unchanged.",
      badgeTest: "TEST",
      f_open: "Report a problem",
      f_title: "Report a translation problem",
      f_what: "What is the problem?",
      f_meaning: "The meaning is wrong",
      f_naturalness: "It does not sound natural",
      f_terminology: "A financial word is badly translated",
      f_other: "Other problem",
      f_suggest: "Your suggestion (optional)",
      f_comment: "Details (optional)",
      f_send: "Send",
      f_cancel: "Cancel",
      f_privacy: "Sent: the original text, the displayed translation and your message. Amounts, numbers and codes are masked.",
      f_thanks_t: "Thank you!",
      f_thanks: "Your report will be reviewed by our language lead. It does not change the translation automatically.",
      f_error: "Cannot send right now. Try again later.",
      f_limit: "You have sent many reports. Try again a little later.",
      f_pick: "Choose the type of problem.",
      p_label: "Diversity Lingua",
      p_open: "Open the Diversity Lingua panel",
      p_drag: "Drag to move the panel",
      p_translated: "texts translated",
      bubble: "Understand",
      bubbleHint: "Understand this text"
    }
  };
  function uiLang() {
    try {
      const l = globalThis.chrome?.i18n?.getUILanguage?.() ?? navigator.language ?? "fr";
      return String(l).toLowerCase().startsWith("fr") ? "fr" : "en";
    } catch {
      return "fr";
    }
  }
  var t = (k, lang = uiLang()) => T[lang][k];

  // src/background/apiClient.ts
  var ApiError = class extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  };
  var DEFAULTS = { timeoutMs: 15e3, retries: 2, backoffMs: 400, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  var STATUSES = /* @__PURE__ */ new Set(["validated", "machine_unvalidated", "unavailable", "unchanged"]);
  function isSegmentResult(x) {
    return x && typeof x.id === "string" && STATUSES.has(x.status) && (x.translation === null || typeof x.translation === "string");
  }
  function parseTranslateResponse(x) {
    if (!x || !Array.isArray(x.results) || !x.results.every(isSegmentResult)) throw new ApiError("bad_response", "R\xE9ponse du serveur invalide");
    for (const r of x.results) {
      if (r.status === "unavailable" && r.translation !== null) r.translation = null;
    }
    return x;
  }
  var ApiClient = class {
    constructor(cfg, fetchImpl = (...a) => fetch(...a), opts = {}) {
      this.cfg = cfg;
      this.fetchImpl = fetchImpl;
      this.o = { ...DEFAULTS, ...opts };
    }
    o;
    async request(method, path, body) {
      const { baseUrl, token } = await this.cfg();
      let lastErr = new ApiError("network", "\xC9chec r\xE9seau");
      for (let attempt = 0; attempt <= this.o.retries; attempt++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
        try {
          const headers = { Accept: "application/json" };
          if (body !== void 0) headers["Content-Type"] = "application/json";
          if (token) headers["X-DL-Token"] = token;
          const res = await this.fetchImpl(baseUrl + path, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body), signal: ctl.signal, credentials: "omit" });
          if (res.ok) {
            try {
              return await res.json();
            } catch {
              throw new ApiError("bad_response", "R\xE9ponse JSON invalide");
            }
          }
          if (res.status === 401 || res.status === 403) throw new ApiError("unauthorized", "Acc\xE8s refus\xE9", res.status);
          if (res.status === 429) {
            lastErr = new ApiError("rate_limited", "Trop de requ\xEAtes", 429);
            const ra = Number(res.headers.get("Retry-After")) || 0;
            if (attempt < this.o.retries) await this.o.sleep(Math.min(ra * 1e3 || this.o.backoffMs * 2 ** attempt, 5e3));
            continue;
          }
          if (res.status >= 500) {
            lastErr = new ApiError("server", `Erreur serveur ${res.status}`, res.status);
            if (attempt < this.o.retries) await this.o.sleep(this.o.backoffMs * 2 ** attempt);
            continue;
          }
          throw new ApiError(`http_${res.status}`, `Requ\xEAte refus\xE9e (${res.status})`, res.status);
        } catch (e) {
          if (e instanceof ApiError && !["network", "timeout"].includes(e.code)) throw e;
          const aborted = e?.name === "AbortError";
          lastErr = new ApiError(aborted ? "timeout" : "network", aborted ? "D\xE9lai d\xE9pass\xE9" : "\xC9chec r\xE9seau");
          if (attempt < this.o.retries) await this.o.sleep(this.o.backoffMs * 2 ** attempt);
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastErr;
    }
    async translate(source, target, segments) {
      return parseTranslateResponse(await this.request("POST", "/api/v1/translate", { source_lang: source, target_lang: target, segments }));
    }
    async explain(source, target, text) {
      const r = await this.request("POST", "/api/v1/explain", { source_lang: source, target_lang: target, text });
      if (!r || typeof r.found !== "boolean") throw new ApiError("bad_response", "R\xE9ponse du serveur invalide");
      return r;
    }
    async feedback(p) {
      const r = await this.request("POST", "/api/v1/feedback", p);
      if (!r || r.status !== "pending_review") throw new ApiError("bad_response", "R\xE9ponse du serveur invalide");
      return r;
    }
    async languages() {
      const r = await this.request("GET", "/api/v1/languages");
      if (!Array.isArray(r?.target_languages)) throw new ApiError("bad_response", "R\xE9ponse du serveur invalide");
      return r.target_languages;
    }
    health() {
      return this.request("GET", "/api/v1/health");
    }
  };

  // src/shared/protect.ts
  var PLACEHOLDER_RE = /\{\{P(\d+)\}\}/g;
  var CUR_SUFFIX = "(?:FCFA|F\\s?CFA|XAF|XOF|CFA|EUR|USD|\u20AC|\\$|FC|F)";
  var CUR_PREFIX = "(?:FCFA|F\\s?CFA|XAF|XOF|CFA|EUR|USD|\u20AC|\\$)";
  var NUM = "\\d+(?:[ \\u00a0\\u202f.,]\\d+)*";
  var PATTERN = new RegExp(
    [
      "(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)",
      `(?<url>(?:https?://|www\\.)[^\\s<>"']+)`,
      "(?<secret>(?:pin|otp|cvv|mot de passe|password|passcode|code secret)\\s*[:=]\\s*)(?<secretval>\\S+)",
      "(?<codectx>\\b(?:code|otp|pin)\\b[^\\d\\n]{0,25})(?<codeval>\\d{4,8})(?!\\d)",
      `(?<amount>(?:(?<![A-Za-z0-9\\u00c0-\\u00ff])${CUR_PREFIX}\\s?${NUM}|${NUM}\\s?${CUR_SUFFIX})(?![A-Za-z0-9\\u00c0-\\u00ff]))`,
      "(?<phone>(?:(?:\\+|00)237[ .-]?)?(?<![\\d])[26](?:[ .-]?\\d){8}(?!\\d))",
      "(?<percent>\\d+(?:[.,]\\d+)?\\s?%)",
      "(?<date>\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b\\d{1,2}[h:]\\d{2}\\b)",
      "(?<id>\\b[A-Z]{2,6}[-_]?\\d[A-Za-z0-9_-]{2,}\\b|\\b\\d{6,}\\b)",
      "(?<currency>\\b(?:FCFA|F\\s?CFA|XAF|XOF|CFA|EUR|USD)\\b|\u20AC|\\$)",
      "(?<number>\\d+(?:[ \\u00a0\\u202f.,]\\d{3})*(?:[.,]\\d+)?)"
    ].join("|"),
    "gid"
  );
  function placeholdersOf(text) {
    const c = /* @__PURE__ */ new Map();
    for (const m of text.matchAll(PLACEHOLDER_RE)) c.set(m[0], (c.get(m[0]) ?? 0) + 1);
    return c;
  }
  function placeholdersMatch(source, translated) {
    const a = placeholdersOf(source), b = placeholdersOf(translated);
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  }

  // src/background/glossaryClient.ts
  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function originalOffset(text, normalized, end) {
    const wanted = normalized.slice(0, end);
    let offset = 0;
    for (const character of text) {
      offset += character.length;
      if (text.slice(0, offset).normalize("NFC") === wanted) return offset;
    }
    return -1;
  }
  function normalizeExact(text) {
    return text.normalize("NFC").replace(/\u2019/g, "'").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function normalize(text) {
    return text.normalize("NFC").replace(/\u2019/g, "'").replace(/\u00a0/g, " ").replace(/\s+/g, " ").replace(/^[ \t\r\n.:;…«»"']+|[ \t\r\n.:;…«»"']+$/g, "").toLowerCase();
  }
  var GlossaryClient = class {
    constructor(loader) {
      this.loader = loader;
    }
    cache = /* @__PURE__ */ new Map();
    async index(target) {
      if (!this.cache.has(target)) {
        let idx = null;
        try {
          const snap = await this.loader(target);
          if (snap && Array.isArray(snap.entries)) {
            idx = { exact: /* @__PURE__ */ new Map(), loose: /* @__PURE__ */ new Map(), bySource: /* @__PURE__ */ new Map() };
            for (const e of snap.entries) {
              if (!e || typeof e.source_text !== "string" || typeof e.translation !== "string" || !e.translation) continue;
              const exactKey = `${e.source_lang}|${normalizeExact(e.source_text)}`;
              const looseKey = `${e.source_lang}|${normalize(e.source_text)}`;
              (idx.exact.get(exactKey) ?? idx.exact.set(exactKey, []).get(exactKey)).push(e);
              (idx.loose.get(looseKey) ?? idx.loose.set(looseKey, []).get(looseKey)).push(e);
              (idx.bySource.get(e.source_lang) ?? idx.bySource.set(e.source_lang, []).get(e.source_lang)).push(e);
            }
          }
        } catch {
          idx = null;
        }
        this.cache.set(target, idx);
      }
      return this.cache.get(target);
    }
    async lookup(masked, source, target) {
      const idx = await this.index(target);
      const c = idx?.exact.get(`${source}|${normalizeExact(masked)}`) ?? idx?.loose.get(`${source}|${normalize(masked)}`);
      if (!c?.length || new Set(c.map((e2) => e2.translation)).size !== 1) return null;
      const e = c[0];
      return placeholdersMatch(masked, e.translation) ? { translation: e.translation, entry: e } : null;
    }
    async lookupPrefix(masked, source, target) {
      const idx = await this.index(target);
      const matches = [];
      for (const entry2 of idx?.bySource.get(source) ?? []) {
        const words = entry2.source_text.normalize("NFC").trim().split(/\s+/).map(escapeRegExp);
        if (!words.length || !words[0]) continue;
        const pattern = new RegExp(`^${words.join("\\s+")}(?=$|[^\\p{L}\\p{N}_])`, "iu");
        const match = pattern.exec(masked.normalize("NFC"));
        if (match) matches.push({ entry: entry2, end: match[0].length });
      }
      if (!matches.length) return null;
      const longest = Math.max(...matches.map((m) => m.end));
      const candidates = matches.filter((m) => m.end === longest);
      if (new Set(candidates.map((m) => m.entry.translation)).size !== 1) return null;
      const { entry, end } = candidates[0];
      const rawEnd = originalOffset(masked, masked.normalize("NFC"), end);
      if (rawEnd < 0) return null;
      const translation = entry.translation + masked.slice(rawEnd);
      return placeholdersMatch(masked, translation) ? { translation, entry } : null;
    }
    async lookupOtherSource(masked, source, target) {
      if (source !== "fr" && source !== "en") return null;
      const other = source === "fr" ? "en" : "fr";
      const idx = await this.index(target);
      if (idx?.loose.has(`${source}|${normalize(masked)}`)) return null;
      return this.lookup(masked, other, target);
    }
  };

  // src/background/translationManager.ts
  var DEFAULTS2 = {
    batchSize: 50,
    maxConcurrent: 2,
    minIntervalMs: 120,
    cacheTtlMs: 30 * 6e4,
    unavailableTtlMs: 5 * 6e4,
    cacheMax: 3e3,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    useLocalGlossary: () => true
  };
  var STABLE_UNAVAILABLE = /* @__PURE__ */ new Set(["no_validated_translation", "language_unavailable", "unsupported_source_language"]);
  var TranslationManager = class {
    constructor(api2, glossary2, opts = {}) {
      this.api = api2;
      this.glossary = glossary2;
      this.o = { ...DEFAULTS2, ...opts };
    }
    o;
    cache = /* @__PURE__ */ new Map();
    nextSlot = 0;
    apiCalls = 0;
    key(source, target, s) {
      const c = s.context;
      return `${source}|${target}|${c?.kind ?? ""}|${c?.tag ?? ""}|${c?.attr ?? ""}|${c?.role ?? ""}|${c?.region ?? ""}|${s.text}`;
    }
    cacheGet(k) {
      const e = this.cache.get(k);
      if (!e) return null;
      if (e.expires < this.o.now()) {
        this.cache.delete(k);
        return null;
      }
      this.cache.delete(k);
      this.cache.set(k, e);
      return e.result;
    }
    cachePut(k, r) {
      let ttl = 0;
      if (r.status === "validated" || r.status === "machine_unvalidated") ttl = this.o.cacheTtlMs;
      else if (r.status === "unavailable" && STABLE_UNAVAILABLE.has(r.reason ?? "")) ttl = this.o.unavailableTtlMs;
      if (!ttl) return;
      this.cache.set(k, { result: r, expires: this.o.now() + ttl });
      while (this.cache.size > this.o.cacheMax) this.cache.delete(this.cache.keys().next().value);
    }
    clearCache() {
      this.cache.clear();
    }
    async slot() {
      const now = this.o.now();
      const at = Math.max(now, this.nextSlot);
      this.nextSlot = at + this.o.minIntervalMs;
      if (at > now) await this.o.sleep(at - now);
    }
    async translate(source, target, segments) {
      const out = /* @__PURE__ */ new Map();
      const groups = /* @__PURE__ */ new Map();
      for (const s of segments) {
        const k = this.key(source, target, s);
        if (this.o.useLocalGlossary() && this.glossary) {
          const hit = await this.glossary.lookup(s.text, source, target) ?? await this.glossary.lookupOtherSource(s.text, source, target);
          if (hit) {
            out.set(s.id, {
              id: s.id,
              translation: hit.translation,
              status: "validated",
              origin: "local-glossary",
              provider: null,
              test_data: !!hit.entry.test_data,
              entry_id: hit.entry.id,
              notes: hit.entry.test_data ? ["test_data"] : []
            });
            continue;
          }
          const prefixHit = await this.glossary.lookupPrefix(s.text, source, target);
          if (prefixHit) {
            out.set(s.id, {
              id: s.id,
              translation: prefixHit.translation,
              status: "validated",
              origin: "local-glossary",
              provider: null,
              test_data: !!prefixHit.entry.test_data,
              entry_id: prefixHit.entry.id,
              notes: prefixHit.entry.test_data ? ["test_data"] : []
            });
            continue;
          }
        }
        const cached = this.cacheGet(k);
        if (cached) {
          out.set(s.id, { ...cached, id: s.id });
          continue;
        }
        (groups.get(k) ?? groups.set(k, []).get(k)).push(s);
      }
      const uniques = [...groups.entries()].map(([k, members], i) => ({ k, members, rid: `u${i}`, rep: members[0] }));
      const batches = [];
      for (let i = 0; i < uniques.length; i += this.o.batchSize) batches.push(uniques.slice(i, i + this.o.batchSize));
      const runBatch = async (batch) => {
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
      return segments.map((s) => out.get(s.id) ?? { id: s.id, status: "error", translation: null, reason: "missing_result" });
    }
  };

  // src/background/index.ts
  var api = new ApiClient(async () => {
    const s = await getSettings();
    return { baseUrl: s.backendUrl, token: s.apiToken };
  });
  var useLocal = true;
  var glossary = new GlossaryClient(async (lang) => {
    try {
      const r = await fetch(chrome.runtime.getURL(`glossary/${encodeURIComponent(lang)}.json`));
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  });
  var manager = new TranslationManager(api, glossary, { useLocalGlossary: () => useLocal });
  getSettings().then((s) => {
    useLocal = s.useLocalGlossary;
  });
  chrome.storage.onChanged.addListener(async (ch) => {
    if (ch.settings) {
      useLocal = (await getSettings()).useLocalGlossary;
      manager.clearCache();
    }
  });
  var MAX_SEGMENTS = 200;
  var MAX_TEXT = 2e3;
  var feedbackLog = [];
  function validTranslate(m) {
    return typeof m.source === "string" && typeof m.target === "string" && Array.isArray(m.segments) && m.segments.length <= MAX_SEGMENTS && m.segments.every((s) => s && typeof s.id === "string" && typeof s.text === "string" && s.text.length <= MAX_TEXT);
  }
  var fail = (e) => {
    if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: "Erreur inattendue", code: "internal" };
  };
  async function handle(msg, sender) {
    try {
      switch (msg.type) {
        case "dl/translate":
          if (!validTranslate(msg)) return { ok: false, error: "Requ\xEAte invalide", code: "invalid_request" };
          return { ok: true, data: await manager.translate(msg.source, msg.target, msg.segments) };
        case "dl/explain":
          if (typeof msg.text !== "string" || msg.text.length > 500) return { ok: false, error: "Requ\xEAte invalide", code: "invalid_request" };
          return { ok: true, data: await api.explain(msg.source, msg.target, msg.text) };
        case "dl/feedback": {
          const p = msg.payload;
          if (!p || typeof p.source_text !== "string" || !p.source_text.trim() || p.source_text.length > 2e3 || (p.suggested_translation ?? "").length > 2e3 || (p.comment ?? "").length > 1e3)
            return { ok: false, error: "Requ\xEAte invalide", code: "invalid_request" };
          const now = Date.now();
          feedbackLog = feedbackLog.filter((t2) => now - t2 < 36e5);
          if (feedbackLog.length >= 20 || feedbackLog.length && now - feedbackLog[feedbackLog.length - 1] < 1500) return { ok: false, error: "Trop de signalements", code: "rate_limited" };
          const res = await api.feedback(p);
          feedbackLog.push(now);
          return { ok: true, data: res };
        }
        case "dl/languages":
          return { ok: true, data: await api.languages() };
        case "dl/health":
          return { ok: true, data: await api.health() };
        case "dl/hello": {
          const id = sender.tab?.id;
          const st = id != null ? (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`] : null;
          return { ok: true, data: st ?? { active: false, target: null } };
        }
        case "dl/tab-state": {
          const id = sender.tab?.id;
          if (id == null) return { ok: true, data: null };
          await chrome.storage.session.set({ [`tab:${id}`]: { active: msg.active, target: msg.target } });
          const badge = {
            inactive: ["", "#0E6B5C"],
            active: ["ON", "#0E6B5C"],
            detecting: ["\u2026", "#0E6B5C"],
            translating: ["\u2026", "#0E6B5C"],
            done: ["ON", "#0E6B5C"],
            partial: ["\xBD", "#7A4F00"],
            error: ["!", "#9E2229"],
            unavailable: ["\u2013", "#3E4C57"],
            empty: ["\u2205", "#3E4C57"]
          };
          const [text, color] = badge[msg.phase] ?? ["", "#0E6B5C"];
          await chrome.action.setBadgeText({ tabId: id, text: msg.active ? text : "" });
          await chrome.action.setBadgeBackgroundColor({ tabId: id, color });
          return { ok: true, data: null };
        }
      }
    } catch (e) {
      return fail(e);
    }
    return { ok: false, error: "Message inconnu", code: "unknown_message" };
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string" || !msg.type.startsWith("dl/")) return false;
    handle(msg, sender).then(sendResponse);
    return true;
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "dl-translate-selection", title: "Diversity Lingua : traduire la s\xE9lection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "dl-explain-selection", title: `Diversity Lingua : ${t("understand", "fr")}`, contexts: ["selection"] });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.selectionText) return;
    const type = info.menuItemId === "dl-explain-selection" ? "dl/explain-selection" : "dl/translate-selection";
    chrome.tabs.sendMessage(tab.id, { type, text: info.selectionText.slice(0, 1e3) }).catch(() => {
    });
  });
  chrome.tabs.onRemoved.addListener((id) => {
    chrome.storage.session.remove(`tab:${id}`);
  });
})();
