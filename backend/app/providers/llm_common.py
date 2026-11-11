"""Prompt et parsing partagés par les fournisseurs LLM."""
from __future__ import annotations

import json
import re

from ..services.languages import LanguageConfig
from .base import ProviderItem, ProviderResult

SYSTEM_TEMPLATE = (
    "You are a careful translator of financial user-interface text (mobile money, digital banking, "
    "microfinance in Cameroon). Translate from {src} into {tgt} ({variety}).\n"
    "STRICT RULES:\n"
    "1. Keep every placeholder such as {{{{P0}}}} EXACTLY as written, the same number of times. Never add, remove, "
    "reorder-away, or translate placeholders.\n"
    "2. Never add, remove or change numbers.\n"
    "3. If glossary terms are provided for an item, use their target forms exactly.\n"
    "4. Do not invent words. If you are not confident that you can produce a faithful, natural translation "
    "in {tgt}, return \"translation\": null and \"uncertain\": true. Abstaining is always better than guessing.\n"
    "5. Preserve meaning of financial operations precisely (send, receive, fees, balance, failure, etc.).\n"
    "6. Output ONLY JSON: {{\"results\": [{{\"id\": str, \"translation\": str|null, \"uncertain\": bool}}]}}."
)


def build_system(source: str, target: str, language: LanguageConfig) -> str:
    return SYSTEM_TEMPLATE.format(src=source, tgt=language.name, variety=language.variety)


def build_user(items: list[ProviderItem]) -> str:
    return json.dumps({"items": [
        {"id": i.id, "text": i.text, "element": i.context.element, "topics": i.context.topics,
         "glossary": [list(h) for h in i.hints]} for i in items]}, ensure_ascii=False)


def parse_results(raw: str, items: list[ProviderItem]) -> dict[str, ProviderResult]:
    txt = raw.strip()
    txt = re.sub(r"^```(?:json)?|```$", "", txt, flags=re.MULTILINE).strip()
    try:
        data = json.loads(txt)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", txt, re.DOTALL)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    ids = {i.id for i in items}
    out: dict[str, ProviderResult] = {}
    for r in (data.get("results") or []) if isinstance(data, dict) else []:
        if not isinstance(r, dict) or r.get("id") not in ids:
            continue
        tr = r.get("translation")
        unc = bool(r.get("uncertain"))
        out[r["id"]] = ProviderResult(text=tr if isinstance(tr, str) and not unc else None, uncertain=unc or tr is None)
    return out


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]
