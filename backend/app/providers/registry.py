"""Sélection et priorité des fournisseurs — pilotées par DL_PROVIDER_ORDER, sans toucher l'extension."""
from __future__ import annotations

from ..core.config import Settings
from ..services.glossary import GlossaryService
from .anthropic import AnthropicProvider
from .base import TranslationProvider
from .lookup_providers import GlossaryProvider, MemoryProvider
from .mock import MockProvider
from .nllb import NllbProvider
from .openai_compat import OpenAICompatProvider


def build_providers(settings: Settings, glossary: GlossaryService, memory: GlossaryService) -> list[TranslationProvider]:
    factories = {
        "glossary": lambda: GlossaryProvider(glossary),
        "memory": lambda: MemoryProvider(memory),
        "openai_compat": lambda: OpenAICompatProvider(settings),
        "anthropic": lambda: AnthropicProvider(settings),
        "nllb": lambda: NllbProvider(settings),
        "mock": lambda: MockProvider(),
    }
    out: list[TranslationProvider] = []
    for name in settings.provider_names:
        if name not in factories:
            raise ValueError(f"Fournisseur inconnu dans DL_PROVIDER_ORDER : {name}")
        if name == "mock" and not settings.allow_test_data:
            continue
        out.append(factories[name]())
    return out
