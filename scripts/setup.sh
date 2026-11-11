#!/usr/bin/env bash
# Installation complète : dépendances Python + Node, icônes, glossaire local, build de l'extension.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m pip install -r backend/requirements.txt ${PIP_FLAGS:-}
python3 -m pip install pillow ${PIP_FLAGS:-}
(cd extension && npm install --no-audit --no-fund)
python3 scripts/generate_icons.py
python3 scripts/build_glossary_templates.py
bash scripts/build_extension.sh
echo "✔ Installation terminée. Lancez : bash scripts/run_backend.sh"
