"""Tests d'intégration sur les ressources linguistiques réelles.

Aucune traduction Fulfulde n'est écrite dans ce fichier : les valeurs attendues sont relues dans les livrables
de l'expert archivés dans data/references/linguistic-delivery/. Les écritures éventuelles se font sur une copie
temporaire de data/ (cf. conftest.make_settings(real_data=True)).
"""
import json
import re
import shutil

import pytest
from fastapi.testclient import TestClient

from app.core.config import REPO_ROOT
from app.main import create_app

from .conftest import make_settings

DELIVERED = REPO_ROOT / "data" / "references" / "linguistic-delivery"
SRC_GLOSSARY = json.loads((DELIVERED / "safinum_glossary_v1.json").read_text(encoding="utf-8"))
SRC_MEMORY = json.loads((DELIVERED / "safinum_translation_memory_v1.json").read_text(encoding="utf-8"))
LIVE_GLOSSARY = REPO_ROOT / "data" / "glossary" / "ff.json"
LIVE_MEMORY = REPO_ROOT / "data" / "memory" / "ff.json"

# Les trois ambiguïtés signalées par le linguiste : (concept, cible approuvée, cible en attente)
CONFLICTS = [("fin_fin_0036", "FIN-0036", "FIN-0122"),
             ("fin_fin_0045", "FIN-0045", "FIN-0143"),
             ("fin_fin_0116", "FIN-0116", "FIN-0139")]


def _concept(doc, cid):
    return next(c for c in doc["concepts"] if c["concept_id"] == cid)


def _target(concept, tid):
    return next(t for t in concept["targets"] if t["target_id"] == tid)


@pytest.fixture
def api(tmp_path):
    return TestClient(create_app(make_settings(tmp_path, real_data=True, provider_order="memory,glossary")))


def tr(api, texts, src="fr", **options):
    r = api.post("/api/v1/translate", json={"source_lang": src, "target_lang": "ff", "options": options,
                                            "segments": [{"id": str(i), "text": t} for i, t in enumerate(texts)]})
    assert r.status_code == 200, r.text
    return r.json()["results"]


def mem_target(source_text, lang="fr"):
    s = next(s for s in SRC_MEMORY["segments"] if s["source"]["lang"] == lang and s["source"]["text"] == source_text)
    return s["targets"][0]["preferred"]


def glo_target(concept_id):
    return _concept(SRC_GLOSSARY, concept_id)["targets"][0]["preferred"]


# ------------------------------------------------------------------ 1. intégrité de l'import
def test_import_counts_and_no_duplicates():
    g = json.loads(LIVE_GLOSSARY.read_text(encoding="utf-8"))
    m = json.loads(LIVE_MEMORY.read_text(encoding="utf-8"))
    ids = [c["concept_id"] for c in g["concepts"]]
    assert len(ids) == len(set(ids))
    delivered_ids = {c["concept_id"] for c in SRC_GLOSSARY["concepts"]}
    assert len(delivered_ids) == 147 and delivered_ids <= set(ids)
    sids = [s["segment_id"] for s in m["segments"]]
    assert len(sids) == len(set(sids)) == 234
    assert sum(s["source"]["lang"] == "fr" for s in m["segments"]) == 117 == sum(s["source"]["lang"] == "en" for s in m["segments"])
    assert g["meta"]["dataset_version"] == m["meta"]["dataset_version"] == "1.0.0"
    assert g["meta"]["language"] == m["meta"]["language"] == "ff" and g["meta"]["variety"] == "adamawa"


def test_runtime_resources_match_archive_except_documented_user_override():
    """Garde-fou : seule la correction utilisateur documentée déroge aux livrables archivés."""
    g = json.loads(LIVE_GLOSSARY.read_text(encoding="utf-8"))
    for c in SRC_GLOSSARY["concepts"]:
        live = _concept(g, c["concept_id"])
        assert [(t["target_id"], t["preferred"], t["accepted"], t["status"]) for t in live["targets"]] == \
               [(t["target_id"], t["preferred"], t["accepted"], t["status"]) for t in c["targets"]]
        assert live["sources"] == c["sources"]
    m = json.loads(LIVE_MEMORY.read_text(encoding="utf-8"))
    live_m = {s["segment_id"]: s for s in m["segments"]}
    for s in SRC_MEMORY["segments"]:
        assert s["source"] == live_m[s["segment_id"]]["source"]
        if s["segment_id"] in {"PH-0019-fr", "PH-0019-en"}:
            target = live_m[s["segment_id"]]["targets"][0]
            assert (target["preferred"], target["status"], target["version"]) == ("ɓaawo", "approved", 3)
            assert target["history"][0]["preferred"] == "Caggal"
            assert any(item["preferred"] == "baawo" for item in target["history"])
        else:
            assert [(t["preferred"], t["accepted"], t["status"]) for t in s["targets"]] == \
                   [(t["preferred"], t["accepted"], t["status"]) for t in live_m[s["segment_id"]]["targets"]]


def test_referentiel_endpoint_reports_loaded_resources(api):
    d = api.get("/api/v1/referentiel").json()
    assert d["glossary"]["load_errors"] == [] and d["memory"]["load_errors"] == []
    assert d["glossary"]["versions"]["ff"] == "1.0.0" and d["memory"]["versions"]["ff"] == "1.0.0"
    assert d["glossary"]["targets_by_status"]["ff"]["approved"] == 147
    assert d["glossary"]["targets_by_status"]["ff"]["pending_validation"] >= 3
    assert d["memory"]["targets_by_status"]["ff"] == {"approved": 234}


# ------------------------------------------------------------------ 2. recherche exacte fr / en, mémoire, glossaire
def test_exact_search_french_and_english_in_memory(api):
    fr, en = tr(api, ["Annuler"], "fr")[0], tr(api, ["Cancel"], "en")[0]
    assert fr["translation"] == mem_target("Annuler") and fr["translation_status"] == "approved" and fr["provider"] == "memory"
    assert en["translation"] == mem_target("Cancel", "en") and en["translation_status"] == "approved"


def test_back_translation_uses_project_requested_ɓaawo(api):
    fr, en = tr(api, ["Retour"], "fr")[0], tr(api, ["Back"], "en")[0]
    assert fr["translation"] == en["translation"] == "ɓaawo"
    assert fr["translation_status"] == en["translation_status"] == "approved"

def test_short_greetings_translate_in_both_source_languages(api):
    fr, en = tr(api, ["Bonjour, Mariam"], "fr")[0], tr(api, ["Hello, Mariam"], "en")[0]
    assert fr["translation"] == en["translation"] == "Jam waali, Mariam"
    assert fr["translation_status"] == en["translation_status"] == "approved"


def test_exact_search_in_glossary_fr_and_en(api):
    fr = tr(api, ["paiement chez un commerçant"], "fr")[0]
    en = tr(api, ["merchant payment"], "en")[0]
    assert fr["provider"] == en["provider"] == "glossary" and fr["translation_status"] == "approved"
    assert fr["translation"] == en["translation"] == glo_target("fin_fin_0036")


def test_fees_other_bank_and_account_number_are_available_in_both_source_languages(api):
    fees_fr = tr(api, ["Frais"], "fr")[0]
    fees_en = tr(api, ["Fee", "Fees"], "en")
    bank_fr = tr(api, ["Autre banque"], "fr")[0]
    bank_en = tr(api, ["Other bank"], "en")[0]
    account_fr = tr(api, ["Numéro de compte"], "fr")[0]
    account_en = tr(api, ["Account number"], "en")[0]

    assert fees_fr["translation_status"] == "approved"
    assert fees_en[0]["translation"] == fees_en[1]["translation"] == fees_fr["translation"]
    assert all(r["translation_status"] == "approved" for r in fees_en)
    assert bank_fr["translation"] == bank_en["translation"] == "Banki feere"
    assert bank_fr["translation_status"] == bank_en["translation_status"] == "approved"
    assert all(r["translation"] for r in (account_fr, account_en))
    assert account_fr["translation_status"] == account_en["translation_status"] == "approved"


def test_source_languages_are_not_mixed(api):
    r = tr(api, ["Cancel"], "fr")[0]  # forme anglaise soumise comme français
    assert r["translation"] is None and r["translation_status"] == "unavailable"


def test_lookup_endpoint_finds_wording_in_both_stores(api):
    d = api.get("/api/v1/glossary/lookup", params={"text": "Annuler", "lang": "fr", "target": "ff"}).json()
    assert d["memory"] and d["memory"][0]["translation"] == mem_target("Annuler")
    d = api.get("/api/v1/glossary/lookup", params={"text": "Operation", "lang": "en", "target": "ff"}).json()
    by_id = {e["target_id"]: e for e in d["entries"]}
    assert by_id["FIN-0045"]["status"] == "approved" and by_id["FIN-0143"]["status"] == "pending_validation"
    # le gabarit d'origine contient aussi un concept « transaction » vide : jamais une traduction (voir PROGRESS.md)
    extras = [e for tid, e in by_id.items() if tid not in ("FIN-0045", "FIN-0143")]
    assert all(e["translation"] is None and e["status"] == "pending_validation" for e in extras)


# ------------------------------------------------------------------ 3. priorité mémoire > glossaire
OVERLAPS = [("Envoyer de l'argent", "fr"), ("Send money", "en"), ("Historique des transactions", "fr"), ("Log out", "en")]


@pytest.mark.parametrize("text,lang", OVERLAPS)
def test_memory_has_priority_over_glossary_on_real_resources(api, tmp_path, text, lang):
    r = tr(api, [text], lang)[0]
    assert r["provider"] == "memory" and r["translation"] == mem_target(text, lang)
    # contre-épreuve : si le glossaire passait en premier, la traduction serait différente (divergence réelle des ressources)
    inv = TestClient(create_app(make_settings(tmp_path / "inv", real_data=True, provider_order="glossary,memory")))
    other = tr(inv, [text], lang)[0]
    assert other["provider"] == "glossary" and other["translation"] != r["translation"]


# ------------------------------------------------------------------ 4. les trois conflits linguistiques
@pytest.mark.parametrize("cid,approved,pending", CONFLICTS)
def test_conflict_statuses_are_preserved_in_the_live_data(cid, approved, pending):
    g = json.loads(LIVE_GLOSSARY.read_text(encoding="utf-8"))
    c = _concept(g, cid)
    assert _target(c, approved)["status"] == "approved"
    p = _target(c, pending)
    assert p["status"] == "pending_validation" and not (p.get("validation") or {}).get("validator_id")


@pytest.mark.parametrize("cid,approved,pending", CONFLICTS)
def test_pending_variant_is_never_displayed_by_default(api, cid, approved, pending):
    c = _concept(SRC_GLOSSARY, cid)
    pend_text, appr_text = _target(c, pending)["preferred"], _target(c, approved)["preferred"]
    for lang in ("fr", "en"):
        form = c["sources"][lang]["preferred"]
        for opts in ({}, {"include_pending": True}):  # même si on demande les propositions en attente : l'approuvée l'emporte
            r = tr(api, [form], lang, **opts)[0]
            assert r["translation"] == appr_text and r["translation_status"] == "approved"
            assert pend_text not in json.dumps(r, ensure_ascii=False)


@pytest.mark.parametrize("cid,approved,pending", CONFLICTS)
def test_pending_variant_stays_searchable_with_explicit_status(api, cid, approved, pending):
    d = api.get("/api/v1/glossary", params={"concept_id": cid, "target": "ff"}).json()
    by_target = {e["target_id"]: e["status"] for e in d["entries"]}
    assert by_target[approved] == "approved" and by_target[pending] == "pending_validation"
    concept = api.get(f"/api/v1/glossary/concepts/{cid}", params={"target": "ff"}).json()
    assert {t["target_id"]: t["status"] for t in concept["targets"]} == {approved: "approved", pending: "pending_validation"}


def test_pending_cannot_be_promoted_without_admin_decision(api):
    r = api.post("/api/v1/glossary/validate", json={"entry_id": "ff:FIN-0122|fr|0", "decision": "validate", "validator_id": "x"})
    assert r.status_code in (401, 403, 422)  # jeton administrateur requis : pas de promotion implicite
    g = json.loads(LIVE_GLOSSARY.read_text(encoding="utf-8"))
    assert _target(_concept(g, "fin_fin_0036"), "FIN-0122")["status"] == "pending_validation"


def test_template_concepts_without_translation_never_produce_text(api):
    from app.services.textnorm import normalize
    tpl = json.loads((REPO_ROOT / "backend/tests/fixtures/template_data/glossary/ff.json").read_text(encoding="utf-8"))
    covered = {(l, normalize(f)) for c in SRC_GLOSSARY["concepts"] for l, s in c["sources"].items()
               for f in [s["preferred"], *s.get("accepted", [])]}
    covered |= {(s["source"]["lang"], normalize(s["source"]["text"])) for s in SRC_MEMORY["segments"]}
    empty = [c for c in tpl["concepts"] if all(not t.get("preferred") for t in c["targets"])]
    only_template = [(l, s["preferred"]) for c in empty for l, s in c["sources"].items()
                     if (l, normalize(s["preferred"])) not in covered]
    assert len(only_template) >= 15  # concepts du gabarit sans équivalent livré
    for lang, form in only_template:
        r = tr(api, [form], lang)[0]
        assert r["translation"] is None and r["translation_status"] == "unavailable", (lang, form)


# ------------------------------------------------------------------ 5. variables et données protégées
def test_template_phrases_restore_amount_phone_and_name(api):
    fr = tr(api, ["Vous allez envoyer 5 000 FCFA à 677123456.", "Vous allez envoyer 5 000 FCFA à Amina Bello.",
                  "Bienvenue, Amina"])
    for r in fr:
        assert r["translation_status"] == "approved" and r["provider"] == "memory" and "{{P" not in r["translation"]
    assert "5 000 FCFA" in fr[0]["translation"] and "677123456" in fr[0]["translation"]
    assert fr[0]["translation"].count("FCFA") == 1  # la devise n'est pas dupliquée
    assert "Amina Bello" in fr[1]["translation"] and fr[2]["translation"].endswith("Amina")
    # le texte fixe est celui de l'expert (jetons remplacés par les valeurs, rien d'autre)
    expect = mem_target("Vous allez envoyer {{P0}} FCFA à {{P1}}.").replace("{{P0}}", "5 000").replace("{{P1}}", "677123456")
    assert fr[0]["translation"] == expect


def test_english_template_phrases(api):
    r = tr(api, ["You are about to send 12,500 FCFA to 677123456."], "en")[0]
    assert r["translation_status"] == "approved" and "12,500 FCFA" in r["translation"] and "677123456" in r["translation"]


def test_full_receipt_with_amount_name_date_reference(api):
    t = "Vous avez envoyé 5 000 FCFA à Amina Bello le 05/11/2026. Référence : TRX-48291."
    r = tr(api, [t])[0]
    assert r["translation_status"] == "approved"
    for kept in ("5 000 FCFA", "Amina Bello", "05/11/2026", "TRX-48291"):
        assert kept in r["translation"], kept
    assert "{{P" not in r["translation"]


def test_fees_and_total_values_are_preserved(api):
    r = tr(api, ["Montant envoyé : 5 000 FCFA. Frais : 150 FCFA.", "Total à payer : 5 150 FCFA."])
    assert "5 000 FCFA" in r[0]["translation"] and "150 FCFA" in r[0]["translation"]
    assert "5 150 FCFA" in r[1]["translation"]
    assert all(x["translation_status"] == "approved" for x in r)


def test_already_masked_input_from_the_extension_keeps_its_tokens(api):
    r = tr(api, ["Vous allez envoyer {{P0}} à {{P1}}.", "Bienvenue, {{P0}}"])
    assert r[0]["translation"].count("{{P0}}") == 1 and r[0]["translation"].count("{{P1}}") == 1
    assert "FCFA" not in r[0]["translation"]  # le jeton externe contient déjà la devise
    assert r[1]["translation"].count("{{P0}}") == 1


def test_free_lowercase_text_in_a_variable_slot_abstains(api):
    r = tr(api, ["Bienvenue, cher client"])[0]
    assert r["translation"] is None and r["translation_status"] == "unavailable"


@pytest.mark.parametrize("text,secret", [("Votre code PIN : 4821", "4821"), ("OTP : 482913", "482913"),
                                         ("Entrez le code 123456 reçu par SMS", "123456")])
def test_secrets_are_protected_and_never_echoed(api, text, secret):
    r = tr(api, [text])[0]
    assert secret not in json.dumps(r, ensure_ascii=False)
    assert r["translation_status"] == "unavailable"


def test_reference_and_phone_stay_intact_in_machine_output(tmp_path):
    """Avec un moteur configuré mais injoignable, rien n'est inventé ; les valeurs protégées ne fuient pas."""
    s = make_settings(tmp_path, real_data=True, provider_order="memory,glossary,openai_compat", openai_api_key="k",
                      openai_model="m", openai_base_url="http://127.0.0.1:9/v1", provider_timeout_s=3)
    r = tr(TestClient(create_app(s)), ["Transfert vers 677123456, référence TRX-48291, PIN: 4821"])[0]
    blob = json.dumps(r, ensure_ascii=False)
    assert r["translation"] is None and r["translation_status"] == "unavailable"
    assert "4821" not in blob


# ------------------------------------------------------------------ 6. texte inconnu et moteur indisponible
def test_unknown_text_is_unavailable_with_explicit_reason(api):
    r = tr(api, ["Texte totalement inconnu qui ne figure dans aucune ressource"])[0]
    assert r["status"] == "unavailable" and r["translation"] is None and r["reason"] == "no_validated_translation"


def test_machine_engine_unavailable_does_not_break_and_never_claims_validation(tmp_path):
    s = make_settings(tmp_path, real_data=True, provider_order="memory,glossary,openai_compat,anthropic,nllb")
    api = TestClient(create_app(s))
    r = tr(api, ["Texte inconnu", "Annuler"])
    assert r[0]["translation"] is None and r[0]["translation_status"] == "unavailable"
    assert r[1]["translation_status"] == "approved"  # les ressources validées continuent de fonctionner


def test_failing_engine_is_survived_and_reported(tmp_path):
    s = make_settings(tmp_path, real_data=True, provider_order="memory,glossary,openai_compat", openai_api_key="k",
                      openai_model="m", openai_base_url="http://127.0.0.1:9/v1", provider_timeout_s=3)
    r = tr(TestClient(create_app(s)), ["Texte inconnu", "Annuler"])
    assert r[0]["translation"] is None and r[0]["reason"] == "provider_error"
    assert r[1]["translation_status"] == "approved"


# ------------------------------------------------------------------ 7. rechargement
def test_reload_picks_up_changes_on_disk(tmp_path):
    s = make_settings(tmp_path, real_data=True, provider_order="memory,glossary")
    api = TestClient(create_app(s))
    hdr = {"X-DL-Admin-Token": "admin-secret"}
    assert tr(api, ["Annuler"])[0]["translation_status"] == "approved"
    assert api.post("/api/v1/referentiel/reload", headers=hdr).json()["memory_errors"] == 0
    assert tr(api, ["Annuler"])[0]["translation"] == mem_target("Annuler")
    (s.data_dir / "memory" / "ff.json").unlink()  # copie temporaire uniquement
    assert api.post("/api/v1/referentiel/reload", headers=hdr).json()["reloaded"] is True
    assert tr(api, ["Annuler"])[0]["translation_status"] == "unavailable"
    assert api.post("/api/v1/referentiel/reload").status_code == 403  # sans jeton admin


def test_corrupted_resource_does_not_prevent_startup(tmp_path):
    s = make_settings(tmp_path, real_data=True, provider_order="memory,glossary")
    (s.data_dir / "memory" / "ff.json").write_text("{ pas du json", encoding="utf-8")
    api = TestClient(create_app(s))
    assert api.get("/api/v1/referentiel").json()["memory"]["load_errors"]
    assert tr(api, ["paiement chez un commerçant"])[0]["translation_status"] == "approved"  # le glossaire reste servi


# ------------------------------------------------------------------ 8. export vers l'extension : jamais de pending
def test_export_for_extension_contains_only_approved(api):
    d = api.get("/api/v1/glossary/export", params={"target": "ff"}).json()
    pend = {_target(_concept(SRC_GLOSSARY, cid), pending)["preferred"] for cid, _, pending in CONFLICTS}
    assert d["entries"] and not ({e["translation"] for e in d["entries"]} & pend)
    assert len({e["concept_id"] for e in d["entries"]}) == 147
