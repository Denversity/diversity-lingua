"""Phase 2 — évolutions additives de l'API : explication enrichie, signalement catégorisé. Contrats existants inchangés."""
import json


def explain(client, text, lang="fr", target="xx-test", **kw):
    return client.post("/api/v1/explain", json={"text": text, "source_lang": lang, "target_lang": target, **kw}).json()


def test_explain_returns_example_and_term_translation_without_engine(client):
    r = explain(client, "Solde insuffisant", target="ff")
    assert r["found"] and r["concept_id"] == "insufficient_balance"
    assert r["example_source"] and "FCFA" in r["example_source"]
    assert r["explanation_source_reviewed"] is False                      # jamais présenté comme officiel
    assert r["term_translation"]["translation_status"] == "unavailable"   # Fulfulde : rien d'approuvé
    assert r["translation"]["translation_status"] == "unavailable"


def test_explain_english_uses_english_text(client):
    r = explain(client, "transaction fee", lang="en", target="ff")
    assert r["concept_id"] == "fees" and "fee" in r["example_source"].lower()

def test_explain_uses_validated_fulfulde_periphrase(tmp_path):
    from fastapi.testclient import TestClient
    from app.core.config import REPO_ROOT, Settings
    from app.main import create_app

    settings = Settings(
        _env_file=None,
        data_dir=REPO_ROOT / "data",
        state_dir=tmp_path / "state",
        provider_order="memory,glossary",
    )
    client = TestClient(create_app(settings))
    data = json.loads((REPO_ROOT / "data/fulfulde_explanations.json").read_text(encoding="utf-8"))
    entry = data["entries"][0]

    for lang, term, expected_lang in (("fr", entry["francais"], "fr"), ("en", entry["anglais"], "en"),
                                      ("en", entry["francais"], "fr")):
        r = explain(client, term, lang=lang, target="ff")
        assert r["found"] and r["translation"]["translation"] == entry["periphrase_descriptive"]
        assert r["source_lang"] == expected_lang
        assert r["translation"]["translation_status"] == "approved"
        assert r["translation"]["origin"] == "glossary"
        assert r["translation"]["entry_id"] == entry["id"]


def test_explain_term_translation_uses_approved_resources_only_by_default(client):
    r = explain(client, "Envoyer de l'argent", target="xx-test")
    assert r["term_translation"]["translation_status"] == "approved" and r["term_translation"]["test_data"] is True
    assert r["term_translation"]["origin"] in ("glossary", "memory")


def test_explain_never_calls_machine_unless_asked(client, settings):
    # provider_order de test = memory,glossary,mock : le mock « traduirait » toute phrase de la langue de test
    off = explain(client, "Le plafond journalier est atteint", target="xx-test")
    assert off["term_translation"]["translation_status"] == "unavailable"
    on = explain(client, "Le plafond journalier est atteint", target="xx-test", allow_machine=True)
    assert on["term_translation"]["translation_status"] == "automatic"


def test_explain_unknown_term_is_explicit(client):
    r = explain(client, "xylophone quantique", target="ff")
    assert r["found"] is False and r["explanation_source"] is None and r["example_source"] is None


def test_feedback_accepts_category_and_is_never_applied(client, settings):
    body = {"source_lang": "fr", "target_lang": "ff", "source_text": "Solde disponible", "shown_translation": "x", "suggested_translation": "y",
            "category": "terminology", "concept_id": "balance", "translation_status": "automatic"}
    assert client.post("/api/v1/feedback", json=body).status_code == 202
    rec = json.loads((settings.state_dir / "feedback.jsonl").read_text().splitlines()[-1])
    assert rec["status"] == "pending_review" and rec["category"] == "terminology" and rec["concept_id"] == "balance"
    assert client.get("/api/v1/glossary/export", params={"target": "ff"}).json()["entries"] == []   # jamais ajouté au glossaire


def test_feedback_rejects_unknown_category_and_still_works_without_new_fields(client):
    bad = {"source_lang": "fr", "target_lang": "ff", "source_text": "x", "category": "inconnue"}
    assert client.post("/api/v1/feedback", json=bad).status_code == 422
    old = {"source_lang": "fr", "target_lang": "ff", "source_text": "x"}                 # contrat historique
    assert client.post("/api/v1/feedback", json=old).status_code == 202


def test_every_concept_has_an_example_in_both_languages():
    from app.core.config import REPO_ROOT
    for c in json.loads((REPO_ROOT / "data/concepts.json").read_text(encoding="utf-8"))["concepts"]:
        assert c["example"]["fr"] and c["example"]["en"], c["id"]
