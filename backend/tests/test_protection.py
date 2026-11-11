import json

from app.core.config import REPO_ROOT
from app.services.protection import has_translatable_letters, mask_text, placeholders_of, unmask

VECTORS = json.loads((REPO_ROOT / "shared" / "protection_vectors.json").read_text(encoding="utf-8"))


def test_vectors_roundtrip_and_masking():
    for v in VECTORS:
        r = mask_text(v["input"])
        assert r.masked == v["masked"]
        assert unmask(r.masked, r.tokens) == v["input"]


def test_amounts_phones_ids_protected():
    r = mask_text("Envoi de 5 000 FCFA vers 677 12 34 56, réf. TX-2026-000123")
    assert "5 000" not in r.masked and "677" not in r.masked and "TX-2026" not in r.masked
    assert {"amount", "phone", "identifier"} <= set(r.kinds)


def test_secrets_never_survive():
    for t in ["PIN: 4821", "Votre code OTP est 123456", "mot de passe : S3cret!", "password=hunter2"]:
        r = mask_text(t)
        for secret in ["4821", "123456", "S3cret!", "hunter2"]:
            assert secret not in r.masked
        assert "secret" in r.kinds


def test_plain_text_untouched():
    assert mask_text("Envoyer de l'argent").masked == "Envoyer de l'argent"


def test_external_placeholders_preserved_and_new_ones_do_not_collide():
    r = mask_text("Reçu {{P0}} de {{P1}} le 12/10/2026")
    assert "{{P0}}" in r.masked and "{{P1}}" in r.masked
    assert list(r.tokens) == ["{{P2}}"]
    assert placeholders_of(r.masked) == {"{{P0}}": 1, "{{P1}}": 1, "{{P2}}": 1}
    assert unmask(r.masked, r.tokens) == "Reçu {{P0}} de {{P1}} le 12/10/2026"


def test_translatable_letters():
    assert not has_translatable_letters("{{P0}}")
    assert not has_translatable_letters("{{P0}} / {{P1}}")
    assert has_translatable_letters("{{P0}} reçus")
