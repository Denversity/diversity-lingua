import asyncio

from app.eval.compare import chrf, import_corpus, load_corpus, evaluate_engine
from .conftest import make_settings


def test_chrf_properties():
    assert chrf("abc def", "abcdef") == 1.0
    assert chrf("xyz", "abc") == 0.0
    assert 0 < chrf("abcdxx", "abcdef") < 1


def test_import_validates_and_normalizes(tmp_path):
    src = tmp_path / "c.csv"
    src.write_text("source_lang,target_lang,source,reference\nfr,ff,Solde,REF\n", encoding="utf-8")
    dest = import_corpus(src, "demo", tmp_path / "out")
    assert load_corpus(dest)[0]["reference"] == "REF"
    bad = tmp_path / "b.csv"
    bad.write_text("source_lang,target_lang,source,reference\nfr,ff,Solde,\n", encoding="utf-8")
    try:
        load_corpus(bad)
        assert False
    except ValueError as e:
        assert "ligne 1" in str(e)


def test_compare_engines_on_technical_corpus(tmp_path):
    from app.core.config import REPO_ROOT
    rows = load_corpus(REPO_ROOT / "data" / "corpus" / "technical-fixture.json")
    s = make_settings(tmp_path)
    g = asyncio.run(evaluate_engine(s, "glossary", rows))
    m = asyncio.run(evaluate_engine(s, "mock", rows))
    o = asyncio.run(evaluate_engine(s, "openai_compat", rows))
    assert g["validated_rate"] == 0.75 and g["abstention_rate"] == 0.25 and g["protected_data_lost"] == 0
    assert g["by_translation_status"] == {"approved": 3, "unavailable": 1}
    assert m["coverage"] == 1.0 and m["validated_rate"] == 0
    assert o["configured"] is False  # jamais de résultat inventé pour un moteur non configuré
