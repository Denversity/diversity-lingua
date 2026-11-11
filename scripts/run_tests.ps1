# Tests Windows : backend + extension (+ navigateur si $env:RUN_BROWSER = "1" et $env:CHROME_PATH défini). NON TESTÉ sous Windows.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$py = if (Test-Path .venv\Scripts\python.exe) { ".\.venv\Scripts\python.exe" } else { "python" }
& $py scripts\export_schemas.py --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location backend
& ..\$py -m pytest -q
$backendExit = $LASTEXITCODE
Pop-Location
if ($backendExit -ne 0) { exit $backendExit }
Push-Location extension
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npx vitest run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($env:RUN_BROWSER -eq "1") {
    node build.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node tests-browser\preservation.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node tests-browser\dynamic.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node tests-browser\ui-screens.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Pop-Location
