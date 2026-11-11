"""Routes API v1."""
from __future__ import annotations

import hmac
import json
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header, Request

from ..schemas import (ExplainRequest, ExplainResponse, FeedbackRequest, TranslateRequest,
                       TranslateResponse, ValidateRequest)

router = APIRouter(prefix="/api/v1")
VERSION = "0.1.0"


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", uuid.uuid4().hex[:12])


@router.get("/health")
async def health(request: Request):
    app = request.app.state
    return {
        "status": "ok", "version": VERSION, "env": app.settings.env,
        "providers": [p.describe() for p in app.providers],
        "languages": [{"code": l.code, "availability": l.availability} for l in app.languages.targets()],
        "glossary": app.glossary.stats(),
        "load_errors": len(app.glossary.load_errors) + len(app.memory.load_errors),
    }


@router.get("/languages")
async def languages(request: Request):
    st = request.app.state
    return {"source_languages": st.languages.source_languages,
            "target_languages": [l.public() | {
                "approved_targets": st.glossary.stats().get(l.code, {}).get("approved", 0),
                "validated_entries": st.glossary.stats().get(l.code, {}).get("approved", 0),  # alias v1 historique
                "pending_entries": st.glossary.stats().get(l.code, {}).get("pending_validation", 0),
                "rejected_entries": st.glossary.stats().get(l.code, {}).get("rejected", 0)}
                for l in st.languages.targets()]}


@router.get("/providers")
async def providers(request: Request):
    """État honnête des fournisseurs : « configured » reflète la présence réelle de la configuration."""
    return {"order": request.app.state.settings.provider_names,
            "providers": [p.describe() for p in request.app.state.providers]}


@router.post("/translate", response_model=TranslateResponse)
async def translate(body: TranslateRequest, request: Request):
    st = request.app.state
    s = st.settings
    if len(body.segments) > s.max_segments:
        raise ApiError(413, "too_many_segments", f"max {s.max_segments} segments par requête")
    total = 0
    for seg in body.segments:
        if len(seg.text) > s.max_segment_chars:
            raise ApiError(413, "segment_too_long", f"segment {seg.id} dépasse {s.max_segment_chars} caractères")
        total += len(seg.text)
    if total > s.max_total_chars:
        raise ApiError(413, "payload_too_large", f"max {s.max_total_chars} caractères au total")
    if st.languages.target(body.target_lang) is None:
        raise ApiError(400, "unknown_target_language", f"langue cible inconnue : {body.target_lang}")
    request.state.n_segments = len(body.segments)
    return await st.orchestrator.translate(body, _rid(request))


@router.post("/explain", response_model=ExplainResponse)
async def explain(body: ExplainRequest, request: Request):
    st = request.app.state
    if st.languages.target(body.target_lang) is None:
        raise ApiError(400, "unknown_target_language", f"langue cible inconnue : {body.target_lang}")
    return await st.explainer.explain(body, _rid(request))


@router.get("/glossary")
async def glossary(request: Request, target: str | None = None, source: str | None = None, status: str | None = None,
                   concept_id: str | None = None, q: str | None = None, limit: int = 200, offset: int = 0):
    """Entrées à plat (une par formulation source). Filtres : langue, statut, concept_id, texte contenu (q)."""
    limit = max(1, min(limit, 1000))
    total, items = request.app.state.glossary.list(target=target, source=source, status=status, concept_id=concept_id,
                                                   q=q, limit=limit, offset=offset)
    return {"total": total, "limit": limit, "offset": offset, "entries": [e.public() for e in items]}


@router.get("/glossary/lookup")
async def glossary_lookup(request: Request, text: str, lang: str, target: str | None = None):
    """Recherche par formulation EXACTE dans UNE langue source (fr|en) — jamais de mélange entre langues."""
    if lang not in request.app.state.languages.source_codes():
        raise ApiError(400, "unsupported_source_language", f"langue source inconnue : {lang}")
    st = request.app.state
    return {"lang": lang, "entries": [e.public() for e in st.glossary.find_by_form(text, lang, target)],
            "memory": [e.public() for e in st.memory.find_by_form(text, lang, target)]}


@router.get("/glossary/concepts/{concept_id}")
async def glossary_concept(concept_id: str, request: Request, target: str | None = None):
    st = request.app.state
    es = st.glossary.find_by_concept(concept_id, target)
    if not es:
        raise ApiError(404, "concept_not_found", concept_id)
    by_target: dict[str, dict] = {}
    for e in es:
        by_target.setdefault(e.target_id, {"target_id": e.target_id, "target_lang": e.target_lang, "status": e.status, "version": e.version,
                                           "contexts": e.contexts, "preferred": e.translation, "accepted": e.alternatives})
    forms: dict[str, list[str]] = {}
    for e in es:
        if e.target_id == es[0].target_id:
            forms.setdefault(e.source_lang, []).append(e.source_text)
    return {"concept_id": concept_id, "sources": forms, "targets": list(by_target.values())}


@router.get("/glossary/export")
async def glossary_export(request: Request, target: str):
    """Instantané des entrées APPROUVÉES uniquement — alimente le glossaire local de l'extension."""
    st = request.app.state
    _, items = st.glossary.list(target=target, status="approved", limit=100000)
    return {"language": target, "version": st.glossary.versions.get(target, "0"),
            "entries": [{"id": e.id, "concept_id": e.concept_id, "source_lang": e.source_lang, "source_text": e.source_text,
                         "translation": e.translation, "contexts": e.contexts, "test_data": e.test_data}
                        for e in items if e.usable]}


@router.get("/referentiel")
async def referentiel(request: Request):
    """État du référentiel chargé : versions, comptages par statut, erreurs de chargement, derniers imports."""
    from ..referentiel.store import ReferentielStore
    st = request.app.state
    store = ReferentielStore(st.settings.data_dir, st.settings.state_dir)
    return {"glossary": {"versions": st.glossary.versions, "targets_by_status": st.glossary.stats(), "load_errors": st.glossary.load_errors},
            "memory": {"versions": st.memory.versions, "targets_by_status": st.memory.stats(), "load_errors": st.memory.load_errors},
            "recent_imports": store.history()[-10:]}


@router.post("/referentiel/reload")
async def referentiel_reload(request: Request, x_dl_admin_token: str | None = Header(default=None)):
    """Recharge glossaire et mémoire depuis le disque (après un import en ligne de commande)."""
    st = request.app.state
    admin = st.settings.admin_token
    if not admin or not x_dl_admin_token or not hmac.compare_digest(admin, x_dl_admin_token):
        raise ApiError(403, "forbidden", "rechargement réservé aux administrateurs (DL_ADMIN_TOKEN)")
    st.glossary.reload(); st.memory.reload()
    from ..services.languages import LanguageService
    st.languages = LanguageService(st.settings.data_dir / "languages.json", allow_test=st.settings.allow_test_data)
    st.orchestrator.languages = st.languages
    return {"reloaded": True, "glossary_errors": len(st.glossary.load_errors), "memory_errors": len(st.memory.load_errors)}


@router.post("/glossary/validate")
async def glossary_validate(body: ValidateRequest, request: Request,
                            x_dl_admin_token: str | None = Header(default=None)):
    st = request.app.state
    admin = st.settings.admin_token
    if not admin or not x_dl_admin_token or not hmac.compare_digest(admin, x_dl_admin_token):
        raise ApiError(403, "forbidden", "validation réservée aux validateurs autorisés (DL_ADMIN_TOKEN)")
    try:
        entry = st.glossary.validate(body.entry_id, body.decision, body.validator_id, body.translation, body.method)
    except KeyError:
        raise ApiError(404, "entry_not_found", body.entry_id)
    except ValueError as e:
        raise ApiError(422, "invalid_validation", str(e))
    return {"entry": entry.public()}


@router.post("/feedback", status_code=202)
async def feedback(body: FeedbackRequest, request: Request):
    """Retour/correction linguistique : mis en file « pending_review », jamais appliqué automatiquement."""
    st = request.app.state
    st.settings.state_dir.mkdir(parents=True, exist_ok=True)
    rec = body.model_dump() | {"status": "pending_review", "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    with (st.settings.state_dir / "feedback.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return {"status": "pending_review"}
