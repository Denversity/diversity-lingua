"""Context Classification Service : déduit le contexte d'un segment (type d'élément + thème financier).

Règles simples et transparentes (mots-clés FR/EN). Le contexte sert à (1) départager des
traductions dépendantes du contexte dans le glossaire / la mémoire, (2) guider le fournisseur IA.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..schemas import ElementContext

_TOPICS: dict[str, list[str]] = {
    "transfer": ["envoi", "envoyer", "transfert", "transférer", "send", "transfer", "destinataire", "recipient", "bénéficiaire"],
    "receive": ["réception", "recevoir", "reçu", "received", "receive", "incoming", "expéditeur", "sender"],
    "payment": ["paiement", "payer", "marchand", "facture", "pay", "payment", "merchant", "bill", "invoice"],
    "fees": ["frais", "commission", "fee", "fees", "charge", "tarif"],
    "balance": ["solde", "balance", "disponible", "available"],
    "history": ["historique", "history", "transactions", "relevé", "statement"],
    "error": ["échec", "échoué", "erreur", "impossible", "refusé", "insuffisant", "failed", "error", "declined", "insufficient", "unable"],
    "security": ["pin", "otp", "mot de passe", "password", "code secret", "sécurité", "security", "authentification", "verification", "vérification"],
    "deposit": ["dépôt", "déposer", "deposit", "cash in"],
    "withdrawal": ["retrait", "retirer", "withdraw", "withdrawal", "cash out"],
    "loan": ["crédit", "prêt", "loan", "credit", "épargne", "savings", "microfinance"],
}
_TAG_KIND = {
    "button": "button", "a": "link", "h1": "heading", "h2": "heading", "h3": "heading", "h4": "heading",
    "h5": "heading", "h6": "heading", "label": "label", "option": "option", "th": "table_header",
    "td": "table_cell", "li": "list_item", "legend": "heading", "caption": "heading", "p": "paragraph",
}
_ROLE_KIND = {"alert": "notification", "status": "notification", "alertdialog": "notification",
              "button": "button", "menuitem": "menu", "tab": "menu", "navigation": "menu", "heading": "heading"}


@dataclass
class ContextInfo:
    element: str = "text"
    topics: list[str] = field(default_factory=list)

    @property
    def tags(self) -> set[str]:
        return {self.element, *self.topics}


def classify(masked_text: str, ctx: ElementContext | None) -> ContextInfo:
    element = "text"
    if ctx:
        if ctx.kind == "attribute":
            element = {"placeholder": "placeholder", "title": "tooltip", "aria-label": "label", "alt": "image_alt"}.get(ctx.attr or "", "attribute")
        elif ctx.role and ctx.role in _ROLE_KIND:
            element = _ROLE_KIND[ctx.role]
        elif ctx.tag and ctx.tag.lower() in _TAG_KIND:
            element = _TAG_KIND[ctx.tag.lower()]
        if ctx.region in ("nav", "menu") and element in ("link", "text", "list_item"):
            element = "menu"
    low = masked_text.lower()
    topics = [t for t, kws in _TOPICS.items() if any(re.search(rf"(?<!\w){re.escape(k)}", low) for k in kws)]
    return ContextInfo(element=element, topics=topics)
