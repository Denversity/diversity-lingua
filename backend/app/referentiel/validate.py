"""Validation d'un document du référentiel (structure + cohérence). Ne touche à aucune donnée."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from ..services.classifier import _TOPICS
from ..services.textnorm import normalize
from .models import DOC_TYPES, SCHEMA_TO_TYPE, Meta, ProfileDoc, placeholders

ELEMENT_CONTEXTS = {"button", "link", "heading", "label", "menu", "notification", "table_header", "table_cell", "list_item",
                    "placeholder", "tooltip", "paragraph", "option", "image_alt", "text", "attribute", "error"}
CONTEXT_VOCAB = ELEMENT_CONTEXTS | set(_TOPICS)


@dataclass
class Issue:
    level: str  # error | warning
    code: str
    path: str
    message: str
    item_id: str | None = None

    def as_dict(self) -> dict:
        return {"level": self.level, "code": self.code, "path": self.path, "item_id": self.item_id, "message": self.message}


@dataclass
class ValidationResult:
    doc_type: str | None = None
    meta: Meta | None = None
    doc_issues: list[Issue] = field(default_factory=list)  # fatales pour tout le document
    item_issues: dict[int, list[Issue]] = field(default_factory=dict)  # par index d'élément
    warnings: list[Issue] = field(default_factory=list)
    items: list[Any] = field(default_factory=list)  # modèles valides (index conservé via valid_index)
    valid_index: list[int] = field(default_factory=list)
    item_total: int = 0
    profile: Any = None

    @property
    def errors(self) -> list[Issue]:
        return self.doc_issues + [i for v in self.item_issues.values() for i in v]

    @property
    def ok(self) -> bool:
        return not self.errors


def _code(err: dict, id_field: str | None) -> str:
    t, loc = err["type"], err["loc"]
    if t == "missing":
        return "missing_id" if id_field and loc and loc[-1] == id_field else "missing_field"
    if t == "extra_forbidden":
        return "unknown_field"
    if t.startswith("value_error") or t == "assertion_error":
        return "invalid_value"
    if t in ("string_pattern_mismatch", "literal_error", "enum"):
        return "invalid_value"
    return "invalid_type"


def _pyd_issues(exc: ValidationError, base: str, id_field: str | None, item_id: str | None) -> list[Issue]:
    return [Issue("error", _code(e, id_field), ".".join([base, *[str(x) for x in e["loc"]]]).strip("."), e["msg"], item_id)
            for e in exc.errors()]


def validate_document(raw: Any, *, expected_type: str | None = None, expected_language: str | None = None,
                      allow_fixture: bool = False, known_concepts: set[str] | None = None,
                      known_segments: set[str] | None = None) -> ValidationResult:
    r = ValidationResult()
    if not isinstance(raw, dict):
        r.doc_issues.append(Issue("error", "invalid_document", "$", "le document doit être un objet JSON"))
        return r
    schema = raw.get("schema")
    if schema is None:
        legacy = "entries" in raw and "language" in raw
        r.doc_issues.append(Issue("error", "legacy_format" if legacy else "missing_schema", "schema",
                                  "format v0 détecté : utiliser l'import (conversion automatique) ou `python -m app.referentiel convert-legacy`"
                                  if legacy else "champ « schema » absent"))
        return r
    kind = SCHEMA_TO_TYPE.get(schema)
    if kind is None:
        r.doc_issues.append(Issue("error", "unknown_schema", "schema", f"schéma inconnu : {schema!r}"))
        return r
    r.doc_type = kind
    if expected_type and expected_type != kind:
        r.doc_issues.append(Issue("error", "type_mismatch", "schema", f"attendu {expected_type}, reçu {kind}"))
        return r
    spec = DOC_TYPES[kind]
    ver = str(raw.get("schema_version", ""))
    if not ver.startswith("1."):
        r.doc_issues.append(Issue("error", "unsupported_version", "schema_version", f"version majeure 1 requise (reçu {ver!r})"))
        return r
    try:
        r.meta = Meta.model_validate(raw.get("meta") if raw.get("meta") is not None else {})
    except ValidationError as e:
        r.doc_issues += _pyd_issues(e, "meta", None, None)
        return r
    if r.meta.fixture and not allow_fixture:
        r.doc_issues.append(Issue("error", "fixture_not_allowed", "meta.fixture", "données techniques fictives : import refusé hors mode test"))
    if expected_language and r.meta.language != expected_language:
        r.doc_issues.append(Issue("error", "language_mismatch", "meta.language", f"attendu {expected_language}, reçu {r.meta.language}"))
    if r.doc_issues:
        return r

    if kind == "language-profile":
        try:
            r.profile = ProfileDoc.model_validate(raw)
        except ValidationError as e:
            r.doc_issues += _pyd_issues(e, "", None, None)
        else:
            if expected_language and r.profile.language.code != expected_language:
                r.doc_issues.append(Issue("error", "language_mismatch", "language.code", f"attendu {expected_language}"))
        return r

    key, idf, model = spec["items"], spec["id"], spec["item_model"]
    if kind == "corpus" and not raw.get("corpus_id"):
        r.doc_issues.append(Issue("error", "missing_field", "corpus_id", "corpus_id requis"))
    if kind == "benchmark" and not raw.get("benchmark_id"):
        r.doc_issues.append(Issue("error", "missing_field", "benchmark_id", "benchmark_id requis"))
    rows = raw.get(key)
    if not isinstance(rows, list):
        r.doc_issues.append(Issue("error", "missing_field", key, f"« {key} » doit être une liste"))
        return r
    unknown_top = set(raw) - {"schema", "schema_version", "meta", key, "corpus_id", "benchmark_id", "scoring"}
    for k in sorted(unknown_top):
        r.doc_issues.append(Issue("error", "unknown_field", k, "champ inconnu au niveau racine"))
    r.item_total = len(rows)

    seen: dict[str, int] = {}
    dup: set[int] = set()
    for i, row in enumerate(rows):
        rid = row.get(idf) if isinstance(row, dict) else None
        if isinstance(rid, str) and rid.strip():
            if rid in seen:
                dup |= {i, seen[rid]}
            else:
                seen[rid] = i
    for i, row in enumerate(rows):
        base = f"{key}[{i}]"
        rid = row.get(idf) if isinstance(row, dict) else None
        rid = rid if isinstance(rid, str) else None
        if i in dup:
            r.item_issues.setdefault(i, []).append(Issue("error", "duplicate_id", f"{base}.{idf}", f"identifiant dupliqué : {rid}", rid))
            continue
        if not isinstance(row, dict):
            r.item_issues.setdefault(i, []).append(Issue("error", "invalid_type", base, "élément non objet"))
            continue
        try:
            obj = model.model_validate(row)
        except ValidationError as e:
            r.item_issues.setdefault(i, []).extend(_pyd_issues(e, base, idf, rid))
            continue
        problems = _semantic(kind, obj, base, r, known_concepts, known_segments)
        if problems:
            r.item_issues.setdefault(i, []).extend(problems)
            continue
        r.items.append(obj)
        r.valid_index.append(i)

    # target_id explicites dupliqués dans le document
    if kind in ("glossary", "translation-memory"):
        tids: dict[str, int] = {}
        for pos, obj in zip(r.valid_index, list(r.items)):
            for t in obj.targets:
                if t.target_id:
                    if t.target_id in tids:
                        r.item_issues.setdefault(pos, []).append(Issue("error", "duplicate_id", f"{key}[{pos}].targets", f"target_id dupliqué : {t.target_id}", getattr(obj, idf)))
                    tids[t.target_id] = pos
        bad = {p for p, v in r.item_issues.items() if v}
        keep = [(p, o) for p, o in zip(r.valid_index, r.items) if p not in bad]
        r.valid_index, r.items = [p for p, _ in keep], [o for _, o in keep]
    _cross_warnings(kind, r, key)
    return r


def _ctx_warn(ctxs: list[str], path: str, rid: str | None, out: list[Issue]) -> None:
    for c in ctxs:
        if c not in CONTEXT_VOCAB:
            out.append(Issue("warning", "unknown_context", path, f"contexte hors vocabulaire : {c!r}", rid))


def _semantic(kind: str, obj: Any, base: str, r: ValidationResult, known_concepts, known_segments) -> list[Issue]:
    errs: list[Issue] = []
    w = r.warnings
    if kind == "glossary":
        cid = obj.concept_id
        phs = {lang: [tuple(placeholders(f)) for f in [forms.preferred, *forms.accepted]] for lang, forms in obj.sources.items()}
        sets = {p for lst in phs.values() for p in lst}
        if len(sets) > 1:
            errs.append(Issue("error", "placeholder_mismatch", f"{base}.sources", "les formes sources n'ont pas les mêmes jetons {{Pn}}", cid))
        for lang, forms in obj.sources.items():
            norm = [normalize(f) for f in [forms.preferred, *forms.accepted]]
            if len(set(norm)) != len(norm):
                errs.append(Issue("error", "duplicate_form", f"{base}.sources.{lang}", "formes sources dupliquées dans un même concept", cid))
        src_ph = next(iter(sets), ())
        for ti, t in enumerate(obj.targets):
            for txt in ([t.preferred] if t.preferred else []) + t.accepted:
                if tuple(placeholders(txt)) != src_ph:
                    errs.append(Issue("error", "placeholder_mismatch", f"{base}.targets[{ti}]", "jetons {{Pn}} de la cible différents de la source", cid))
                    break
            _ctx_warn(t.contexts, f"{base}.targets[{ti}].contexts", cid, w)
        _ctx_warn(obj.contexts, f"{base}.contexts", cid, w)
        missing = [l for l in (r.meta.source_languages if r.meta else []) if l not in obj.sources]
        for l in missing:
            w.append(Issue("warning", "missing_source_language", f"{base}.sources", f"aucune formulation {l}", cid))
    elif kind == "translation-memory":
        sid = obj.segment_id
        src_ph = tuple(placeholders(obj.source.text))
        for ti, t in enumerate(obj.targets):
            for txt in ([t.preferred] if t.preferred else []) + t.accepted:
                if tuple(placeholders(txt)) != src_ph:
                    errs.append(Issue("error", "placeholder_mismatch", f"{base}.targets[{ti}]", "jetons {{Pn}} de la cible différents de la source", sid))
                    break
            _ctx_warn(t.contexts, f"{base}.targets[{ti}].contexts", sid, w)
        if obj.concept_id and known_concepts is not None and obj.concept_id not in known_concepts:
            w.append(Issue("warning", "unknown_concept", f"{base}.concept_id", f"concept absent du glossaire : {obj.concept_id}", sid))
    elif kind in ("corpus", "benchmark"):
        iid = obj.item_id
        src_ph = tuple(placeholders(obj.source.text))
        refs = [obj.reference] if kind == "corpus" else obj.references
        for ref in refs:
            for txt in ([ref.text] if ref.text else []) + ref.accepted:
                if tuple(placeholders(txt)) != src_ph:
                    errs.append(Issue("error", "placeholder_mismatch", f"{base}.reference", "jetons {{Pn}} de la référence différents de la source", iid))
                    break
        if kind == "benchmark":
            for s in obj.must_preserve:
                if s not in obj.source.text:
                    errs.append(Issue("error", "must_preserve_not_in_source", f"{base}.must_preserve", f"« {s} » absent du texte source", iid))
        _ctx_warn(obj.contexts, f"{base}.contexts", iid, w)
        if known_concepts is not None:
            for c in obj.concept_ids:
                if c not in known_concepts:
                    w.append(Issue("warning", "unknown_concept", f"{base}.concept_ids", f"concept absent du glossaire : {c}", iid))
    elif kind == "corrections":
        ref = obj.target_ref
        if ref.kind == "glossary" and known_concepts is not None and ref.concept_id not in known_concepts:
            w.append(Issue("warning", "unknown_target", f"{base}.target_ref", f"concept inconnu : {ref.concept_id}", obj.correction_id))
        if ref.kind == "memory" and known_segments is not None and ref.segment_id not in known_segments:
            w.append(Issue("warning", "unknown_target", f"{base}.target_ref", f"segment inconnu : {ref.segment_id}", obj.correction_id))
    return errs


def _cross_warnings(kind: str, r: ValidationResult, key: str) -> None:
    """Formes sources identiques dans deux concepts sans contextes disjoints → ambiguïté (l'orchestrateur s'abstiendra)."""
    if kind != "glossary":
        return
    by: dict[tuple[str, str], list] = {}
    for obj in r.items:
        for lang, forms in obj.sources.items():
            for f in [forms.preferred, *forms.accepted]:
                by.setdefault((lang, normalize(f)), []).append(obj)
    for (lang, form), objs in by.items():
        ids = sorted({o.concept_id for o in objs})
        if len(ids) > 1:
            ctxs = [set(c for t in o.targets for c in t.contexts) | set(o.contexts) for o in objs]
            disjoint = all(a and b and not (a & b) for i, a in enumerate(ctxs) for b in ctxs[i + 1:])
            if not disjoint:
                r.warnings.append(Issue("warning", "ambiguous_form", key, f"forme {lang} « {form} » partagée par {ids} sans contextes disjoints", None))


def load_json(path) -> Any:
    from pathlib import Path
    return json.loads(Path(path).read_text(encoding="utf-8"))
