"""Importateur du référentiel : validation, rejet sans corruption, mise à jour sans perte, retour arrière."""
import copy
import json
import shutil
from pathlib import Path

import pytest

from app.core.config import REPO_ROOT
from .conftest import TEMPLATE_DATA
from app.referentiel.corrections import apply_corrections
from app.referentiel.importer import ImportOptions, import_document
from app.referentiel.store import ReferentielStore
from app.services.glossary import GlossaryService

FX = Path(__file__).parent / "fixtures"
OPT = ImportOptions(allow_fixture=True)


@pytest.fixture
def env(tmp_path):
    data = tmp_path / "data"
    shutil.copytree(TEMPLATE_DATA, data)
    return ReferentielStore(data, tmp_path / "state")


def snapshot(store: ReferentielStore) -> dict:
    return {str(p.relative_to(store.data_dir)): p.read_bytes() for p in sorted(store.data_dir.rglob("*")) if p.is_file()}


def load(name: str) -> dict:
    return json.loads((FX / name).read_text(encoding="utf-8"))


def gdoc(store, lang="ff"):
    return json.loads(store.path_for("glossary", lang).read_text(encoding="utf-8"))


def target(doc, cid):
    return next(c for c in doc["concepts"] if c["concept_id"] == cid)["targets"][0]


# ------------------------------------------------------------------ import valide
def test_import_valid_glossary(env):
    before = len(gdoc(env)["concepts"])
    rep = import_document(FX / "glossary_valid.json", env, OPT)
    assert rep.accepted and rep.doc_type == "glossary" and rep.import_id
    assert len(rep.added) == 4 and not rep.errors
    assert rep.status_counts == {"approved": 1, "pending_validation": 2, "rejected": 1}  # statuts distingués
    doc = gdoc(env)
    assert len(doc["concepts"]) == before + 4                      # ajout, sans toucher aux concepts existants
    assert doc["meta"]["dataset_version"] == "fx-1" and target(doc, "fx.alpha")["status"] == "approved"
    g = GlossaryService(env.data_dir / "glossary", env.state_dir)  # le moteur sert les données importées
    assert g.lookup("Alpha fictif", "fr", "ff", set()).tier == "approved"
    assert g.lookup("Fictitious gamma", "en", "ff", set()).tier == "pending_validation"
    assert g.lookup("Delta fictif", "fr", "ff", set()).tier == "rejected"
    assert (env.reports / f"{rep.import_id}.json").exists() and env.history()[-1]["import_id"] == rep.import_id


def test_all_valid_document_types_import(env):
    for name in ["memory_valid.json", "corpus_valid.json", "benchmark_valid.json", "corrections_valid.json", "profile_valid.json"]:
        rep = import_document(FX / name, env, OPT)
        assert rep.accepted and not rep.errors, (name, rep.errors)
    assert (env.data_dir / "corpus" / "fx-corpus.json").exists() and (env.data_dir / "benchmark" / "fx-bench.json").exists()


def test_fixture_data_refused_unless_explicitly_allowed(env):
    snap = snapshot(env)
    rep = import_document(FX / "glossary_valid.json", env, ImportOptions())
    assert not rep.accepted and rep.errors[0]["code"] == "fixture_not_allowed" and snapshot(env) == snap


# ------------------------------------------------------------------ rejet sans corruption
@pytest.mark.parametrize("name,code", [
    ("invalid_duplicate_ids.json", "duplicate_id"), ("invalid_missing_id.json", "missing_id"),
    ("invalid_missing_sources.json", "missing_field"), ("invalid_unknown_field.json", "unknown_field"),
    ("invalid_wrong_variety.json", "invalid_value"), ("invalid_approved_without_validator.json", "invalid_value"),
    ("invalid_bad_concept_id.json", "invalid_value"), ("invalid_placeholder_mismatch.json", "placeholder_mismatch"),
    ("invalid_schema_version.json", "unsupported_version")])
def test_invalid_glossary_rejected_and_store_untouched(env, name, code):
    snap = snapshot(env)
    rep = import_document(FX / name, env, OPT)
    assert not rep.accepted and code in {e["code"] for e in rep.errors}
    assert snapshot(env) == snap and rep.import_id is None   # aucune donnée modifiée, aucun import enregistré


def test_duplicate_ids_flag_every_occurrence_and_lenient_mode_keeps_the_rest(env):
    rep = import_document(FX / "invalid_duplicate_ids.json", env, OPT)
    dup = [e for e in rep.errors if e["code"] == "duplicate_id"]
    assert len(dup) == 2 and {e["item_id"] for e in dup} == {"fx.alpha"}
    snap = snapshot(env)
    lenient = import_document(FX / "invalid_duplicate_ids.json", env, ImportOptions(allow_fixture=True, mode="lenient"))
    assert lenient.accepted and len(lenient.skipped) == 2
    ids = {c["concept_id"] for c in gdoc(env)["concepts"]}
    assert {"fx.beta", "fx.gamma", "fx.delta"} <= ids and "fx.alpha" not in ids  # les doublons ambigus ne sont pas importés
    assert snapshot(env) != snap


def test_missing_required_fields_and_ids_are_reported_with_paths(env):
    rep = import_document(FX / "invalid_missing_id.json", env, OPT)
    e = next(x for x in rep.errors if x["code"] == "missing_id")
    assert e["path"].startswith("concepts[1]")
    rep = import_document(FX / "invalid_missing_sources.json", env, OPT)
    assert any(x["code"] == "missing_field" and "sources" in x["path"] for x in rep.errors)


def test_garbage_and_missing_files_do_not_crash(env, tmp_path):
    bad = tmp_path / "bad.json"; bad.write_text("{ pas du json")
    assert import_document(bad, env, OPT).errors[0]["code"] == "invalid_json"
    assert import_document(tmp_path / "absent.json", env, OPT).errors[0]["code"] == "file_not_found"
    arr = tmp_path / "arr.json"; arr.write_text("[1,2]")
    assert import_document(arr, env, OPT).errors[0]["code"] == "invalid_document"


def test_corrupt_existing_store_is_never_overwritten(env):
    p = env.path_for("glossary", "ff")
    p.write_text('{"schema": "diversity-lingua/glossary", "schema_version": "1.0.0", "meta": {"language": "ff"}}')
    snap = snapshot(env)
    rep = import_document(FX / "glossary_valid.json", env, OPT)
    assert not rep.accepted and rep.errors[0]["code"] == "store_corrupt" and snapshot(env) == snap


def test_dry_run_writes_nothing(env):
    snap = snapshot(env)
    rep = import_document(FX / "glossary_valid.json", env, ImportOptions(allow_fixture=True, dry_run=True))
    assert rep.accepted and rep.dry_run and len(rep.added) == 4 and rep.import_id is None
    assert snapshot(env) == snap and not env.history()


# ------------------------------------------------------------------ mise à jour sans perte
def test_update_never_loses_approved_translations(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    # 1) l'entrant ne contient que du « en attente / null » pour alpha (approuvé) et apporte du neuf
    v2 = load("glossary_valid.json")
    v2["meta"]["dataset_version"] = "fx-2"
    v2["concepts"][0]["targets"] = [{"target_id": "fx.alpha~t1", "preferred": None, "status": "pending_validation", "version": 5}]
    v2["concepts"] = v2["concepts"][:2]  # gamma/delta absents du fichier entrant → doivent être conservés
    rep = import_document(v2, env, OPT)
    assert rep.accepted
    assert [p["code"] for p in rep.protected] == ["approved_protected"] and rep.protected[0]["id"] == "fx.alpha"
    doc = gdoc(env)
    a = target(doc, "fx.alpha")
    assert a["status"] == "approved" and a["preferred"] == "[FIXTURE] alpha" and a["accepted"] == ["[FIXTURE] alpha-bis"]
    assert {c["concept_id"] for c in doc["concepts"]} >= {"fx.gamma", "fx.delta"}      # rien n'a été supprimé
    assert rep.counts["kept_absent_from_file"] >= 2 and doc["meta"]["dataset_version"] == "fx-2"


def test_approved_replaced_only_by_higher_approved_version_with_history(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    same = load("glossary_valid.json")
    same["concepts"][0]["targets"][0].update(preferred="[FIXTURE] alpha-v1bis")          # même version 1, texte différent
    rep = import_document(same, env, OPT)
    assert [c["code"] for c in rep.conflicts] == ["approved_version_conflict"]
    assert target(gdoc(env), "fx.alpha")["preferred"] == "[FIXTURE] alpha"               # inchangé
    newer = load("glossary_valid.json")
    newer["concepts"][0]["targets"][0].update(preferred="[FIXTURE] alpha-v2", version=2)
    rep = import_document(newer, env, OPT)
    t = target(gdoc(env), "fx.alpha")
    assert t["preferred"] == "[FIXTURE] alpha-v2" and t["version"] == 2
    assert t["history"][0]["preferred"] == "[FIXTURE] alpha" and t["history"][0]["version"] == 1   # ancienne version CONSERVÉE
    assert t["history"][0]["replaced_by"] == rep.import_id


def test_rejected_cannot_silently_demote_approved(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    rej = load("glossary_valid.json")
    rej["concepts"][0]["targets"][0] = {"target_id": "fx.alpha~t1", "preferred": "[FIXTURE] x", "status": "rejected", "version": 9}
    assert import_document(rej, env, OPT).protected
    assert target(gdoc(env), "fx.alpha")["status"] == "approved"
    rep = import_document(rej, env, ImportOptions(allow_fixture=True, allow_demote=True))
    assert target(gdoc(env), "fx.alpha")["status"] == "rejected" and rep.updated[0]["code"] == "approved_demoted"


def test_pending_is_replaced_by_incoming_and_old_version_archived(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    v2 = load("glossary_valid.json")
    v2["concepts"][1]["targets"][0] = {"target_id": "fx.beta~t1", "preferred": "[FIXTURE] beta-proposé", "status": "pending_validation"}
    import_document(v2, env, OPT)
    t = target(gdoc(env), "fx.beta")
    assert t["preferred"] == "[FIXTURE] beta-proposé" and t["version"] == 2 and t["history"][0]["preferred"] is None


def test_reimport_of_identical_file_is_a_noop(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    snap = snapshot(env)
    rep = import_document(FX / "glossary_valid.json", env, OPT)
    assert rep.accepted and not rep.added and not rep.updated and not rep.conflicts and "aucun changement" in " ".join(rep.notes)
    assert snapshot(env) == snap


def test_api_validation_survives_a_later_import(env):
    g = GlossaryService(env.data_dir / "glossary", env.state_dir)
    eid = g.find_by_concept("balance", "ff")[0].id
    g.validate(eid, "validate", "native-1", "[FIXTURE] solde", "native_speaker")
    tpl = json.loads((TEMPLATE_DATA / "glossary/ff.json").read_text())   # ré-import du gabarit (cibles en attente)
    rep = import_document(tpl, env, ImportOptions())
    assert any(p["id"] == "balance" for p in rep.protected)
    assert target(gdoc(env), "balance")["preferred"] == "[FIXTURE] solde"


# ------------------------------------------------------------------ retour arrière
def test_rollback_restores_exact_bytes_and_removes_created_files(env):
    snap = snapshot(env)
    r1 = import_document(FX / "glossary_valid.json", env, OPT)
    r2 = import_document(FX / "corpus_valid.json", env, OPT)
    assert (env.data_dir / "corpus" / "fx-corpus.json").exists()
    with pytest.raises(ValueError):
        env.rollback(r1.import_id)                      # il faut d'abord annuler le plus récent
    env.rollback(r2.import_id)
    assert not (env.data_dir / "corpus" / "fx-corpus.json").exists()
    env.rollback(r1.import_id)
    after = snapshot(env)
    after.pop("referentiel_manifest.json", None); snap.pop("referentiel_manifest.json", None)
    assert after == snap                                   # octet pour octet
    with pytest.raises(ValueError):
        env.rollback(r1.import_id)                      # déjà annulé
    assert [h.get("rolled_back") for h in env.history()] == [True, True] and env.last_import_id() is None


def test_failure_midway_restores_everything(env, monkeypatch):
    snap = snapshot(env)
    real = ReferentielStore._write_atomic
    calls = {"n": 0}

    def flaky(self, path, text):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disque plein")
        return real(self, path, text)
    monkeypatch.setattr(ReferentielStore, "_write_atomic", flaky)
    with pytest.raises(OSError):
        import_document(FX / "profile_valid.json", env, OPT)   # écrit le profil + languages.json
    monkeypatch.undo()
    assert snapshot(env) == snap


# ------------------------------------------------------------------ format v0, export, corrections, profil, corpus
def test_legacy_v0_file_is_converted_without_fabricating_approvals(env):
    rep = import_document(FX / "legacy_v0_glossary.json", env, OPT)
    assert rep.accepted and any(w["code"] == "converted_legacy" for w in rep.warnings)
    doc = gdoc(env)
    assert target(doc, "fx.legacy")["status"] == "pending_validation"      # « validated » sans validateur → pas d'approbation inventée
    assert target(doc, "fx.legacy2")["status"] == "approved"


def test_export_import_round_trip_is_lossless(env, tmp_path):
    import_document(FX / "glossary_valid.json", env, OPT)
    exported = json.loads(env.path_for("glossary", "ff").read_text(encoding="utf-8"))
    other = ReferentielStore(tmp_path / "d2", tmp_path / "s2")
    (tmp_path / "d2").mkdir()
    rep = import_document(exported, other, ImportOptions(allow_fixture=True, allow_demote=True))
    assert rep.accepted
    assert json.loads(other.path_for("glossary", "ff").read_text(encoding="utf-8")) == exported


def test_corrections_registry_is_applied_with_history_and_is_reversible(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    import_document(FX / "corrections_valid.json", env, OPT)
    snap = snapshot(env)
    rep = apply_corrections(env, "ff")
    assert rep.accepted and rep.updated[0]["code"] == "correction_applied"
    t = target(gdoc(env), "fx.alpha")
    assert t["preferred"] == "[FIXTURE] alpha-corrigé" and t["version"] == 2 and t["history"][0]["preferred"] == "[FIXTURE] alpha"
    assert t["validation"]["validator_id"] == "fixture-validator"
    assert json.loads(env.path_for("corrections", "ff").read_text())["corrections"][0]["status"] == "applied"
    again = apply_corrections(env, "ff")
    assert not again.updated                                                  # idempotent
    env.rollback(rep.import_id)
    assert snapshot(env) == {k: v for k, v in snap.items() if k != "referentiel_manifest.json"} | {"referentiel_manifest.json": env.manifest_path.read_bytes()}


def test_correction_with_unknown_target_is_reported_not_applied(env):
    import_document(FX / "glossary_valid.json", env, OPT)
    c = load("corrections_valid.json")
    c["corrections"][0]["target_ref"]["concept_id"] = "fx.inconnu"
    c["corrections"][0]["target_ref"].pop("target_id")
    import_document(c, env, OPT)
    rep = apply_corrections(env, "ff")
    assert rep.conflicts and rep.conflicts[0]["code"] == "target_not_found_or_ambiguous"
    assert target(gdoc(env), "fx.alpha")["preferred"] == "[FIXTURE] alpha"


def test_language_profile_updates_language_sheet_and_rejects_wrong_variety(env):
    rep = import_document(FX / "profile_valid.json", env, OPT)
    assert rep.accepted
    ff = next(t for t in json.loads(env.languages_path.read_text())["target_languages"] if t["code"] == "ff")
    assert ff["variety_code"] == "adamawa" and ff["availability"] == "partial" and (env.data_dir / "profiles" / "ff.json").exists()
    bad = load("profile_valid.json"); bad["language"]["variety"] = "autre"
    assert not import_document(bad, env, OPT).accepted


def test_memory_placeholder_mismatch_and_benchmark_must_preserve_are_validated(env):
    m = load("memory_valid.json"); m["segments"][0]["targets"][0]["preferred"] = "[FIXTURE] sans jeton"
    assert "placeholder_mismatch" in {e["code"] for e in import_document(m, env, OPT).errors}
    b = load("benchmark_valid.json"); b["items"][0]["must_preserve"] = ["999 FCFA"]
    assert "must_preserve_not_in_source" in {e["code"] for e in import_document(b, env, OPT).errors}


def test_corpus_approved_reference_is_protected(env):
    import_document(FX / "corpus_valid.json", env, OPT)
    c = load("corpus_valid.json")
    c["items"][0]["reference"] = {"text": "[FIXTURE] autre", "status": "approved"}
    rep = import_document(c, env, OPT)
    assert rep.conflicts and rep.conflicts[0]["code"] == "approved_reference_conflict"
    assert json.loads((env.data_dir / "corpus/fx-corpus.json").read_text())["items"][0]["reference"]["text"] == "[FIXTURE] alpha"
    assert import_document(c, env, ImportOptions(allow_fixture=True, replace_approved=True)).updated


def test_import_of_real_template_does_not_alter_repo_data(env):
    """Garde-fou : les tests travaillent sur une copie — le dépôt n'est jamais modifié."""
    before = (REPO_ROOT / "data/glossary/ff.json").read_bytes()
    import_document(FX / "glossary_valid.json", env, OPT)
    assert (REPO_ROOT / "data/glossary/ff.json").read_bytes() == before
