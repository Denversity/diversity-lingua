"""Normalisation de texte partagée (index de recherche, validation, extension : même règle)."""
import re
import unicodedata

_STRIP = " \t\r\n.:;…«»\"'"


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFC", text).replace("\u2019", "'").replace("\u00a0", " ")
    t = re.sub(r"\s+", " ", t).strip(_STRIP)
    return t.casefold()
