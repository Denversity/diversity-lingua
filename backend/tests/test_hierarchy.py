"""Hiérarchie : mémoire validée → glossaire validé → moteur automatique → indisponible ; cinq statuts distincts."""
import json

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.providers.base import ProviderResult
from app.providers.lookup_providers import GlossaryProvider, MemoryProvider
from app.schemas import ElementContext, Segment, Status, TranslateOptions, TranslateRequest, TranslationStatus

from .conftest import make_settings
from .test_orchestrator import Fake, build, run


def rq(*texts, source="fr", include_pending=False, tag=None):
    return TranslateRequest(source_lang=source, target_lang="tt", options=TranslateOptions(include_pending=include_pending),
                            segments=[Segment(id=str(i), text=t, context=ElementContext(tag=tag)) for i, t in enumerate(texts)])


MEM_FIRST = lambda g, m: [MemoryProvider(m), GlossaryProvider(g)]


def test_default_provider_order_puts_validated_memory_before_glossary_before_machine():
    names = Settings(_env_file=None).provider_names
    assert names.index("memory") < names.index("glossary") < min(names.index(n) for n in ("openai_compat", "anthropic", "nllb"))


def test_validated_memory_has_priority_over_validated_glossary(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, MEM_FIRST)
    r = run(orch, rq("Solde"))[0]                      # présent dans les DEUX : mémoire = « MEM-BAL », glossaire = « BAL »
    assert (r.translation, r.origin, r.translation_status) == ("MEM-BAL", "memory", TranslationStatus.APPROVED)
    orch2, _ = build(custom_data, tmp_path, lambda g, m: [GlossaryProvider(g), MemoryProvider(m)])
    assert run(orch2, rq("Solde"))[0].translation == "BAL"      # l'ordre est bien celui configuré


def test_glossary_used_when_memory_has_no_match_and_machine_is_not_called(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="MT"))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g), fake])
    r = run(orch, rq("Quatre"))[0]
    assert (r.translation, r.origin, r.concept_id) == ("T-FOUR", "glossary", "c.four") and fake.calls == []


def test_machine_engine_is_used_only_when_nothing_validated_exists(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="Traduction automatique de " + i.text))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g), fake])
    r = run(orch, rq("Solde", "Phrase inconnue du glossaire"))
    assert r[0].origin == "memory" and r[1].origin == "provider"
    assert (r[1].status, r[1].translation_status) == (Status.MACHINE_UNVALIDATED, TranslationStatus.AUTOMATIC)
    assert fake.calls == [["Phrase inconnue du glossaire"]]


def test_automatic_is_never_presented_as_approved(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="Traduction simulée", validated=True))   # le moteur « prétend » être validé
    orch, _ = build(custom_data, tmp_path, lambda g, m: [fake])
    r = run(orch, rq("Texte quelconque ici"))[0]
    assert r.translation_status == TranslationStatus.AUTOMATIC and r.status == Status.MACHINE_UNVALIDATED


def test_unavailable_when_no_provider_can_process(custom_data, tmp_path):
    def boom(i):
        raise RuntimeError("moteur hors service")
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g), Fake(boom)])
    r = run(orch, rq("Texte inconnu du glossaire"))[0]
    assert (r.translation_status, r.translation, r.reason.value) == (TranslationStatus.UNAVAILABLE, None, "provider_error")
    orch2, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g)])      # aucun moteur configuré
    r2 = run(orch2, rq("Texte inconnu du glossaire"))[0]
    assert r2.translation_status == TranslationStatus.UNAVAILABLE and r2.reason.value == "no_validated_translation"
    assert "no_machine_provider_for_language" in r2.notes


def test_five_statuses_are_distinguished_in_one_request(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="Auto " + i.text))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g), fake], allow_machine_translation=False)
    texts = ["Solde", "Frais", "Rejeter", "Retour", "Texte inconnu du glossaire"]
    r = {x.id: x for x in run(orch, rq(*texts, include_pending=True))}
    got = [r[str(i)].translation_status for i in range(5)]
    assert got == [TranslationStatus.APPROVED, TranslationStatus.PENDING_VALIDATION, TranslationStatus.REJECTED,
                   TranslationStatus.UNAVAILABLE, TranslationStatus.UNAVAILABLE]
    assert r["1"].translation == "FEES-PENDING" and r["2"].translation is None and r["2"].reason.value == "rejected_translation"
    orch_m, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g), fake])
    assert run(orch_m, rq("Texte inconnu du glossaire"))[0].translation_status == TranslationStatus.AUTOMATIC   # le 5ᵉ : automatic


def test_pending_human_proposal_is_hidden_by_default_and_never_shown_as_approved(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g)])
    r = run(orch, rq("Frais"))[0]
    assert r.translation is None and r.reason.value == "pending_validation_only" and r.translation_status == TranslationStatus.UNAVAILABLE
    shown = run(orch, rq("Frais", include_pending=True))[0]
    assert shown.translation == "FEES-PENDING" and shown.translation_status == TranslationStatus.PENDING_VALIDATION
    assert shown.status == Status.MACHINE_UNVALIDATED and "human_translation_pending_validation" in shown.notes   # jamais « validated »


def test_pending_wins_over_machine_only_when_allowed_and_approved_wins_over_pending(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="Auto " + i.text))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g), fake])
    assert run(orch, rq("Frais"))[0].translation_status == TranslationStatus.AUTOMATIC                      # pending masqué → machine
    assert run(orch, rq("Frais", include_pending=True))[0].translation_status == TranslationStatus.PENDING_VALIDATION
    assert run(orch, rq("Solde", include_pending=True))[0].translation_status == TranslationStatus.APPROVED


def test_rejected_translation_is_never_displayed(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MemoryProvider(m), GlossaryProvider(g)])
    r = run(orch, rq("Rejeter", include_pending=True))[0]
    assert r.translation is None and r.translation_status == TranslationStatus.REJECTED and r.entry_id


def test_source_languages_never_mix(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, MEM_FIRST)
    assert run(orch, rq("Four", source="fr"))[0].translation == "T-OVEN"
    assert run(orch, rq("Four", source="en"))[0].translation == "T-FOUR"
    assert run(orch, rq("Oven", source="fr"))[0].translation_status == TranslationStatus.UNAVAILABLE


def test_search_resolves_french_and_english_wordings_to_the_same_concept(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, MEM_FIRST)
    fr = run(orch, rq("Compte", source="fr"))[0]
    en = run(orch, rq("Account", source="en"))[0]
    assert (fr.concept_id, en.concept_id) == ("c.alt", "c.alt") and fr.translation == en.translation == "ACC"
    assert fr.alternatives == ["ACC-ALT"]                       # variante acceptée exposée


def test_protected_data_stays_intact_with_validated_memory(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, MEM_FIRST)
    r = run(orch, rq("Vous avez reçu 5 000 FCFA"))[0]
    assert r.translation == "MEM 5 000 FCFA" and "amount" in r.protected


# ------------------------------------------------------------------ API : recherche + statut canonique
def test_api_exposes_canonical_status_and_legacy_status(client):
    r = client.post("/api/v1/translate", json={"source_lang": "fr", "target_lang": "xx-test", "segments": [
        {"id": "a", "text": "Envoyer de l'argent"}, {"id": "b", "text": "Phrase inconnue du glossaire"}, {"id": "c", "text": "12 500 F"}]}).json()["results"]
    assert [(x["translation_status"], x["status"]) for x in r] == [("approved", "validated"), ("automatic", "machine_unvalidated"), (None, "unchanged")]
    assert r[0]["concept_id"] == "ui.envoyer_de_l_argent"
    ff = client.post("/api/v1/translate", json={"source_lang": "fr", "target_lang": "ff", "segments": [{"id": "a", "text": "Solde"}]}).json()["results"][0]
    assert (ff["translation_status"], ff["reason"]) == ("unavailable", "no_validated_translation")   # gabarit : aucune traduction fournie


def test_api_search_by_concept_id_and_by_wording(client):
    by_concept = client.get("/api/v1/glossary", params={"target": "ff", "concept_id": "balance"}).json()
    assert {e["source_text"] for e in by_concept["entries"]} == {"solde", "solde disponible", "balance", "available balance"}
    fr = client.get("/api/v1/glossary/lookup", params={"text": "Solde", "lang": "fr", "target": "ff"}).json()
    en = client.get("/api/v1/glossary/lookup", params={"text": "Balance", "lang": "en", "target": "ff"}).json()
    assert {e["concept_id"] for e in fr["entries"]} == {e["concept_id"] for e in en["entries"]} == {"balance"}
    assert client.get("/api/v1/glossary/lookup", params={"text": "Balance", "lang": "fr", "target": "ff"}).json()["entries"] == []
    assert client.get("/api/v1/glossary/lookup", params={"text": "x", "lang": "de"}).status_code == 400
    c = client.get("/api/v1/glossary/concepts/balance", params={"target": "ff"}).json()
    assert c["sources"]["fr"] and c["sources"]["en"] and c["targets"][0]["status"] == "pending_validation"
    assert client.get("/api/v1/glossary/concepts/inexistant").status_code == 404


def test_api_referentiel_status_and_admin_reload(client, settings):
    st = client.get("/api/v1/referentiel").json()
    assert st["glossary"]["targets_by_status"]["ff"]["pending_validation"] > 40 and st["glossary"]["load_errors"] == []
    assert client.post("/api/v1/referentiel/reload").status_code == 403
    # un import en ligne de commande est pris en compte après rechargement
    from pathlib import Path
    from app.referentiel.importer import ImportOptions, import_document
    from app.referentiel.store import ReferentielStore
    fx = Path(__file__).parent / "fixtures" / "glossary_valid.json"
    assert import_document(fx, ReferentielStore(settings.data_dir, settings.state_dir), ImportOptions(allow_fixture=True)).accepted
    assert client.post("/api/v1/referentiel/reload", headers={"X-DL-Admin-Token": "admin-secret"}).json()["reloaded"]
    assert client.get("/api/v1/glossary/lookup", params={"text": "Alpha fictif", "lang": "fr"}).json()["entries"][0]["status"] == "approved"


def test_api_starts_with_a_broken_glossary_file_and_reports_it(tmp_path):
    s = make_settings(tmp_path)
    (s.data_dir / "glossary" / "zz.json").write_text('{"language": "zz", "entries": [{"id": "a"}]}')
    c = TestClient(create_app(s))
    assert c.get("/api/v1/health").json()["load_errors"] == 1
    assert c.get("/api/v1/referentiel").json()["glossary"]["load_errors"][0]["code"] == "legacy_format"
    assert c.post("/api/v1/translate", json={"source_lang": "fr", "target_lang": "xx-test", "segments": [{"id": "a", "text": "Confirmer"}]}).status_code == 200
