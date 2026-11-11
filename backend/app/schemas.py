"""Schémas Pydantic de l'API v1."""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Status(str, Enum):
    VALIDATED = "validated"  # validée par un locuteur natif / validateur (glossaire, mémoire)
    MACHINE_UNVALIDATED = "machine_unvalidated"  # générée automatiquement, NON validée
    UNAVAILABLE = "unavailable"  # le système s'abstient
    UNCHANGED = "unchanged"  # rien à traduire (nombres, identifiants…)


class TranslationStatus(str, Enum):
    """Statut canonique (contrat linguistique). `status` (v1 historique) en est dérivé."""
    APPROVED = "approved"  # validé par un humain (mémoire / glossaire)
    AUTOMATIC = "automatic"  # produit par un moteur automatique, NON validé
    PENDING_VALIDATION = "pending_validation"  # proposition humaine pas encore validée
    UNAVAILABLE = "unavailable"  # le système s'abstient
    REJECTED = "rejected"  # la seule traduction connue a été rejetée par un validateur


_LEGACY = {"approved": "validated", "automatic": "machine_unvalidated", "pending_validation": "machine_unvalidated",
           "unavailable": "unavailable", "rejected": "unavailable"}


class Reason(str, Enum):
    NO_VALIDATED_TRANSLATION = "no_validated_translation"
    NO_PROVIDER_CONFIGURED = "no_provider_configured"
    PROVIDER_ERROR = "provider_error"
    INTEGRITY_CHECK_FAILED = "integrity_check_failed"
    LOW_CONFIDENCE = "low_confidence"
    UNCERTAIN = "provider_uncertain"
    AMBIGUOUS_CONTEXT = "ambiguous_context"
    LANGUAGE_UNAVAILABLE = "language_unavailable"
    UNSUPPORTED_SOURCE = "unsupported_source_language"
    MACHINE_DISABLED = "machine_translation_disabled"
    PENDING_ONLY = "pending_validation_only"
    REJECTED = "rejected_translation"


class ElementContext(BaseModel):
    kind: Literal["text", "attribute"] = "text"
    attr: str | None = Field(None, max_length=32)
    tag: str | None = Field(None, max_length=32)
    role: str | None = Field(None, max_length=32)
    region: str | None = Field(None, max_length=32)  # nav, main, dialog, alert, table…


class Segment(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1)
    context: ElementContext | None = None


class TranslateOptions(BaseModel):
    allow_machine: bool = True
    include_pending: bool = False  # afficher les traductions humaines en attente (statut pending_validation)


class TranslateRequest(BaseModel):
    source_lang: str = Field(min_length=2, max_length=16)
    target_lang: str = Field(min_length=2, max_length=16)
    segments: list[Segment] = Field(min_length=1)
    options: TranslateOptions = TranslateOptions()

    @model_validator(mode="after")
    def _unique_ids(self):
        ids = [s.id for s in self.segments]
        if len(ids) != len(set(ids)):
            raise ValueError("segment ids must be unique")
        return self


class SegmentResult(BaseModel):
    id: str
    translation: str | None = None
    status: Status
    origin: Literal["glossary", "memory", "provider", "none"] = "none"
    provider: str | None = None
    confidence: float | None = None
    test_data: bool = False
    reason: Reason | None = None
    protected: list[str] = []  # types d'éléments protégés côté serveur (jamais leurs valeurs)
    entry_id: str | None = None
    notes: list[str] = []
    translation_status: TranslationStatus | None = None  # canonique ; None = « unchanged » (rien à traduire)
    concept_id: str | None = None
    alternatives: list[str] = []  # variantes acceptées (glossaire/mémoire)

    @model_validator(mode="after")
    def _fill_status(self):
        if self.translation_status is None:
            m = {Status.VALIDATED: TranslationStatus.APPROVED, Status.MACHINE_UNVALIDATED: TranslationStatus.AUTOMATIC,
                 Status.UNAVAILABLE: TranslationStatus.UNAVAILABLE}
            self.translation_status = m.get(self.status)
        return self


class TranslateResponse(BaseModel):
    request_id: str
    source_lang: str
    target_lang: str
    results: list[SegmentResult]
    summary: dict[str, int]
    took_ms: int


class ExplainRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    source_lang: str = Field(min_length=2, max_length=16)
    target_lang: str = Field(min_length=2, max_length=16)
    allow_machine: bool = False  # par défaut : AUCUN appel à un moteur externe pour une explication


class ExplainResponse(BaseModel):
    found: bool
    concept_id: str | None = None
    term: str | None = None
    source_lang: str | None = None
    explanation_source: str | None = None  # explication simple dans la langue source
    explanation_source_reviewed: bool = False
    translation: SegmentResult | None = None  # traduction de l'explication (statut explicite)
    example_source: str | None = None  # exemple concret, dans la langue source
    term_translation: SegmentResult | None = None  # traduction du TERME (approuvée si elle existe ; pas de moteur par défaut)


class ValidateRequest(BaseModel):
    entry_id: str
    decision: Literal["validate", "reject"]
    validator_id: str = Field(min_length=1, max_length=64)
    translation: str | None = Field(None, max_length=2000)  # correction éventuelle
    method: Literal["native_speaker", "panel", "corpus_import"] = "native_speaker"


class FeedbackRequest(BaseModel):
    category: Literal["meaning", "naturalness", "terminology", "other"] | None = None
    concept_id: str | None = Field(None, max_length=120)
    translation_status: Literal["approved", "automatic", "pending_validation", "unavailable", "rejected"] | None = None
    source_lang: str
    target_lang: str
    source_text: str = Field(max_length=2000)
    shown_translation: str | None = Field(None, max_length=2000)
    suggested_translation: str | None = Field(None, max_length=2000)
    comment: str | None = Field(None, max_length=1000)
