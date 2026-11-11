#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../backend"
[ -f ../.env ] && set -a && . ../.env && set +a
exec python3 -m uvicorn app.main:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}"
