"""Fournisseur SIMULÉ — tests techniques uniquement.

Ne produit AUCUNE traduction réelle : il préfixe le texte avec « [TEST~] ». Il refuse de traiter
toute langue qui n'est pas une langue de test (availability == test_only), afin qu'une sortie
factice ne soit jamais confondue avec du Fulfulde.
"""
from __future__ import annotations

from ..services.languages import LanguageConfig
from .base import ProviderItem, ProviderResult, TranslationProvider


class MockProvider(TranslationProvider):
    name, kind = "mock", "machine"

    def is_configured(self) -> bool:
        return True

    def supports(self, source: str, target: str, language: LanguageConfig) -> bool:
        return language.is_test

    async def translate(self, items, source, target, language):
        return {it.id: ProviderResult(text=f"[TEST~] {it.text}", validated=False, test_data=True) for it in items}
