"use strict";
(() => {
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
      const lang2 = fr >= en ? "fr" : "en";
      const conf = Math.max(fr, en) / total;
      if (conf >= minConf) return { lang: lang2, confidence: conf, source: "text" };
    }
    if (hl === "fr" || hl === "en") return { lang: hl, confidence: 0.5, source: "html-lang" };
    return { lang: "unknown", confidence: 0, source: "none" };
  }

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
  async function saveSettings(patch) {
    const next = sanitizeSettings({ ...await getSettings(), ...patch });
    await chrome.storage.local.set({ settings: next });
    return next;
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
  var t = (k, lang2 = uiLang()) => T[lang2][k];
  var has = (k, lang2 = uiLang()) => k in T[lang2];

  // src/ui/dom.ts
  function h(doc2, tag, attrs = {}, ...children) {
    const el = doc2.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === void 0 || v === false) continue;
      if (v === true) el.setAttribute(k, "");
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    for (const c of children) if (c) el.append(typeof c === "string" ? doc2.createTextNode(c) : c);
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
  function icon(doc2, name) {
    const svg = doc2.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "dl-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of PATHS[name]) {
      const p = doc2.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  // src/ui/coverage.ts
  var uid = 0;
  function renderCoverage(doc2, view, lang2) {
    const c = view.coverage;
    if (!c || c.total === 0) return null;
    const id = `dl-cov-${++uid}`;
    const pct = (n) => n === 0 ? 0 : Math.max(3, Math.round(n / c.total * 100));
    const seg = (cls, n) => h(doc2, "span", { class: cls, style: `flex-basis:${pct(n)}%;flex-grow:${n === 0 ? 0 : 1}` });
    const summary = `${c.verified} ${t("cov_verified", lang2)}, ${c.unverified} ${t("cov_unverified", lang2)}, ${c.kept} ${t("cov_kept", lang2)}`;
    const note = h(doc2, "p", { class: "dl-muted dl-covnote", id }, t("cov_note", lang2));
    note.hidden = true;
    const help = h(doc2, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-expanded": "false", "aria-controls": id, "aria-label": t("cov_help", lang2) }, icon(doc2, "info"));
    help.addEventListener("click", () => {
      const open = note.hidden;
      note.hidden = !open;
      help.setAttribute("aria-expanded", String(open));
    });
    const row = (cls, label, n) => h(doc2, "li", {}, h(doc2, "span", { class: `dot ${cls}` }), h(doc2, "span", {}, label), h(doc2, "b", {}, String(n)));
    return h(
      doc2,
      "section",
      { class: "dl-coverage", "aria-label": t("cov_title", lang2) },
      h(doc2, "div", { class: "dl-covhead" }, h(doc2, "h3", {}, `${t("cov_title", lang2)} \xB7 ${c.total} ${t("cov_texts", lang2)}`), help),
      h(doc2, "div", { class: "dl-meter", role: "img", "aria-label": summary }, seg("is-verified", c.verified), seg("is-auto", c.unverified), seg("is-kept", c.kept)),
      h(
        doc2,
        "ul",
        { class: "dl-legend" },
        row("is-verified", t("cov_verified", lang2), c.verified),
        row("is-auto", t("cov_unverified", lang2), c.unverified),
        row("is-kept", t("cov_kept", lang2), c.kept)
      ),
      note
    );
  }
  function renderReasons(doc2, view, lang2) {
    if (!view.reasons.length) return null;
    return h(
      doc2,
      "section",
      { class: "dl-reasons", "aria-label": t("reasons_title", lang2) },
      h(doc2, "h3", {}, t("reasons_title", lang2)),
      h(doc2, "ul", {}, ...view.reasons.map((r) => h(doc2, "li", {}, h(doc2, "span", {}, r.label), h(doc2, "b", {}, String(r.count)))))
    );
  }

  // src/shared/status.ts
  var LEGACY = { validated: "approved", machine_unvalidated: "automatic", unavailable: "unavailable", unchanged: "unchanged", error: "error" };
  function canonicalStatus(r) {
    const ts = r.translation_status;
    if (ts === "approved" || ts === "automatic" || ts === "pending_validation" || ts === "unavailable" || ts === "rejected") return ts;
    return LEGACY[r.status] ?? "unavailable";
  }
  var hasDisplayableText = (c) => c === "approved" || c === "automatic" || c === "pending_validation";

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
  var reliabilityBadge = (doc2, r, lang2) => h(doc2, "span", { class: `dl-badge dl-badge--${REL[r].badge}` }, icon(doc2, REL[r].icon), t(REL[r].title, lang2));
  function renderExplain(doc2, m, lang2, hd = {}) {
    const sec = (label, ...kids2) => h(doc2, "section", { class: "dl-xsec" }, h(doc2, "h3", {}, label), ...kids2);
    const srcName = t(m.sourceLang === "fr" ? "srcfr" : "srcen", lang2);
    const rel = REL[m.translation.reliability];
    const kids = [];
    const head = h(doc2, "div", { class: "dl-xhead" }, h(doc2, "h2", {}, t("understand", lang2)));
    if (m.testData) head.append(h(doc2, "span", { class: "dl-badge dl-badge--test" }, t("badgeTest", lang2)));
    if (hd.onClose) {
      const b = h(doc2, "button", { class: "dl-iconbtn dl-iconbtn--sm", type: "button", "aria-label": t("close", lang2) }, icon(doc2, "close"));
      b.addEventListener("click", hd.onClose);
      head.append(b);
    }
    kids.push(head);
    const long = m.term.length > 70;
    kids.push(sec(t("c_term", lang2), h(doc2, "p", { class: `dl-xterm${long ? " dl-xlong" : ""}`, lang: m.sourceLang }, m.term)));
    const tr = m.translation;
    const translationItems = [
      tr.text ? h(doc2, "p", { class: `dl-xtrans${long ? " dl-xlong" : ""}` }, tr.text) : null,
      h(
        doc2,
        "p",
        { class: "dl-xrel" },
        reliabilityBadge(doc2, m.keptForLayout ? "kept" : tr.reliability, lang2),
        h(doc2, "span", {}, t(m.keptForLayout ? "q_kept" : rel.text, lang2))
      )
    ];
    kids.push(sec(`${t("c_in", lang2)} ${m.targetName}`, ...translationItems));
    if (m.explanation || m.translatedExplanation) {
      const sourceButton = m.explanation ? h(doc2, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button", "aria-pressed": "false" }, srcName) : null;
      const targetButton = m.translatedExplanation ? h(doc2, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button", "aria-pressed": "false" }, m.targetName) : null;
      const choices = h(
        doc2,
        "div",
        { class: "dl-xlang", role: "group", "aria-label": t("c_expl_language", lang2) },
        ...sourceButton ? [sourceButton] : [],
        ...targetButton ? [targetButton] : []
      );
      const paragraph = h(doc2, "p", { class: "dl-xdefinition" });
      const note = h(doc2, "p", { class: "dl-muted dl-xnote" });
      const showExplanation = (target2) => {
        const translated = target2 && m.translatedExplanation;
        const source = translated ? null : m.explanation;
        paragraph.textContent = translated ? translated.text : source?.text ?? "";
        paragraph.setAttribute("lang", translated ? m.targetLang ?? "ff" : m.sourceLang);
        sourceButton?.setAttribute("aria-pressed", String(!!source));
        targetButton?.setAttribute("aria-pressed", String(!!translated));
        note.replaceChildren();
        if (translated) {
          note.append(reliabilityBadge(doc2, translated.reliability, lang2), h(doc2, "span", {}, t(REL[translated.reliability].text, lang2)));
        } else if (source) {
          note.textContent = source.reviewed ? t("c_expl_note_reviewed", lang2) : t("c_expl_note", lang2);
        }
      };
      sourceButton?.addEventListener("click", () => showExplanation(false));
      targetButton?.addEventListener("click", () => showExplanation(true));
      showExplanation(!!m.translatedExplanation);
      kids.push(sec(t("c_simple", lang2), choices, paragraph, note));
      if (m.example) kids.push(sec(`${t("c_example", lang2)} ${t("c_src_in", lang2).replace("{lang}", srcName)}`, h(doc2, "p", { class: "dl-xexample", lang: m.sourceLang }, m.example)));
    } else {
      kids.push(sec(t("c_simple", lang2), h(doc2, "p", {}, t("c_noexpl", lang2)), h(doc2, "p", { class: "dl-muted dl-xnote" }, t("c_noexpl_hint", lang2))));
    }
    const foot = h(doc2, "div", { class: "dl-xfoot" });
    if (hd.onReport && m.reportable) {
      const b = h(doc2, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button" }, icon(doc2, "flag"), t("f_open", lang2));
      b.addEventListener("click", hd.onReport);
      foot.append(b);
    }
    kids.push(foot);
    return h(doc2, "div", { class: "dl-explain" }, ...kids);
  }
  function renderLoading(doc2, lang2) {
    return h(doc2, "div", { class: "dl-explain", role: "status" }, h(doc2, "p", { class: "dl-muted" }, t("c_loading", lang2)));
  }
  function renderMessage(doc2, text) {
    return h(doc2, "div", { class: "dl-explain", role: "alert" }, h(doc2, "p", {}, text));
  }

  // src/ui/report.ts
  var uid2 = 0;
  function renderReportForm(doc2, lang2, send, onDone) {
    const id = `dl-rep-${++uid2}`;
    const cats = [["meaning", "f_meaning"], ["naturalness", "f_naturalness"], ["terminology", "f_terminology"], ["other", "f_other"]];
    const msg = h(doc2, "p", { class: "dl-reperr", role: "alert" });
    msg.hidden = true;
    const radios = cats.map(([v, k], i) => {
      const input = h(doc2, "input", { type: "radio", name: id, value: v, id: `${id}-${v}` });
      return h(doc2, "label", { class: "dl-radio", for: `${id}-${v}` }, input, h(doc2, "span", {}, t(k, lang2)));
    });
    const suggest = h(doc2, "input", { class: "dl-field", type: "text", id: `${id}-s`, maxlength: "300", autocomplete: "off" });
    const comment = h(doc2, "textarea", { class: "dl-field", id: `${id}-c`, maxlength: "500", rows: "2" });
    const submit = h(doc2, "button", { class: "dl-btn dl-btn--primary dl-btn--sm", type: "button" }, icon(doc2, "send"), t("f_send", lang2));
    const cancel = h(doc2, "button", { class: "dl-btn dl-btn--ghost dl-btn--sm", type: "button" }, t("f_cancel", lang2));
    const form = h(
      doc2,
      "div",
      { class: "dl-report", role: "group", "aria-labelledby": `${id}-t` },
      h(doc2, "h3", { id: `${id}-t` }, t("f_title", lang2)),
      h(doc2, "fieldset", { class: "dl-fieldset" }, h(doc2, "legend", {}, t("f_what", lang2)), ...radios),
      h(doc2, "label", { for: `${id}-s`, class: "dl-lbl" }, t("f_suggest", lang2)),
      suggest,
      h(doc2, "label", { for: `${id}-c`, class: "dl-lbl" }, t("f_comment", lang2)),
      comment,
      h(doc2, "p", { class: "dl-muted dl-xnote" }, t("f_privacy", lang2)),
      msg,
      h(doc2, "div", { class: "dl-xfoot" }, submit, cancel)
    );
    const showErr = (text) => {
      msg.textContent = text;
      msg.hidden = false;
    };
    cancel.addEventListener("click", onDone);
    submit.addEventListener("click", async () => {
      const picked = form.querySelector(`input[name="${id}"]:checked`)?.value;
      if (!picked) return showErr(t("f_pick", lang2));
      msg.hidden = true;
      submit.setAttribute("disabled", "");
      const r = await send({ category: picked, suggestion: suggest.value.trim() || null, comment: comment.value.trim() || null });
      if (r.ok) {
        form.replaceChildren(h(
          doc2,
          "div",
          { role: "status", class: "dl-thanks" },
          icon(doc2, "check"),
          h(doc2, "div", {}, h(doc2, "b", {}, t("f_thanks_t", lang2)), h(doc2, "p", {}, t("f_thanks", lang2)))
        ), h(doc2, "div", { class: "dl-xfoot" }, (() => {
          const b = h(doc2, "button", { class: "dl-btn dl-btn--secondary dl-btn--sm", type: "button" }, t("close", lang2));
          b.addEventListener("click", onDone);
          return b;
        })()));
      } else {
        submit.removeAttribute("disabled");
        showErr(r.code === "rate_limited" ? t("f_limit", lang2) : t("f_error", lang2));
      }
    });
    return form;
  }

  // src/ui/view.ts
  function reasonLabel(code, lang2) {
    const k = `r_${code}`;
    return has(k, lang2) ? t(k, lang2) : t("r_other", lang2);
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

  // src/popup/popup.ts
  var doc = document;
  var lang = uiLang();
  var FALLBACK = [{ code: "ff", name: "Fulfulde", native_name: "Fulfulde", variety: "", availability: "awaiting_validation" }];
  var tabId;
  var tabUrl = "";
  var langs = FALLBACK;
  var target = "ff";
  var lastKey = "";
  var state = null;
  var reachable = false;
  var bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, error: "", code: "network" }));
  async function toTab(msg) {
    if (tabId == null) return null;
    try {
      return await chrome.tabs.sendMessage(tabId, msg) ?? null;
    } catch {
      return null;
    }
  }
  var isWeb = (u) => /^https?:\/\//i.test(u) && !/^https:\/\/chrome(web)?store\.google\.com|^https:\/\/chromewebstore\.google\.com/i.test(u);
  var langCtx = () => {
    const l = langs.find((x) => x.code === target);
    return l ? { name: l.name, availability: l.availability, approved: l.approved_targets ?? l.validated_entries ?? 0, isTest: l.availability === "test_only" } : null;
  };
  var targetName = () => langs.find((x) => x.code === target)?.name ?? target;
  var dyn = h(doc, "div", { id: "dyn", class: "pop-dyn" });
  var select = h(doc, "select", { class: "dl-field", id: "lang", "aria-label": t("translateTo", lang) });
  var srcBox = h(doc, "div", { class: "src", id: "src" });
  var termInput = h(doc, "textarea", { class: "dl-field", id: "term", rows: "2", maxlength: "300", placeholder: t("understandPh", lang), "aria-label": t("understandTitle", lang) });
  var explainOut = h(doc, "div", { id: "xout", "aria-live": "polite" });
  var explainBtn = h(doc, "button", { class: "dl-btn dl-btn--secondary", type: "button" }, t("explain", lang));
  var details = h(
    doc,
    "details",
    { class: "understand" },
    h(doc, "summary", {}, icon(doc, "book"), t("understandTitle", lang)),
    h(doc, "div", { class: "understand-body" }, h(doc, "p", { class: "hint" }, t("understandHint", lang)), termInput, explainBtn, explainOut)
  );
  var gear = h(doc, "button", { class: "dl-iconbtn", type: "button", "aria-label": t("settings", lang), title: t("settings", lang) }, icon(doc, "gear"));
  gear.addEventListener("click", () => chrome.runtime.openOptionsPage());
  var app = doc.getElementById("app");
  app.className = "dl-root";
  app.append(
    h(
      doc,
      "header",
      { class: "pop-head" },
      h(doc, "img", { src: "icons/icon-48.png", alt: "", width: "36", height: "36" }),
      h(doc, "div", {}, h(doc, "h1", {}, t("appName", lang)), h(doc, "p", {}, t("tagline", lang))),
      gear
    ),
    h(
      doc,
      "main",
      { class: "pop-main" },
      h(
        doc,
        "section",
        { class: "route", "aria-label": t("thisPage", lang) },
        h(doc, "div", {}, h(doc, "span", { class: "lbl" }, `${t("thisPage", lang)} \xB7 ${t("detected", lang)}`), srcBox),
        h(doc, "span", { class: "arrow" }, icon(doc, "arrow")),
        h(doc, "div", {}, h(doc, "label", { class: "lbl", for: "lang" }, t("translateTo", lang)), select)
      ),
      dyn,
      details
    ),
    h(doc, "footer", { class: "pop-foot" }, h(doc, "span", {}, "TEAM DIVERSITY \xB7 SAFINUM 2026"))
  );
  function renderDyn(v) {
    const focusedPrimary = doc.activeElement?.id === "primary";
    const card = h(
      doc,
      "section",
      { class: `dl-card state state--${v.tone}`, "aria-live": "polite" },
      h(
        doc,
        "div",
        { class: "state-head" },
        h(doc, "span", { class: "state-ico" }, icon(doc, v.icon)),
        h(doc, "div", {}, h(doc, "h2", {}, v.title), h(doc, "p", {}, v.message))
      )
    );
    if (v.kind === "translating") {
      const pct = v.progress == null ? 0 : Math.round(v.progress * 100);
      card.append(h(
        doc,
        "div",
        { class: "dl-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
        h(doc, "span", { style: `width:${pct}%` })
      ));
    }
    const cov = renderCoverage(doc, v, lang);
    if (cov) card.append(cov);
    const reasons = renderReasons(doc, v, lang);
    const nodes = [card];
    if (reasons) nodes.push(h(doc, "details", { class: "reasons-wrap dl-card" }, h(doc, "summary", {}, t("reasons_title", lang)), reasons));
    for (const n of v.notices) {
      nodes.push(h(
        doc,
        "div",
        { class: `dl-notice dl-notice--${n.tone}`, role: "note" },
        icon(doc, n.tone === "test" ? "alert" : n.tone === "layout" ? "keep" : "info"),
        h(doc, "div", {}, n.title ? h(doc, "b", {}, n.title) : null, n.text)
      ));
    }
    if (v.primary.id !== "none") {
      const primary = h(
        doc,
        "button",
        { id: "primary", class: `dl-btn dl-btn--block ${v.primary.id === "restore" ? "dl-btn--secondary" : "dl-btn--primary"}`, type: "button" },
        icon(doc, v.primary.id === "restore" ? "undo" : v.primary.id === "reload" ? "undo" : "globe"),
        v.primary.label
      );
      primary.addEventListener("click", () => onPrimary(v.primary.id));
      nodes.push(primary);
    }
    dyn.replaceChildren(...nodes);
    if (focusedPrimary) doc.getElementById("primary")?.focus();
  }
  function refreshView(force = false) {
    const v = deriveView({ state, reachable, reloadable: !reachable && isWeb(tabUrl), lang, language: langCtx() });
    srcBox.textContent = reachable && state && state.detectedLang !== "unknown" ? v.sourceLabel : "\u2014";
    const key = JSON.stringify([v, target]);
    if (force || key !== lastKey) {
      lastKey = key;
      renderDyn(v);
    }
  }
  async function poll() {
    const s = await toTab({ type: "dl/get-state" });
    reachable = s !== null;
    state = s;
    refreshView();
  }
  async function onPrimary(id) {
    if (id === "reload") {
      if (tabId != null) await chrome.tabs.reload(tabId);
      window.close();
      return;
    }
    if (id === "restore") await toTab({ type: "dl/deactivate" });
    else if (id === "translate" || id === "retry") {
      state = {
        ...state ?? {},
        phase: "detecting",
        detectedLang: state?.detectedLang ?? "unknown",
        target,
        total: 0,
        counts: state?.counts ?? {},
        testData: false,
        coverage: { verified: 0, unverified: 0, kept: 0, total: 0 },
        reasons: {}
      };
      refreshView();
      await toTab({ type: "dl/activate", target });
    }
    await poll();
  }
  function guessSource(text) {
    const d = detectLanguage(text, null, 1, 1);
    if (d.lang === "fr" || d.lang === "en") return d.lang;
    if (state && (state.detectedLang === "fr" || state.detectedLang === "en")) return state.detectedLang;
    return /[éèêàçùâîôû]|\b(le|la|les|des|frais|solde|bénéficiaire|beneficiaire|numéro|numero)\b/i.test(text) ? "fr" : "en";
  }
  async function doExplain() {
    const raw = termInput.value.trim();
    if (!raw) return;
    explainOut.replaceChildren(renderLoading(doc, lang));
    const m = maskText(raw);
    const source = guessSource(raw);
    const res = await bg({ type: "dl/explain", source, target, text: m.masked });
    if (!res.ok) {
      explainOut.replaceChildren(renderMessage(doc, t("c_error", lang)));
      return;
    }
    const effectiveSource = res.data.source_lang === "fr" || res.data.source_lang === "en" ? res.data.source_lang : source;
    const model = buildExplainModel(res.data, { term: raw, targetName: targetName(), targetLang: target, sourceLang: effectiveSource });
    const box = h(doc, "div", { class: "dl-card" });
    const show = () => box.replaceChildren(renderExplain(doc, model, lang, { onReport: openReport }));
    const openReport = () => box.replaceChildren(renderReportForm(doc, lang, async (r) => {
      const payload = {
        source_lang: effectiveSource,
        target_lang: target,
        source_text: m.masked,
        shown_translation: model.translation.text ? maskText(model.translation.text).masked : null,
        suggested_translation: r.suggestion ? maskText(r.suggestion).masked : null,
        comment: r.comment,
        category: r.category,
        concept_id: model.conceptId,
        translation_status: model.translation.reliability === "kept" ? "unavailable" : model.translation.reliability
      };
      const resp = await bg({ type: "dl/feedback", payload });
      return resp.ok ? { ok: true } : { ok: false, code: resp.code };
    }, show));
    show();
    explainOut.replaceChildren(box);
  }
  explainBtn.addEventListener("click", doExplain);
  termInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doExplain();
    }
  });
  details.addEventListener("toggle", async () => {
    if (details.open && !termInput.value) {
      const s = await toTab({ type: "dl/get-selection" });
      if (s?.text) termInput.value = s.text;
      termInput.focus();
    }
  });
  async function init() {
    doc.documentElement.lang = lang;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    tabUrl = tab?.url ?? "";
    const settings = await getSettings();
    const r = await bg({ type: "dl/languages" });
    if (r.ok && r.data.length) langs = r.data;
    for (const l of langs) select.append(h(doc, "option", { value: l.code }, l.availability === "test_only" ? `${l.name} (test)` : l.name));
    target = langs.some((l) => l.code === settings.targetLang) ? settings.targetLang : langs[0].code;
    select.value = target;
    select.addEventListener("change", async () => {
      target = select.value;
      await saveSettings({ targetLang: target });
      if (reachable && state && state.phase !== "inactive") await toTab({ type: "dl/activate", target });
      await poll();
      refreshView(true);
    });
    await poll();
    refreshView(true);
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === "dl/state") {
        state = m.state;
        reachable = true;
        refreshView();
      }
    });
    setInterval(poll, 800);
  }
  init();
})();
