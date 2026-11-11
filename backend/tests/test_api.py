import json

from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import make_settings


def post(client, segs, target="xx-test", **kw):
    return client.post("/api/v1/translate", json={"source_lang": "fr", "target_lang": target, "segments": segs}, **kw)


def test_health_and_languages_expose_honest_state(client):
    h = client.get("/api/v1/health").json()
    assert h["status"] == "ok"
    names = {p["name"]: p["configured"] for p in h["providers"]}
    assert names["glossary"] is True and "openai_compat" not in names  # ordre de test = glossary,memory,mock
    langs = {l["code"]: l for l in client.get("/api/v1/languages").json()["target_languages"]}
    assert langs["ff"]["availability"] == "awaiting_validation" and langs["ff"]["validated_entries"] == 0
    assert langs["ff"]["pending_entries"] > 40
    assert langs["xx-test"]["availability"] == "test_only"


def test_health_never_leaks_secrets(tmp_path):
    c = TestClient(create_app(make_settings(tmp_path, openai_api_key="sk-SECRET", openai_model="m",
                                            provider_order="glossary,openai_compat", admin_token="adm-SECRET")))
    blob = json.dumps([c.get("/api/v1/health").json(), c.get("/api/v1/providers").json()])
    assert "SECRET" not in blob
    assert {p["name"]: p["configured"] for p in c.get("/api/v1/providers").json()["providers"]}["openai_compat"] is True


def test_translate_fulfulde_without_validated_corpus_abstains(client):
    r = post(client, [{"id": "a", "text": "Envoyer de l'argent"}], target="ff").json()
    res = r["results"][0]
    assert res["status"] == "unavailable" and res["translation"] is None
    assert r["summary"] == {"unavailable": 1}


def test_translate_test_locale_statuses_and_protection(client):
    r = post(client, [{"id": "a", "text": "Envoyer de l'argent", "context": {"tag": "button"}},
                      {"id": "b", "text": "Vous avez reçu 5 000 FCFA de 677 12 34 56"},
                      {"id": "c", "text": "2 500 F"}]).json()["results"]
    assert (r[0]["status"], r[0]["test_data"]) == ("validated", True)
    assert r[1]["status"] == "machine_unvalidated" and "5 000 FCFA" in r[1]["translation"] and "677 12 34 56" in r[1]["translation"]
    assert r[2]["status"] == "unchanged"


def test_request_validation_and_limits(client, tmp_path):
    assert post(client, []).status_code == 422
    assert post(client, [{"id": "a", "text": "x"}, {"id": "a", "text": "y"}]).status_code == 422
    assert post(client, [{"id": "a", "text": "x"}], target="zz").json()["error"]["code"] == "unknown_target_language"
    small = TestClient(create_app(make_settings(tmp_path, max_segments=2, max_segment_chars=10)))
    assert post(small, [{"id": str(i), "text": "x"} for i in range(3)]).status_code == 413
    assert post(small, [{"id": "a", "text": "x" * 11}]).json()["error"]["code"] == "segment_too_long"


def test_validation_error_does_not_echo_user_text(client):
    r = client.post("/api/v1/translate", json={"source_lang": "fr", "target_lang": "ff", "segments": [{"id": "a", "text": "SECRET-123", "context": {"kind": "bogus"}}]})
    assert r.status_code == 422 and "SECRET-123" not in r.text


def test_api_token_and_rate_limit(tmp_path):
    c = TestClient(create_app(make_settings(tmp_path, api_token="tok", rate_limit_per_min=3)))
    assert post(c, [{"id": "a", "text": "Bonjour"}]).status_code == 401
    assert c.get("/api/v1/health").status_code == 200  # santé publique
    h = {"X-DL-Token": "tok"}
    codes = [post(c, [{"id": "a", "text": "Bonjour"}], headers=h).status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200] and codes[3:] == [429, 429]


def test_cors_allows_extension_origin_only(client):
    ok = client.options("/api/v1/translate", headers={"Origin": "chrome-extension://abc", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "chrome-extension://abc"
    bad = client.options("/api/v1/translate", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_logs_never_contain_segment_text(client):
    import logging

    from app.core.logging import JsonFormatter

    records = []

    class H(logging.Handler):
        def emit(self, record):
            records.append(JsonFormatter().format(record))
    h = H()
    logging.getLogger("dl").addHandler(h)
    try:
        post(client, [{"id": "a", "text": "Mon PIN: 4821 et 5 000 FCFA"}])
    finally:
        logging.getLogger("dl").removeHandler(h)
    out = "\n".join(records)
    assert "translate" in out and "4821" not in out and "5 000" not in out and "PIN" not in out


def test_glossary_listing_export_and_validation_flow(client):
    g = client.get("/api/v1/glossary", params={"target": "ff", "limit": 3}).json()
    assert g["total"] > 100 and len(g["entries"]) == 3 and g["entries"][0]["status"] == "pending_validation"
    assert client.get("/api/v1/glossary/export", params={"target": "ff"}).json()["entries"] == []
    eid = g["entries"][0]["id"]
    body = {"entry_id": eid, "decision": "validate", "validator_id": "native-1", "translation": "VALIDATION-TECHNIQUE"}
    assert client.post("/api/v1/glossary/validate", json=body).status_code == 403
    assert client.post("/api/v1/glossary/validate", json=body, headers={"X-DL-Admin-Token": "wrong"}).status_code == 403
    ok = client.post("/api/v1/glossary/validate", json=body, headers={"X-DL-Admin-Token": "admin-secret"})
    assert ok.status_code == 200 and ok.json()["entry"]["status"] == "approved"
    exp = client.get("/api/v1/glossary/export", params={"target": "ff"}).json()["entries"]
    assert eid in [e["id"] for e in exp] and {e["translation"] for e in exp} == {"VALIDATION-TECHNIQUE"}
    assert client.post("/api/v1/glossary/validate", json=body | {"entry_id": "nope"},
                       headers={"X-DL-Admin-Token": "admin-secret"}).status_code == 404


def test_explain_known_and_unknown(client):
    ok = client.post("/api/v1/explain", json={"text": "Solde insuffisant", "source_lang": "fr", "target_lang": "ff"}).json()
    assert ok["found"] and ok["concept_id"] == "insufficient_balance"
    assert ok["translation"]["status"] == "unavailable"  # pas de traduction validée en Fulfulde
    assert ok["explanation_source_reviewed"] is False
    unknown = client.post("/api/v1/explain", json={"text": "blablabla inconnu", "source_lang": "fr", "target_lang": "ff"}).json()
    assert unknown["found"] is False and unknown["concept_id"] is None and unknown["explanation_source"] is None   # (champs additifs phase 2 tolérés)


def test_feedback_is_queued_not_applied(client, settings):
    r = client.post("/api/v1/feedback", json={"source_lang": "fr", "target_lang": "ff", "source_text": "Solde", "suggested_translation": "x"})
    assert r.status_code == 202
    line = json.loads((settings.state_dir / "feedback.jsonl").read_text().splitlines()[0])
    assert line["status"] == "pending_review"
    assert client.get("/api/v1/glossary/export", params={"target": "ff"}).json()["entries"] == []


def test_prod_mode_hides_test_language_and_mock(tmp_path):
    c = TestClient(create_app(make_settings(tmp_path, allow_test_data=False, env="prod")))
    codes = [l["code"] for l in c.get("/api/v1/languages").json()["target_languages"]]
    assert codes == ["ff"]
    assert post(c, [{"id": "a", "text": "Bonjour"}], target="xx-test").status_code == 400
