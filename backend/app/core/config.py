"""Configuration centralisée (variables d'environnement préfixées DL_)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DL_", env_file=".env", extra="ignore")

    env: str = "dev"  # dev | prod
    data_dir: Path = REPO_ROOT / "data"
    state_dir: Path = REPO_ROOT / "backend" / "state"
    demo_dir: Path = REPO_ROOT / "demo"

    # Ordre de priorité des fournisseurs (le premier qui répond avec un résultat valide gagne).
    provider_order: str = "memory,glossary,openai_compat,anthropic,nllb,mock"

    # Politique de traduction
    allow_test_data: bool = True  # glossaires fixtures + langue de test (désactiver en prod)
    allow_machine_translation: bool = True
    show_pending: bool = False  # True = présenter les traductions « pending_validation » (jamais comme approuvées)
    min_confidence: float = 0.0  # appliqué seulement si le fournisseur fournit un score

    # Sécurité / quotas
    api_token: str | None = None  # si défini, requis dans l'en-tête X-DL-Token
    admin_token: str | None = None  # requis pour /glossary/validate (sinon 403)
    rate_limit_per_min: int = 240
    max_segments: int = 200
    max_segment_chars: int = 2000
    max_total_chars: int = 60000
    provider_timeout_s: float = 20.0
    cors_origin_regex: str = r"^(chrome-extension://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?)$"

    # Fournisseur compatible OpenAI (OpenAI, Azure, vLLM, Ollama, etc.)
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str | None = None
    openai_model: str | None = None

    # Fournisseur Anthropic
    anthropic_base_url: str = "https://api.anthropic.com"
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None

    # Modèle local (ex. NLLB). Licence à reconnaître explicitement (NLLB-200 : CC-BY-NC 4.0).
    nllb_model: str | None = None
    local_model_license_ack: bool = False

    log_level: str = "INFO"

    @property
    def provider_names(self) -> list[str]:
        return [p.strip() for p in self.provider_order.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
