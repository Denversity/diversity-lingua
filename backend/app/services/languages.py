"""Language Management Service : configuration linguistique centralisée (data/languages.json).

Aucune condition spécifique à une langue ne doit exister ailleurs dans le code :
tout passe par ces fiches (code, variété, script, orthographe, statut de disponibilité).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class LanguageConfig:
    code: str
    name: str
    native_name: str
    iso639_3: str | None
    variety: str
    script: str
    orthography: str
    availability: str  # awaiting_validation | partial | available | test_only | disabled
    machine_translation: str  # allowed | disabled
    low_resource: bool = False
    nllb_code: str | None = None
    variety_code: str | None = None
    notes: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def is_test(self) -> bool:
        return self.availability == "test_only"

    def public(self) -> dict:
        return {
            "code": self.code, "name": self.name, "native_name": self.native_name,
            "iso639_3": self.iso639_3, "variety": self.variety, "script": self.script,
            "variety_code": self.variety_code, "orthography": self.orthography, "availability": self.availability,
            "machine_translation": self.machine_translation, "low_resource": self.low_resource,
            "notes": self.notes,
        }


class LanguageService:
    def __init__(self, path: Path, allow_test: bool = True):
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        self.source_languages: list[dict] = raw["source_languages"]
        self._targets: dict[str, LanguageConfig] = {}
        for item in raw["target_languages"]:
            known = {k: item.get(k) for k in LanguageConfig.__dataclass_fields__ if k in item}
            cfg = LanguageConfig(**known)
            if cfg.is_test and not allow_test:
                continue
            self._targets[cfg.code] = cfg

    def source_codes(self) -> set[str]:
        return {s["code"] for s in self.source_languages}

    def target(self, code: str) -> LanguageConfig | None:
        return self._targets.get(code)

    def targets(self) -> list[LanguageConfig]:
        return [c for c in self._targets.values() if c.availability != "disabled"]
