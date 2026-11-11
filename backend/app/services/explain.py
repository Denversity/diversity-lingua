"""Mode « Je veux comprendre » : explication simple d'un concept financier.

L'explication est rédigée dans la langue SOURCE (data/concepts.json, marquée « à relire »).
Sa traduction passe par l'orchestrateur : statut explicite, jamais présentée comme validée sans l'être.
Si le concept est inconnu, on le dit — aucune explication n'est inventée.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..schemas import ElementContext, ExplainRequest, ExplainResponse, Segment, SegmentResult, Status, TranslateOptions, TranslateRequest, TranslationStatus
from .glossary import normalize
from .orchestrator import Orchestrator


class ExplainService:
    def __init__(self, concepts_path: Path, orchestrator: Orchestrator):
        concepts_path = Path(concepts_path)
        raw = json.loads(concepts_path.read_text(encoding="utf-8"))
        self.concepts = raw["concepts"]
        explanations_path = concepts_path.with_name("fulfulde_explanations.json")
        if explanations_path.exists():
            explanations = json.loads(explanations_path.read_text(encoding="utf-8"))
            self.fulfulde_explanations = explanations["entries"]
        else:
            self.fulfulde_explanations = raw.get("fulfulde_explanations", [])
        self.orch = orchestrator

    def find_fulfulde_explanation(self, text: str, lang: str):
        query = normalize(text)
        source_keys = {"fr": "francais", "en": "anglais"}
        if lang not in source_keys:
            return None, None, None
        for candidate in (lang, "en" if lang == "fr" else "fr"):
            matches = []
            for entry in self.fulfulde_explanations:
                if entry.get("status") != "approved":
                    continue
                term = normalize(entry.get(source_keys[candidate], ""))
                if term and re.search(rf"(?<!\w){re.escape(term)}(?!\w)", query):
                    matches.append((entry, term))
            if not matches:
                continue
            longest = max(len(term) for _, term in matches)
            matches = [(entry, term) for entry, term in matches if len(term) == longest]
            descriptions = {entry["periphrase_descriptive"] for entry, _ in matches}
            if len(descriptions) != 1:
                return None, None, None
            return matches[0][0], matches[0][1], candidate
        return None, None, None

    def find(self, text: str, lang: str):
        q = normalize(text)
        best, best_len = None, 0
        for c in self.concepts:
            for term in c["terms"].get(lang, []):
                t = normalize(term)
                if t == q:
                    return c, term
                if t and t in q and len(t) > best_len:
                    best, best_len, best_term = c, len(t), term
        return (best, best_term) if best else (None, None)

    async def explain(self, req: ExplainRequest, request_id: str) -> ExplainResponse:
        concept, term = self.find(req.text, req.source_lang)
        source_lang = req.source_lang
        periphrase, periphrase_term, periphrase_lang = (None, None, None)
        if req.target_lang.casefold() == "ff":
            periphrase, periphrase_term, periphrase_lang = self.find_fulfulde_explanation(req.text, req.source_lang)
        if periphrase_lang and periphrase_lang != source_lang:
            source_lang = periphrase_lang
            concept, term = self.find(req.text, source_lang)
        elif not concept:
            alternate = "en" if source_lang == "fr" else "fr"
            concept, term = self.find(req.text, alternate)
            if concept:
                source_lang = alternate
        opts = TranslateOptions(allow_machine=req.allow_machine)
        # Traduction du TERME (priorité : texte sélectionné, puis forme du concept) — mémoire/glossaire d'abord ; pas de moteur par défaut.
        forms = [req.text] + ([term] if term and normalize(term) != normalize(req.text) else [])
        term_tr = None
        tr_terms = await self.orch.translate(TranslateRequest(
            source_lang=source_lang, target_lang=req.target_lang, options=opts,
            segments=[Segment(id=f"t{i}", text=f, context=ElementContext(tag="span")) for i, f in enumerate(forms)]), request_id)
        for r in tr_terms.results:
            if r.translation_status in (TranslationStatus.APPROVED, TranslationStatus.AUTOMATIC, TranslationStatus.PENDING_VALIDATION):
                term_tr = r
                break
        term_tr = term_tr or tr_terms.results[0]
        if not concept:
            if periphrase:
                return ExplainResponse(
                    found=True,
                    concept_id=periphrase["id"],
                    term=periphrase_term,
                    source_lang=source_lang,
                    translation=SegmentResult(
                        id="explanation",
                        translation=periphrase["periphrase_descriptive"],
                        status=Status.VALIDATED,
                        origin="glossary",
                        entry_id=periphrase["id"],
                        translation_status=TranslationStatus.APPROVED,
                    ),
                    term_translation=term_tr,
                )
            return ExplainResponse(found=False, source_lang=source_lang, term_translation=term_tr)
        text = concept["definition"][source_lang]
        if periphrase:
            tr = SegmentResult(
                id="explanation",
                translation=periphrase["periphrase_descriptive"],
                status=Status.VALIDATED,
                origin="glossary",
                entry_id=periphrase["id"],
                translation_status=TranslationStatus.APPROVED,
            )
        else:
            translated = await self.orch.translate(TranslateRequest(
                source_lang=source_lang, target_lang=req.target_lang, options=opts,
                segments=[Segment(id="explanation", text=text, context=ElementContext(tag="p"))]), request_id)
            tr = translated.results[0]
        return ExplainResponse(found=True, concept_id=concept["id"], term=term, source_lang=source_lang, explanation_source=text,
                               explanation_source_reviewed=bool(concept.get("reviewed")), translation=tr,
                               example_source=(concept.get("example") or {}).get(source_lang), term_translation=term_tr)
