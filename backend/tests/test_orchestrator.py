import asyncio

import httpx
import pytest

from app.core.config import Settings
from app.providers.anthropic import AnthropicProvider
from app.providers.base import ProviderResult, TranslationProvider
from app.providers.lookup_providers import GlossaryProvider, MemoryProvider
from app.providers.mock import MockProvider
from app.providers.openai_compat import OpenAICompatProvider
from app.schemas import ElementContext, Segment, Status, TranslateRequest
from app.services.glossary import GlossaryService
from app.services.languages import LanguageService
from app.services.orchestrator import Orchestrator

from .conftest import make_settings


class Fake(TranslationProvider):
    kind = "machine"

    def __init__(self, fn, name="fake"):
        self.fn, self.name, self.calls = fn, name, []

    def is_configured(self):
        return True

    async def translate(self, items, source, target, language):
        self.calls.append([i.text for i in items])
        return {i.id: self.fn(i) for i in items}


def build(custom_data, tmp_path, providers_fn, **kw):
    s = make_settings(tmp_path, data_dir=custom_data, **kw)
    langs = LanguageService(custom_data / "languages.json")
    gl = GlossaryService(custom_data / "glossary", tmp_path / "st")
    mem = GlossaryService(custom_data / "memory", tmp_path / "st", name="memory")
    provs = providers_fn(gl, mem)
    return Orchestrator(s, langs, provs, gl), provs


def req(*texts, target="tt", **kw):
    return TranslateRequest(source_lang="fr", target_lang=target,
                            segments=[Segment(id=str(i), text=t, context=ElementContext(tag=kw.get("tag"))) for i, t in enumerate(texts)])


def run(orch, r):
    return asyncio.run(orch.translate(r, "rid")).results


def test_priority_glossary_then_memory_then_machine(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="MT " + i.text))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [GlossaryProvider(g), MemoryProvider(m), fake])
    r = run(orch, req("Solde", "Vous avez reçu 5 000 FCFA", "Quelque chose d'autre"))
    assert (r[0].status, r[0].origin, r[0].translation) == (Status.VALIDATED, "glossary", "BAL")
    assert (r[1].status, r[1].origin) == (Status.VALIDATED, "memory")
    assert r[1].translation == "MEM 5 000 FCFA"  # montant restauré, intact
    assert r[2].status == Status.MACHINE_UNVALIDATED and r[2].origin == "provider"
    assert fake.calls == [["Quelque chose d'autre"]]  # le fournisseur IA ne reçoit que le reste


def test_machine_output_never_validated_even_if_provider_claims_it(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="Traduction simulée", validated=True))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [fake])
    assert run(orch, req("Bonjour tout le monde"))[0].status == Status.MACHINE_UNVALIDATED


def test_sensitive_data_never_reaches_provider_and_is_restored(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="TR " + i.text))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [fake])
    text = "Envoi de 5 000 FCFA au 677 12 34 56 (PIN: 4821), réf. TX-2026-000123"
    r = run(orch, req(text))[0]
    sent = fake.calls[0][0]
    for secret in ["5 000", "677", "4821", "TX-2026", "FCFA"]:
        assert secret not in sent
    for kept in ["5 000 FCFA", "677 12 34 56", "4821", "TX-2026-000123"]:
        assert kept in r.translation
    assert {"amount", "phone", "secret", "identifier"} <= set(r.protected)


def test_integrity_failure_triggers_fallback_then_abstention(custom_data, tmp_path):
    bad = Fake(lambda i: ProviderResult(text="perdu"), "bad")  # supprime les jetons
    good = Fake(lambda i: ProviderResult(text=i.text + " ok"), "good")
    orch, _ = build(custom_data, tmp_path, lambda g, m: [bad, good])
    r = run(orch, req("Solde de {{P0}} restant"))[0]
    assert r.provider == "good"
    orch2, _ = build(custom_data, tmp_path, lambda g, m: [bad])
    r2 = run(orch2, req("Total de 500 F"))[0]
    assert r2.status == Status.UNAVAILABLE and r2.reason.value == "integrity_check_failed" and r2.translation is None


def test_provider_error_and_timeout_are_survivable(custom_data, tmp_path):
    def boom(i):
        raise RuntimeError("net")
    r = run(build(custom_data, tmp_path, lambda g, m: [Fake(boom)])[0], req("Bonjour à tous"))[0]
    assert r.status == Status.UNAVAILABLE and r.reason.value == "provider_error"

    class Slow(Fake):
        async def translate(self, *a, **k):
            await asyncio.sleep(2)
    orch, _ = build(custom_data, tmp_path, lambda g, m: [Slow(lambda i: None)], provider_timeout_s=0.05)
    assert run(orch, req("Bonjour à tous"))[0].reason.value == "provider_error"


def test_uncertain_abstains(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, lambda g, m: [Fake(lambda i: ProviderResult(text=None, uncertain=True))])
    assert run(orch, req("Bonjour à tous"))[0].reason.value == "provider_uncertain"


def test_context_ambiguity_reported(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, lambda g, m: [GlossaryProvider(g)])
    assert run(orch, req("Envoyer", tag="p"))[0].reason.value == "ambiguous_context"
    assert run(orch, req("Envoyer", tag="button"))[0].translation == "SEND-BTN"


def test_unchanged_for_numbers_only(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MockProvider()])
    r = run(orch, req("12 500 F", "677 12 34 56"))
    assert all(x.status == Status.UNCHANGED for x in r) and r[0].translation == "12 500 F"


def test_machine_can_be_disabled(custom_data, tmp_path):
    fake = Fake(lambda i: ProviderResult(text="X"))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [GlossaryProvider(g), fake], allow_machine_translation=False)
    r = run(orch, req("Bonjour à tous"))[0]
    assert r.status == Status.UNAVAILABLE and r.reason.value == "machine_translation_disabled" and fake.calls == []


def test_unknown_languages_are_explicit(custom_data, tmp_path):
    orch, _ = build(custom_data, tmp_path, lambda g, m: [MockProvider()])
    assert run(orch, req("Bonjour", target="zz"))[0].reason.value == "language_unavailable"
    r = TranslateRequest(source_lang="de", target_lang="tt", segments=[Segment(id="1", text="Hallo")])
    assert run(orch, r)[0].reason.value == "unsupported_source_language"


def test_mock_refuses_real_languages(settings):
    from app.core.config import REPO_ROOT
    langs = LanguageService(REPO_ROOT / "data" / "languages.json")
    assert not MockProvider().supports("fr", "ff", langs.target("ff"))
    assert MockProvider().supports("fr", "xx-test", langs.target("xx-test"))


# ---------------------------------------------------------- fournisseurs HTTP (transport simulé)
def _settings(tmp_path, **kw):
    return make_settings(tmp_path, **kw)


def test_openai_compat_provider_request_and_parsing(tmp_path, custom_data):
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"choices": [{"message": {"content":
            '```json\n{"results":[{"id":"0","translation":"T {{P0}}","uncertain":false},{"id":"1","translation":null,"uncertain":true}]}\n```'}}]})
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    s = _settings(tmp_path, openai_api_key="k", openai_model="m")
    prov = OpenAICompatProvider(s, client)
    assert prov.is_configured()
    orch, _ = build(custom_data, tmp_path, lambda g, m: [prov])
    r = run(orch, req("Total {{P0}}", "Autre phrase"))
    assert r[0].status == Status.MACHINE_UNVALIDATED and r[0].translation == "T {{P0}}"
    assert r[1].reason.value == "provider_uncertain"
    assert seen["auth"] == "Bearer k"
    assert "Tech" in seen["body"] and "{{P0}}" in seen["body"]  # langue cible et jetons transmis au fournisseur


def test_anthropic_provider_request_and_parsing(tmp_path, custom_data):
    seen = {}

    def handler(request: httpx.Request):
        seen["key"] = request.headers.get("x-api-key")
        return httpx.Response(200, json={"content": [{"type": "text", "text": '{"results":[{"id":"0","translation":"AT","uncertain":false}]}'}]})
    prov = AnthropicProvider(_settings(tmp_path, anthropic_api_key="ak", anthropic_model="m"),
                             httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    orch, _ = build(custom_data, tmp_path, lambda g, m: [prov])
    assert run(orch, req("Bonjour à tous"))[0].translation == "AT" and seen["key"] == "ak"


def test_unconfigured_providers_are_not_called_and_reported_honestly(tmp_path):
    s = _settings(tmp_path)
    assert not OpenAICompatProvider(s).is_configured()
    assert not AnthropicProvider(s).is_configured()
    from app.providers.nllb import NllbProvider
    assert not NllbProvider(_settings(tmp_path, nllb_model="x")).is_configured()  # licence non reconnue
    assert NllbProvider(_settings(tmp_path, nllb_model="x", local_model_license_ack=True)).is_configured()


def test_http_error_from_provider_becomes_abstention(tmp_path, custom_data):
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    prov = OpenAICompatProvider(_settings(tmp_path, openai_api_key="k", openai_model="m"), client)
    orch, _ = build(custom_data, tmp_path, lambda g, m: [prov])
    assert run(orch, req("Bonjour à tous"))[0].reason.value == "provider_error"
