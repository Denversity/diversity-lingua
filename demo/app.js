/* MoMo Démo — SIMULATION. Aucune donnée réelle, aucun service financier. Sert uniquement à démontrer Diversity Lingua. */
const I18N = {
  fr: {
    banner_t: "APPLICATION DE DÉMONSTRATION.", banner: "Données fictives — ceci n'est pas un vrai service financier.",
    nav_dash: "Tableau de bord", nav_send: "Envoyer de l'argent", nav_receive: "Recevoir de l'argent", nav_pay: "Payer un marchand", nav_history: "Historique", nav_notifs: "Notifications",
    dash_h: "Bonjour, bienvenue sur votre compte", bal_label: "Solde disponible", recent: "Dernières transactions",
    act_send: "Envoyez de l'argent à un proche en quelques secondes.", act_pay: "Payez vos achats sans espèces.", act_receive: "Consultez votre numéro et vos réceptions.",
    th_date: "Date", th_desc: "Description", th_amount: "Montant", th_status: "Statut", th_ref: "Référence",
    send_h: "Envoyer de l'argent", f_to: "Numéro du bénéficiaire", f_amount: "Montant à envoyer (FCFA)", fee_label: "Frais de transaction :", total_label: "Total à débiter :",
    scen_hint: "Scénarios de test : le numéro 670 00 00 01 simule un échec après débit ; 670 00 00 02 simule un échec réseau sans débit.",
    f_pin: "Code PIN", pin_hint: "Code PIN de démonstration : 1234. Ne partagez jamais votre vrai code PIN.", confirm: "Confirmer", cancel: "Annuler",
    recv_h: "Recevoir de l'argent", recv_p: "Donnez votre numéro à la personne qui souhaite vous envoyer de l'argent.", your_number: "Votre numéro :", sim_recv: "Simuler une réception",
    pay_h: "Payer un marchand", f_merchant: "Marchand", pay_btn: "Payer maintenant", hist_h: "Historique des transactions", notif_h: "Notifications",
    footer: "MoMo Démo — projet de démonstration TEAM DIVERSITY · SAFINUM Innovate Challenge 2026",
    s_ok: "Réussie", s_fail: "Échouée", s_pend: "En attente", d_sent: "Envoi à", d_recv: "Réception de", d_pay: "Paiement marchand :", d_dep: "Dépôt chez un agent",
    e_pin: "Code PIN incorrect.", e_pin_left: "Il vous reste", e_tries: "tentatives.", e_blocked: "Compte bloqué temporairement après 3 erreurs de PIN.",
    e_bal_h: "Solde insuffisant", e_bal: "Votre solde ne permet pas de payer le montant et les frais.", e_amt: "Montant invalide.", e_num: "Numéro de bénéficiaire invalide.",
    ok_h: "Transaction réussie", ok_p: "Le bénéficiaire a reçu l'argent. Référence :",
    f1_h: "Transaction échouée : montant débité mais non reçu", f1_p: "Le réseau du bénéficiaire n'a pas confirmé la réception. Voici ce que cela signifie :",
    f1_l1: "Votre compte a déjà été débité du total.", f1_l2: "Le bénéficiaire n'a PAS reçu l'argent pour le moment.", f1_l3: "Le remboursement automatique peut prendre jusqu'à 24 heures.", f1_l4: "Ne recommencez pas avant d'avoir vérifié votre historique : vous risquez de payer deux fois.", f1_l5: "Conservez la référence pour toute réclamation :",
    f2_h: "Transaction échouée : aucun débit", f2_p: "Le réseau est indisponible. Votre compte n'a pas été débité. Vous pouvez réessayer plus tard.",
    n_sent: "Transaction échouée : remboursement en attente", n_recv: "Vous avez reçu", n_from: "de", n_welcome: "Bienvenue ! Ne communiquez jamais votre code PIN ou votre code de vérification.", n_fail2: "Échec du transfert, aucun débit.", just_now: "À l'instant", toast_recv: "Vous avez reçu"
  },
  en: {
    banner_t: "DEMONSTRATION APPLICATION.", banner: "Fictitious data — this is not a real financial service.",
    nav_dash: "Dashboard", nav_send: "Send money", nav_receive: "Receive money", nav_pay: "Pay a merchant", nav_history: "History", nav_notifs: "Notifications",
    dash_h: "Hello, welcome to your account", bal_label: "Available balance", recent: "Latest transactions",
    act_send: "Send money to a relative in seconds.", act_pay: "Pay for purchases without cash.", act_receive: "See your number and incoming payments.",
    th_date: "Date", th_desc: "Description", th_amount: "Amount", th_status: "Status", th_ref: "Reference",
    send_h: "Send money", f_to: "Recipient number", f_amount: "Amount to send (FCFA)", fee_label: "Transaction fee:", total_label: "Total to be debited:",
    scen_hint: "Test scenarios: number 670 00 00 01 simulates a failure after debit; 670 00 00 02 simulates a network failure with no debit.",
    f_pin: "PIN code", pin_hint: "Demo PIN code: 1234. Never share your real PIN code.", confirm: "Confirm", cancel: "Cancel",
    recv_h: "Receive money", recv_p: "Give your number to the person who wants to send you money.", your_number: "Your number:", sim_recv: "Simulate an incoming payment",
    pay_h: "Pay a merchant", f_merchant: "Merchant", pay_btn: "Pay now", hist_h: "Transaction history", notif_h: "Notifications",
    footer: "MoMo Demo — TEAM DIVERSITY demonstration project · SAFINUM Innovate Challenge 2026",
    s_ok: "Successful", s_fail: "Failed", s_pend: "Pending", d_sent: "Sent to", d_recv: "Received from", d_pay: "Merchant payment:", d_dep: "Deposit at an agent",
    e_pin: "Incorrect PIN code.", e_pin_left: "You have", e_tries: "attempts left.", e_blocked: "Account temporarily blocked after 3 wrong PIN attempts.",
    e_bal_h: "Insufficient balance", e_bal: "Your balance does not cover the amount and the fees.", e_amt: "Invalid amount.", e_num: "Invalid recipient number.",
    ok_h: "Transaction successful", ok_p: "The recipient received the money. Reference:",
    f1_h: "Transaction failed: amount debited but not received", f1_p: "The recipient's network did not confirm receipt. Here is what this means:",
    f1_l1: "Your account has already been debited the total.", f1_l2: "The recipient has NOT received the money for now.", f1_l3: "The automatic refund can take up to 24 hours.", f1_l4: "Do not try again before checking your history: you may pay twice.", f1_l5: "Keep the reference for any complaint:",
    f2_h: "Transaction failed: no debit", f2_p: "The network is unavailable. Your account was not debited. You can try again later.",
    n_sent: "Transaction failed: refund pending", n_recv: "You received", n_from: "from", n_welcome: "Welcome! Never share your PIN code or verification code.", n_fail2: "Transfer failed, no debit.", just_now: "Just now", toast_recv: "You received"
  },
};
let lang = "fr", balance = 125000, pinTries = 3, refN = 1000;
const fmt = (n) => n.toLocaleString("fr-FR").replace(/\u202f/g, " ") + " FCFA";
const fee = (a) => (a > 0 ? Math.min(1500, Math.max(100, Math.round(a * 0.01))) : 0);
const T = (k) => I18N[lang][k];
const $ = (id) => document.getElementById(id);
const tx = [ // {key de description, args, montant signé, statut, réf}
  { d: "01/11/2026", kind: "d_dep", who: "", amt: 50000, st: "ok", ref: "TX-2026-000901" },
  { d: "02/11/2026", kind: "d_pay", who: "Boutique Les Palmiers", amt: -7500, st: "ok", ref: "TX-2026-000917" },
  { d: "03/11/2026", kind: "d_recv", who: "Aminata (670 55 55 55)", amt: 20000, st: "ok", ref: "TX-2026-000954" },
];
const notifs = [{ k: "n_welcome", when: "01/11/2026" }];

function td(text, cls) { const c = document.createElement("td"); c.textContent = text; if (cls) c.className = cls; return c; }
function row(t, withRef) {
  const r = document.createElement("tr");
  const sign = t.amt > 0 ? "+" : "−";
  r.append(td(t.d), td(`${T(t.kind)} ${t.who}`.trim()));
  if (withRef) r.append(td(t.ref));
  r.append(td(`${sign}${fmt(Math.abs(t.amt))}`), td(T("s_" + t.st), "st-" + t.st));
  return r;
}
function render() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((e) => { e.textContent = T(e.dataset.i18n); });
  $("bal").textContent = fmt(balance);
  $("acct").textContent = "Compte N° 0001-2345-6789";
  $("recent").replaceChildren(...tx.slice(-3).reverse().map((t) => row(t, false)));
  $("hist").replaceChildren(...[...tx].reverse().map((t) => row(t, true)));
  $("notifs").replaceChildren(...[...notifs].reverse().map((n) => {
    const d = document.createElement("div"); d.className = "notif";
    const p = document.createElement("div"); p.textContent = n.text ? n.text(lang) : T(n.k);
    const s = document.createElement("small"); s.textContent = n.when === "now" ? T("just_now") : n.when;
    d.append(p, s); return d; }));
  updFees();
}
function updFees() {
  const a = parseInt(($("s-amt").value || "0").replace(/\D/g, ""), 10) || 0;
  $("s-fee").textContent = fmt(fee(a)); $("s-total").textContent = fmt(a + fee(a));
  const b = parseInt(($("p-amt").value || "0").replace(/\D/g, ""), 10) || 0;
  $("p-fee").textContent = fmt(0); $("p-total").textContent = fmt(b);
}
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + view));
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
}
function msg(el, cls, title, paragraphs, items) {
  el.className = "msg " + cls; el.hidden = false; el.replaceChildren();
  const h = document.createElement("h3"); h.textContent = title; el.append(h);
  paragraphs.forEach((t) => { const p = document.createElement("p"); p.textContent = t; p.style.margin = "4px 0"; el.append(p); });
  if (items) { const ul = document.createElement("ul"); items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.append(li); }); el.append(ul); }
}
function toast(text) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = text; $("toasts").append(t);
  setTimeout(() => t.remove(), 6000);
}
const today = () => new Date().toLocaleDateString("fr-FR");
const newRef = () => `TX-2026-${String(++refN).padStart(6, "0")}`;

function checkPin(pin, el) {
  if (pinTries <= 0) { msg(el, "", T("e_blocked"), []); return false; }
  if (pin !== "1234") {
    pinTries--;
    msg(el, "", T("e_pin"), [pinTries > 0 ? `${T("e_pin_left")} ${pinTries} ${T("e_tries")}` : T("e_blocked")]);
    return false;
  }
  pinTries = 3; return true;
}
function doSend() {
  const el = $("s-msg"), to = $("s-to").value.trim(), digits = to.replace(/\D/g, "");
  const a = parseInt($("s-amt").value.replace(/\D/g, ""), 10) || 0, total = a + fee(a);
  if (digits.length < 9) return msg(el, "", T("e_num"), []);
  if (a < 100) return msg(el, "", T("e_amt"), []);
  if (total > balance) return msg(el, "", T("e_bal_h"), [T("e_bal")]);
  if (!checkPin($("s-pin").value, el)) return;
  $("s-pin").value = "";
  const ref = newRef();
  if (digits === "670000001") {
    balance -= total;
    tx.push({ d: today(), kind: "d_sent", who: to, amt: -total, st: "pend", ref });
    notifs.push({ k: "n_sent", when: "now" });
    msg(el, "warn", T("f1_h"), [T("f1_p")], [T("f1_l1"), T("f1_l2"), T("f1_l3"), T("f1_l4"), `${T("f1_l5")} ${ref}`]);
  } else if (digits === "670000002") {
    tx.push({ d: today(), kind: "d_sent", who: to, amt: -total, st: "fail", ref });
    notifs.push({ k: "n_fail2", when: "now" });
    msg(el, "", T("f2_h"), [T("f2_p")]);
  } else {
    balance -= total;
    tx.push({ d: today(), kind: "d_sent", who: to, amt: -total, st: "ok", ref });
    msg(el, "ok", T("ok_h"), [`${T("ok_p")} ${ref}`]);
  }
  render();
}
function doPay() {
  const el = $("p-msg"), a = parseInt($("p-amt").value.replace(/\D/g, ""), 10) || 0;
  if (a < 100) return msg(el, "", T("e_amt"), []);
  if (a > balance) return msg(el, "", T("e_bal_h"), [T("e_bal")]);
  if (!checkPin($("p-pin").value, el)) return;
  $("p-pin").value = ""; const ref = newRef(); balance -= a;
  tx.push({ d: today(), kind: "d_pay", who: $("p-m").value, amt: -a, st: "ok", ref });
  msg(el, "ok", T("ok_h"), [`${T("ok_p")} ${ref}`]); render();
}
function simulateReceive() {
  const amt = [2500, 10000, 15000][Math.floor(Math.random() * 3)], from = "Joseph (655 44 33 22)";
  balance += amt; tx.push({ d: today(), kind: "d_recv", who: from, amt, st: "ok", ref: newRef() });
  notifs.push({ when: "now", text: (l) => `${I18N[l].n_recv} ${fmt(amt)} ${I18N[l].n_from} ${from}.` });
  toast(`${T("toast_recv")} ${fmt(amt)} ${I18N[lang].n_from} ${from}.`);
  render();
}
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
$("s-amt").addEventListener("input", updFees); $("p-amt").addEventListener("input", updFees);
$("s-go").addEventListener("click", doSend); $("p-go").addEventListener("click", doPay); $("sim-recv").addEventListener("click", simulateReceive);
for (const l of ["fr", "en"]) $("l-" + l).addEventListener("click", () => { lang = l; $("l-fr").classList.toggle("on", l === "fr"); $("l-en").classList.toggle("on", l === "en"); render(); });
render();
