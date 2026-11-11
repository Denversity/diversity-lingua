"""Instantané hors-ligne de l'extension (scripts/export_glossary.py) sur les vraies ressources."""
import importlib.util
import json
import re

from app.core.config import REPO_ROOT
from app.services.textnorm import normalize

_spec = importlib.util.spec_from_file_location("export_glossary", REPO_ROOT / "scripts" / "export_glossary.py")
export_glossary = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export_glossary)

SRC_GLOSSARY = json.loads((REPO_ROOT / "data/references/linguistic-delivery/safinum_glossary_v1.json").read_text(encoding="utf-8"))
SRC_MEMORY = json.loads((REPO_ROOT / "data/references/linguistic-delivery/safinum_translation_memory_v1.json").read_text(encoding="utf-8"))


def snapshot():
    return export_glossary.build(include_test=False)["ff"]


def test_snapshot_has_no_pending_no_variable_and_no_duplicate_key():
    snap = snapshot()
    pending = {t["preferred"] for c in SRC_GLOSSARY["concepts"] for t in c["targets"] if t["status"] == "pending_validation"}
    assert snap["version"] == "1.0.0" and snap["entries"]
    assert not ({e["translation"] for e in snap["entries"]} & pending)
    assert not any(re.search(r"\{\{P\d+\}\}", e["source_text"]) for e in snap["entries"])
    keys = [(e["source_lang"], export_glossary.normalize_form(e["source_text"])) for e in snap["entries"]]
    assert len(keys) == len(set(keys))
    assert not any(e.get("test_data") for e in snap["entries"])
    by_key = {(e["source_lang"], export_glossary.normalize_form(e["source_text"])): e for e in snap["entries"]}
    assert by_key[("en", export_glossary.normalize_form("Account number"))]["origin"] == "glossary"
    assert by_key[("en", export_glossary.normalize_form("Account number :"))]["origin"] == "memory"
    assert by_key[("fr", export_glossary.normalize_form("Numéro de compte"))]["origin"] == "glossary"
    assert by_key[("fr", export_glossary.normalize_form("Numéro de compte :"))]["origin"] == "memory"


def test_memory_has_priority_over_glossary_in_the_offline_snapshot():
    by_key = {(e["source_lang"], normalize(e["source_text"])): e for e in snapshot()["entries"]}
    for lang, text in (("fr", "Envoyer de l'argent"), ("en", "Send money"), ("fr", "Historique des transactions"), ("en", "Log out")):
        seg = next(s for s in SRC_MEMORY["segments"] if s["source"]["lang"] == lang and s["source"]["text"] == text)
        e = by_key[(lang, normalize(text))]
        assert e["origin"] == "memory" and e["translation"] == seg["targets"][0]["preferred"]


def test_project_requested_back_translation_is_in_offline_snapshot():
    by_key = {(e["source_lang"], normalize(e["source_text"])): e for e in snapshot()["entries"]}
    assert by_key[("fr", "retour")]["translation"] == "ɓaawo"
    assert by_key[("en", "back")]["translation"] == "ɓaawo"


def test_every_variable_free_memory_phrase_is_exported():
    keys = {(e["source_lang"], normalize(e["source_text"])) for e in snapshot()["entries"]}
    for s in SRC_MEMORY["segments"]:
        if "{{P" not in s["source"]["text"]:
            assert (s["source"]["lang"], normalize(s["source"]["text"])) in keys
