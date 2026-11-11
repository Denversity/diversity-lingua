"""Appariement « à gabarit » des phrases à variables de la mémoire (GlossaryService.lookup).

Données TECHNIQUES fictives (langue « tt », textes « MEM … ») : aucun contenu linguistique réel.
"""
import json

import pytest

from app.services.glossary import GlossaryService

from .conftest import make_doc, tgt


def seg(sid, text, target, status="approved", lang="fr"):
    return {"segment_id": sid, "source": {"lang": lang, "text": text}, "targets": [tgt(target, status=status, target_id="t." + sid)]}


@pytest.fixture
def mem(tmp_path):
    d = tmp_path / "memory"
    d.mkdir()
    doc = make_doc("translation-memory", "segments", [
        seg("pay", "Vous allez payer {{P0}} FCFA à {{P1}}.", "PAY {{P1}} / {{P0}} FCFA"),
        seg("hello", "Bonjour, {{P0}}", "SALUT {{P0}}"),
        seg("copy", "Copie {{P0}} puis {{P0}}", "COPIE {{P0}} {{P0}}"),
        seg("bare", "{{P0}}", "BARE {{P0}}"),
        seg("thanks_a", "Merci {{P0}}", "MERCI-A {{P0}}"),
        seg("thanks_b", "Merci {{P0}}", "MERCI-B {{P0}}"),
        seg("soon", "Bientôt {{P0}}", "BIENTOT {{P0}}", status="pending_validation"),
        seg("exact", "Bonjour", "EXACT"),
        seg("exact2", "Bonjour Amina", "EXACT-AMINA"),
        seg("en_pay", "You will pay {{P0}} FCFA to {{P1}}.", "EN-PAY {{P1}} {{P0}}", lang="en"),
    ])
    (d / "tt.json").write_text(json.dumps(doc), encoding="utf-8")
    return GlossaryService(d, tmp_path / "state", allow_test=True, name="memory")


def look(g, text, lang="fr"):
    return g.lookup(text, lang, "tt", set())


def test_tokens_are_remapped_to_the_request_and_the_absorbed_currency_is_not_duplicated(mem):
    r = look(mem, "Vous allez payer {{P3}} à {{P5}}.")
    assert r.tier == "approved" and r.rendered == "PAY {{P5}} / {{P3}}"  # ordre de l'expert conservé, devise absorbée par le jeton


def test_free_slot_accepts_proper_names_only(mem):
    assert look(mem, "Bonjour, Amina Diallo").rendered == "SALUT Amina Diallo"
    assert look(mem, "Bonjour, Jean de Dieu").rendered == "SALUT Jean de Dieu"
    for refused in ("Bonjour, cher client", "Bonjour, 3 amis", "Bonjour, Amina a b c d e"):
        assert look(mem, refused).entry is None, refused


def test_exact_match_wins_over_template(mem):
    r = look(mem, "Bonjour Amina")
    assert r.entry.translation == "EXACT-AMINA" and r.rendered is None


def test_repeated_variable_must_have_the_same_value(mem):
    assert look(mem, "Copie Amina puis Amina").rendered == "COPIE Amina Amina"
    assert look(mem, "Copie Amina puis Zoe").entry is None


def test_template_without_enough_letters_is_exact_only(mem):
    assert look(mem, "Quelque chose").entry is None
    assert look(mem, "Merci").entry is None


def test_ambiguous_templates_abstain(mem):
    r = look(mem, "Merci Amina")
    assert r.entry is None and r.reason == "ambiguous_context"


def test_pending_template_keeps_its_status_and_is_rendered(mem):
    r = look(mem, "Bientôt Amina")
    assert r.tier == "pending_validation" and r.rendered == "BIENTOT Amina"


def test_source_languages_do_not_mix_for_templates(mem):
    assert look(mem, "You will pay {{P0}} to {{P1}}", "en").rendered == "EN-PAY {{P1}} {{P0}}"
    assert look(mem, "You will pay {{P0}} to {{P1}}", "fr").entry is None
    assert look(mem, "Vous allez payer {{P0}} à {{P1}}", "en").entry is None


def test_reload_rebuilds_templates(mem):
    n = sum(len(v) for v in mem._templates.values())
    assert n >= 6
    mem.reload()
    assert sum(len(v) for v in mem._templates.values()) == n
