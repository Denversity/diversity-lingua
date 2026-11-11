"""Fournisseur de modèle local (NLLB ou compatible) — OPTIONNEL, NON ACTIVÉ PAR DÉFAUT.

Garde-fous :
 - nécessite DL_NLLB_MODEL ET DL_LOCAL_MODEL_LICENSE_ACK=true : les poids NLLB-200 sont publiés sous
   CC-BY-NC 4.0 (usage non commercial) ; l'équipe doit vérifier que son usage est autorisé ;
 - nécessite les paquets `transformers`, `torch`, `sentencepiece` (non installés par défaut) ;
 - n'est utilisé que pour les langues dont la fiche (data/languages.json) définit `nllb_code`.
   Pour le Fulfulde camerounais la variété exacte supportée par le modèle reste à vérifier : le
   champ est volontairement vide.
Ce fournisseur n'a PAS été exécuté dans l'environnement de développement (pas de modèle téléchargé).
"""
from __future__ import annotations

import asyncio

from ..core.config import Settings
from ..services.languages import LanguageConfig
from .base import ProviderItem, ProviderResult, TranslationProvider

_SRC = {"fr": "fra_Latn", "en": "eng_Latn"}


class NllbProvider(TranslationProvider):
    name, kind = "nllb", "machine"

    def __init__(self, settings: Settings):
        self.s = settings
        self._pipe = None

    def is_configured(self) -> bool:
        return bool(self.s.nllb_model and self.s.local_model_license_ack)

    def supports(self, source: str, target: str, language: LanguageConfig) -> bool:
        return bool(language.nllb_code) and source in _SRC and language.machine_translation == "allowed"

    def _load(self, source: str, target_code: str):
        from transformers import pipeline  # import tardif : dépendance optionnelle
        return pipeline("translation", model=self.s.nllb_model, src_lang=_SRC[source], tgt_lang=target_code)

    async def translate(self, items: list[ProviderItem], source: str, target: str,
                        language: LanguageConfig) -> dict[str, ProviderResult]:
        def run() -> dict[str, ProviderResult]:
            pipe = self._pipe or self._load(source, language.nllb_code)
            self._pipe = pipe
            outs = pipe([i.text for i in items], max_length=256)
            return {i.id: ProviderResult(text=o["translation_text"]) for i, o in zip(items, outs)}
        return await asyncio.to_thread(run)
