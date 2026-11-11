"""Translation Orchestrator — moteur hybride.

Ordre (configurable via DL_PROVIDER_ORDER) : glossaire validé → mémoire de traduction →
fournisseurs IA / locaux → (simulé en test). Pour chaque segment :
  1. masquage des données sensibles (jamais transmises aux fournisseurs) ;
  2. interrogation des fournisseurs dans l'ordre, sur les segments restants ;
  3. contrôle d'intégrité du résultat (jetons, chiffres, balisage, longueur) ;
  4. restauration des valeurs protégées ;
  5. restitution avec statut explicite. Une sortie machine n'est JAMAIS « validated ».
En cas d'échec ou de doute : abstention (status=unavailable + raison).
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from ..core.config import Settings
from ..core.logging import log
from ..providers.base import ProviderItem, TranslationProvider
from ..schemas import (ElementContext, Reason, SegmentResult, Status, TranslateRequest,
                       TranslateResponse, TranslationStatus)
from . import protection, validation
from .classifier import ContextInfo, classify
from .glossary import GlossaryService
from .languages import LanguageService

_REASON_PRIORITY = [Reason.PROVIDER_ERROR, Reason.INTEGRITY_CHECK_FAILED, Reason.UNCERTAIN,
                    Reason.LOW_CONFIDENCE, Reason.AMBIGUOUS_CONTEXT]


@dataclass
class _Work:
    seg_id: str
    original: str
    mask: protection.MaskResult
    ctx: ContextInfo
    result: SegmentResult | None = None
    reasons: set[Reason] = field(default_factory=set)
    pending: tuple | None = None  # (ProviderResult, provider) : proposition humaine non validée
    rejected: object | None = None  # ProviderResult : seule traduction connue = rejetée


class Orchestrator:
    def __init__(self, settings: Settings, languages: LanguageService, providers: list[TranslationProvider],
                 glossary: GlossaryService, logger: logging.Logger | None = None):
        self.s = settings
        self.languages = languages
        self.providers = providers
        self.glossary = glossary
        self.logger = logger or logging.getLogger("dl")

    async def translate(self, req: TranslateRequest, request_id: str) -> TranslateResponse:
        t0 = time.perf_counter()
        results = await self._run(req)
        summary: dict[str, int] = {}
        for r in results:
            summary[r.status.value] = summary.get(r.status.value, 0) + 1
        took = int((time.perf_counter() - t0) * 1000)
        # Journalisation : compteurs uniquement, JAMAIS le texte.
        log(self.logger, "translate", request_id=request_id, target=req.target_lang,
            segments=len(req.segments), summary=summary, took_ms=took)
        return TranslateResponse(request_id=request_id, source_lang=req.source_lang,
                                 target_lang=req.target_lang, results=results, summary=summary, took_ms=took)

    # ------------------------------------------------------------------
    async def _run(self, req: TranslateRequest) -> list[SegmentResult]:
        lang = self.languages.target(req.target_lang)
        if req.source_lang not in self.languages.source_codes():
            return [SegmentResult(id=s.id, status=Status.UNAVAILABLE, reason=Reason.UNSUPPORTED_SOURCE) for s in req.segments]
        if lang is None:
            return [SegmentResult(id=s.id, status=Status.UNAVAILABLE, reason=Reason.LANGUAGE_UNAVAILABLE) for s in req.segments]

        works: list[_Work] = []
        for seg in req.segments:
            m = protection.mask_text(seg.text)
            w = _Work(seg.id, seg.text, m, classify(m.masked, seg.context))
            if not protection.has_translatable_letters(m.masked):
                w.result = SegmentResult(id=seg.id, translation=seg.text, status=Status.UNCHANGED,
                                         protected=m.kinds)
            works.append(w)

        allow_machine = (self.s.allow_machine_translation and req.options.allow_machine
                         and lang.machine_translation == "allowed")
        machine_possible = False
        show_pending = self.s.show_pending or req.options.include_pending
        for prov in self.providers:
            if prov.kind == "machine":  # une proposition humaine en attente passe AVANT la machine (si autorisée)
                self._flush_pending(works, show_pending, lang)
            pending = [w for w in works if w.result is None]
            if not pending:
                break
            if not prov.is_configured() or not prov.supports(req.source_lang, req.target_lang, lang):
                continue
            if prov.kind == "machine":
                if not allow_machine:
                    for w in pending:
                        w.reasons.add(Reason.MACHINE_DISABLED)
                    continue
                machine_possible = True
            items = [ProviderItem(w.seg_id, w.mask.masked, w.ctx,
                                  self.glossary.find_terms(w.mask.masked, req.source_lang, req.target_lang)
                                  if prov.kind == "machine" else []) for w in pending]
            try:
                out = await asyncio.wait_for(prov.translate(items, req.source_lang, req.target_lang, lang),
                                             timeout=self.s.provider_timeout_s)
            except Exception as exc:  # réseau, timeout, réponse invalide : on bascule sur la suite
                log(self.logger, "provider_error", provider=prov.name, error=type(exc).__name__)
                for w in pending:
                    w.reasons.add(Reason.PROVIDER_ERROR)
                continue
            for w in pending:
                self._consume(w, out.get(w.seg_id), prov, lang)

        self._flush_pending(works, show_pending, lang)
        results: list[SegmentResult] = []
        for w in works:
            if w.result is None:
                notes = [] if machine_possible else ["no_machine_provider_for_language"]
                if w.rejected is not None:  # statut explicite : la traduction connue a été rejetée
                    w.result = SegmentResult(id=w.seg_id, status=Status.UNAVAILABLE, translation_status=TranslationStatus.REJECTED,
                                             reason=Reason.REJECTED, protected=w.mask.kinds, notes=notes,
                                             concept_id=getattr(w.rejected, "concept_id", None), entry_id=getattr(w.rejected, "entry_id", None))
                else:
                    w.result = SegmentResult(id=w.seg_id, status=Status.UNAVAILABLE, reason=self._reason(w),
                                             protected=w.mask.kinds, notes=notes)
            results.append(w.result)
        return results

    def _flush_pending(self, works: list[_Work], show: bool, lang) -> None:
        for w in works:
            if w.result is not None or w.pending is None:
                continue
            res, prov = w.pending
            if show:
                w.result = SegmentResult(
                    id=w.seg_id, translation=protection.unmask(res.text, w.mask.tokens), status=Status.MACHINE_UNVALIDATED,
                    translation_status=TranslationStatus.PENDING_VALIDATION, origin=prov.kind, provider=prov.name,
                    test_data=res.test_data, protected=w.mask.kinds, entry_id=res.entry_id, concept_id=res.concept_id,
                    alternatives=[protection.unmask(a, w.mask.tokens) for a in res.alternatives],
                    notes=["human_translation_pending_validation"] + (["test_data"] if res.test_data else []))
            else:
                w.reasons.add(Reason.PENDING_ONLY)
            w.pending = None

    def _consume(self, w: _Work, res, prov: TranslationProvider, lang) -> None:
        if res is None:
            return
        if res.reason == "ambiguous_context":
            w.reasons.add(Reason.AMBIGUOUS_CONTEXT)
            return
        if res.human_status == "rejected":
            w.rejected = w.rejected or res
            return
        if res.human_status == "pending_validation":
            if res.text is not None and validation.check(w.mask.masked, res.text, machine=False).ok:
                w.pending = w.pending or (res, prov)
            else:
                w.reasons.add(Reason.INTEGRITY_CHECK_FAILED)
            return
        if res.text is None:
            if res.uncertain:
                w.reasons.add(Reason.UNCERTAIN)
            return
        machine = prov.kind == "machine"
        verdict = validation.check(w.mask.masked, res.text, machine=machine)
        if not verdict.ok:
            w.reasons.add(Reason.INTEGRITY_CHECK_FAILED)
            return
        if machine and res.confidence is not None and res.confidence < self.s.min_confidence:
            w.reasons.add(Reason.LOW_CONFIDENCE)
            return
        validated = bool(res.validated) and not machine  # une sortie machine n'est jamais « validée »
        notes = []
        if machine and lang.low_resource:
            notes.append("low_resource_language_machine_output")
        if res.test_data:
            notes.append("test_data")
        w.result = SegmentResult(
            id=w.seg_id, translation=protection.unmask(res.text, w.mask.tokens),
            status=Status.VALIDATED if validated else Status.MACHINE_UNVALIDATED,
            origin=prov.kind if prov.kind in ("glossary", "memory") else "provider",
            provider=prov.name, confidence=res.confidence, test_data=res.test_data,
            protected=w.mask.kinds, entry_id=res.entry_id, notes=notes, concept_id=res.concept_id,
            alternatives=[protection.unmask(a, w.mask.tokens) for a in res.alternatives])

    @staticmethod
    def _reason(w: _Work) -> Reason:
        for r in _REASON_PRIORITY:
            if r in w.reasons:
                return r
        if Reason.PENDING_ONLY in w.reasons:
            return Reason.PENDING_ONLY
        if Reason.MACHINE_DISABLED in w.reasons:
            return Reason.MACHINE_DISABLED
        return Reason.NO_VALIDATED_TRANSLATION
