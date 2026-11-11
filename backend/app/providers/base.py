"""Interface commune TranslationProvider — l'extension et l'orchestrateur ne dépendent que d'elle."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from ..services.classifier import ContextInfo
from ..services.languages import LanguageConfig


@dataclass
class ProviderItem:
    id: str
    text: str  # texte MASQUÉ (jetons {{Pn}}) — aucune donnée sensible
    context: ContextInfo
    hints: list[tuple[str, str]] = field(default_factory=list)  # (source, cible) validés à respecter


@dataclass
class ProviderResult:
    text: str | None
    validated: bool = False  # True uniquement pour glossaire/mémoire (entrées validées par un humain)
    confidence: float | None = None
    test_data: bool = False
    entry_id: str | None = None
    uncertain: bool = False
    reason: str | None = None  # ambiguous_context, …
    human_status: str | None = None  # pending_validation | rejected (entrées humaines non approuvées)
    alternatives: list[str] = field(default_factory=list)
    concept_id: str | None = None


class TranslationProvider(ABC):
    name: str = "base"
    kind: str = "machine"  # glossary | memory | machine

    @abstractmethod
    def is_configured(self) -> bool: ...

    def supports(self, source: str, target: str, language: LanguageConfig) -> bool:
        return True

    @abstractmethod
    async def translate(self, items: list[ProviderItem], source: str, target: str,
                        language: LanguageConfig) -> dict[str, ProviderResult]: ...

    def describe(self) -> dict:
        return {"name": self.name, "kind": self.kind, "configured": self.is_configured()}
