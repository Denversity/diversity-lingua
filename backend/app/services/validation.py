"""Translation Validation Service : contrôle l'intégrité d'un résultat AVANT restitution.

Un résultat qui échoue à l'un de ces contrôles est rejeté (le système s'abstient ou essaie le
fournisseur suivant). Réussir ces contrôles NE rend PAS une traduction « validée » :
cela relève uniquement des validateurs humains (glossaire).
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from .protection import PLACEHOLDER_RE, placeholders_of

_TAG_RE = re.compile(r"<\s*/?\s*[a-zA-Z]")


@dataclass
class Verdict:
    ok: bool
    code: str | None = None  # placeholders | digits | empty | length | markup | echo


def _digits(text: str) -> Counter:
    return Counter(re.findall(r"\d", PLACEHOLDER_RE.sub("", text)))


def check(source_masked: str, candidate: str | None, *, machine: bool) -> Verdict:
    if candidate is None or not candidate.strip():
        return Verdict(False, "empty")
    # 1. Jetons : exactement les mêmes, autant de fois (montants, numéros, identifiants intacts).
    if placeholders_of(source_masked) != placeholders_of(candidate):
        return Verdict(False, "placeholders")
    if not machine:
        return Verdict(True)
    # 2. Aucun chiffre « inventé » dans une sortie machine.
    extra = _digits(candidate) - _digits(source_masked)
    if extra:
        return Verdict(False, "digits")
    # 3. Pas de balisage injecté.
    if _TAG_RE.search(candidate) and not _TAG_RE.search(source_masked):
        return Verdict(False, "markup")
    # 4. Longueur plausible.
    ls, lc = len(source_masked), len(candidate)
    if lc > 4 * ls + 40 or (ls > 20 and lc < 0.15 * ls):
        return Verdict(False, "length")
    # 5. Écho de la source (pas de traduction réelle) sur un texte non trivial.
    if ls > 25 and candidate.strip().casefold() == source_masked.strip().casefold():
        return Verdict(False, "echo")
    return Verdict(True)
