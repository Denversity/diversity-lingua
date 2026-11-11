param(
    [switch]$BuildExtension
)

# Installe le backend sans reconstruire l'extension précompilée livrée dans extension/dist.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv .venv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv .venv
    } else {
        throw "Python est introuvable. Installez Python 3.11+ puis relancez ce script."
    }
    if ($LASTEXITCODE -ne 0) { throw "La création de .venv a échoué (code $LASTEXITCODE)." }
}

& $python --version
if ($LASTEXITCODE -ne 0) {
    throw "Le .venv fourni est invalide ou non portable. Supprimez uniquement le dossier .venv copié, puis relancez ce script."
}

& $python -m pip install -r backend\requirements.txt
if ($LASTEXITCODE -ne 0) { throw "L'installation des dépendances du backend a échoué (code $LASTEXITCODE)." }

if ($BuildExtension) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "Node.js 18+ et npm sont nécessaires pour reconstruire l'extension."
    }
    Push-Location extension
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "L'installation des dépendances Node a échoué (code $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
    & $python scripts\export_glossary.py
    if ($LASTEXITCODE -ne 0) { throw "L'export du glossaire local a échoué (code $LASTEXITCODE)." }
    Push-Location extension
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "Le build de l'extension a échoué (code $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $root "extension\dist\manifest.json"))) {
    throw "L'extension précompilée est absente. Récupérez extension\dist avec le projet, ou reconstruisez-la avec .\scripts\setup.ps1 -BuildExtension."
}

Write-Host "Installation du backend terminée. L'extension précompilée est prête dans extension\dist."
Write-Host "Lancez .\scripts\run_backend.ps1, puis chargez extension\dist dans chrome://extensions."
