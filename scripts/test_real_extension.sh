#!/usr/bin/env bash
# Test navigateur avec l extension RÉELLE (dist) + backend réel (port 8000) + ressources de data/.
# Prérequis : CHROME_PATH (Chrome/Chromium installé), `npm ci` dans extension/, dépendances Python du backend.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CHROME_PATH:?Définir CHROME_PATH vers un Chrome/Chromium}"
(cd backend && DL_ALLOW_TEST_DATA=false python3 -m uvicorn app.main:app --port 8000 >/tmp/dl-backend.log 2>&1 & echo $! >/tmp/dl-backend.pid)
trap "kill \$(cat /tmp/dl-backend.pid) 2>/dev/null || true" EXIT
for i in $(seq 1 30); do curl -sf http://localhost:8000/api/v1/health >/dev/null && break; sleep 1; done
(cd extension && node tests-browser/real-extension.mjs)
