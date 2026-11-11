#!/usr/bin/env python3
"""Génère shared/protection_vectors.json depuis l'implémentation Python (référence).
Les vecteurs sont ensuite vérifiés à l'identique côté TypeScript (extension/tests/protect.test.ts)."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.services.protection import mask_text

INPUTS = [
    "Vous avez envoyé 5 000 FCFA au 677 12 34 56.",
    "Frais : 1,5 % — réf. TX-2026-000123 le 12/10/2026 à 14h30",
    "Votre code OTP est 483920",
    "PIN: 1234",
    "Mot de passe : abc123XYZ",
    "Solde disponible : 1 250 000 F",
    "Contact : aide@example.cm ou https://example.cm/aide?x=1",
    "Reçu {{P0}} de {{P1}}, total 300 XAF",
    "Vous avez 3 transactions en attente",
    "Envoyer de l'argent",
    "Retrait de 600 000 000 F",
    "Appelez le +237 677 123 456",
    "Total: $25 / €10 / 15 USD",
    "Compte 000123456789 débité de 2 500 FCFA",
    "Frais de 100 F",
    "Confirmer",
    "12 500",
    "Taux : 2.5% par mois",
    "Frais 5 Frais",
    "XAF 10 000 reçus",
    "Proposition de l'utilisateur 5000 FCFA",
    "Erreur 404 : page introuvable",
    "Visiteur 12 et 3 EUR de frais",
    "Montant : EUR 25 reçus",
    "Paiement de USD 40 effectué",
]
out = []
for t in INPUTS:
    r = mask_text(t)
    out.append({"input": t, "masked": r.masked,
                "tokens": [[ph, v, k] for ph, (v, k) in r.tokens.items()]})
(ROOT / "shared" / "protection_vectors.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
for o in out: print(o["masked"], "|", [(t[1], t[2]) for t in o["tokens"]])
