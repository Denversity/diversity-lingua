# Lance l'API (Windows). Utilise .venv s'il existe.
Set-Location (Join-Path $PSScriptRoot "..\backend")
$py = if (Test-Path ..\.venv\Scripts\python.exe) { "..\.venv\Scripts\python.exe" } else { "python" }
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
