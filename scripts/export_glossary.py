#!/usr/bin/env python3
"""Exporte les entrées VALIDÉES (jamais les 'pending') vers extension/public/glossary/<langue>.json.

Instantané hors-ligne de l'extension = glossaire approuvé + phrases APPROUVÉES de la mémoire de traduction
qui ne contiennent aucune variable. Hiérarchie identique au serveur : mémoire → glossaire (si une même
formulation existe dans les deux, la mémoire l'emporte). Les phrases à variables ({{Pn}}) ne sont pas exportées :
leur appariement à gabarit est fait par le serveur uniquement.

--include-test inclut la fixture technique xx-test (démo hors ligne). Sans cette option, la langue de test est ignorée.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.services.glossary import GlossaryService  # noqa: E402

TOKEN = re.compile(r"\{\{P\d+\}\}")


def normalize_form(text: str) -> str:
    """Keep punctuation significant so a field label does not mask a glossary term."""
    text = unicodedata.normalize("NFC", text).replace("\u2019", "'").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip().casefold()


def entry_dict(e, origin):
    return {"id": e.id, "source_lang": e.source_lang, "source_text": e.source_text, "translation": e.translation,
            "contexts": e.contexts, "test_data": e.test_data, "origin": origin}


def build(include_test: bool) -> dict[str, dict]:
    state = ROOT / "backend" / "state"
    g = GlossaryService(ROOT / "data" / "glossary", state, allow_test=include_test, name="glossary")
    m = GlossaryService(ROOT / "data" / "memory", state, allow_test=include_test, name="memory")
    langs = sorted({e.target_lang for e in g.entries.values()} | {e.target_lang for e in m.entries.values()})
    out: dict[str, dict] = {}
    for lang in langs:
        mem = [e for e in m.entries.values() if e.target_lang == lang and e.usable and not TOKEN.search(e.source_text)]
        taken = {(e.source_lang, normalize_form(e.source_text)) for e in mem}
        glo = [e for e in g.entries.values() if e.target_lang == lang and e.usable
               and (e.source_lang, normalize_form(e.source_text)) not in taken]
        version = g.versions.get(lang) or m.versions.get(lang, "0")
        out[lang] = {"language": lang, "version": version,
                     "entries": [entry_dict(e, "memory") for e in mem] + [entry_dict(e, "glossary") for e in glo]}
    return out


def main() -> None:
    include_test = "--include-test" in sys.argv
    out = ROOT / "extension" / "public" / "glossary"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    for lang, doc in build(include_test).items():
        (out / f"{lang}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        n_mem = sum(e["origin"] == "memory" for e in doc["entries"])
        print(f"{lang}: {len(doc['entries'])} entrées validées exportées (mémoire : {n_mem}, glossaire : {len(doc['entries']) - n_mem})")


if __name__ == "__main__":
    main()
