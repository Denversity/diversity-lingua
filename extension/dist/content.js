"use strict";
(() => {
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
  var GROUPS = ["secretval", "codeval", "email", "url", "amount", "phone", "percent", "date", "id", "currency", "number"];
  var KIND = {
    email: "email",
    url: "url",
    secretval: "secret",
    codeval: "secret",
    amount: "amount",
    phone: "phone",
    percent: "number",
    date: "number",
    id: "identifier",
    currency: "currency",
    number: "number"
  };
  function maskRaw(text) {
    const ext = [...text.matchAll(PLACEHOLDER_RE)].map((m) => Number(m[1]));
    let counter = ext.length ? Math.max(...ext) + 1 : 0;
    const tokens = [];
    let out = "";
    let pos = 0;
    for (const m of text.matchAll(PATTERN)) {
      const groups = m.groups;
      const g = GROUPS.find((n) => groups[n] !== void 0);
      if (!g) continue;
      const idx = m.indices.groups[g];
      const [start, end] = idx;
      if (start < pos) continue;
      const ph = `{{P${counter++}}}`;
      tokens.push([ph, text.slice(start, end), KIND[g]]);
      out += text.slice(pos, start) + ph;
      pos = end;
    }
    out += text.slice(pos);
    return { masked: out, tokens, external: [] };
  }
  function maskText(text) {
    const extMatches = [...text.matchAll(PLACEHOLDER_RE)];
    if (!extMatches.length) return maskRaw(text);
    const sentinels = /* @__PURE__ */ new Map();
    const stashed = text.replace(PLACEHOLDER_RE, (full, digits) => {
      const key = "\uE000" + [...digits].map((d) => String.fromCharCode(57360 + Number(d))).join("") + "\uE001";
      sentinels.set(key, full);
      return key;
    });
    const res = maskRaw(stashed);
    const base = Math.max(...extMatches.map((m) => Number(m[1]))) + 1;
    const mapping = /* @__PURE__ */ new Map();
    const tokens = res.tokens.map(([ph, v, k], i) => {
      const np = `{{P${base + i}}}`;
      mapping.set(ph, np);
      return [np, v, k];
    });
    let masked = res.masked.replace(PLACEHOLDER_RE, (m) => mapping.get(m) ?? m);
    for (const [key, original] of sentinels) masked = masked.split(key).join(original);
    return { masked, tokens, external: extMatches.map((m) => m[0]) };
  }
  function unmask(text, tokens) {
    const map = new Map(tokens.map(([ph, v]) => [ph, v]));
    return text.replace(PLACEHOLDER_RE, (m) => map.get(m) ?? m);
  }
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
  function hasTranslatableLetters(masked) {
    return /[\p{L}]/u.test(masked.replace(PLACEHOLDER_RE, ""));
  }

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
  var has = (k, lang = uiLang()) => k in T[lang];

  // src/shared/status.ts
  var LEGACY = { validated: "approved", machine_unvalidated: "automatic", unavailable: "unavailable", unchanged: "unchanged", error: "error" };
  function canonicalStatus(r) {
    const ts = r.translation_status;
    if (ts === "approved" || ts === "automatic" || ts === "pending_validation" || ts === "unavailable" || ts === "rejected") return ts;
    return LEGACY[r.status] ?? "unavailable";
  }
  var hasDisplayableText = (c) => c === "approved" || c === "automatic" || c === "pending_validation";

  // src/ui/dom.ts
  function h(doc, tag, attrs = {}, ...children) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === void 0 || v === false) continue;
      if (v === true) el.setAttribute(k, "");
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) if (c) el.append(typeof c === "string" ? doc.createTextNode(c) : c);
    return el;
  }

  // src/ui/icons.ts
  var PATHS = {
    check: ["M5 12.5l4.2 4.2L19 7"],
    shield: ["M12 3l7 3v5.5c0 4.4-2.9 7.9-7 9.5-4.1-1.6-7-5.1-7-9.5V6l7-3z", "M8.6 12.2l2.5 2.5 4.4-4.6"],
    spark: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"],
    eye: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z"],
    globe: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M3.5 9h17M3.5 15h17", "M12 3c2.6 2.4 3.8 5.4 3.8 9s-1.2 6.6-3.8 9c-2.6-2.4-3.8-5.4-3.8-9S9.4 5.4 12 3z"],
    info: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M12 11v5.2", "M12 7.8v.1"],
    close: ["M6 6l12 12M18 6L6 18"],
    flag: ["M6 21V4", "M6 4.5h11l-2.2 4 2.2 4H6"],
    book: ["M5 4.5h10a3 3 0 013 3V20H8a3 3 0 01-3-3V4.5z", "M5 17a3 3 0 013-3h10"],
    undo: ["M9 7L4.5 11.5 9 16", "M5 11.5h9.5a5 5 0 010 10H12"],
    gear: ["M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z", "M19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 01-1.6.9l-.3 2h-3.6l-.3-2a7 7 0 01-1.6-.9l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 010-1.8L5 10.5l1.8-3.1 1.9.7a7 7 0 011.6-.9l.3-2h3.6l.3 2a7 7 0 011.6.9l1.9-.7 1.8 3.1-1.6 1.2a7 7 0 010 1.8z"],
    alert: ["M12 3.5l9.5 16.5h-19L12 3.5z", "M12 10v4.5", "M12 17.2v.1"],
    offline: ["M3 3l18 18", "M8.5 16.5a5 5 0 017-.2", "M5 12.8a9.5 9.5 0 014-2.4", "M12 20h.01"],
    lock: ["M6.5 10.5h11v9h-11z", "M8.5 10.5V8a3.5 3.5 0 017 0v2.5"],
    keep: ["M4 7h16M4 12h16M4 17h10"],
    arrow: ["M5 12h14", "M13 6l6 6-6 6"],
    send: ["M4 12l16-7-6 15-2.5-6L4 12z"]
  };
  var NS = "http://www.w3.org/2000/svg";
  function icon(doc, name) {
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "dl-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of PATHS[name]) {
      const p = doc.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }
  function markSvg(doc, size = 20) {
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const r = doc.createElementNS(NS, "rect");
    r.setAttribute("width", "32");
    r.setAttribute("height", "32");
    r.setAttribute("rx", "9");
    r.setAttribute("fill", "#0e6b5c");
    const b = doc.createElementNS(NS, "path");
    b.setAttribute("d", "M7 8.5h18a2.5 2.5 0 012.5 2.5v8a2.5 2.5 0 01-2.5 2.5H15l-5 4.2v-4.2H7A2.5 2.5 0 014.5 19v-8A2.5 2.5 0 017 8.5z");
    b.setAttribute("fill", "#fbfaf6");
    const d = doc.createElementNS(NS, "circle");
    d.setAttribute("cx", "22.5");
    d.setAttribute("cy", "22.5");
    d.setAttribute("r", "4.2");
    d.setAttribute("fill", "#d98e04");
    svg.append(r, b, d);
    return svg;
  }

  // src/ui/explain.ts
  function buildExplainModel(resp, o) {
    const tt = resp.term_translation;
    const c = tt ? canonicalStatus(tt) : "unavailable";
    const hasText = !!tt && !!tt.translation && hasDisplayableText(c);
    const explanationStatus = resp.translation ? canonicalStatus(resp.translation) : "unavailable";
    const translatedExplanation = resp.translation?.translation && hasDisplayableText(explanationStatus) ? { text: resp.translation.translation, reliability: explanationStatus } : null;
    const kept = o.shownStatus === "kept";
    const own = hasText ? c : c === "rejected" ? "rejected" : "unavailable";
    const reliability = kept ? own : o.shownStatus ?? own;
    const text = kept ? hasText ? tt.translation : null : o.shownText ?? (hasText ? tt.translation : null);
    return {
      term: o.term,
      shownText: o.shownText ?? null,
      targetName: o.targetName,
      sourceLang: o.sourceLang,
      targetLang: o.targetLang,
      translation: { text: text ?? null, reliability: text ? reliability : reliability === "rejected" ? "rejected" : "unavailable" },
      explanation: resp.found && resp.explanation_source ? { text: resp.explanation_source, reviewed: !!resp.explanation_source_reviewed } : null,
      translatedExplanation,
      example: resp.found ? resp.example_source ?? null : null,
      testData: !!tt?.test_data,
      reportable: true,
      conceptId: resp.concept_id ?? null,
      keptForLayout: kept
    };
  }
  var REL = {
    approved: { badge: "verified", icon: "shield", title: "q_approved_t", text: "q_approved" },
    automatic: { badge: "auto", icon: "spark", title: "q_automatic_t", text: "q_automatic" },
    pending_validation: { badge: "auto", icon: "info", title: "q_pending_t", text: "q_pending" },
    unavailable: { badge: "unavail", icon: "info", title: "q_unavailable_t", text: "q_unavailable" },
    rejected: { badge: "unavail", icon: "alert", title: "q_rejected_t", text: "q_rejected" },
    kept: { badge: "kept", icon: "keep", title: "q_kept_t", text: "q_kept" }
  };
  var reliabilityBadge = (doc, r, lang) => h(doc, "span", { class: `dl-badge dl-badge--${REL[r].badge}` }, icon(doc, REL[r].icon), t(REL[r].title, lang));
  function renderExplain(doc, m, lang, hd = {}) {
    const sec = (label, ...kids2) => h(doc, "section", { class: "dl-xsec" }, h(doc, "h3", {}, label), ...kids2);
    const srcName = t(m.sourceLang === "fr" ? "srcfr" : "srcen", lang);
    const rel = REL[m.translation.reliability];
    const kids = [];
    const head = h(doc, "div", { class: "dl-xhead" }, h(doc, "h2", {}, t("understand", lang)));
    if (m.testData) head.append(h(doc, "span", { class: "dl-badge dl-badge--test" }, t("badgeTest", lang)));
    if (hd.onClose) {
      const b = h(doc, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-label": t("close", lang) }, icon(doc, "close"));
      b.addEventListener("click", hd.onClose);
      head.append(b);
    }
    kids.push(head);
    const long = m.term.length > 70;
    kids.push(sec(t("c_term", lang), h(doc, "p", { class: `dl-xterm${long ? " dl-xlong" : ""}`, lang: m.sourceLang }, m.term)));
    const tr = m.translation;
    const translationItems = [
      tr.text ? h(doc, "p", { class: `dl-xtrans${long ? " dl-xlong" : ""}` }, tr.text) : null,
      h(
        doc,
        "p",
        { class: "dl-xrel" },
        reliabilityBadge(doc, m.keptForLayout ? "kept" : tr.reliability, lang),
        h(doc, "span", {}, t(m.keptForLayout ? "q_kept" : rel.text, lang))
      )
    ];
    kids.push(sec(`${t("c_in", lang)} ${m.targetName}`, ...translationItems));
    if (m.explanation || m.translatedExplanation) {
      const sourceButton = m.explanation ? h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button", "aria-pressed": "false" }, srcName) : null;
      const targetButton = m.translatedExplanation ? h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button", "aria-pressed": "false" }, m.targetName) : null;
      const choices = h(
        doc,
        "div",
        { class: "dl-xlang", role: "group", "aria-label": t("c_expl_language", lang) },
        ...sourceButton ? [sourceButton] : [],
        ...targetButton ? [targetButton] : []
      );
      const paragraph = h(doc, "p", { class: "dl-xdefinition" });
      const note = h(doc, "p", { class: "dl-muted dl-xnote" });
      const showExplanation = (target) => {
        const translated = target && m.translatedExplanation;
        const source = translated ? null : m.explanation;
        paragraph.textContent = translated ? translated.text : source?.text ?? "";
        paragraph.setAttribute("lang", translated ? m.targetLang ?? "ff" : m.sourceLang);
        sourceButton?.setAttribute("aria-pressed", String(!!source));
        targetButton?.setAttribute("aria-pressed", String(!!translated));
        note.replaceChildren();
        if (translated) {
          note.append(reliabilityBadge(doc, translated.reliability, lang), h(doc, "span", {}, t(REL[translated.reliability].text, lang)));
        } else if (source) {
          note.textContent = source.reviewed ? t("c_expl_note_reviewed", lang) : t("c_expl_note", lang);
        }
      };
      sourceButton?.addEventListener("click", () => showExplanation(false));
      targetButton?.addEventListener("click", () => showExplanation(true));
      showExplanation(!!m.translatedExplanation);
      kids.push(sec(t("c_simple", lang), choices, paragraph, note));
      if (m.example) kids.push(sec(`${t("c_example", lang)} ${t("c_src_in", lang).replace("{lang}", srcName)}`, h(doc, "p", { class: "dl-xexample", lang: m.sourceLang }, m.example)));
    } else {
      kids.push(sec(t("c_simple", lang), h(doc, "p", {}, t("c_noexpl", lang)), h(doc, "p", { class: "dl-muted dl-xnote" }, t("c_noexpl_hint", lang))));
    }
    const foot = h(doc, "div", { class: "dl-xfoot" });
    if (hd.onReport && m.reportable) {
      const b = h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button" }, icon(doc, "flag"), t("f_open", lang));
      b.addEventListener("click", hd.onReport);
      foot.append(b);
    }
    kids.push(foot);
    return h(doc, "div", { class: "dl-explain" }, ...kids);
  }
  function renderLoading(doc, lang) {
    return h(doc, "div", { class: "dl-explain", role: "status" }, h(doc, "p", { class: "dl-muted" }, t("c_loading", lang)));
  }
  function renderMessage(doc, text) {
    return h(doc, "div", { class: "dl-explain", role: "alert" }, h(doc, "p", {}, text));
  }

  // src/ui/report.ts
  var uid = 0;
  function renderReportForm(doc, lang, send, onDone) {
    const id = `dl-rep-${++uid}`;
    const cats = [["meaning", "f_meaning"], ["naturalness", "f_naturalness"], ["terminology", "f_terminology"], ["other", "f_other"]];
    const msg = h(doc, "p", { class: "dl-reperr", role: "alert" });
    msg.hidden = true;
    const radios = cats.map(([v, k], i) => {
      const input = h(doc, "input", { type: "radio", name: id, value: v, id: `${id}-${v}` });
      return h(doc, "label", { class: "dl-radio", for: `${id}-${v}` }, input, h(doc, "span", {}, t(k, lang)));
    });
    const suggest = h(doc, "input", { class: "dl-field", type: "text", id: `${id}-s`, maxlength: "300", autocomplete: "off" });
    const comment = h(doc, "textarea", { class: "dl-field", id: `${id}-c`, maxlength: "500", rows: "2" });
    const submit = h(doc, "button", { class: "dl-btn dl-btn--primary dl-btn--sm", type: "button" }, icon(doc, "send"), t("f_send", lang));
    const cancel = h(doc, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button" }, t("f_cancel", lang));
    const form = h(
      doc,
      "div",
      { class: "dl-report", role: "group", "aria-labelledby": `${id}-t` },
      h(doc, "h3", { id: `${id}-t` }, t("f_title", lang)),
      h(doc, "fieldset", { class: "dl-fieldset" }, h(doc, "legend", {}, t("f_what", lang)), ...radios),
      h(doc, "label", { for: `${id}-s`, class: "dl-lbl" }, t("f_suggest", lang)),
      suggest,
      h(doc, "label", { for: `${id}-c`, class: "dl-lbl" }, t("f_comment", lang)),
      comment,
      h(doc, "p", { class: "dl-muted dl-xnote" }, t("f_privacy", lang)),
      msg,
      h(doc, "div", { class: "dl-xfoot" }, submit, cancel)
    );
    const showErr = (text) => {
      msg.textContent = text;
      msg.hidden = false;
    };
    cancel.addEventListener("click", onDone);
    submit.addEventListener("click", async () => {
      const picked = form.querySelector(`input[name="${id}"]:checked`)?.value;
      if (!picked) return showErr(t("f_pick", lang));
      msg.hidden = true;
      submit.setAttribute("disabled", "");
      const r = await send({ category: picked, suggestion: suggest.value.trim() || null, comment: comment.value.trim() || null });
      if (r.ok) {
        form.replaceChildren(h(
          doc,
          "div",
          { role: "status", class: "dl-thanks" },
          icon(doc, "check"),
          h(doc, "div", {}, h(doc, "b", {}, t("f_thanks_t", lang)), h(doc, "p", {}, t("f_thanks", lang)))
        ), h(doc, "div", { class: "dl-xfoot" }, (() => {
          const b = h(doc, "button", { class: "dl-btn dl-btn--secondary dl-btn--sm", type: "button" }, t("close", lang));
          b.addEventListener("click", onDone);
          return b;
        })()));
      } else {
        submit.removeAttribute("disabled");
        showErr(r.code === "rate_limited" ? t("f_limit", lang) : t("f_error", lang));
      }
    });
    return form;
  }

  // src/shared/langdetect.ts
  var FR = new Set("le la les des du de et est un une pour vous votre vos avec sur dans pas que qui au aux en ce nous ou par ne se sont \xEAtre avez compte solde envoyer argent montant frais confirmer annuler historique paiement payer retirer d\xE9poser b\xE9n\xE9ficiaire beneficiaire destinataire num\xE9ro numero retour annuler re\xE7u recu retrait d\xE9p\xF4t depot transfert banque autre bonjour".split(" "));
  var EN = new Set("the and is are you your for with to of in on that this it not from by an have has will can account balance send money transfer amount fee fees confirm cancel history payment pay withdraw deposit beneficiary recipient number back withdrawal deposit bank other received hello".split(" "));
  function detectLanguage(sample, htmlLang, minHits = 4, minConf = 0.6) {
    const words = sample.toLowerCase().normalize("NFC").match(/[a-zà-ÿ']+/g) ?? [];
    let fr = 0, en = 0;
    for (const w of words.slice(0, 1500)) {
      const base = w.includes("'") ? w.split("'").pop() : w;
      if (FR.has(base)) fr++;
      if (EN.has(base)) en++;
    }
    const total = fr + en;
    const hl = (htmlLang ?? "").toLowerCase().slice(0, 2);
    if (total >= minHits) {
      const lang = fr >= en ? "fr" : "en";
      const conf = Math.max(fr, en) / total;
      if (conf >= minConf) return { lang, confidence: conf, source: "text" };
    }
    if (hl === "fr" || hl === "en") return { lang: hl, confidence: 0.5, source: "html-lang" };
    return { lang: "unknown", confidence: 0, source: "none" };
  }

  // src/shared/types.ts
  var emptyCounts = () => ({
    validated: 0,
    machine_unvalidated: 0,
    unavailable: 0,
    unchanged: 0,
    error: 0,
    pending: 0,
    layout: 0
  });

  // src/content/shadow.ts
  function shadowRootOf(el) {
    try {
      const dom = globalThis.chrome?.dom;
      return dom?.openOrClosedShadowRoot?.(el) ?? el.shadowRoot ?? null;
    } catch {
      return el.shadowRoot ?? null;
    }
  }
  function parentOf(node) {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode?.();
    return root && root.host ? root.host : null;
  }
  function collectShadowRoots(root, skip = () => false, out = []) {
    const base = root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root : null;
    if (!base) return out;
    const self = root.nodeType === Node.ELEMENT_NODE ? [root] : [];
    for (const el of [...self, ...Array.from(base.querySelectorAll("*"))]) {
      if (skip(el)) continue;
      const sr = shadowRootOf(el);
      if (sr) {
        out.push(sr);
        collectShadowRoots(sr, skip, out);
      }
    }
    return out;
  }

  // src/content/domExtractor.ts
  var HOST_ID = "dl-root";
  var SKIP_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "CODE", "PRE", "KBD", "SAMP", "TEMPLATE", "IFRAME", "OBJECT", "HEAD", "TITLE", "CANVAS", "AUDIO", "VIDEO"]);
  var IGNORE_SELECTOR = `[translate="no"], .notranslate, [data-dl-ignore], [contenteditable=""], [contenteditable="true"], #${HOST_ID}`;
  var TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label", "alt"];
  var ICON_CLASS = /(^|[\s_-])(icon|icons|fa|fas|far|fab|fal|fad|glyphicon|material-icons[\w-]*|material-symbols[\w-]*|mdi|bi|ti|ion|ri|feather|codicon|lucide)([\s_-]|$)/i;
  var BRAND_CLASS = /(^|[\s_-])(logo|logotype|brand|brandmark|wordmark)([\s_-]|$)/i;
  var PRIVATE_USE = /[\uE000-\uF8FF]/;
  var LIGATURE = /^[a-z0-9_]{2,40}$/;
  function matchesIgnore(el) {
    try {
      return el.matches(IGNORE_SELECTOR);
    } catch {
      return false;
    }
  }
  function ancestorHas(el, test, depth = 99) {
    for (let e = el, i = 0; e && i < depth; e = parentOf(e), i++) if (test(e)) return true;
    return false;
  }
  var classOf = (e) => (e.getAttribute("class") ?? "") + " " + (e.id ?? "");
  function isIgnored(el, forAttr = false, targetLang) {
    for (let e = el; e; e = parentOf(e)) {
      if (forAttr && e === el && (e.tagName === "INPUT" || e.tagName === "TEXTAREA")) continue;
      if (SKIP_TAGS.has(e.tagName.toUpperCase()) || matchesIgnore(e)) return true;
      const lang = e.getAttribute("lang");
      if (targetLang && lang && lang.toLowerCase().startsWith(targetLang.toLowerCase())) return true;
    }
    return false;
  }
  function isIconOrBrand(el, text) {
    if (!el) return false;
    if (PRIVATE_USE.test(text)) return true;
    if (ancestorHas(el, (e) => ICON_CLASS.test(e.getAttribute("class") ?? ""), 2)) return true;
    if (ancestorHas(el, (e) => BRAND_CLASS.test(classOf(e)), 3)) return true;
    if (LIGATURE.test(text.trim()) && text.trim().length <= 40) {
      try {
        const ff = el.ownerDocument.defaultView?.getComputedStyle(el).fontFamily ?? "";
        if (/icon|symbol|material|awesome|glyph|feather/i.test(ff)) return true;
      } catch {
      }
    }
    return false;
  }
  var letterCount = (s) => (s.match(new RegExp("\\p{L}", "gu")) ?? []).length;
  var DomExtractor = class {
    constructor(opts) {
      this.opts = opts;
    }
    counter = 0;
    make(partial, raw) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
      const core = m[2].replace(/\s+/g, " ");
      if (!core) return null;
      const mask = maskText(core);
      if (!hasTranslatableLetters(mask.masked)) return null;
      if (letterCount(mask.masked.replace(/\{\{P\d+\}\}/g, "")) < 2) return null;
      return { ...partial, id: `s${++this.counter}`, lead: m[1], trail: m[3], masked: mask.masked, tokens: mask.tokens };
    }
    extract(root) {
      const out = [];
      const tl = this.opts.targetLang;
      const handleText = (t2) => {
        const parent = t2.parentElement ?? parentOf(t2);
        if (!parent || isIgnored(parent, false, tl)) return;
        const raw = t2.nodeValue ?? "";
        if (parent.tagName === "OPTION" && !parent.hasAttribute("value")) return;
        if (this.opts.shouldSkip?.(t2) || isIconOrBrand(parent, raw)) return;
        const ref = this.make({ kind: "text", node: t2, original: raw, context: contextOf(parent, "text") }, raw);
        if (ref) out.push(ref);
      };
      const handleAttrs = (el) => {
        if (isIgnored(el, true, tl)) return;
        if (el.tagName === "INPUT" && el.type === "hidden") return;
        for (const a of TRANSLATABLE_ATTRS) {
          const v = el.getAttribute(a);
          if (!v || this.opts.shouldSkip?.(el, a)) continue;
          if (a === "alt" && ancestorHas(el, (e) => BRAND_CLASS.test(classOf(e)), 3)) continue;
          const ref = this.make({ kind: "attr", node: el, attr: a, original: v, context: contextOf(el, "attribute", a) }, v);
          if (ref) out.push(ref);
        }
      };
      const walkRoot = (start2) => {
        const doc = start2.ownerDocument ?? start2;
        const walker = doc.createTreeWalker(start2, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
          acceptNode: (n) => {
            if (n.nodeType === Node.ELEMENT_NODE) {
              const e = n;
              return SKIP_TAGS.has(e.tagName.toUpperCase()) || matchesIgnore(e) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) handleText(n);
        if (this.opts.attributes) {
          if (start2.nodeType === Node.ELEMENT_NODE) handleAttrs(start2);
          for (const el of Array.from(start2.querySelectorAll(TRANSLATABLE_ATTRS.map((a) => `[${a}]`).join(",")))) handleAttrs(el);
        }
      };
      if (root.nodeType === Node.TEXT_NODE) {
        handleText(root);
        return out;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return out;
      const start = root.nodeType === Node.DOCUMENT_NODE ? root.body ?? root.documentElement : root;
      if (!start) return out;
      if (start.nodeType === Node.ELEMENT_NODE && isIgnored(start, false, tl)) return out;
      walkRoot(start);
      for (const sr of collectShadowRoots(start, (el) => el.id === HOST_ID || isIgnored(el, false, tl))) {
        this.opts.onShadowRoot?.(sr);
        walkRoot(sr);
      }
      return out;
    }
  };
  function contextOf(el, kind, attr) {
    const ctx = { kind };
    if (attr) ctx.attr = attr;
    if (!el) return ctx;
    ctx.tag = el.tagName.toLowerCase();
    const role = el.closest("[role]")?.getAttribute("role");
    if (role) ctx.role = role.slice(0, 32);
    if (el.closest("[role=alert],[role=status],[role=alertdialog]")) ctx.region = "alert";
    else if (el.closest("nav,[role=navigation]")) ctx.region = "nav";
    else if (el.closest("dialog,[role=dialog]")) ctx.region = "dialog";
    else if (el.closest("table")) ctx.region = "table";
    return ctx;
  }

  // src/content/domRestorer.ts
  var Restorer = class {
    texts = /* @__PURE__ */ new Map();
    attrs = /* @__PURE__ */ new Map();
    applyText(node, original, applied) {
      const prev = this.texts.get(node);
      node.nodeValue = applied;
      this.texts.set(node, { original: prev?.original ?? original, applied });
    }
    applyAttr(el, attr, original, applied) {
      const m = this.attrs.get(el) ?? /* @__PURE__ */ new Map();
      const prev = m.get(attr);
      el.setAttribute(attr, applied);
      m.set(attr, { original: prev?.original ?? original, applied });
      this.attrs.set(el, m);
    }
    /** Rétablit un nœud (repli de mise en page) et oublie sa trace. */
    revertText(node) {
      const r = this.texts.get(node);
      if (r && node.nodeValue === r.applied) node.nodeValue = r.original;
      this.texts.delete(node);
    }
    revertAttr(el, attr) {
      const r = this.attrs.get(el)?.get(attr);
      if (r && el.getAttribute(attr) === r.applied) el.setAttribute(attr, r.original);
      this.attrs.get(el)?.delete(attr);
    }
    /** Vrai si le nœud porte actuellement NOTRE traduction (permet d'ignorer nos propres mutations). */
    isApplied(node, attr) {
      if (attr) return this.attrs.get(node)?.get(attr)?.applied === node.getAttribute(attr);
      const r = this.texts.get(node);
      return !!r && r.applied === node.nodeValue;
    }
    hasRecord(node, attr) {
      return attr ? !!this.attrs.get(node)?.has(attr) : this.texts.has(node);
    }
    originalOf(node) {
      return this.texts.get(node)?.original;
    }
    forget(node, attr) {
      if (attr) this.attrs.get(node)?.delete(attr);
      else this.texts.delete(node);
    }
    get size() {
      let n = this.texts.size;
      for (const m of this.attrs.values()) n += m.size;
      return n;
    }
    prune() {
      for (const n of this.texts.keys()) if (!n.isConnected) this.texts.delete(n);
      for (const e of this.attrs.keys()) if (!e.isConnected) this.attrs.delete(e);
    }
    restoreAll() {
      let restored = 0, respected = 0;
      for (const [node, r] of this.texts) {
        if (node.nodeValue === r.applied) {
          node.nodeValue = r.original;
          restored++;
        } else respected++;
      }
      for (const [el, m] of this.attrs) {
        for (const [a, r] of m) {
          if (el.getAttribute(a) === r.applied) {
            el.setAttribute(a, r.original);
            restored++;
          } else respected++;
        }
      }
      this.texts.clear();
      this.attrs.clear();
      return { restored, respectedSiteChanges: respected };
    }
  };

  // src/content/ledger.ts
  var Ledger = class {
    m = /* @__PURE__ */ new Map();
    set(node, attr, e) {
      const per = this.m.get(node) ?? /* @__PURE__ */ new Map();
      per.set(attr ?? "", e);
      this.m.set(node, per);
    }
    get(node, attr) {
      return this.m.get(node)?.get(attr ?? "");
    }
    delete(node, attr) {
      const per = this.m.get(node);
      if (!per) return;
      per.delete(attr ?? "");
      if (!per.size) this.m.delete(node);
    }
    prune() {
      for (const n of [...this.m.keys()]) if (!n.isConnected) this.m.delete(n);
    }
    clear() {
      this.m.clear();
    }
    summary() {
      const s = {
        approved: 0,
        automatic: 0,
        pending_validation: 0,
        unavailable: 0,
        rejected: 0,
        layout: 0,
        error: 0,
        total: 0,
        verified: 0,
        unverified: 0,
        kept: 0,
        reasons: {},
        testData: false
      };
      for (const [node, per] of this.m) {
        if (!node.isConnected) continue;
        for (const e of per.values()) {
          s[e.status]++;
          s.total++;
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
  };

  // src/content/layoutGuard.ts
  var CONTROL_TAGS = /* @__PURE__ */ new Set(["BUTTON", "SELECT", "SUMMARY"]);
  var CONTROL_ROLES = /* @__PURE__ */ new Set(["button", "tab", "menuitem", "option", "switch", "link"]);
  var CONTROL_CLASS = /(^|[\s_-])(btn|button|chip|pill|tag|badge|tab)([\s_-]|$)/i;
  var SLACK = 1;
  var LayoutGuard = class _LayoutGuard {
    constructor(win = window) {
      this.win = win;
    }
    /** Élément dont la mise en page peut être affectée par un changement de texte de ce nœud. */
    static elementFor(node) {
      let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (el && (el.tagName === "OPTION" || el.tagName === "OPTGROUP")) el = el.closest("select") ?? el;
      return el;
    }
    /** Mesure d'un élément (publique : sert aussi à surveiller les victimes collatérales). */
    measure(el) {
      return this.box(el);
    }
    box(el) {
      let cs = null;
      try {
        cs = this.win.getComputedStyle(el);
      } catch {
      }
      const r = el.getBoundingClientRect();
      const role = el.getAttribute("role") ?? "";
      const inline = el.clientWidth === 0 && el.clientHeight === 0;
      return {
        w: r.width,
        h: r.height,
        sw: el.scrollWidth ?? 0,
        cw: el.clientWidth ?? 0,
        sh: el.scrollHeight ?? 0,
        ch: el.clientHeight ?? 0,
        ox: cs?.overflowX ?? "visible",
        oy: cs?.overflowY ?? "visible",
        nowrap: /nowrap|pre\b/.test(cs?.whiteSpace ?? ""),
        ellipsis: cs?.textOverflow === "ellipsis",
        control: CONTROL_TAGS.has(el.tagName) || CONTROL_ROLES.has(role) || CONTROL_CLASS.test(el.getAttribute("class") ?? ""),
        inline
      };
    }
    snapshot(el) {
      const chain = [];
      for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) chain.push(this.box(e));
      return { chain };
    }
    /** Conteneur dont les pistes (colonnes/lignes) sont partagées : table, flex, grille. Un texte qui grandit y réduit la place des voisins. */
    containerOf(el) {
      for (let e = el.parentElement, i = 0; e && i < 8; e = e.parentElement, i++) {
        let d = "";
        try {
          d = this.win.getComputedStyle(e).display;
        } catch {
          return null;
        }
        if (/^(table|inline-table|flex|inline-flex|grid|inline-grid)$/.test(d)) return e;
      }
      return null;
    }
    /** Éléments susceptibles de TRONQUER leur contenu (overflow ≠ visible + nowrap/ellipsis) dans un conteneur. */
    collectClippable(container, limit = 400) {
      const out = [];
      const all = container.querySelectorAll("*");
      for (let i = 0; i < all.length && i < limit * 4 && out.length < limit; i++) {
        const e = all[i];
        let cs;
        try {
          cs = this.win.getComputedStyle(e);
        } catch {
          continue;
        }
        if ((cs.overflowX !== "visible" || cs.overflowY !== "visible") && (/nowrap/.test(cs.whiteSpace) || cs.textOverflow === "ellipsis")) out.push(e);
      }
      return out;
    }
    /**
     * Troncature NOUVELLE ou AGGRAVÉE sur l'axe horizontal : le contenu dépasse davantage qu'avant, dans un élément qui coupe (overflow caché,
     * ellipsis) ou qui déborde sur ses voisins (nowrap). Les zones défilantes (auto/scroll) ne perdent rien : elles sont ignorées.
     */
    static worsenedX(b, a) {
      const clips = a.ox === "hidden" || a.ox === "clip" || a.ellipsis || a.ox === "visible" && a.nowrap;
      return !a.inline && clips && a.sw - a.cw > Math.max(0, b.sw - b.cw) + SLACK;
    }
    /** Idem sur l'axe vertical (hauteur fixe + overflow caché : le texte est coupé). */
    static worsenedY(b, a) {
      return !a.inline && (a.oy === "hidden" || a.oy === "clip") && a.sh - a.ch > Math.max(0, b.sh - b.ch) + SLACK;
    }
    isNewClip(b, a) {
      return _LayoutGuard.worsenedX(b, a);
    }
    pageOverflowsX() {
      const d = this.win.document.documentElement;
      return d.scrollWidth > d.clientWidth + SLACK;
    }
    /** Comparaison avant/après — fonction pure. */
    judge(before, after) {
      for (let i = 0; i < Math.min(before.chain.length, after.chain.length); i++) {
        const b = before.chain[i], a = after.chain[i];
        if (a.inline) continue;
        if (_LayoutGuard.worsenedX(b, a)) return { code: "clip_x", level: i };
        if (_LayoutGuard.worsenedY(b, a)) return { code: "clip_y", level: i };
        if (a.control && a.h - b.h > Math.max(6, 0.3 * b.h)) return { code: "control_wrap", level: i };
      }
      return null;
    }
  };

  // src/content/marks.ts
  var NAMES = { verified: "dl-verified", auto: "dl-auto" };
  var MARK_RULES = `
::highlight(dl-auto) { text-decoration: underline dotted rgba(201, 138, 18, .85); text-decoration-thickness: 1px; }
::highlight(dl-verified) { text-decoration: underline dotted rgba(47, 154, 99, .8); text-decoration-thickness: 1px; }
`;
  var STYLE_ID = "dl-highlight-style";
  var HighlightMarks = class {
    constructor(doc, mode) {
      this.doc = doc;
      this.mode = mode;
    }
    ranges = /* @__PURE__ */ new Map();
    sheet = null;
    styleEl = null;
    highlights = /* @__PURE__ */ new Map();
    get supported() {
      const w = this.doc.defaultView;
      return !!w && typeof w.Highlight === "function" && !!w.CSS?.highlights;
    }
    install() {
      if (this.sheet || this.styleEl) return;
      const w = this.doc.defaultView;
      try {
        const sheet = new w.CSSStyleSheet();
        sheet.replaceSync(MARK_RULES);
        this.doc.adoptedStyleSheets = [...this.doc.adoptedStyleSheets ?? [], sheet];
        this.sheet = sheet;
      } catch {
        const s = this.doc.createElement("style");
        s.id = STYLE_ID;
        s.textContent = MARK_RULES;
        (this.doc.head ?? this.doc.documentElement).appendChild(s);
        this.styleEl = s;
      }
    }
    mark(node, kind) {
      const m = this.mode();
      if (!this.supported || m === "none" || kind === "verified" && m !== "all") return;
      this.install();
      const w = this.doc.defaultView;
      this.unmark(node);
      const range = this.doc.createRange();
      range.selectNodeContents(node);
      let hl = this.highlights.get(kind);
      if (!hl) {
        hl = new w.Highlight();
        this.highlights.set(kind, hl);
        w.CSS.highlights.set(NAMES[kind], hl);
      }
      hl.add(range);
      this.ranges.set(node, { range, kind });
    }
    unmark(node) {
      const r = this.ranges.get(node);
      if (!r) return;
      this.highlights.get(r.kind)?.delete(r.range);
      this.ranges.delete(node);
    }
    clear() {
      const w = this.doc.defaultView;
      for (const [kind] of this.highlights) w.CSS?.highlights?.delete(NAMES[kind]);
      this.highlights.clear();
      this.ranges.clear();
      if (this.sheet) this.doc.adoptedStyleSheets = this.doc.adoptedStyleSheets.filter((s) => s !== this.sheet);
      this.styleEl?.remove();
      this.sheet = null;
      this.styleEl = null;
    }
  };

  // src/content/observer.ts
  var DynamicObserver = class {
    constructor(root, onNodes, isOurs, delayMs = 250) {
      this.root = root;
      this.onNodes = onNodes;
      this.isOurs = isOurs;
      this.delayMs = delayMs;
    }
    mo = null;
    observed = /* @__PURE__ */ new WeakSet();
    pending = /* @__PURE__ */ new Set();
    timer = null;
    start() {
      if (this.mo) return;
      this.mo = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "characterData") {
            if (!this.isOurs(r.target)) this.pending.add(r.target);
          } else {
            r.addedNodes.forEach((n) => {
              if ((n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) && !this.inHost(n)) this.pending.add(n);
            });
          }
        }
        if (this.pending.size && !this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs);
      });
      this.addRoot(this.root);
    }
    /** Observe une racine supplémentaire (Shadow DOM). Idempotent. */
    addRoot(root) {
      if (!this.mo || this.observed.has(root)) return;
      this.observed.add(root);
      this.mo.observe(root, { childList: true, characterData: true, subtree: true });
    }
    inHost(n) {
      const el = n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
      return !!el && (el.id === HOST_ID || !!el.closest(`#${HOST_ID}`));
    }
    flush() {
      this.timer = null;
      const nodes = [...this.pending].filter((n) => n.isConnected);
      this.pending.clear();
      const roots = nodes.filter((n) => !nodes.some((o) => o !== n && o.nodeType === Node.ELEMENT_NODE && o.contains(n)));
      if (roots.length) this.onNodes(roots);
    }
    stop() {
      this.mo?.disconnect();
      this.mo = null;
      this.observed = /* @__PURE__ */ new WeakSet();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.pending.clear();
    }
  };

  // src/content/routes.ts
  var RouteWatcher = class {
    constructor(win, onChange, debounceMs = 350, pollMs = 1e3) {
      this.win = win;
      this.onChange = onChange;
      this.debounceMs = debounceMs;
      this.pollMs = pollMs;
    }
    last = "";
    timer = null;
    poll = null;
    cleanup = [];
    start() {
      this.last = this.win.location.href;
      const fire = () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.last = this.win.location.href;
          this.onChange();
        }, this.debounceMs);
      };
      const nav = this.win.navigation;
      if (nav?.addEventListener) {
        nav.addEventListener("navigatesuccess", fire);
        this.cleanup.push(() => nav.removeEventListener("navigatesuccess", fire));
      }
      for (const ev of ["popstate", "hashchange"]) {
        this.win.addEventListener(ev, fire);
        this.cleanup.push(() => this.win.removeEventListener(ev, fire));
      }
      if (!nav) this.poll = setInterval(() => {
        if (this.win.location.href !== this.last) fire();
      }, this.pollMs);
    }
    stop() {
      for (const c of this.cleanup) c();
      this.cleanup = [];
      if (this.timer) clearTimeout(this.timer);
      if (this.poll) clearInterval(this.poll);
      this.timer = this.poll = null;
    }
  };

  // src/content/controller.ts
  function chunk(a, n) {
    const o = [];
    for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
    return o;
  }
  var ledgerStatus = (c) => c === "approved" || c === "automatic" || c === "pending_validation" || c === "rejected" || c === "unavailable" ? c : "error";
  var PageTranslator = class {
    // sérialise les traitements (lots + mutations + navigation)
    constructor(d) {
      this.d = d;
      this.guard = d.guard === void 0 ? new LayoutGuard(d.doc.defaultView) : d.guard;
      this.marks = d.marks === void 0 ? new HighlightMarks(d.doc, () => d.settings().marks) : d.marks;
      this.extractor = this.newExtractor();
    }
    restorer = new Restorer();
    ledger = new Ledger();
    extractor;
    observer = null;
    routes = null;
    marks;
    guard;
    gen = 0;
    active = false;
    target = null;
    source = "unknown";
    pendingCount = 0;
    message;
    phase = "inactive";
    churn = /* @__PURE__ */ new WeakMap();
    blocked = /* @__PURE__ */ new WeakSet();
    /** Textes volontairement conservés (mise en page) : tant que leur valeur n'a pas changé, on ne les retraite pas. */
    kept = /* @__PURE__ */ new WeakMap();
    isKept(n, attr) {
      const v = attr ? n.getAttribute(attr) : n.nodeValue;
      return this.kept.get(n) === v && v !== null;
    }
    chain = Promise.resolve();
    newExtractor() {
      return new DomExtractor({
        attributes: this.d.settings().translateAttributes,
        targetLang: this.target ?? void 0,
        shouldSkip: (n, attr) => this.restorer.isApplied(n, attr) || this.blocked.has(n) || this.isKept(n, attr),
        onShadowRoot: (r) => this.observer?.addRoot(r)
      });
    }
    // ------------------------------------------------------------------ état
    /** Langue de la page avant toute activation (échantillon léger, mis en cache 5 s). */
    peeked = null;
    peekLanguage() {
      const now = Date.now();
      if (this.peeked && now - this.peeked.at < 5e3) return this.peeked.lang;
      let sample = "";
      const body = this.d.doc.body;
      if (body) {
        const w = this.d.doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(n.parentElement?.tagName ?? "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        for (let n = w.nextNode(); n && sample.length < 4e3; n = w.nextNode()) sample += " " + (n.nodeValue ?? "");
      }
      const lang = detectLanguage(sample, this.d.doc.documentElement.getAttribute("lang")).lang;
      this.peeked = { at: now, lang };
      return lang;
    }
    getState() {
      this.ledger.prune();
      const s = this.ledger.summary();
      const counts = {
        ...emptyCounts(),
        validated: s.approved,
        machine_unvalidated: s.unverified,
        unavailable: s.unavailable + s.rejected,
        layout: s.layout,
        error: s.error,
        pending: this.pendingCount
      };
      return {
        phase: this.phase,
        target: this.target,
        detectedLang: this.active ? this.source : this.peekLanguage(),
        total: s.total + this.pendingCount,
        counts,
        testData: s.testData,
        message: this.message,
        coverage: { verified: s.verified, unverified: s.unverified, kept: s.kept, total: s.total },
        reasons: s.reasons
      };
    }
    emit(phase, message) {
      if (phase) this.phase = phase;
      this.message = message;
      this.d.onState(this.getState());
    }
    // ------------------------------------------------------------------ activation
    async activate(target) {
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
      this.observer = new DynamicObserver(
        this.d.doc.body ?? this.d.doc.documentElement,
        (nodes) => this.enqueue(() => this.onMutations(nodes, gen)),
        (n) => this.restorer.isApplied(n) || this.isKept(n),
        this.d.mutationDelayMs ?? 250
      );
      this.observer.start();
      if (this.d.watchRoutes !== false) {
        this.routes = new RouteWatcher(this.d.doc.defaultView, () => this.enqueue(() => this.rescan(gen)));
        this.routes.start();
      }
      if (!refs.length) {
        this.emit("empty");
        return;
      }
      this.emit("translating");
      await this.enqueue(() => this.process(refs, gen));
    }
    deactivate() {
      this.gen++;
      this.active = false;
      this.observer?.stop();
      this.observer = null;
      this.routes?.stop();
      this.routes = null;
      this.restorer.restoreAll();
      this.marks?.clear();
      this.ledger.clear();
      this.pendingCount = 0;
      this.blocked = /* @__PURE__ */ new WeakSet();
      this.churn = /* @__PURE__ */ new WeakMap();
      this.kept = /* @__PURE__ */ new WeakMap();
      this.emit("inactive");
    }
    /** Attend la fin des traitements en cours (utile aux tests et à la restauration propre). */
    idle() {
      return this.chain;
    }
    enqueue(fn) {
      this.chain = this.chain.then(fn, fn);
      return this.chain;
    }
    pageLanguage(refs) {
      const sample = refs.map((r) => r.masked.replace(/\{\{P\d+\}\}/g, " ")).join(" ").slice(0, 8e3);
      return detectLanguage(sample, this.d.doc.documentElement.getAttribute("lang")).lang;
    }
    /** Langue d'un segment : détection fine si nette (pages multilingues), sinon langue de la page. */
    segmentLang(ref) {
      const d = detectLanguage(ref.masked.replace(/\{\{P\d+\}\}/g, " "), null, 1, 1);
      if (d.source === "text" && (d.lang === "fr" || d.lang === "en")) return d.lang;
      const node = ref.node;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      const holder = el?.closest?.("[lang]") ?? null;
      const hl = holder && holder !== this.d.doc.documentElement ? (holder.getAttribute("lang") ?? "").toLowerCase().slice(0, 2) : "";
      return hl === "fr" || hl === "en" ? hl : this.source;
    }
    // ------------------------------------------------------------------ contenus dynamiques et navigation
    async onMutations(nodes, gen) {
      if (gen !== this.gen || !this.active) return;
      const now = Date.now();
      const refs = [];
      for (const n of nodes) {
        if (!n.isConnected || this.blocked.has(n)) continue;
        if (n.nodeType === Node.TEXT_NODE && this.restorer.hasRecord(n) && !this.restorer.isApplied(n)) {
          const c = this.churn.get(n) ?? { n: 0, t: now };
          if (now - c.t > 1e4) {
            c.n = 0;
            c.t = now;
          }
          c.n++;
          this.churn.set(n, c);
          if (c.n > 6) {
            this.blocked.add(n);
            continue;
          }
          this.restorer.forget(n);
          this.ledger.delete(n);
          this.marks?.unmark(n);
        }
        refs.push(...this.extractor.extract(n));
      }
      this.restorer.prune();
      this.ledger.prune();
      const det = detectLanguage(refs.map((r) => r.masked.replace(/\{\{P\d+\}\}/g, " ")).join(" ").slice(0, 8e3), null);
      if (det.source === "text" && (det.lang === "fr" || det.lang === "en") && det.lang !== this.source) this.source = det.lang;
      await this.process(refs, gen);
    }
    /** Nouveau balayage complet (navigation interne sans rechargement). */
    async rescan(gen = this.gen) {
      if (gen !== this.gen || !this.active) return;
      this.restorer.prune();
      this.ledger.prune();
      this.blocked = /* @__PURE__ */ new WeakSet();
      this.churn = /* @__PURE__ */ new WeakMap();
      const refs = this.extractor.extract(this.d.doc);
      const lang = this.pageLanguage(refs);
      if (lang !== "unknown") this.source = lang;
      if (!refs.length) {
        this.finalize();
        return;
      }
      await this.process(refs, gen);
    }
    // ------------------------------------------------------------------ traitement par lots
    async process(refs, gen) {
      if (!refs.length || gen !== this.gen) {
        if (gen === this.gen) this.finalize();
        return;
      }
      this.pendingCount += refs.length;
      this.emit("translating");
      const target = this.target;
      const ctx = this.newGuardCtx(refs);
      const groups = /* @__PURE__ */ new Map();
      for (const r of refs) {
        const l = this.segmentLang(r);
        (groups.get(l) ?? groups.set(l, []).get(l)).push(r);
      }
      let failures = 0, lastCode = "";
      for (const [source, list] of groups) {
        for (const batch of chunk(list, this.d.batchSize ?? 50)) {
          if (gen !== this.gen) return;
          let results = null;
          if (failures < 2) {
            const segments = batch.map((r) => ({ id: r.id, text: r.masked, context: r.context }));
            try {
              const resp = await this.d.send({ type: "dl/translate", source, target, segments });
              if (resp.ok) {
                results = resp.data;
                failures = 0;
              } else {
                failures++;
                lastCode = resp.code;
              }
            } catch {
              failures++;
              lastCode = "network";
            }
            if (gen !== this.gen) return;
          } else lastCode ||= "network";
          const byId = new Map((results ?? []).map((r) => [r.id, r]));
          const plans = [];
          for (const ref of batch) {
            const res = byId.get(ref.id) ?? { id: ref.id, status: "error", translation: null, reason: lastCode || "missing_result" };
            const plan = this.classify(ref, res);
            if (plan) plans.push(plan);
            this.pendingCount--;
          }
          this.applyBatch(plans, ctx);
          this.emit("translating");
        }
      }
      this.enforce(ctx);
      this.finalize(lastCode);
    }
    /** Décide du sort d'un résultat : plan d'application, ou entrée de registre (texte conservé). */
    classify(ref, res) {
      const key = ref.kind === "text" ? ref.node : ref.node;
      const attr = ref.kind === "attr" ? ref.attr : void 0;
      const c = canonicalStatus(res);
      const reason = res.reason ?? null;
      if (res.status === "error") {
        this.ledger.set(key, attr, { status: "error", reason });
        return null;
      }
      if (res.status === "unchanged") return null;
      if (!hasDisplayableText(c) || res.translation == null) {
        this.ledger.set(key, attr, { status: ledgerStatus(c === "rejected" ? "rejected" : "unavailable"), reason });
        return null;
      }
      if (!placeholdersMatch(ref.masked, res.translation)) {
        this.ledger.set(key, attr, { status: "unavailable", reason: "integrity_check_failed" });
        return null;
      }
      if (ref.kind === "text") {
        const n = ref.node;
        if (!n.isConnected || n.nodeValue !== ref.original) return null;
      } else {
        const e = ref.node;
        if (!e.isConnected || e.getAttribute(ref.attr) !== ref.original) return null;
      }
      return { ref, final: ref.lead + unmask(res.translation, ref.tokens) + ref.trail, status: c, testData: !!res.test_data };
    }
    newGuardCtx(refs) {
      const guard = this.d.settings().layoutGuard === false ? null : this.guard;
      const ctx = { guard, baseline: /* @__PURE__ */ new Map(), pageBefore: false, applied: [], reverted: /* @__PURE__ */ new Set(), victims: /* @__PURE__ */ new Map() };
      if (guard) {
        for (const r of refs) {
          const e = LayoutGuard.elementFor(r.node);
          if (e && !ctx.baseline.has(e)) ctx.baseline.set(e, guard.snapshot(e));
        }
        ctx.pageBefore = guard.pageOverflowsX();
        const containers = /* @__PURE__ */ new Set();
        for (const e of ctx.baseline.keys()) {
          const c = guard.containerOf(e);
          if (c) containers.add(c);
        }
        const depth = (e) => {
          let d = 0;
          for (let x = e; x; x = x.parentElement) d++;
          return d;
        };
        for (const c of [...containers].sort((a, b) => depth(b) - depth(a)))
          for (const v of guard.collectClippable(c)) if (!ctx.victims.has(v)) ctx.victims.set(v, { box: guard.measure(v), container: c });
      }
      return ctx;
    }
    revert(p, ctx) {
      this.kept.set(p.ref.node, p.ref.original);
      if (p.ref.kind === "text") {
        this.restorer.revertText(p.ref.node);
        this.marks?.unmark(p.ref.node);
      } else this.restorer.revertAttr(p.ref.node, p.ref.attr);
      this.ledger.set(p.ref.node, p.ref.kind === "attr" ? p.ref.attr : void 0, { status: "layout", reason: "layout" });
      ctx.reverted.add(p);
    }
    /** Écriture d'un lot puis contrôle : les textes qui dégradent la mise en page sont rétablis. */
    applyBatch(plans, ctx) {
      if (!plans.length) return;
      for (const p of plans) {
        if (p.ref.kind === "text") this.restorer.applyText(p.ref.node, p.ref.original, p.final);
        else this.restorer.applyAttr(p.ref.node, p.ref.attr, p.ref.original, p.final);
        const attr = p.ref.kind === "attr" ? p.ref.attr : void 0;
        this.ledger.set(p.ref.node, attr, { status: ledgerStatus(p.status), testData: p.testData });
      }
      ctx.applied.push(...plans);
      this.enforce(ctx);
      for (const p of plans) if (!ctx.reverted.has(p) && p.ref.kind === "text") this.marks?.mark(p.ref.node, p.status === "approved" ? "verified" : "auto");
    }
    /**
     * Un texte qui grandit réduit la place de ses voisins (colonnes de tableau, éléments flex). Si un élément — traduit ou non —
     * se met à tronquer son contenu, on rétablit les traductions de son conteneur, les plus larges d'abord, jusqu'à résorption.
     */
    protectVictims(ctx) {
      const guard = ctx.guard;
      const elOf = (p) => LayoutGuard.elementFor(p.ref.node);
      const growth = (p) => {
        const e = elOf(p), b = e && ctx.baseline.get(e);
        return e && b ? guard.measure(e).w - b.chain[0].w : 0;
      };
      const ignored = /* @__PURE__ */ new Set();
      for (let iter = 0; iter < 80; iter++) {
        const hit = [...ctx.victims].filter(([v, info2]) => !ignored.has(v) && v.isConnected && guard.isNewClip(info2.box, guard.measure(v)));
        if (!hit.length) return;
        const [victim, info] = hit[0];
        const cands = ctx.applied.filter((p) => !ctx.reverted.has(p) && elOf(p) && info.container.contains(elOf(p))).sort((a, b) => growth(b) - growth(a));
        if (!cands.length) {
          ignored.add(victim);
          continue;
        }
        this.revert(cands[0], ctx);
      }
    }
    /** Point fixe : rétablir un texte peut en faire déborder un autre (colonnes de tableau, flex…) → on re-juge tout jusqu'à stabilité. */
    enforce(ctx) {
      const guard = ctx.guard;
      if (!guard) return;
      const elOf = (p) => LayoutGuard.elementFor(p.ref.node);
      let after = /* @__PURE__ */ new Map();
      for (let pass = 0; pass < 6; pass++) {
        const live = ctx.applied.filter((p) => !ctx.reverted.has(p) && elOf(p)?.isConnected);
        if (!live.length) return;
        after = /* @__PURE__ */ new Map();
        for (const e of new Set(live.map(elOf).filter((x) => !!x))) after.set(e, guard.snapshot(e));
        const bad = live.filter((p) => {
          const e = elOf(p);
          const b = e && ctx.baseline.get(e);
          return !!e && !!b && !!guard.judge(b, after.get(e));
        });
        if (!bad.length) break;
        for (const p of bad) this.revert(p, ctx);
      }
      this.protectVictims(ctx);
      if (!ctx.pageBefore && guard.pageOverflowsX()) {
        const growth = (p) => {
          const e = elOf(p);
          const a = e && after.get(e), b = e && ctx.baseline.get(e);
          return a && b ? a.chain[0].w - b.chain[0].w : 0;
        };
        for (const p of ctx.applied.filter((x) => !ctx.reverted.has(x) && growth(x) > 4).sort((a, b) => growth(b) - growth(a))) {
          this.revert(p, ctx);
          if (!guard.pageOverflowsX()) break;
        }
      }
    }
    finalize(lastCode = "") {
      this.ledger.prune();
      if (this.pendingCount > 0) return;
      const s = this.ledger.summary();
      const translated = s.verified + s.unverified;
      const other = s.unavailable + s.rejected + s.layout;
      let phase = "done";
      if (s.total === 0) phase = "empty";
      else if (translated === 0) phase = s.error > 0 && other === 0 ? "error" : "unavailable";
      else if (s.error > 0 || other > 0) phase = "partial";
      this.emit(phase, phase === "error" ? lastCode || "network" : void 0);
    }
    // ------------------------------------------------------------------ sélection (comprendre, traduire, signaler)
    async ensureSource(text) {
      const selection = detectLanguage(text, null, 1, 1);
      if (selection.source === "text" && selection.lang !== "unknown") return selection.lang;
      if (this.source !== "unknown") return this.source;
      const d = detectLanguage(text, this.d.doc.documentElement.getAttribute("lang"));
      return d.lang === "unknown" ? "fr" : d.lang;
    }
    get targetLang() {
      return this.target ?? this.d.defaultTarget();
    }
    get sourceLang() {
      return this.source;
    }
    get isActive() {
      return this.active;
    }
    /** Pour un nœud texte déjà traité : original, texte affiché et statut (la sélection d'un texte traduit doit remonter à l'ORIGINAL). */
    inspectNode(node) {
      if (node.nodeType !== Node.TEXT_NODE) return null;
      const original = this.restorer.originalOf(node);
      const e = this.ledger.get(node);
      if (original === void 0) return e?.status === "layout" ? { original: (node.nodeValue ?? "").trim(), shown: "", status: "layout", testData: !!e.testData } : null;
      return { original: original.trim(), shown: (node.nodeValue ?? "").trim(), status: e?.status ?? null, testData: !!e?.testData };
    }
    async translateText(text) {
      const m = maskText(text.trim());
      if (!hasTranslatableLetters(m.masked)) return { original: text, result: { id: "sel", status: "unchanged", translation: text } };
      const source = await this.ensureSource(text);
      const resp = await this.d.send({
        type: "dl/translate",
        source,
        target: this.targetLang,
        segments: [{ id: "sel", text: m.masked, context: { kind: "text", tag: "p" } }]
      });
      if (!resp.ok) return { original: text, result: { id: "sel", status: "error", translation: null, reason: resp.code } };
      const r = resp.data[0];
      if (r && r.status !== "error" && r.translation != null) {
        if (!placeholdersMatch(m.masked, r.translation)) return { original: text, result: { id: "sel", status: "unavailable", translation: null, reason: "integrity_check_failed" } };
        return { original: text, result: { ...r, translation: unmask(r.translation, m.tokens) } };
      }
      return { original: text, result: r ?? { id: "sel", status: "error", translation: null, reason: "missing_result" } };
    }
    async explainText(text) {
      const m = maskText(text.trim());
      const source = await this.ensureSource(text);
      const resp = await this.d.send({ type: "dl/explain", source, target: this.targetLang, text: m.masked });
      return resp.ok ? { ok: true, data: resp.data, sourceLang: source } : { ok: false, code: resp.code };
    }
  };

  // src/ui/components.css
  var components_default = '/* Composants r\xE9utilisables Diversity Lingua (pr\xE9fixe .dl-). Utilisent uniquement les jetons de tokens.css. */\n.dl-root { font-family: var(--dl-font); font-size: var(--dl-fs-md); line-height: var(--dl-lh-body); color: var(--dl-ink-900); }\n.dl-root *, .dl-root *::before, .dl-root *::after { box-sizing: border-box; }\n.dl-sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n.dl-root :focus-visible { outline: 3px solid var(--dl-focus); outline-offset: 2px; border-radius: var(--dl-r-sm); }\n\n.dl-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: var(--dl-s-2); min-height: var(--dl-hit);\n  padding: 0 var(--dl-s-4); border-radius: var(--dl-r-md); border: 1.5px solid transparent; font: 600 var(--dl-fs-md)/1 var(--dl-font);\n  cursor: pointer; transition: background var(--dl-t-fast), border-color var(--dl-t-fast), transform var(--dl-t-fast); text-decoration: none; }\n.dl-btn:active { transform: translateY(1px); }\n.dl-btn[disabled] { opacity: .55; cursor: not-allowed; }\n.dl-btn--primary { background: var(--dl-jade-600); color: #fff; }\n.dl-btn--primary:hover:not([disabled]) { background: var(--dl-jade-700); }\n.dl-btn--secondary { background: var(--dl-paper-0); color: var(--dl-ink-900); border-color: var(--dl-ink-200); }\n.dl-btn--secondary:hover:not([disabled]) { border-color: var(--dl-ink-400); background: var(--dl-paper-50); }\n.dl-btn--ghost { background: transparent; color: var(--dl-jade-700); padding: 0 var(--dl-s-3); }\n.dl-btn--ghost:hover:not([disabled]) { background: var(--dl-jade-50); }\n.dl-btn--block { width: 100%; }\n.dl-btn--sm { min-height: 36px; padding: 0 var(--dl-s-3); font-size: var(--dl-fs-sm); }\n.dl-iconbtn { appearance: none; display: inline-grid; place-items: center; width: var(--dl-hit); height: var(--dl-hit); border: 0; border-radius: var(--dl-r-md);\n  background: transparent; color: var(--dl-ink-500); cursor: pointer; }\n.dl-iconbtn:hover { background: var(--dl-paper-100); color: var(--dl-ink-900); }\n.dl-icon { width: 20px; height: 20px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n\n.dl-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: var(--dl-r-pill); font-size: var(--dl-fs-xs); font-weight: 650; line-height: 1.3; }\n.dl-badge .dl-icon { width: 14px; height: 14px; stroke-width: 2.2; }\n.dl-badge--verified { background: var(--dl-verified-bg); color: var(--dl-verified-fg); }\n.dl-badge--auto { background: var(--dl-auto-bg); color: var(--dl-auto-fg); }\n.dl-badge--unavail { background: var(--dl-unavail-bg); color: var(--dl-unavail-fg); }\n.dl-badge--kept { background: var(--dl-kept-bg); color: var(--dl-kept-fg); }\n.dl-badge--error { background: var(--dl-error-bg); color: var(--dl-error-fg); }\n.dl-badge--test { background: var(--dl-ink-900); color: var(--dl-paper-50); letter-spacing: .06em; }\n\n.dl-card { background: var(--dl-paper-0); border: 1px solid var(--dl-paper-200); border-radius: var(--dl-r-lg); padding: var(--dl-s-4); }\n.dl-card--tone-verified { border-left: 4px solid var(--dl-verified-line); }\n.dl-card--tone-auto { border-left: 4px solid var(--dl-auto-line); }\n.dl-card--tone-error { border-left: 4px solid var(--dl-error-line); }\n.dl-card--tone-neutral { border-left: 4px solid var(--dl-ink-300); }\n\n/* Jauge de couverture : 3 segments s\xE9mantiques + l\xE9gende en langage clair */\n.dl-meter { display: flex; height: 10px; border-radius: var(--dl-r-pill); overflow: hidden; background: var(--dl-paper-200); gap: 2px; }\n.dl-meter > span { display: block; min-width: 0; height: 100%; transition: flex-basis var(--dl-t-med); }\n.dl-meter .is-verified { background: var(--dl-verified-line); } .dl-meter .is-auto { background: var(--dl-auto-line); } .dl-meter .is-kept { background: var(--dl-unavail-line); }\n.dl-legend { list-style: none; margin: var(--dl-s-3) 0 0; padding: 0; display: grid; gap: var(--dl-s-2); }\n.dl-legend li { display: grid; grid-template-columns: 12px 1fr auto; align-items: baseline; gap: var(--dl-s-2); font-size: var(--dl-fs-sm); }\n.dl-legend .dot { width: 10px; height: 10px; border-radius: 3px; transform: translateY(1px); }\n.dl-legend b { font-variant-numeric: tabular-nums; }\n.dl-progress { height: 6px; border-radius: var(--dl-r-pill); background: var(--dl-paper-200); overflow: hidden; }\n.dl-progress > span { display: block; height: 100%; background: var(--dl-jade-500); transition: width var(--dl-t-med); }\n.dl-muted { color: var(--dl-ink-500); }\n.dl-field { width: 100%; min-height: var(--dl-hit); padding: 0 var(--dl-s-3); border: 1.5px solid var(--dl-ink-200); border-radius: var(--dl-r-md); background: var(--dl-paper-0); font: inherit; color: var(--dl-ink-900); }\ntextarea.dl-field { padding: var(--dl-s-3); min-height: 72px; resize: vertical; }\n.dl-field:hover { border-color: var(--dl-ink-400); }\n\n/* Couverture / raisons / avis (partag\xE9s) */\n.dl-covhead { display: flex; align-items: center; justify-content: space-between; gap: var(--dl-s-2); margin-bottom: var(--dl-s-2); }\n.dl-covhead h3, .dl-reasons h3 { margin: 0; font-size: var(--dl-fs-sm); font-weight: 650; color: var(--dl-ink-700); }\n.dl-iconbtn--sm { width: 32px; height: 32px; } .dl-iconbtn--sm .dl-icon { width: 18px; height: 18px; }\n.dl-legend .is-verified { background: var(--dl-verified-line); } .dl-legend .is-auto { background: var(--dl-auto-line); } .dl-legend .is-kept { background: var(--dl-unavail-line); }\n.dl-covnote { margin: var(--dl-s-3) 0 0; font-size: var(--dl-fs-sm); }\n.dl-reasons ul { list-style: none; margin: var(--dl-s-2) 0 0; padding: 0; display: grid; gap: 6px; }\n.dl-reasons li { display: flex; justify-content: space-between; gap: var(--dl-s-3); font-size: var(--dl-fs-sm); color: var(--dl-ink-700); }\n.dl-reasons b { font-variant-numeric: tabular-nums; }\n.dl-notice { display: grid; grid-template-columns: 20px 1fr; gap: var(--dl-s-2); padding: var(--dl-s-3); border-radius: var(--dl-r-md); font-size: var(--dl-fs-sm); background: var(--dl-paper-100); color: var(--dl-ink-700); border-left: 3px solid var(--dl-jade-500); }\n.dl-notice--test { background: var(--dl-ink-900); color: var(--dl-paper-50); border-left-color: var(--dl-auto-line); }\n.dl-notice--layout { background: var(--dl-kept-bg); color: var(--dl-kept-fg); border-left-color: var(--dl-kept-line); }\n.dl-notice b { display: block; }\n\n/* Carte \xAB Comprendre \xBB + signalement (partag\xE9s) */\n.dl-explain { display: grid; gap: var(--dl-s-3); }\n.dl-xhead { display: flex; align-items: center; gap: var(--dl-s-2); }\n.dl-xhead h2 { margin: 0; font-size: var(--dl-fs-xl); line-height: var(--dl-lh-tight); flex: 1; }\n.dl-xsec h3, .dl-lbl, .dl-fieldset legend { margin: 0 0 var(--dl-s-1); font-size: var(--dl-fs-xs); font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--dl-ink-500); }\n.dl-xsec p { margin: 0 0 var(--dl-s-2); }\n.dl-xlang { display: flex; flex-wrap: wrap; gap: var(--dl-s-2); margin-bottom: var(--dl-s-2); }\n.dl-xlang [aria-pressed="true"] { background: var(--dl-jade-50); color: var(--dl-jade-700); }\n.dl-xterm { font-size: var(--dl-fs-xl); font-weight: 650; line-height: var(--dl-lh-tight); overflow-wrap: anywhere; }\n.dl-xtrans { font-size: var(--dl-fs-lg); font-weight: 600; overflow-wrap: anywhere; }\n.dl-xrel { display: flex; align-items: flex-start; gap: var(--dl-s-2); flex-wrap: wrap; font-size: var(--dl-fs-sm); color: var(--dl-ink-700); }\n.dl-xrel .dl-badge { flex: none; }\n.dl-xexample { padding: var(--dl-s-3); background: var(--dl-paper-100); border-radius: var(--dl-r-md); }\n.dl-xnote { font-size: var(--dl-fs-xs); }\n.dl-xfoot { display: flex; gap: var(--dl-s-2); align-items: center; flex-wrap: wrap; }\n.dl-report { display: grid; gap: var(--dl-s-2); }\n.dl-report h3 { margin: 0; font-size: var(--dl-fs-lg); }\n.dl-fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 2px; }\n.dl-radio { display: flex; align-items: center; gap: var(--dl-s-2); min-height: var(--dl-hit); padding: 0 var(--dl-s-2); border-radius: var(--dl-r-md); cursor: pointer; }\n.dl-radio:hover { background: var(--dl-paper-100); }\n.dl-radio input { width: 20px; height: 20px; accent-color: var(--dl-jade-600); flex: none; }\n.dl-reperr { margin: 0; padding: var(--dl-s-2) var(--dl-s-3); border-radius: var(--dl-r-md); background: var(--dl-error-bg); color: var(--dl-error-fg); font-size: var(--dl-fs-sm); }\n.dl-thanks { display: grid; grid-template-columns: 28px 1fr; gap: var(--dl-s-3); padding: var(--dl-s-3); border-radius: var(--dl-r-md); background: var(--dl-verified-bg); color: var(--dl-verified-fg); }\n.dl-thanks p { margin: 2px 0 0; font-size: var(--dl-fs-sm); }\n.dl-xlong { font-size: var(--dl-fs-md); font-weight: 500; line-height: 1.45; }\n';

  // src/ui/coverage.ts
  var uid2 = 0;
  function renderCoverage(doc, view, lang) {
    const c = view.coverage;
    if (!c || c.total === 0) return null;
    const id = `dl-cov-${++uid2}`;
    const pct = (n) => n === 0 ? 0 : Math.max(3, Math.round(n / c.total * 100));
    const seg = (cls, n) => h(doc, "span", { class: cls, style: `flex-basis:${pct(n)}%;flex-grow:${n === 0 ? 0 : 1}` });
    const summary = `${c.verified} ${t("cov_verified", lang)}, ${c.unverified} ${t("cov_unverified", lang)}, ${c.kept} ${t("cov_kept", lang)}`;
    const note = h(doc, "p", { class: "dl-muted dl-covnote", id }, t("cov_note", lang));
    note.hidden = true;
    const help = h(doc, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-expanded": "false", "aria-controls": id, "aria-label": t("cov_help", lang) }, icon(doc, "info"));
    help.addEventListener("click", () => {
      const open = note.hidden;
      note.hidden = !open;
      help.setAttribute("aria-expanded", String(open));
    });
    const row = (cls, label, n) => h(doc, "li", {}, h(doc, "span", { class: `dot ${cls}` }), h(doc, "span", {}, label), h(doc, "b", {}, String(n)));
    return h(
      doc,
      "section",
      { class: "dl-coverage", "aria-label": t("cov_title", lang) },
      h(doc, "div", { class: "dl-covhead" }, h(doc, "h3", {}, `${t("cov_title", lang)} \xB7 ${c.total} ${t("cov_texts", lang)}`), help),
      h(doc, "div", { class: "dl-meter", role: "img", "aria-label": summary }, seg("is-verified", c.verified), seg("is-auto", c.unverified), seg("is-kept", c.kept)),
      h(
        doc,
        "ul",
        { class: "dl-legend" },
        row("is-verified", t("cov_verified", lang), c.verified),
        row("is-auto", t("cov_unverified", lang), c.unverified),
        row("is-kept", t("cov_kept", lang), c.kept)
      ),
      note
    );
  }
  function renderReasons(doc, view, lang) {
    if (!view.reasons.length) return null;
    return h(
      doc,
      "section",
      { class: "dl-reasons", "aria-label": t("reasons_title", lang) },
      h(doc, "h3", {}, t("reasons_title", lang)),
      h(doc, "ul", {}, ...view.reasons.map((r) => h(doc, "li", {}, h(doc, "span", {}, r.label), h(doc, "b", {}, String(r.count)))))
    );
  }

  // src/ui/overlay.css
  var overlay_default = "/* Mise en page du panneau inject\xE9. Isol\xE9 dans un Shadow DOM : aucune r\xE8gle ne sort, aucune r\xE8gle de la page n'entre. */\n:host { all: initial; }\n.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: var(--dl-font); }\n.layer > * { pointer-events: auto; }\n.launcher { position: fixed; bottom: 16px; right: 16px; display: inline-flex; align-items: center; gap: var(--dl-s-2); max-width: min(320px, calc(100vw - 32px)); min-height: var(--dl-hit);\n  padding: 0 var(--dl-s-4) 0 var(--dl-s-3); border: 0; border-radius: var(--dl-r-pill); background: var(--dl-ink-900); color: var(--dl-paper-50);\n  font: 600 var(--dl-fs-sm)/1.2 var(--dl-font); cursor: pointer; box-shadow: var(--dl-shadow-md); transition: transform var(--dl-t-fast), box-shadow var(--dl-t-fast); }\n.launcher:hover { box-shadow: var(--dl-shadow-lg); }\n.launcher:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px var(--dl-focus); }\n.launcher .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.launcher .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--dl-ink-300); }\n.launcher .dot.is-verified { background: #5fd394; } .launcher .dot.is-auto { background: #f0b43c; } .launcher .dot.is-error { background: #ff8b8b; } .launcher .dot.is-progress { background: #f0b43c; animation: dlpulse 1.1s infinite; }\n@keyframes dlpulse { 50% { opacity: .35; } }\n@media (prefers-reduced-motion: reduce) { .launcher .dot.is-progress { animation: none; } }\n.panel, .card { position: fixed; width: 340px; max-width: calc(100vw - 24px); max-height: min(72vh, 600px); overflow: auto; background: var(--dl-paper-50); color: var(--dl-ink-900);\n  border: 1px solid var(--dl-paper-200); border-radius: var(--dl-r-lg); box-shadow: var(--dl-shadow-lg); padding: var(--dl-s-4); }\n.panel { bottom: 72px; right: 16px; display: grid; gap: var(--dl-s-3); }\n.card:not([hidden]) ~ .bubble { display: none; }\n.panel[hidden], .card[hidden], .bubble[hidden] { display: none; }\n.phead, .dl-xhead { display: flex; align-items: center; gap: var(--dl-s-2); cursor: grab; touch-action: none; user-select: none; }\n.phead.is-dragging, .dl-xhead.is-dragging { cursor: grabbing; }\n.phead strong { flex: 1; font-size: var(--dl-fs-lg); }\n.panel h2 { margin: 0; font-size: var(--dl-fs-lg); line-height: var(--dl-lh-tight); }\n.panel .msg { margin: 4px 0 0; font-size: var(--dl-fs-sm); color: var(--dl-ink-700); }\n.panel .row { display: flex; gap: var(--dl-s-2); flex-wrap: wrap; }\n.bubble { position: fixed; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 var(--dl-s-3); border: 0; border-radius: var(--dl-r-pill);\n  background: var(--dl-jade-600); color: #fff; font: 600 var(--dl-fs-sm)/1 var(--dl-font); cursor: pointer; box-shadow: var(--dl-shadow-md); }\n.bubble:hover { background: var(--dl-jade-700); }\n.bubble:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px var(--dl-focus); }\n.bubble .dl-icon { width: 16px; height: 16px; }\n.card:focus, .card:focus-visible { outline: none; } /* focus programmatique du conteneur (lecteurs d'\xE9cran) : pas de cadre ; les contr\xF4les internes gardent leur anneau */\n";

  // src/ui/tokens.css
  var tokens_default = '/* Diversity Lingua \u2014 jetons de design (source unique : popup, options ET panneaux inject\xE9s en Shadow DOM).\n   Ces variables ne sont JAMAIS appliqu\xE9es aux pages visit\xE9es. */\n:root, :host {\n  /* Encre (texte, surfaces sombres) */\n  --dl-ink-950: #08171f; --dl-ink-900: #0b1f2a; --dl-ink-700: #1c3b49; --dl-ink-500: #476474; --dl-ink-400: #5f7787;\n  --dl-ink-300: #9db0bb; --dl-ink-200: #cbd6dc;\n  /* Papier (fonds) */\n  --dl-paper-0: #ffffff; --dl-paper-50: #fbfaf6; --dl-paper-100: #f4f1e8; --dl-paper-200: #e7e2d3; --dl-paper-300: #d5cebb;\n  /* Accent unique : jade */\n  --dl-jade-700: #0a5a4c; --dl-jade-600: #0e6b5c; --dl-jade-500: #158a75; --dl-jade-100: #d6eee7; --dl-jade-50: #eaf6f2;\n  /* Couleurs fonctionnelles (s\xE9mantiques \u2014 jamais d\xE9coratives) */\n  --dl-verified-fg: #146b3f; --dl-verified-bg: #dcf2e4; --dl-verified-line: #2f9a63;\n  --dl-auto-fg: #7a4f00; --dl-auto-bg: #fbebc8; --dl-auto-line: #c98a12;\n  --dl-unavail-fg: #3e4c57; --dl-unavail-bg: #e5e9ec; --dl-unavail-line: #8a99a5;\n  --dl-kept-fg: #1f4d7a; --dl-kept-bg: #deeaf7; --dl-kept-line: #5b8fc4;\n  --dl-error-fg: #9e2229; --dl-error-bg: #fbe3e3; --dl-error-line: #d45a5f;\n  --dl-focus: #0b6bcb;\n  /* Typographie : pile syst\xE8me (rendu v\xE9rifi\xE9 sur \u0253 \u0257 \u014B \u0272 \u01B4 ; repli par glyphe assur\xE9 par le syst\xE8me) */\n  --dl-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;\n  --dl-fs-xs: 12px; --dl-fs-sm: 13px; --dl-fs-md: 14px; --dl-fs-lg: 16px; --dl-fs-xl: 19px; --dl-fs-2xl: 24px;\n  --dl-lh-tight: 1.25; --dl-lh-body: 1.5;\n  /* Espacements (\xE9chelle de 4 px) */\n  --dl-s-1: 4px; --dl-s-2: 8px; --dl-s-3: 12px; --dl-s-4: 16px; --dl-s-5: 20px; --dl-s-6: 24px; --dl-s-8: 32px;\n  /* Rayons, ombres */\n  --dl-r-sm: 6px; --dl-r-md: 10px; --dl-r-lg: 14px; --dl-r-pill: 999px;\n  --dl-shadow-sm: 0 1px 2px rgba(11, 31, 42, .10);\n  --dl-shadow-md: 0 4px 14px rgba(11, 31, 42, .14), 0 1px 3px rgba(11, 31, 42, .10);\n  --dl-shadow-lg: 0 14px 40px rgba(11, 31, 42, .22), 0 2px 6px rgba(11, 31, 42, .12);\n  /* Interaction */\n  --dl-hit: 44px; --dl-t-fast: 120ms; --dl-t-med: 200ms;\n}\n@media (prefers-reduced-motion: reduce) { :root, :host { --dl-t-fast: 0.01ms; --dl-t-med: 0.01ms; } }\n';

  // src/ui/view.ts
  function reasonLabel(code, lang) {
    const k = `r_${code}`;
    return has(k, lang) ? t(k, lang) : t("r_other", lang);
  }
  function deriveView(i) {
    const L = i.lang, tt = (k) => t(k, L);
    const st = i.state;
    const src = st?.detectedLang === "fr" ? tt("srcfr") : st?.detectedLang === "en" ? tt("srcen") : tt("srcunknown");
    const base = { progress: null, coverage: null, reasons: [], notices: [], sourceLabel: src };
    const notices = [];
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
    const restore = { id: "restore", label: tt("restore") };
    switch (st.phase) {
      case "detecting":
        return { ...withCov, kind: "detecting", tone: "progress", icon: "eye", title: tt("s_detecting_t"), message: tt("s_detecting_m"), primary: { id: "none", label: "" } };
      case "translating": {
        const total = st.total || 0;
        return {
          ...withCov,
          kind: "translating",
          tone: "progress",
          icon: "spark",
          title: tt("s_translating_t"),
          message: tt("s_translating_m"),
          progress: total > 0 ? Math.max(0, Math.min(1, (total - st.counts.pending) / total)) : null,
          primary: restore
        };
      }
      case "done":
        return { ...withCov, kind: "done", tone: cov.unverified > 0 ? "auto" : "verified", icon: cov.unverified > 0 ? "shield" : "check", title: tt("s_done_t"), message: tt("s_done_m"), primary: restore };
      case "partial":
        return { ...withCov, kind: "partial", tone: "auto", icon: "alert", title: tt("s_partial_t"), message: tt("s_partial_m"), primary: restore };
      case "error": {
        const code = st.message === "unauthorized" ? "unauthorized" : st.message === "rate_limited" ? "rate_limited" : "";
        const tk = code ? `s_error_${code}_t` : "s_error_t", mk = code ? `s_error_${code}_m` : "s_error_m";
        return {
          ...base,
          kind: "error",
          tone: "error",
          icon: code === "unauthorized" ? "lock" : "offline",
          title: tt(tk),
          message: tt(mk),
          notices: notices.filter((n) => n.tone === "test"),
          primary: { id: "retry", label: tt("retry") }
        };
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

  // src/content/overlay.ts
  var Overlay = class {
    constructor(doc, lang, hd) {
      this.doc = doc;
      this.lang = lang;
      this.hd = hd;
    }
    host = null;
    layer;
    launcher;
    lbl;
    dot;
    panel;
    card;
    bubble;
    panelOpen = false;
    lastKey = "";
    cleanup = [];
    language = null;
    dragCleanup = null;
    get mounted() {
      return !!this.host?.isConnected;
    }
    get cardOpen() {
      return this.mounted && !this.card.hidden;
    }
    setLanguage(l) {
      this.language = l;
    }
    mount() {
      if (this.mounted) return;
      const d = this.doc;
      this.host = h(d, "div", { id: HOST_ID, "data-dl-ignore": true });
      const root = this.host.attachShadow({ mode: this.doc.defaultView?.__DL_TEST_OPEN ? "open" : "closed" });
      const style = h(d, "style", {});
      style.textContent = `${tokens_default}
${components_default}
${overlay_default}`;
      this.dot = h(d, "span", { class: "dot" });
      this.lbl = h(d, "span", { class: "lbl" });
      this.launcher = h(d, "button", { class: "launcher", type: "button", "aria-expanded": "false", "aria-label": t("p_open", this.lang) }, markSvg(d, 22), this.dot, this.lbl);
      this.panel = h(d, "section", { class: "panel dl-root", role: "region", "aria-label": t("appName", this.lang) });
      this.panel.hidden = true;
      this.card = h(d, "div", { class: "card dl-root", role: "dialog", "aria-label": t("understand", this.lang), tabindex: "-1" });
      this.card.hidden = true;
      this.bubble = h(d, "button", { class: "bubble", type: "button", "aria-label": t("bubbleHint", this.lang) }, icon(d, "book"), t("bubble", this.lang));
      this.bubble.hidden = true;
      this.layer = h(d, "div", { class: "layer dl-root" }, this.panel, this.card, this.bubble, this.launcher);
      root.append(style, this.layer);
      this.launcher.addEventListener("click", () => this.togglePanel());
      const esc = (e) => {
        if (e.key === "Escape") {
          if (!this.card.hidden) this.hideCard();
          else if (this.panelOpen) this.togglePanel(false);
        }
      };
      const away = (e) => {
        if (!e.composedPath().includes(this.host)) {
          if (this.panelOpen) this.togglePanel(false);
          this.hideCard();
          this.hideBubble();
        }
      };
      const dragStart = (e) => this.startDrag(e);
      this.doc.addEventListener("keydown", esc, true);
      this.doc.addEventListener("pointerdown", away, true);
      this.layer.addEventListener("pointerdown", dragStart);
      this.cleanup.push(
        () => this.doc.removeEventListener("keydown", esc, true),
        () => this.doc.removeEventListener("pointerdown", away, true),
        () => this.layer.removeEventListener("pointerdown", dragStart)
      );
      this.doc.documentElement.appendChild(this.host);
    }
    startDrag(e) {
      if (e.button !== 0 || !this.layer) return;
      const target = e.target;
      if (target.closest("button, a, input, select, textarea")) return;
      const handle = target.closest(".phead, .dl-xhead");
      const element = target.closest(".panel, .card");
      if (!handle || !element || element.hidden) return;
      this.dragCleanup?.();
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY, left = rect.left, top = rect.top;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.right = "auto";
      element.style.bottom = "auto";
      handle.classList.add("is-dragging");
      const move = (event) => {
        if (event.pointerId !== e.pointerId) return;
        const maxLeft = Math.max(0, this.doc.documentElement.clientWidth - element.offsetWidth);
        const maxTop = Math.max(0, this.doc.documentElement.clientHeight - element.offsetHeight);
        element.style.left = `${Math.max(0, Math.min(maxLeft, left + event.clientX - startX))}px`;
        element.style.top = `${Math.max(0, Math.min(maxTop, top + event.clientY - startY))}px`;
        event.preventDefault();
      };
      const finish = (event) => {
        if (event.pointerId !== e.pointerId) return;
        this.dragCleanup?.();
      };
      this.dragCleanup = () => {
        this.doc.removeEventListener("pointermove", move, true);
        this.doc.removeEventListener("pointerup", finish, true);
        this.doc.removeEventListener("pointercancel", finish, true);
        handle.classList.remove("is-dragging");
        this.dragCleanup = null;
      };
      this.doc.addEventListener("pointermove", move, true);
      this.doc.addEventListener("pointerup", finish, true);
      this.doc.addEventListener("pointercancel", finish, true);
    }
    destroy() {
      this.dragCleanup?.();
      for (const c of this.cleanup) c();
      this.cleanup = [];
      this.host?.remove();
      this.host = null;
      this.panelOpen = false;
      this.lastKey = "";
    }
    // ---------------------------------------------------------------- puce + panneau
    render(state, hidden) {
      if (state.phase === "inactive" || hidden) {
        if (this.mounted && state.phase === "inactive") this.destroy();
        else if (this.mounted) this.launcher.hidden = true;
        return;
      }
      this.mount();
      this.launcher.hidden = false;
      const v = deriveView({ state, reachable: true, lang: this.lang, language: this.language });
      const c = v.coverage;
      const short = v.kind === "translating" ? `${v.title}${v.progress != null ? ` \xB7 ${Math.round(v.progress * 100)} %` : ""}` : (v.kind === "done" || v.kind === "partial") && c ? `${c.verified + c.unverified} ${t("p_translated", this.lang)}` : v.title;
      this.lbl.textContent = short;
      this.dot.className = `dot ${v.tone === "verified" ? "is-verified" : v.tone === "auto" ? "is-auto" : v.tone === "error" ? "is-error" : v.tone === "progress" ? "is-progress" : ""}`;
      const key = JSON.stringify([v, this.panelOpen]);
      if (key !== this.lastKey) {
        this.lastKey = key;
        if (this.panelOpen) this.renderPanel(v);
      }
    }
    togglePanel(force) {
      this.panelOpen = force ?? !this.panelOpen;
      this.panel.hidden = !this.panelOpen;
      this.launcher.setAttribute("aria-expanded", String(this.panelOpen));
      if (this.panelOpen) {
        this.lastKey = "";
        this.hideCard();
        this.hideBubble();
        this.onNeedPanel?.();
      }
    }
    onNeedPanel = null;
    renderPanelFor(state) {
      this.renderPanel(deriveView({ state, reachable: true, lang: this.lang, language: this.language }));
    }
    renderPanel(v) {
      const d = this.doc, L = this.lang;
      const close = h(d, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-label": t("close", L) }, icon(d, "close"));
      close.addEventListener("click", () => this.togglePanel(false));
      const kids = [
        h(d, "div", { class: "phead", title: t("p_drag", L) }, markSvg(d, 24), h(d, "strong", {}, t("appName", L)), close),
        h(d, "div", {}, h(d, "h2", {}, v.title), h(d, "p", { class: "msg" }, v.message))
      ];
      if (v.kind === "translating") {
        const pct = v.progress == null ? 0 : Math.round(v.progress * 100);
        kids.push(h(d, "div", { class: "dl-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) }, h(d, "span", { style: `width:${pct}%` })));
      }
      const cov = renderCoverage(d, v, L);
      if (cov) kids.push(cov);
      const reasons = renderReasons(d, v, L);
      if (reasons) kids.push(h(d, "div", {}, reasons));
      for (const n of v.notices) kids.push(h(d, "div", { class: `dl-notice dl-notice--${n.tone}`, role: "note" }, icon(d, n.tone === "test" ? "alert" : n.tone === "layout" ? "keep" : "info"), h(d, "div", {}, n.title ? h(d, "b", {}, n.title) : null, n.text)));
      const row = h(d, "div", { class: "row" });
      if (v.primary.id === "restore") {
        const b = h(d, "button", { class: "dl-btn dl-btn--secondary", type: "button" }, icon(d, "undo"), v.primary.label);
        b.addEventListener("click", this.hd.onRestore);
        row.append(b);
      }
      if (v.primary.id === "retry") {
        const b = h(d, "button", { class: "dl-btn dl-btn--primary", type: "button" }, v.primary.label);
        b.addEventListener("click", this.hd.onRetry);
        row.append(b);
        const r = h(d, "button", { class: "dl-btn dl-btn--ghost", type: "button" }, t("restore", L));
        r.addEventListener("click", this.hd.onRestore);
        row.append(r);
      }
      const hide = h(d, "button", { class: "dl-btn dl-btn--ghost", type: "button" }, t("hide", L));
      hide.addEventListener("click", () => {
        this.togglePanel(false);
        this.hd.onHide();
      });
      row.append(hide);
      kids.push(row);
      this.panel.replaceChildren(...kids);
    }
    // ---------------------------------------------------------------- bulle « Comprendre » + carte
    showBubble(rect, onClick) {
      this.mount();
      if (this.cardOpen) {
        this.hideBubble();
        return;
      }
      const vw = this.doc.documentElement.clientWidth || 1024, vh = this.doc.documentElement.clientHeight || 768;
      const w = 124, hgt = 36;
      const left = Math.min(Math.max(8, rect.right - w / 2), vw - w - 8);
      const above = rect.top - hgt - 8 > 8;
      this.bubble.style.left = `${left}px`;
      this.bubble.style.top = `${above ? rect.top - hgt - 8 : Math.min(rect.bottom + 8, vh - hgt - 8)}px`;
      this.bubble.onclick = () => {
        this.hideBubble();
        onClick();
      };
      this.bubble.hidden = false;
    }
    hideBubble() {
      if (this.bubble) {
        this.bubble.hidden = true;
        this.bubble.onclick = null;
      }
    }
    showCard(content, near) {
      this.mount();
      this.hideBubble();
      this.card.replaceChildren(content);
      const vw = this.doc.documentElement.clientWidth || 1024, vh = this.doc.documentElement.clientHeight || 768;
      const w = Math.min(340, Math.max(0, vw - 24));
      const margin = 12;
      const maxLeft = Math.max(margin, vw - w - margin);
      this.card.style.maxHeight = `${Math.max(0, vh - margin * 2)}px`;
      this.card.style.left = `${near ? Math.max(margin, Math.min(maxLeft, near.left)) : Math.max(margin, vw - w - 16)}px`;
      this.card.hidden = false;
      const measuredHeight = this.card.getBoundingClientRect().height || this.card.offsetHeight;
      const height = Math.min(measuredHeight || Math.min(vh * 0.72, 600), Math.max(0, vh - margin * 2));
      const maxTop = Math.max(margin, vh - height - margin);
      let top = near ? near.bottom + 10 : 80;
      if (near && top > maxTop) top = near.top - height - 10;
      this.card.style.top = `${Math.max(margin, Math.min(maxTop, top))}px`;
      this.card.focus({ preventScroll: true });
    }
    hideCard() {
      if (this.card) this.card.hidden = true;
    }
  };

  // src/content/selection.ts
  var FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
  var squash = (s) => s.replace(/\s+/g, " ").trim();
  function readSelection(win, inspect) {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = squash(sel.toString());
    if (text.length < 2 || text.length > 300 || (text.match(new RegExp("\\p{L}", "gu")) ?? []).length < 2) return null;
    const elOf = (n) => n && n.nodeType === Node.ELEMENT_NODE ? n : n?.parentElement ?? null;
    for (const n of [sel.anchorNode, sel.focusNode]) {
      const el = elOf(n);
      if (el && (el.closest(`#${HOST_ID}`) || el.closest(FIELD))) return null;
    }
    const range = sel.getRangeAt(0);
    const root = range.commonAncestorContainer;
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
    else {
      const w = win.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (range.intersectsNode(n) && (n.nodeValue ?? "").trim()) nodes.push(n);
    }
    const parts = nodes.map((n) => ({ n, info: inspect(n) }));
    const ours = parts.filter((p) => p.info);
    let rect = { left: 0, top: 0, right: 0, bottom: 0 };
    try {
      const r = range.getBoundingClientRect();
      rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    } catch {
    }
    if (!ours.length) return { text, original: text, shown: null, status: null, testData: false, rect };
    const original = squash(parts.map((p) => p.info?.original ?? (p.n.nodeValue ?? "")).join(" "));
    const allKept = ours.every((p) => p.info.status === "layout");
    return { text, original: original.slice(0, 480), shown: allKept ? null : text, status: ours[0].info.status, testData: ours.some((p) => p.info.testData), rect };
  }

  // src/content/index.ts
  function boot(win = window) {
    if (win.top !== win || win.__dlLoaded) return null;
    win.__dlLoaded = true;
    const doc = win.document;
    const lang = uiLang();
    let settings = DEFAULT_SETTINGS;
    let hiddenPanel = false;
    let languageCtx = null;
    let targetName = "";
    const send = (req) => chrome.runtime.sendMessage(req);
    const overlay = new Overlay(doc, lang, {
      onRestore: () => translator.deactivate(),
      onHide: () => {
        hiddenPanel = true;
        overlay.render(translator.getState(), true);
      },
      onRetry: () => {
        translator.activate(translator.getState().target ?? settings.targetLang);
      }
    });
    overlay.onNeedPanel = () => overlay.renderPanelFor(translator.getState());
    const translator = new PageTranslator({
      doc,
      send,
      settings: () => settings,
      defaultTarget: () => settings.targetLang,
      onState: (s) => {
        if (s.phase === "inactive") {
          hiddenPanel = false;
          selection.stop();
        } else selection.start();
        overlay.render(s, hiddenPanel || !settings.showBadge);
        send({ type: "dl/tab-state", active: s.phase !== "inactive", target: s.target, phase: s.phase }).catch(() => {
        });
        chrome.runtime.sendMessage({ type: "dl/state", state: s }).catch(() => {
        });
      }
    });
    const closeCard = () => {
      overlay.hideCard();
      if (!translator.isActive) overlay.destroy();
    };
    const relOf = (s) => s === "approved" ? "approved" : s === "automatic" ? "automatic" : s === "pending_validation" ? "pending_validation" : s === "layout" ? "kept" : null;
    async function openExplain(info) {
      overlay.showCard(h(doc, "div", {}, renderLoading(doc, lang)), info.rect);
      const r = await translator.explainText(info.original);
      if (!r.ok) {
        overlay.showCard(renderMessage(doc, t("c_error", lang)), info.rect);
        return;
      }
      const src = r.data.source_lang === "fr" || r.data.source_lang === "en" ? r.data.source_lang : r.sourceLang;
      const model = buildExplainModel(r.data, { term: info.original, shownText: info.shown && info.shown !== info.original ? info.shown : null, targetName: targetName || translator.targetLang, targetLang: translator.targetLang, sourceLang: src, shownStatus: relOf(info.status) });
      const box = h(doc, "div", {});
      const show = () => box.replaceChildren(renderExplain(doc, model, lang, { onReport: openReport, onClose: closeCard }));
      const openReport = () => box.replaceChildren(renderReportForm(doc, lang, async (rep) => {
        const payload = {
          source_lang: src,
          target_lang: translator.targetLang,
          source_text: maskText(info.original).masked,
          shown_translation: model.translation.text ? maskText(model.translation.text).masked : null,
          suggested_translation: rep.suggestion ? maskText(rep.suggestion).masked : null,
          comment: rep.comment,
          category: rep.category,
          concept_id: model.conceptId,
          translation_status: model.translation.reliability === "kept" ? "unavailable" : model.translation.reliability
        };
        const resp = await send({ type: "dl/feedback", payload });
        return resp.ok ? { ok: true } : { ok: false, code: resp.code };
      }, show));
      show();
      overlay.showCard(box, info.rect);
    }
    let timer = null;
    const evaluate = () => {
      if (overlay.cardOpen) {
        overlay.hideBubble();
        return;
      }
      if (!translator.isActive) {
        overlay.hideBubble();
        return;
      }
      const info = readSelection(win, (n) => translator.inspectNode(n));
      if (!info) {
        overlay.hideBubble();
        return;
      }
      overlay.showBubble(info.rect, () => {
        openExplain(info);
      });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluate, 80);
    };
    const selection = {
      on: false,
      start() {
        if (this.on) return;
        this.on = true;
        doc.addEventListener("mouseup", schedule, true);
        doc.addEventListener("keyup", schedule, true);
        win.addEventListener("scroll", hideOnScroll, true);
      },
      stop() {
        if (!this.on) return;
        this.on = false;
        doc.removeEventListener("mouseup", schedule, true);
        doc.removeEventListener("keyup", schedule, true);
        win.removeEventListener("scroll", hideOnScroll, true);
      }
    };
    const hideOnScroll = () => overlay.hideBubble();
    getSettings().then(async (s) => {
      settings = s;
      const hello = await send({ type: "dl/hello" }).catch(() => null);
      if (hello?.ok && hello.data?.active && hello.data.target) translator.activate(hello.data.target);
    });
    send({ type: "dl/languages" }).then((r) => {
      if (!r.ok) return;
      const l = r.data.find((x) => x.code === settings.targetLang);
      if (l) {
        targetName = l.name;
        languageCtx = { name: l.name, availability: l.availability, approved: l.approved_targets ?? l.validated_entries ?? 0, isTest: l.availability === "test_only" };
        overlay.setLanguage(languageCtx);
      }
    }).catch(() => {
    });
    chrome.storage.onChanged.addListener(async (ch) => {
      if (ch.settings) settings = await getSettings();
    });
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (!msg || typeof msg.type !== "string") return false;
      switch (msg.type) {
        case "dl/activate":
          translator.activate(msg.target).then(() => respond(translator.getState()));
          return true;
        case "dl/deactivate":
          translator.deactivate();
          respond(translator.getState());
          return false;
        case "dl/get-state":
          respond(translator.getState());
          return false;
        case "dl/get-selection":
          respond({ text: (win.getSelection()?.toString() ?? "").trim().slice(0, 300) });
          return false;
        case "dl/translate-selection":
        case "dl/explain-selection": {
          const info = readSelection(win, (n) => translator.inspectNode(n));
          openExplain(info ?? { original: msg.text, shown: null, status: null, rect: { left: 80, top: 80, right: 80, bottom: 80 } });
          return false;
        }
      }
      return false;
    });
    return { translator, overlay };
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.id) boot();
})();
