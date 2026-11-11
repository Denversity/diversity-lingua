import json

from .conftest import TEMPLATE_DATA
import pytest

from app.services.glossary import GlossaryService, normalize


def svc(custom_data, tmp_path, **kw):
    return GlossaryService(custom_data / "glossary", tmp_path / "state", **kw)


def test_normalize():
    assert normalize("  Envoyer :  ") == "envoyer"
    assert normalize("L’argent") == "l'argent"


def test_only_approved_is_served_as_approved(custom_data, tmp_path):
    g = svc(custom_data, tmp_path)
    assert g.lookup("Solde", "fr", "tt", set()).tier == "approved"
    r = g.lookup("Frais", "fr", "tt", set())
    assert r.tier == "pending_validation" and r.entry.status == "pending_validation"  # connu, mais jamais « approved »
    assert g.lookup("Retour", "fr", "tt", set()).entry is None  # pending sans texte : rien à servir
    r = g.lookup("Rejeter", "fr", "tt", set())
    assert r.tier == "rejected" and r.entry.translation == "BAD"


def test_context_disambiguation(custom_data, tmp_path):
    g = svc(custom_data, tmp_path)
    assert g.lookup("Envoyer", "fr", "tt", {"button"}).entry.translation == "SEND-BTN"
    assert g.lookup("Envoyer", "fr", "tt", {"heading"}).entry.translation == "SEND-HEAD"


def test_ambiguity_abstains_instead_of_guessing(custom_data, tmp_path):
    r = svc(custom_data, tmp_path).lookup("Envoyer", "fr", "tt", {"paragraph"})
    assert r.entry is None and r.reason == "ambiguous_context"


def test_search_by_concept_id_and_by_form_per_language(custom_data, tmp_path):
    g = svc(custom_data, tmp_path)
    forms = {(e.source_lang, e.source_text) for e in g.find_by_concept("c.balance")}
    assert forms == {("fr", "Solde"), ("en", "Balance")}
    assert {e.concept_id for e in g.find_by_form("solde", "fr")} == {"c.balance"}   # formulation française
    assert {e.concept_id for e in g.find_by_form("BALANCE", "en")} == {"c.balance"}  # formulation anglaise
    assert g.find_by_form("Balance", "fr") == []                                      # l'anglais n'existe pas côté fr


def test_no_mixing_between_source_languages(custom_data, tmp_path):
    g = svc(custom_data, tmp_path)
    assert g.lookup("Four", "fr", "tt", set()).entry.translation == "T-OVEN"   # « Four » français = four (cuisine)
    assert g.lookup("Four", "en", "tt", set()).entry.translation == "T-FOUR"   # « Four » anglais = quatre
    assert g.lookup("Oven", "fr", "tt", set()).entry is None


def test_accepted_variants_are_exposed(custom_data, tmp_path):
    e = svc(custom_data, tmp_path).lookup("Compte", "fr", "tt", set()).entry
    assert e.translation == "ACC" and e.alternatives == ["ACC-ALT"]


def test_validation_flow_persists_with_history_and_single_write_path(custom_data, tmp_path):
    g = svc(custom_data, tmp_path)
    eid = g.find_by_form("Frais", "fr")[0].id
    e = g.validate(eid, "validate", "native-1", "FEES-OK", "native_speaker")
    assert e.status == "approved" and e.version == 2 and e.validator_id == "native-1"
    g2 = svc(custom_data, tmp_path)  # rechargement depuis le fichier de données
    assert g2.lookup("Frais", "fr", "tt", set()).entry.translation == "FEES-OK"
    doc = json.loads((custom_data / "glossary" / "tt.json").read_text())
    t = next(c for c in doc["concepts"] if c["concept_id"] == "c.fees")["targets"][0]
    assert t["history"][0]["status"] == "pending_validation" and t["history"][0]["preferred"] == "FEES-PENDING"  # ancienne version conservée
    with pytest.raises(ValueError):  # impossible d'approuver sans traduction
        g.validate(g.find_by_form("Retour", "fr")[0].id, "validate", "native-1", None, "native_speaker")
    assert g.validate(g.find_by_form("Retour", "fr")[0].id, "validate", "native-1", "BACK", "native_speaker").translation == "BACK"


def test_reject_makes_entry_not_approved(custom_data, tmp_path):
    g = svc(custom_data, tmp_path)
    g.validate(g.find_by_form("Solde", "fr")[0].id, "reject", "native-1", None, "panel")
    r = g.lookup("Solde", "fr", "tt", set())
    assert r.tier == "rejected"


def test_find_terms_only_approved(custom_data, tmp_path):
    terms = svc(custom_data, tmp_path).find_terms("Votre solde et vos frais", "fr", "tt")
    assert ("Solde", "BAL") in terms and all(t[0] != "Frais" for t in terms)


def test_invalid_file_never_breaks_startup(custom_data, tmp_path):
    (custom_data / "glossary" / "broken.json").write_text('{"language": "tt", "entries": [{"id": "a"}]}')  # format v0 / malformé
    (custom_data / "glossary" / "garbage.json").write_text("{ pas du json")
    g = svc(custom_data, tmp_path)
    assert {e["code"] for e in g.load_errors} >= {"legacy_format", "invalid_json"}
    assert g.lookup("Solde", "fr", "tt", set()).tier == "approved"  # le reste reste servi


def test_invalid_item_is_skipped_not_fatal(custom_data, tmp_path):
    p = custom_data / "glossary" / "tt.json"
    doc = json.loads(p.read_text())
    doc["concepts"].append({"concept_id": "Bad Id!", "sources": {"fr": {"preferred": "x"}}})
    p.write_text(json.dumps(doc))
    g = svc(custom_data, tmp_path)
    assert any(e["code"] == "invalid_value" for e in g.load_errors)
    assert g.lookup("Solde", "fr", "tt", set()).tier == "approved"


def test_fixture_files_excluded_when_test_data_disallowed(tmp_path):
    from app.core.config import REPO_ROOT
    g = GlossaryService(TEMPLATE_DATA / "glossary", tmp_path, allow_test=False)
    assert not any(e.test_data for e in g.entries.values())
    assert g.stats().get("ff", {}).get("approved", 0) == 0
    assert g.stats()["ff"]["pending_validation"] > 40
