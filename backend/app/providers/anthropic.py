"""Fournisseur IA Anthropic (API Messages). Configuré si clé ET modèle sont définis."""
from __future__ import annotations

import httpx

from ..core.config import Settings
from ..services.languages import LanguageConfig
from . import llm_common as C
from .base import ProviderItem, ProviderResult, TranslationProvider


class AnthropicProvider(TranslationProvider):
    name, kind = "anthropic", "machine"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.s = settings
        self._client = client

    def is_configured(self) -> bool:
        return bool(self.s.anthropic_api_key and self.s.anthropic_model)

    def supports(self, source: str, target: str, language: LanguageConfig) -> bool:
        return language.machine_translation == "allowed" and not language.is_test

    async def translate(self, items: list[ProviderItem], source: str, target: str,
                        language: LanguageConfig) -> dict[str, ProviderResult]:
        out: dict[str, ProviderResult] = {}
        client = self._client or httpx.AsyncClient(timeout=self.s.provider_timeout_s)
        try:
            for batch in C.chunks(items, 20):
                body = {"model": self.s.anthropic_model, "max_tokens": 4096, "temperature": 0,
                        "system": C.build_system(source, target, language),
                        "messages": [{"role": "user", "content": C.build_user(batch)}]}
                r = await client.post(self.s.anthropic_base_url.rstrip("/") + "/v1/messages", json=body,
                                      headers={"x-api-key": self.s.anthropic_api_key or "",
                                               "anthropic-version": "2023-06-01",
                                               "content-type": "application/json"})
                r.raise_for_status()
                text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
                out.update(C.parse_results(text, batch))
        finally:
            if self._client is None:
                await client.aclose()
        return out
