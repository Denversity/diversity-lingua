# Installation Windows (PowerShell) — équivalent de setup.sh. NON TESTÉ sous Windows par l'équipe de développement.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path .venv)) { py -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt pillow
Push-Location extension; npm install; Pop-Location
& .\.venv\Scripts\python.exe scripts\generate_icons.py
& .\.venv\Scripts\python.exe scripts\build_glossary_templates.py
& .\.venv\Scripts\python.exe scripts\export_glossary.py --include-test
Push-Location extension; node build.mjs; Pop-Location
Write-Host "OK. Lancez : .\scripts\run_backend.ps1  puis chargez extension\dist dans chrome://extensions"
