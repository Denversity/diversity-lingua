"""Point d'entrée FastAPI — Diversity Lingua API."""
from __future__ import annotations

import hmac
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.v1 import VERSION, ApiError, router
from .core.config import Settings, get_settings
from .core.logging import log, setup_logging
from .providers.registry import build_providers
from .services.explain import ExplainService
from .services.glossary import GlossaryService
from .services.languages import LanguageService
from .services.orchestrator import Orchestrator

PUBLIC_PATHS = ("/api/v1/health", "/docs", "/openapi.json", "/redoc", "/demo")


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or get_settings()
    logger = setup_logging(s.log_level)
    app = FastAPI(title="Diversity Lingua API", version=VERSION)

    languages = LanguageService(s.data_dir / "languages.json", allow_test=s.allow_test_data)
    glossary = GlossaryService(s.data_dir / "glossary", s.state_dir, s.allow_test_data, name="glossary")
    memory = GlossaryService(s.data_dir / "memory", s.state_dir, s.allow_test_data, name="memory")
    providers = build_providers(s, glossary, memory)
    orchestrator = Orchestrator(s, languages, providers, glossary, logger)
    app.state.settings, app.state.languages = s, languages
    app.state.glossary, app.state.memory, app.state.providers = glossary, memory, providers
    app.state.orchestrator = orchestrator
    app.state.explainer = ExplainService(s.data_dir / "concepts.json", orchestrator)
    hits: dict[str, deque] = defaultdict(deque)

    @app.exception_handler(ApiError)
    async def _api_error(_, e: ApiError):
        return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_, e: RequestValidationError):
        # On ne renvoie pas la valeur fautive (peut contenir des données de l'utilisateur).
        errs = [{"loc": [str(x) for x in err["loc"]], "type": err["type"]} for err in e.errors()]
        return JSONResponse({"error": {"code": "invalid_request", "message": "requête invalide", "details": errs}},
                            status_code=422)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        request.state.request_id = uuid.uuid4().hex[:12]
        path, t0 = request.url.path, time.perf_counter()
        if request.method != "OPTIONS" and not path.startswith(PUBLIC_PATHS):
            tok = request.headers.get("x-dl-token", "")
            if s.api_token and not hmac.compare_digest(s.api_token, tok):
                return JSONResponse({"error": {"code": "unauthorized", "message": "jeton API requis"}}, status_code=401)
            key = tok or (request.client.host if request.client else "anon")
            now, q = time.monotonic(), hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= s.rate_limit_per_min:
                return JSONResponse({"error": {"code": "rate_limited", "message": "trop de requêtes"}},
                                    status_code=429, headers={"Retry-After": "10"})
            q.append(now)
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        log(logger, "http", request_id=request.state.request_id, method=request.method, path=path,
            status=response.status_code, ms=int((time.perf_counter() - t0) * 1000))
        return response

    app.add_middleware(CORSMiddleware, allow_origin_regex=s.cors_origin_regex, allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Content-Type", "X-DL-Token", "X-DL-Admin-Token"], max_age=600)
    app.include_router(router)
    if s.allow_test_data and s.demo_dir.exists():
        app.mount("/demo", StaticFiles(directory=s.demo_dir, html=True), name="demo")
    return app


app = create_app()
