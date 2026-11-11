#!/usr/bin/env python3
"""Génère schemas/*.schema.json depuis les modèles Pydantic (source unique). `--check` : échoue si obsolètes."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.referentiel.models import CONTRACT_VERSION, DOC_TYPES

out = ROOT / "schemas"
out.mkdir(exist_ok=True)
stale = []
for kind, spec in DOC_TYPES.items():
    schema = spec["model"].model_json_schema(by_alias=True)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = f"https://diversity-lingua.local/schemas/{kind}/{CONTRACT_VERSION}"
    schema["title"] = f"Diversity Lingua — {kind} (contrat {CONTRACT_VERSION})"
    text = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    f = out / f"{kind}.schema.json"
    if "--check" in sys.argv:
        if not f.exists() or f.read_text(encoding="utf-8") != text:
            stale.append(f.name)
    else:
        f.write_text(text, encoding="utf-8")
        print("écrit", f.relative_to(ROOT))
if stale:
    print("schémas obsolètes :", stale); sys.exit(1)
