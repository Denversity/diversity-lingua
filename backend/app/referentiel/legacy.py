"""Conversion du format v0 (entrées à plat, status « validated ») vers le contrat v1.0.0."""
from __future__ import annotations

import re
import unicodedata
from collections import OrderedDict

from ..services.glossary import normalize
from .models import CONTRACT_VERSION, TARGET_VARIETIES

STATUS = {"validated": "approved", "approved": "approved", "pending_validation": "pending_validation",
          "rejected": "rejected", "deprecated": "deprecated"}


def _slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")[:60] or "x"


def is_legacy(raw) -> bool:
    return isinstance(raw, dict) and "schema" not in raw and "entries" in raw and "language" in raw


def convert(raw: dict, kind: str) -> tuple[dict, list[str]]:
    """kind : glossary | translation-memory. Retourne (document v1, avertissements)."""
    warns: list[str] = []
    lang = raw["language"]
    meta = {"language": lang, "variety": TARGET_VARIETIES.get(lang, "unspecified"), "source_languages": ["fr", "en"],
            "dataset_version": str(raw.get("version", "0")), "fixture": bool(raw.get("fixture")),
            "notes": "converti depuis le format v0"}
    if kind == "translation-memory":
        segs = []
        for e in raw["entries"]:
            t = _target(e, warns)
            segs.append({"segment_id": e["id"], "concept_id": e.get("concept_id"), "source": {"lang": e["source_lang"], "text": e["source_text"]},
                         "contexts": e.get("contexts") or [], "targets": [t]})
        return {"schema": "diversity-lingua/translation-memory", "schema_version": CONTRACT_VERSION, "meta": meta, "segments": segs}, warns
    groups: "OrderedDict[str, dict]" = OrderedDict()
    for e in raw["entries"]:
        cid = e.get("concept_id") or f"legacy.{_slug(e['source_text'])}"
        g = groups.setdefault(cid, {"concept_id": cid, "contexts": e.get("contexts") or [], "sources": {}, "targets": [], "_t": {}})
        forms = g["sources"].setdefault(e["source_lang"], {"preferred": e["source_text"], "accepted": []})
        if normalize(e["source_text"]) not in {normalize(forms["preferred"]), *map(normalize, forms["accepted"])}:
            forms["accepted"].append(e["source_text"])
        t = _target(e, warns)
        key = (tuple(sorted(t["contexts"])), t["preferred"], t["status"])
        if key not in g["_t"]:
            g["_t"][key] = True
            g["targets"].append(t)
    concepts = []
    for g in groups.values():
        g.pop("_t")
        # collapse : plusieurs cibles identiques non traduites → une seule cible en attente
        pend = [t for t in g["targets"] if t["preferred"] is None]
        g["targets"] = [t for t in g["targets"] if t["preferred"] is not None] + pend[:1]
        concepts.append(g)
    return {"schema": "diversity-lingua/glossary", "schema_version": CONTRACT_VERSION, "meta": meta, "concepts": concepts}, warns


def _target(e: dict, warns: list[str]) -> dict:
    status = STATUS.get(e.get("status", "pending_validation"), "pending_validation")
    val = e.get("validation") or {}
    tr = e.get("translation")
    if status == "approved" and not (val.get("validator_id") and val.get("validated_at") and tr):
        warns.append(f"{e['id']} : « validated » sans validateur/date/traduction → converti en pending_validation")
        status = "pending_validation"
    return {"contexts": e.get("contexts") or [], "preferred": tr, "accepted": [], "status": status,
            "validation": {"validator_id": val.get("validator_id"), "validated_at": val.get("validated_at"), "method": val.get("method")},
            "version": int(e.get("version", 1))}
