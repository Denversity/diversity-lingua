"""Import d'un corpus de référence et comparaison de moteurs.

Corpus (CSV ou JSON) : colonnes/champs  source_lang, target_lang, source, reference[, context_tag]
 - `import`  : normalise un fichier du locuteur natif en data/corpus/<nom>.json
 - `compare` : exécute chaque moteur (un seul fournisseur à la fois, sans repli) sur le corpus et
               calcule couverture, taux d'abstention, correspondance exacte, chrF, intégrité des
               données protégées. Les résultats sont des MESURES sur corpus : aucune validation
               linguistique n'est déduite automatiquement.

Exemples :
  python -m app.eval.compare import --input corpus.csv --name ff-v1
  python -m app.eval.compare compare --corpus ../data/corpus/ff-v1.json --engines glossary,openai_compat
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

from ..core.config import Settings, get_settings
from ..providers.registry import build_providers
from ..schemas import ElementContext, Segment, TranslateOptions, TranslateRequest
from ..services.glossary import GlossaryService, normalize
from ..services.languages import LanguageService
from ..services.orchestrator import Orchestrator

REQUIRED = ("source_lang", "target_lang", "source", "reference")


def _from_contract(doc: dict) -> list[dict]:
    """Corpus / benchmark au format contrat v1.0.0 → lignes d'évaluation (seules les références APPROUVÉES comptent)."""
    from ..referentiel.validate import validate_document
    res = validate_document(doc, allow_fixture=True)
    if not res.ok:
        raise ValueError(f"document invalide : {res.errors[0].code} {res.errors[0].path} — {res.errors[0].message}")
    out = []
    for it in res.items:
        refs = [it.reference] if res.doc_type == "corpus" else it.references
        ref = next((r for r in refs if r.status == "approved" and r.text), None)
        out.append({"source_lang": it.source.lang, "target_lang": res.meta.language, "source": it.source.text,
                    "reference": ref.text if ref else None, "context_tag": (it.contexts or [None])[0],
                    "must_preserve": list(getattr(it, "must_preserve", []) or []),
                    "expected_status": getattr(it, "expected_status", None), "item_id": it.item_id})
    return out


def load_corpus(path: Path) -> list[dict]:
    path = Path(path)
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(rows, dict) and rows.get("schema") in ("diversity-lingua/corpus", "diversity-lingua/benchmark"):
            return _from_contract(rows)
        rows = rows["items"] if isinstance(rows, dict) else rows
    else:
        with path.open(encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh))
    out = []
    for i, r in enumerate(rows, 1):
        missing = [k for k in REQUIRED if not (r.get(k) or "").strip()]
        if missing:
            raise ValueError(f"ligne {i} : champs manquants {missing}")
        out.append({k: r[k].strip() for k in REQUIRED} | {"context_tag": (r.get("context_tag") or "").strip() or None})
    return out


def import_corpus(src: Path, name: str, out_dir: Path) -> Path:
    rows = load_corpus(src)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{name}.json"
    dest.write_text(json.dumps({"schema_version": 1, "name": name, "items": rows}, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    return dest


def chrf(hyp: str, ref: str, max_n: int = 6, beta: float = 2.0) -> float:
    """chrF simplifié (F-score sur n-grammes de caractères, beta=2), sans dépendance externe."""
    h, r = re.sub(r"\s+", "", hyp), re.sub(r"\s+", "", ref)
    if not h or not r:
        return 0.0
    ps, rs = [], []
    for n in range(1, max_n + 1):
        hc = Counter(h[i:i + n] for i in range(len(h) - n + 1))
        rc = Counter(r[i:i + n] for i in range(len(r) - n + 1))
        if not hc or not rc:
            continue
        overlap = sum((hc & rc).values())
        ps.append(overlap / sum(hc.values()))
        rs.append(overlap / sum(rc.values()))
    if not ps:
        return 0.0
    p, rc_ = sum(ps) / len(ps), sum(rs) / len(rs)
    if p + rc_ == 0:
        return 0.0
    return (1 + beta**2) * p * rc_ / (beta**2 * p + rc_)


def _numbers(text: str) -> Counter:
    return Counter(re.findall(r"\d+", text))


async def evaluate_engine(settings: Settings, engine: str, rows: list[dict]) -> dict:
    s = settings.model_copy(update={"provider_order": engine})
    langs = LanguageService(s.data_dir / "languages.json", allow_test=s.allow_test_data)
    gloss = GlossaryService(s.data_dir / "glossary", s.state_dir, s.allow_test_data)
    mem = GlossaryService(s.data_dir / "memory", s.state_dir, s.allow_test_data, name="memory")
    providers = build_providers(s, gloss, mem)
    configured = all(p.is_configured() for p in providers) and bool(providers)
    if not configured:
        return {"engine": engine, "configured": False, "note": "moteur non configuré — non évalué"}
    orch = Orchestrator(s, langs, providers, gloss)
    stats = Counter()
    chrfs, per_item = [], []
    for i, row in enumerate(rows):
        req = TranslateRequest(
            source_lang=row["source_lang"], target_lang=row["target_lang"],
            segments=[Segment(id="x", text=row["source"],
                              context=ElementContext(tag=row["context_tag"]) if row.get("context_tag") else None)],
            options=TranslateOptions(allow_machine=True))
        res = (await orch.translate(req, f"eval{i}")).results[0]
        stats["total"] += 1
        stats[res.status.value] += 1
        ts = res.translation_status.value if res.translation_status else "unchanged"
        stats[f"ts:{ts}"] += 1
        if row.get("expected_status"):
            stats["status_checked"] += 1
            stats["status_match"] += ts == row["expected_status"]
        if res.translation is None:
            continue
        stats["covered"] += 1
        if row.get("must_preserve"):
            stats["preserve_checked"] += 1
            stats["preserve_ok"] += all(m in res.translation for m in row["must_preserve"])
        if _numbers(row["source"]) - _numbers(res.translation):
            stats["protected_data_lost"] += 1
        if not row.get("reference"):  # pas de référence approuvée : on mesure la couverture seulement
            per_item.append({"source": row["source"], "output": res.translation, "reference": None, "translation_status": ts})
            continue
        exact = normalize(res.translation) == normalize(row["reference"]) or normalize(res.translation) in {
            normalize(a) for a in res.alternatives}
        stats["exact"] += exact
        stats["scored"] += 1
        score = chrf(res.translation, row["reference"])
        chrfs.append(score)
        per_item.append({"source": row["source"], "output": res.translation, "reference": row["reference"],
                         "status": res.status.value, "translation_status": ts, "exact": exact, "chrf": round(score, 3)})
    n, cov = stats["total"], stats["covered"]
    return {
        "engine": engine, "configured": True, "items": n,
        "coverage": round(cov / n, 3) if n else 0, "abstention_rate": round(stats["unavailable"] / n, 3) if n else 0,
        "validated_rate": round(stats["validated"] / n, 3) if n else 0,
        "exact_match_rate_on_covered": round(stats["exact"] / stats["scored"], 3) if stats["scored"] else None,
        "preservation_rate": round(stats["preserve_ok"] / stats["preserve_checked"], 3) if stats["preserve_checked"] else None,
        "status_match_rate": round(stats["status_match"] / stats["status_checked"], 3) if stats["status_checked"] else None,
        "by_translation_status": {k[3:]: v for k, v in stats.items() if k.startswith("ts:")},
        "chrf_mean_on_covered": round(sum(chrfs) / len(chrfs), 3) if chrfs else None,
        "protected_data_lost": stats["protected_data_lost"], "details": per_item,
    }


async def compare(settings: Settings, corpus: Path, engines: list[str]) -> list[dict]:
    rows = load_corpus(corpus)
    return [await evaluate_engine(settings, e, rows) for e in engines]


def to_markdown(results: list[dict]) -> str:
    head = "| moteur | configuré | couverture | abstention | validé | exact | chrF | données perdues |\n|---|---|---|---|---|---|---|---|\n"
    lines = []
    for r in results:
        if not r["configured"]:
            lines.append(f"| {r['engine']} | non | – | – | – | – | – | – |")
        else:
            lines.append(f"| {r['engine']} | oui | {r['coverage']} | {r['abstention_rate']} | {r['validated_rate']} | "
                         f"{r['exact_match_rate_on_covered']} | {r['chrf_mean_on_covered']} | {r['protected_data_lost']} |")
    return head + "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("import")
    a.add_argument("--input", required=True, type=Path)
    a.add_argument("--name", required=True)
    b = sub.add_parser("compare")
    b.add_argument("--corpus", required=True, type=Path)
    b.add_argument("--engines", required=True, help="ex: glossary,memory,openai_compat,anthropic,mock")
    b.add_argument("--json-out", type=Path)
    args = ap.parse_args(argv)
    s = get_settings()
    if args.cmd == "import":
        print(import_corpus(args.input, args.name, s.data_dir / "corpus"))
        return 0
    results = asyncio.run(compare(s, args.corpus, [e.strip() for e in args.engines.split(",")]))
    print(to_markdown(results))
    if args.json_out:
        args.json_out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
