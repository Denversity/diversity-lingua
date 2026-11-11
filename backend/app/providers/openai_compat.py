"""Fournisseur IA compatible API « chat completions » (OpenAI, Azure, vLLM, Ollama, LiteLLM…).

Configuré uniquement si DL_OPENAI_API_KEY (ou base_url locale) ET DL_OPENAI_MODEL sont définis.
La clé reste côté serveur : elle n'est jamais envoyée à l'extension.
"""
from __future__ import annotations

import httpx

from ..core.config import Settings
from ..services.languages import LanguageConfig
from . import llm_common as C
from .base import ProviderItem, ProviderResult, TranslationProvider


class OpenAICompatProvider(TranslationProvider):
    name, kind = "openai_compat", "machine"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.s = settings
        self._client = client

    def is_configured(self) -> bool:
        local = self.s.openai_base_url and "api.openai.com" not in self.s.openai_base_url
        return bool(self.s.openai_model and (self.s.openai_api_key or local))

    def supports(self, source: str, target: str, language: LanguageConfig) -> bool:
        return language.machine_translation == "allowed" and not language.is_test

    async def translate(self, items: list[ProviderItem], source: str, target: str,
                        language: LanguageConfig) -> dict[str, ProviderResult]:
        out: dict[str, ProviderResult] = {}
        client = self._client or httpx.AsyncClient(timeout=self.s.provider_timeout_s)
        try:
            for batch in C.chunks(items, 20):
                headers = {"Content-Type": "application/json"}
                if self.s.openai_api_key:
                    headers["Authorization"] = f"Bearer {self.s.openai_api_key}"
                body = {"model": self.s.openai_model, "temperature": 0,
                        "messages": [{"role": "system", "content": C.build_system(source, target, language)},
                                     {"role": "user", "content": C.build_user(batch)}]}
                r = await client.post(self.s.openai_base_url.rstrip("/") + "/chat/completions",
                                      json=body, headers=headers)
                r.raise_for_status()
                content = r.json()["choices"][0]["message"]["content"]
                out.update(C.parse_results(content, batch))
        finally:
            if self._client is None:
                await client.aclose()
        return out
