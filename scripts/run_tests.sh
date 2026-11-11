#!/usr/bin/env bash
# Backend (pytest) + extension (typecheck + vitest) + contrat extension⇄backend sur un vrai serveur.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Schémas JSON publiés à jour"; python3 scripts/export_schemas.py --check
echo "== Backend"; (cd backend && python3 -m pytest -q)
echo "== Extension (types)"; (cd extension && npx tsc --noEmit)
echo "== Extension (unitaires + démo)"; (cd extension && npx vitest run)
echo "== Contrat extension ⇄ backend"
(cd backend && nohup python3 -m uvicorn app.main:app --port 8765 --log-level warning >/tmp/dl_srv.log 2>&1 </dev/null & echo $! > /tmp/dl_srv.pid)
trap 'kill $(cat /tmp/dl_srv.pid) 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf localhost:8765/api/v1/health >/dev/null && break; sleep 0.3; done
(cd extension && DL_E2E_URL=http://127.0.0.1:8765 npx vitest run tests/e2e.backend.test.ts)
# Tests dans un VRAI navigateur (préservation visuelle, scénarios dynamiques, interface injectée) — optionnels :
#   RUN_BROWSER=1 bash scripts/run_tests.sh      (utilise CHROME_PATH si défini, sinon @sparticuz/chromium)
if [ "${RUN_BROWSER:-0}" = "1" ]; then
  echo "== Navigateur réel (Chromium)"; (cd extension && node build.mjs >/dev/null && node tests-browser/preservation.mjs | tail -3 && node tests-browser/dynamic.mjs | tail -2 && node tests-browser/ui-screens.mjs | tail -2)
  echo "== Navigateur réel : content script dist + service worker réel + backend réel + ressources linguistiques"; bash scripts/test_real_extension.sh | tail -3
fi
echo "✔ Tout est vert"
