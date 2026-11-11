"""Fournisseurs « déterministes » : mémoire de traduction et glossaire (contrat v1.0.0)."""
from __future__ import annotations

from ..services.glossary import GlossaryService
from ..services.languages import LanguageConfig
from .base import ProviderItem, ProviderResult, TranslationProvider


class _LookupProvider(TranslationProvider):
    def __init__(self, service: GlossaryService):
        self.service = service

    def is_configured(self) -> bool:
        return True

    def supports(self, source: str, target: str, language: LanguageConfig) -> bool:
        return any(e.target_lang == target for e in self.service.entries.values())

    async def translate(self, items, source, target, language):
        out: dict[str, ProviderResult] = {}
        for it in items:
            res = self.service.lookup(it.text, source, target, it.context.tags)
            e = res.entry
            if res.reason == "ambiguous_context":
                out[it.id] = ProviderResult(text=None, reason="ambiguous_context")
            elif res.tier == "approved" and e:
                out[it.id] = ProviderResult(text=res.rendered or e.translation, validated=True, test_data=e.test_data, entry_id=e.id,
                                            alternatives=(res.rendered_alternatives if res.rendered else e.alternatives) or [],
                                            concept_id=e.concept_id)
            elif res.tier == "pending_validation" and e:
                out[it.id] = ProviderResult(text=res.rendered or e.translation, human_status="pending_validation", test_data=e.test_data,
                                            entry_id=e.id,
                                            alternatives=(res.rendered_alternatives if res.rendered else e.alternatives) or [],
                                            concept_id=e.concept_id)
            elif res.tier == "rejected" and e:
                out[it.id] = ProviderResult(text=None, human_status="rejected", entry_id=e.id, concept_id=e.concept_id)
        return out

    def describe(self) -> dict:
        d = super().describe()
        d["targets_by_language"] = self.service.stats()
        d["load_errors"] = len(self.service.load_errors)
        return d


class GlossaryProvider(_LookupProvider):
    name, kind = "glossary", "glossary"


class MemoryProvider(_LookupProvider):
    name, kind = "memory", "memory"
