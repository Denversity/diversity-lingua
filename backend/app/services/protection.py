"""Data Protection Service.

Remplace les données sensibles/financières par des jetons {{P<n>}} AVANT toute traduction,
puis les restaure APRÈS. Les valeurs protégées ne quittent jamais ce module.
L'extension applique la même logique côté navigateur (defense in depth) :
les jetons déjà présents dans le texte reçu sont traités comme « externes » et doivent
être préservés tels quels.

Les vecteurs de test partagés (shared/protection_vectors.json) garantissent que
l'implémentation Python et l'implémentation TypeScript produisent exactement le même masquage.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

PLACEHOLDER_RE = re.compile(r"\{\{P(\d+)\}\}")

_CUR_SUFFIX = r"(?:FCFA|F\s?CFA|XAF|XOF|CFA|EUR|USD|€|\$|FC|F)"
_CUR_PREFIX = r"(?:FCFA|F\s?CFA|XAF|XOF|CFA|EUR|USD|€|\$)"
_NUM = r"\d+(?:[ \u00a0\u202f.,]\d+)*"

# L'ordre des alternatives est significatif (la première qui correspond à une position l'emporte).
_PATTERN = re.compile(
    "|".join(
        [
            r"(?P<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)",
            r"(?P<url>(?:https?://|www\.)[^\s<>\"']+)",
            r"(?P<secret>(?:pin|otp|cvv|mot de passe|password|passcode|code secret)\s*[:=]\s*)(?P<secretval>\S+)",
            r"(?P<codectx>\b(?:code|otp|pin)\b[^\d\n]{0,25})(?P<codeval>\d{4,8})(?!\d)",
            rf"(?P<amount>(?:(?<![A-Za-z0-9\u00c0-\u00ff]){_CUR_PREFIX}\s?{_NUM}|{_NUM}\s?{_CUR_SUFFIX})(?![A-Za-z0-9\u00c0-\u00ff]))",
            r"(?P<phone>(?:(?:\+|00)237[ .-]?)?(?<![\d])[26](?:[ .-]?\d){8}(?!\d))",
            r"(?P<percent>\d+(?:[.,]\d+)?\s?%)",
            r"(?P<date>\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}[h:]\d{2}\b)",
            r"(?P<id>\b[A-Z]{2,6}[-_]?\d[A-Za-z0-9_-]{2,}\b|\b\d{6,}\b)",
            r"(?P<currency>\b(?:FCFA|F\s?CFA|XAF|XOF|CFA|EUR|USD)\b|€|\$)",
            r"(?P<number>\d+(?:[ \u00a0\u202f.,]\d{3})*(?:[.,]\d+)?)",
        ]
    ),
    re.IGNORECASE,
)

_KIND_BY_GROUP = {
    "email": "email",
    "url": "url",
    "secretval": "secret",
    "codeval": "secret",
    "amount": "amount",
    "phone": "phone",
    "percent": "number",
    "date": "number",
    "id": "identifier",
    "currency": "currency",
    "number": "number",
}


@dataclass
class MaskResult:
    masked: str
    tokens: dict[str, tuple[str, str]] = field(default_factory=dict)  # placeholder -> (valeur, type)
    external: list[str] = field(default_factory=list)  # jetons posés par l'extension

    @property
    def kinds(self) -> list[str]:
        return sorted({k for _, k in self.tokens.values()})

    @property
    def all_placeholders(self) -> list[str]:
        return list(self.tokens.keys()) + self.external


def mask(text: str) -> MaskResult:
    external = [m.group(0) for m in PLACEHOLDER_RE.finditer(text)]
    used = [int(m.group(1)) for m in PLACEHOLDER_RE.finditer(text)]
    counter = (max(used) + 1) if used else 0
    tokens: dict[str, tuple[str, str]] = {}
    out: list[str] = []
    pos = 0
    for m in _PATTERN.finditer(text):
        group = next(g for g in ("secretval", "codeval", "email", "url", "amount", "phone", "percent",
                                 "date", "id", "currency", "number") if m.group(g) is not None)
        start, end = m.start(group), m.end(group)
        if start < pos:
            continue
        # Les jetons externes ne sont pas des nombres : ils sont déjà sautés car {{P0}} contient un 'P'.
        value = text[start:end]
        ph = f"{{{{P{counter}}}}}"
        counter += 1
        tokens[ph] = (value, _KIND_BY_GROUP[group])
        out.append(text[pos:start])
        out.append(ph)
        pos = end
    out.append(text[pos:])
    masked = "".join(out)
    return MaskResult(masked=masked, tokens=tokens, external=external)


def mask_text(text: str) -> MaskResult:
    """Point d'entrée : masque les données sensibles en préservant les jetons externes."""
    ext_tokens = list(PLACEHOLDER_RE.finditer(text))
    if not ext_tokens:
        return mask(text)
    sentinels: dict[str, str] = {}

    def _stash(m: re.Match) -> str:
        key = "\ue000" + "".join(chr(0xE010 + int(d)) for d in m.group(1)) + "\ue001"
        sentinels[key] = m.group(0)
        return key

    stashed = PLACEHOLDER_RE.sub(_stash, text)
    res = mask(stashed)
    # Renuméroter après les jetons externes
    used = [int(m.group(1)) for m in ext_tokens]
    base = max(used) + 1
    renum: dict[str, tuple[str, str]] = {}
    mapping: dict[str, str] = {}
    for i, (ph, val) in enumerate(res.tokens.items()):
        new_ph = f"{{{{P{base + i}}}}}"
        mapping[ph] = new_ph
        renum[new_ph] = val
    masked = res.masked
    # Les jetons générés par mask() (à partir de 0) sont remplacés en une passe pour éviter les collisions.
    masked = PLACEHOLDER_RE.sub(lambda m: mapping.get(m.group(0), m.group(0)), masked)
    for key, original in sentinels.items():
        masked = masked.replace(key, original)
    return MaskResult(masked=masked, tokens=renum, external=[m.group(0) for m in ext_tokens])


def unmask(text: str, tokens: dict[str, tuple[str, str]]) -> str:
    """Restaure les valeurs protégées posées par le serveur. Les jetons externes sont laissés intacts."""
    return PLACEHOLDER_RE.sub(lambda m: tokens[m.group(0)][0] if m.group(0) in tokens else m.group(0), text)


def placeholders_of(text: str) -> Counter:
    return Counter(m.group(0) for m in PLACEHOLDER_RE.finditer(text))


def has_translatable_letters(masked: str) -> bool:
    stripped = PLACEHOLDER_RE.sub("", masked)
    return re.search(r"[^\W\d_]", stripped) is not None
