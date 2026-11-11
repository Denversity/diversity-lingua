"""Contrat de données : schémas publiés à jour, exemples de référence valides, règles de modèle."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import REPO_ROOT
from app.referentiel.models import DOC_TYPES, Meta, Target
from app.referentiel.validate import validate_document

EXAMPLES = sorted((REPO_ROOT / "schemas" / "examples").glob("*.json"))


def test_published_json_schemas_are_up_to_date():
    r = subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "export_schemas.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert {p.stem.replace(".schema", "") for p in (REPO_ROOT / "schemas").glob("*.schema.json")} == set(DOC_TYPES)


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.name)
def test_reference_examples_are_valid_and_contain_no_translation(path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    res = validate_document(raw)                         # sans allow_fixture : ce sont des modèles destinés au vrai travail
    assert res.ok, [e.as_dict() for e in res.errors]
    assert raw["meta"]["language"] == "ff" and raw["meta"]["variety"] == "adamawa" and raw["meta"]["fixture"] is False
    for key in ("concepts", "segments"):
        for it in raw.get(key, []):
            assert all(t["preferred"] is None for t in it["targets"])      # traduction cible VIDE dans les exemples


def test_six_example_files_cover_the_six_document_types():
    assert {json.loads(p.read_text())["schema"] for p in EXAMPLES} == {v["schema"] for v in DOC_TYPES.values()}


def test_model_rules():
    with pytest.raises(ValidationError):
        Target(status="approved", preferred="x")                                   # approuvé sans validateur
    with pytest.raises(ValidationError):
        Target(preferred="  ")                                                      # chaîne vide interdite (utiliser null)
    with pytest.raises(ValidationError):
        Target(accepted=["a"])                                                      # variantes sans forme préférée
    with pytest.raises(ValidationError):
        Meta(language="ff", variety="autre", dataset_version="1")                   # ff exige adamawa
    assert Meta(language="ff", variety="adamawa", dataset_version="1").source_languages == ["fr", "en"]
    assert Target().status == "pending_validation" and Target().preferred is None   # vide = état valide


def test_source_languages_are_restricted_to_fr_and_en():
    raw = json.loads((REPO_ROOT / "schemas/examples/glossary.example.json").read_text())
    raw["concepts"][0]["sources"]["de"] = {"preferred": "Guthaben"}
    assert not validate_document(raw).ok


def test_unknown_context_is_a_warning_not_an_error():
    raw = json.loads((REPO_ROOT / "schemas/examples/glossary.example.json").read_text())
    raw["concepts"][0]["contexts"] = ["contexte_inconnu"]
    res = validate_document(raw)
    assert res.ok and any(w.code == "unknown_context" for w in res.warnings)


def test_shared_forms_without_disjoint_contexts_warn_about_ambiguity():
    raw = json.loads((REPO_ROOT / "schemas/examples/glossary.example.json").read_text())
    twin = json.loads(json.dumps(raw["concepts"][0])); twin["concept_id"] = "fin.balance.twin"; twin["targets"][0].pop("target_id")
    raw["concepts"].append(twin)
    assert any(w.code == "ambiguous_form" for w in validate_document(raw).warnings)
