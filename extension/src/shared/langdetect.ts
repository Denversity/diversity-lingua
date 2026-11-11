/** Détection simple de la langue source (français / anglais) par mots vides + attribut lang. */
const FR = new Set("le la les des du de et est un une pour vous votre vos avec sur dans pas que qui au aux en ce nous ou par ne se sont être avez compte solde envoyer argent montant frais confirmer annuler historique paiement payer retirer déposer bénéficiaire beneficiaire destinataire numéro numero retour annuler reçu recu retrait dépôt depot transfert banque autre bonjour".split(" "));
const EN = new Set("the and is are you your for with to of in on that this it not from by an have has will can account balance send money transfer amount fee fees confirm cancel history payment pay withdraw deposit beneficiary recipient number back withdrawal deposit bank other received hello".split(" "));

export interface Detection { lang: "fr" | "en" | "unknown"; confidence: number; source: "text" | "html-lang" | "none" }

export function detectLanguage(sample: string, htmlLang?: string | null, minHits = 4, minConf = 0.6): Detection {
  const words = sample.toLowerCase().normalize("NFC").match(/[a-zà-ÿ']+/g) ?? [];
  let fr = 0, en = 0;
  for (const w of words.slice(0, 1500)) {
    const base = w.includes("'") ? w.split("'").pop()! : w;
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
