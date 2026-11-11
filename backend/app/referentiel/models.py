"""Contrat d'intégration du référentiel linguistique (v1.0.0).

SOURCE UNIQUE : ces modèles produisent les schémas JSON publiés dans `schemas/` (scripts/export_schemas.py)
et servent à la validation à l'import. Six types de documents :
  glossary · translation-memory · corpus · benchmark · corrections · language-profile
Langues sources : fr, en. Langue cible : ff (variété : adamawa). Aucun champ ne contient de traduction
fournie par l'équipe technique : `preferred: null` est un état valide (en attente du linguiste).
"""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

CONTRACT_VERSION = "1.0.0"
SOURCE_LANGS = ("fr", "en")
SourceLang = Literal["fr", "en"]
TARGET_VARIETIES = {"ff": "adamawa"}  # langue cible → variété exigée (extensible sans toucher au code métier)
PLACEHOLDER_RE = re.compile(r"\{\{P\d+\}\}")

ConceptId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*(?:[.\-][a-z0-9_]+)*$", max_length=120)]
ItemId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:~|\-]*$", max_length=160)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Version = Annotated[int, Field(ge=1)]

EntryStatus = Literal["pending_validation", "approved", "rejected", "deprecated"]
Method = Literal["native_speaker", "panel", "community_review", "import", "technical_fixture"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Provenance(Strict):
    author: str | None = None
    organization: str | None = None
    source_document: str | None = None
    method: Method | None = None
    date: str | None = Field(None, description="ISO 8601 (AAAA-MM-JJ)")
    license: str | None = None
    notes: str | None = None


class Validation(Strict):
    validator_id: str | None = None
    validated_at: str | None = Field(None, description="ISO 8601")
    method: Method | None = None
    comment: str | None = None


class HistoryItem(Strict):
    """Version antérieure conservée (jamais supprimée) lors d'une mise à jour."""
    version: Version
    status: EntryStatus
    preferred: str | None = None
    accepted: list[str] = []
    validation: Validation = Validation()
    replaced_at: str | None = None
    replaced_by: str | None = Field(None, description="Import ou action ayant remplacé cette version")


class Target(Strict):
    """Traduction cible (ff/adamawa) — éventuellement propre à des contextes métier."""
    target_id: ItemId | None = Field(None, description="Si absent, attribué à l'import : <concept_id>~tN")
    contexts: list[str] = Field([], description="Vide = valable dans tous les contextes")
    preferred: str | None = Field(None, max_length=2000, description="Forme recommandée ; null = pas encore fournie")
    accepted: list[Text] = Field([], description="Variantes acceptées")
    status: EntryStatus = "pending_validation"
    validation: Validation = Validation()
    version: Version = 1
    history: list[HistoryItem] = []
    provenance: Provenance | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _rules(self):
        if self.preferred is not None and not self.preferred.strip():
            raise ValueError("preferred ne doit pas être une chaîne vide (utiliser null)")
        if self.accepted and self.preferred is None:
            raise ValueError("des variantes acceptées exigent une forme preferred")
        if self.preferred is not None and self.preferred in self.accepted:
            raise ValueError("preferred ne doit pas être répété dans accepted")
        if len(set(self.accepted)) != len(self.accepted):
            raise ValueError("variantes acceptées dupliquées")
        if self.status == "approved":
            if self.preferred is None:
                raise ValueError("status=approved exige une traduction preferred")
            if not (self.validation.validator_id and self.validation.validated_at):
                raise ValueError("status=approved exige validation.validator_id et validation.validated_at")
        return self


class SourceForms(Strict):
    preferred: Text
    accepted: list[Text] = []


class SourceText(Strict):
    lang: SourceLang
    text: Text


class Meta(Strict):
    language: str = Field(pattern=r"^[a-z]{2,3}(?:-[a-z0-9]+)?$", description="Langue cible (ff)")
    variety: str = Field(min_length=1, description="adamawa pour ff")
    source_languages: list[SourceLang] = ["fr", "en"]
    dataset_version: str = Field(min_length=1, max_length=40, description="ex. 2026.11.0")
    created_at: str | None = None
    provenance: Provenance | None = None
    fixture: bool = Field(False, description="True = données techniques fictives, refusées en production")
    notes: str | None = None

    @model_validator(mode="after")
    def _variety(self):
        want = TARGET_VARIETIES.get(self.language)
        if want and self.variety != want:
            raise ValueError(f"pour la langue {self.language}, variety doit valoir « {want} »")
        return self


class _Doc(Strict):
    schema_version: str = Field(pattern=r"^1\.\d+\.\d+$", description="Version majeure 1 requise")


# --------------------------------------------------------------------------- glossaire
class Concept(Strict):
    concept_id: ConceptId
    domain: str | None = None
    contexts: list[str] = Field([], description="Contextes métier du concept (button, transfer, fees…)")
    definition: dict[SourceLang, str] | None = None
    sources: dict[SourceLang, SourceForms] = Field(min_length=1)
    targets: list[Target] = []
    tags: list[str] = []
    provenance: Provenance | None = None
    version: Version = 1
    notes: str | None = None


class GlossaryDoc(_Doc):
    schema_: Literal["diversity-lingua/glossary"] = Field("diversity-lingua/glossary", alias="schema")
    meta: Meta
    concepts: list[Concept]
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- mémoire de traduction
class MemorySegment(Strict):
    segment_id: ItemId
    concept_id: ConceptId | None = None
    source: SourceText
    contexts: list[str] = []
    targets: list[Target] = []
    provenance: Provenance | None = None
    notes: str | None = None


class MemoryDoc(_Doc):
    schema_: Literal["diversity-lingua/translation-memory"] = Field("diversity-lingua/translation-memory", alias="schema")
    meta: Meta
    segments: list[MemorySegment]
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- corpus / benchmark
class Reference(Strict):
    text: str | None = None
    accepted: list[Text] = []
    status: EntryStatus = "pending_validation"


class CorpusItem(Strict):
    item_id: ItemId
    source: SourceText
    reference: Reference = Reference()
    contexts: list[str] = []
    concept_ids: list[ConceptId] = []
    language_register: str | None = None
    split: Literal["train", "dev", "test"] | None = None
    provenance: Provenance | None = None
    notes: str | None = None


class CorpusDoc(_Doc):
    schema_: Literal["diversity-lingua/corpus"] = Field("diversity-lingua/corpus", alias="schema")
    meta: Meta
    corpus_id: ItemId
    items: list[CorpusItem]
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class BenchmarkItem(Strict):
    item_id: ItemId
    source: SourceText
    references: list[Reference] = []
    category: str = Field(min_length=1, description="amount, fees, error, security, menu…")
    contexts: list[str] = []
    concept_ids: list[ConceptId] = []
    must_preserve: list[Text] = Field([], description="Chaînes qui doivent apparaître telles quelles dans la sortie (montants, numéros…)")
    expected_status: Literal["approved", "automatic", "unavailable"] | None = None
    difficulty: Literal["easy", "medium", "hard"] | None = None
    notes: str | None = None


class Scoring(Strict):
    metrics: list[Literal["coverage", "exact_match", "chrf", "preservation", "status_match"]] = ["coverage", "exact_match", "chrf", "preservation"]
    pass_threshold: float | None = Field(None, ge=0, le=1)


class BenchmarkDoc(_Doc):
    schema_: Literal["diversity-lingua/benchmark"] = Field("diversity-lingua/benchmark", alias="schema")
    meta: Meta
    benchmark_id: ItemId
    scoring: Scoring = Scoring()
    items: list[BenchmarkItem]
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- registre des corrections
class TargetRef(Strict):
    kind: Literal["glossary", "memory"]
    concept_id: ConceptId | None = None
    segment_id: ItemId | None = None
    target_id: ItemId | None = None

    @model_validator(mode="after")
    def _one(self):
        if self.kind == "glossary" and not self.concept_id:
            raise ValueError("kind=glossary exige concept_id")
        if self.kind == "memory" and not self.segment_id:
            raise ValueError("kind=memory exige segment_id")
        return self


class Correction(Strict):
    correction_id: ItemId
    target_ref: TargetRef
    source: SourceText | None = None
    previous: str | None = None
    corrected: Text
    accepted: list[Text] = []
    category: Literal["spelling", "orthography", "semantic", "register", "terminology", "other"] = "other"
    reason: str | None = None
    reported_by: str | None = None
    decided_by: str | None = None
    decided_at: str | None = None
    status: Literal["proposed", "accepted", "rejected", "applied"] = "proposed"
    provenance: Provenance | None = None

    @model_validator(mode="after")
    def _decided(self):
        if self.status in ("accepted", "rejected", "applied") and not (self.decided_by and self.decided_at):
            raise ValueError("une correction décidée exige decided_by et decided_at")
        return self


class CorrectionsDoc(_Doc):
    schema_: Literal["diversity-lingua/corrections"] = Field("diversity-lingua/corrections", alias="schema")
    meta: Meta
    corrections: list[Correction]
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- profil linguistique
class Orthography(Strict):
    description: str | None = None
    alphabet: list[str] = []
    special_characters: list[str] = []
    rules: list[str] = []


class NumberFormat(Strict):
    decimal_separator: str | None = None
    thousands_separator: str | None = None
    currency_position: Literal["before", "after"] | None = None


class StyleGuideRef(Strict):
    title: str | None = None
    version: str | None = None
    document_path: str | None = Field(None, description="Chemin du guide (ex. data/referentiel/style_guide/ff.md)")


class LanguageProfile(Strict):
    code: str = Field(pattern=r"^[a-z]{2,3}(?:-[a-z0-9]+)?$")
    name: Text
    native_name: str | None = None
    variety: str = Field(min_length=1)
    iso639_3: str | None = Field(None, pattern=r"^[a-z]{3}$")
    script: str = "Latn"
    orthography: Orthography = Orthography()
    language_register: str | None = None
    number_format: NumberFormat = NumberFormat()
    style_guide: StyleGuideRef | None = None
    availability: Literal["awaiting_validation", "partial", "available", "disabled"] = "awaiting_validation"
    machine_translation: Literal["allowed", "disabled"] = "allowed"
    nllb_code: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _variety(self):
        want = TARGET_VARIETIES.get(self.code)
        if want and self.variety != want:
            raise ValueError(f"pour la langue {self.code}, variety doit valoir « {want} »")
        return self


class ProfileDoc(_Doc):
    schema_: Literal["diversity-lingua/language-profile"] = Field("diversity-lingua/language-profile", alias="schema")
    meta: Meta
    language: LanguageProfile
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------------------- registre des types
DOC_TYPES: dict[str, dict] = {
    "glossary": {"schema": "diversity-lingua/glossary", "model": GlossaryDoc, "items": "concepts", "item_model": Concept, "id": "concept_id"},
    "translation-memory": {"schema": "diversity-lingua/translation-memory", "model": MemoryDoc, "items": "segments", "item_model": MemorySegment, "id": "segment_id"},
    "corpus": {"schema": "diversity-lingua/corpus", "model": CorpusDoc, "items": "items", "item_model": CorpusItem, "id": "item_id"},
    "benchmark": {"schema": "diversity-lingua/benchmark", "model": BenchmarkDoc, "items": "items", "item_model": BenchmarkItem, "id": "item_id"},
    "corrections": {"schema": "diversity-lingua/corrections", "model": CorrectionsDoc, "items": "corrections", "item_model": Correction, "id": "correction_id"},
    "language-profile": {"schema": "diversity-lingua/language-profile", "model": ProfileDoc, "items": None, "item_model": None, "id": None},
}
SCHEMA_TO_TYPE = {v["schema"]: k for k, v in DOC_TYPES.items()}


def placeholders(text: str | None) -> list[str]:
    return sorted(PLACEHOLDER_RE.findall(text or ""))
