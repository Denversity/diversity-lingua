import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import REPO_ROOT, Settings
from app.main import create_app

# Jeu de données « gabarit » (état avant intégration des ressources Safinum) : les tests historiques
# supposent un Fulfulde sans traduction validée. Les vraies ressources (data/) sont testées dans test_integration_resources.py.
TEMPLATE_DATA = Path(__file__).parent / "fixtures" / "template_data"

VALID = {"validator_id": "fixture-validator", "validated_at": "2026-01-01T00:00:00+00:00", "method": "technical_fixture"}


def make_settings(tmp_path: Path, real_data: bool = False, **kw) -> Settings:
    """Copie TEMPORAIRE des données : les écritures (validation, import) ne touchent jamais data/ du dépôt."""
    data = tmp_path / "data"
    if not data.exists():
        shutil.copytree(REPO_ROOT / "data" if real_data else TEMPLATE_DATA, data)
    base = dict(state_dir=tmp_path / "state", data_dir=data, provider_order="memory,glossary,mock",
                admin_token="admin-secret", openai_api_key=None, anthropic_api_key=None, rate_limit_per_min=1000)
    base.update(kw)
    return Settings(_env_file=None, **base)


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings))


def tgt(preferred, status="approved", contexts=(), target_id=None, accepted=()):
    t = {"contexts": list(contexts), "preferred": preferred, "accepted": list(accepted), "status": status}
    if target_id:
        t["target_id"] = target_id
    if status == "approved":
        t["validation"] = dict(VALID)
    return t


def concept(cid, fr, en, targets, contexts=()):
    srcs = {"fr": {"preferred": fr, "accepted": []}}
    if en:
        srcs["en"] = {"preferred": en, "accepted": []}
    return {"concept_id": cid, "contexts": list(contexts), "sources": srcs, "targets": targets}


def make_doc(kind, key, items, language="tt", **extra):
    meta = {"language": language, "variety": "v", "dataset_version": "1", "fixture": True}
    return {"schema": f"diversity-lingua/{kind}", "schema_version": "1.0.0", "meta": meta, key: items, **extra}


@pytest.fixture
def custom_data(tmp_path):
    """data_dir technique (langue « tt », fixtures FICTIVES) : contexte, ambiguïté, mélange fr/en, statuts."""
    d = tmp_path / "cdata"
    for sub in ("glossary", "memory"):
        (d / sub).mkdir(parents=True)
    (d / "languages.json").write_text(json.dumps({"source_languages": [{"code": "fr", "name": "F"}, {"code": "en", "name": "E"}],
        "target_languages": [{"code": "tt", "name": "Tech", "native_name": "Tech", "iso639_3": None, "variety": "v",
                              "script": "Latn", "orthography": "", "availability": "partial",
                              "machine_translation": "allowed", "low_resource": True}]}))
    (d / "concepts.json").write_text(json.dumps({"concepts": [], "ui_phrases": []}))
    gl = make_doc("glossary", "concepts", [
        concept("c.send", "Envoyer", "Send", [tgt("SEND-BTN", contexts=["button"], target_id="t.send.btn"),
                                              tgt("SEND-HEAD", contexts=["heading"], target_id="t.send.head")]),
        concept("c.balance", "Solde", "Balance", [tgt("BAL", target_id="t.balance")]),
        concept("c.fees", "Frais", "Fees", [tgt("FEES-PENDING", status="pending_validation", target_id="t.fees")]),
        concept("c.back", "Retour", "Back", [tgt(None, status="pending_validation", target_id="t.back")]),
        concept("c.bad", "Rejeter", "Reject", [tgt("BAD", status="rejected", target_id="t.bad")]),
        concept("c.oven", "Four", "Oven", [tgt("T-OVEN", target_id="t.oven")]),
        concept("c.four", "Quatre", "Four", [tgt("T-FOUR", target_id="t.four")]),
        concept("c.alt", "Compte", "Account", [tgt("ACC", target_id="t.acc", accepted=["ACC-ALT"])]),
    ])
    (d / "glossary" / "tt.json").write_text(json.dumps(gl))
    mem = make_doc("translation-memory", "segments", [
        {"segment_id": "m1", "source": {"lang": "fr", "text": "Vous avez reçu {{P0}}"}, "targets": [tgt("MEM {{P0}}", target_id="tm1")]},
        {"segment_id": "m2", "source": {"lang": "fr", "text": "Solde"}, "targets": [tgt("MEM-BAL", target_id="tm2")]},
    ])
    (d / "memory" / "tt.json").write_text(json.dumps(mem))
    return d
