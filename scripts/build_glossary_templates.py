#!/usr/bin/env python3
"""Génère les GABARITS au format contrat v1.0.0 à partir de data/concepts.json.

 - data/glossary/ff.json      : concepts (fr/en) avec une cible en attente, preferred=null. AUCUNE traduction.
 - data/memory/ff.json        : mémoire vide.
 - data/glossary/xx-test.json : FIXTURE technique (meta.fixture=true), pseudo-localisation « [TEST] <concept_id> ».

Sécurité : ff.json n'est jamais écrasé s'il contient déjà des traductions ou s'il est déjà au format contrat
(sauf --force-ff). Un ancien fichier v0 sans aucune traduction est régénéré.
"""
import json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
concepts = json.loads((DATA / "concepts.json").read_text(encoding="utf-8"))
VERSION = "1.0.0"
TEMPLATE_VERSION = "0.2.0-template"


def slug(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")[:60] or "x"


def norm(t):
    return re.sub(r"\s+", " ", t).strip(" .:;").casefold()


def build_concepts():
    out, seen = [], set()
    for c in concepts["concepts"]:
        srcs = {}
        for lang in ("fr", "en"):
            terms = c["terms"][lang]
            srcs[lang] = {"preferred": terms[0], "accepted": terms[1:]}
            seen.update((lang, norm(t)) for t in terms)
        out.append({"concept_id": c["id"], "domain": "mobile_money", "contexts": c["topics"],
                    "definition": {"fr": c["definition"]["fr"], "en": c["definition"]["en"]},
                    "sources": srcs, "targets": [{"target_id": f"{c['id']}~t1", "contexts": [], "preferred": None, "accepted": [], "status": "pending_validation"}]})
    for u in concepts["ui_phrases"]:
        if ("fr", norm(u["fr"])) in seen or ("en", norm(u["en"])) in seen:
            continue
        seen.update([("fr", norm(u["fr"])), ("en", norm(u["en"]))])
        out.append({"concept_id": f"ui.{slug(u['fr'])}", "domain": "mobile_money", "contexts": u["contexts"],
                    "sources": {"fr": {"preferred": u["fr"], "accepted": []}, "en": {"preferred": u["en"], "accepted": []}},
                    "targets": [{"target_id": f"ui.{slug(u['fr'])}~t1", "contexts": [], "preferred": None, "accepted": [], "status": "pending_validation"}]})
    return out


def doc(kind, meta, key, items, **extra):
    return {"schema": f"diversity-lingua/{kind}", "schema_version": VERSION, "meta": meta, key: items, **extra}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def is_safe_to_overwrite(path):
    if not path.exists():
        return True
    raw = json.loads(path.read_text(encoding="utf-8"))
    if "schema" in raw:
        return False  # déjà au format contrat : peut contenir du travail du linguiste
    return all(e.get("translation") in (None, "") for e in raw.get("entries", []))


def main():
    force = "--force-ff" in sys.argv
    prov = {"organization": "TEAM DIVERSITY (équipe technique)", "method": "import",
            "notes": "Gabarit : termes sources uniquement. Aucune traduction fournie par l'équipe technique."}
    meta_ff = {"language": "ff", "variety": "adamawa", "source_languages": ["fr", "en"], "dataset_version": TEMPLATE_VERSION,
               "fixture": False, "provenance": prov, "notes": "À remplacer/compléter par le glossaire du responsable linguistique (voir README.md)."}
    p = DATA / "glossary" / "ff.json"
    if force or is_safe_to_overwrite(p):
        cs = build_concepts()
        write(p, doc("glossary", meta_ff, "concepts", cs))
        print(f"glossary/ff.json : {len(cs)} concepts, 0 traduction")
    else:
        print("glossary/ff.json conservé (contient déjà du travail ; --force-ff pour régénérer)")
    m = DATA / "memory" / "ff.json"
    if force or is_safe_to_overwrite(m):
        write(m, doc("translation-memory", meta_ff, "segments", []))
        print("memory/ff.json : vide")
    # fixture technique (jamais chargée en production : meta.fixture=true, langue de test)
    fx = []
    for u in concepts["ui_phrases"]:
        cid = f"ui.{slug(u['fr'])}"
        fx.append({"concept_id": cid, "contexts": [],
                   "sources": {"fr": {"preferred": u["fr"], "accepted": []}, "en": {"preferred": u["en"], "accepted": []}},
                   "targets": [{"target_id": f"{cid}~t1", "contexts": [], "preferred": f"[TEST] {cid}", "accepted": [], "status": "approved",
                                "validation": {"validator_id": "technical-fixture", "validated_at": "2026-01-01T00:00:00+00:00", "method": "technical_fixture"}}]})
    meta_fx = {"language": "xx-test", "variety": "none", "dataset_version": "fixture-1", "fixture": True,
               "provenance": {"method": "technical_fixture", "notes": "FIXTURE TECHNIQUE — pseudo-localisation, aucune valeur linguistique."}}
    write(DATA / "glossary" / "xx-test.json", doc("glossary", meta_fx, "concepts", fx))
    print(f"glossary/xx-test.json : {len(fx)} concepts fixtures")


main()
