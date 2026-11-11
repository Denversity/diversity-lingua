#!/usr/bin/env bash
# Installe le backend et conserve le build précompilé. BUILD_EXTENSION=1 reconstruit l'extension depuis les sources.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m pip install -r backend/requirements.txt ${PIP_FLAGS:-}
if [ "${BUILD_EXTENSION:-0}" = "1" ]; then
  (cd extension && npm ci --no-audit --no-fund)
  python3 scripts/export_glossary.py
  (cd extension && npm run build)
fi
test -f extension/dist/manifest.json || {
  echo "Extension précompilée absente. Incluez extension/dist ou relancez avec BUILD_EXTENSION=1." >&2
  exit 1
}
echo "✔ Installation terminée. Lancez : bash scripts/run_backend.sh"
