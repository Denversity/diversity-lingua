#!/usr/bin/env bash
# Construit extension/dist. Dev : glossaire local avec fixtures de test. PROD=1 : sans fixtures.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${PROD:-0}" = "1" ]; then python3 scripts/export_glossary.py; else python3 scripts/export_glossary.py --include-test; fi
(cd extension && node build.mjs)
echo "→ Chargez extension/dist dans chrome://extensions (mode développeur → Charger l'extension non empaquetée)"
