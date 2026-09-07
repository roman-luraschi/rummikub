# Publica el juego con localtunnel (HTTPS / puerto 443).
# La PC tiene que quedar encendida. El link cambia cada vez que lo arrancás.
param(
    [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

$ltJs = Join-Path $Root "tools\lt\node_modules\localtunnel\bin\lt.js"
if (-not (Test-Path $ltJs)) {
    Write-Host "Instalando localtunnel..."
    New-Item -ItemType Directory -Force -Path (Join-Path $Root "tools\lt") | Out-Null
    npm.cmd install --prefix (Join-Path $Root "tools\lt") localtunnel
    if (-not (Test-Path $ltJs)) {
        throw "No se pudo instalar localtunnel"
    }
}

Write-Host "Compilando la UI..."
Push-Location (Join-Path $Root "web")
npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Fallo npm run build"
}
Pop-Location

$env:PYTHONPATH = Join-Path $Root "engine"
Write-Host "Levantando el servidor en http://127.0.0.1:$Port ..."
$uvicorn = Start-Process -FilePath "python" -ArgumentList @(
    "-m", "uvicorn",
    "rummikub.api.server:app",
    "--host", "127.0.0.1",
    "--port", "$Port"
) -WorkingDirectory $Root -PassThru -NoNewWindow

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health"
        if ($health.ok) { $ok = $true; break }
    } catch {
        if ($uvicorn.HasExited) {
            throw "uvicorn salio antes de quedar listo (exit $($uvicorn.ExitCode)). El puerto $Port esta ocupado?"
        }
    }
}
if (-not $ok) {
    Stop-Process -Id $uvicorn.Id -Force -ErrorAction SilentlyContinue
    throw "uvicorn no respondio en http://127.0.0.1:$Port/api/health"
}

$tools = Join-Path $Root "tools"
$outLog = Join-Path $tools "tunnel.out.log"
$errLog = Join-Path $tools "tunnel.err.log"
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

Write-Host "Abriendo tunnel..."
$tunnelProc = Start-Process -FilePath "node" -ArgumentList @(
    $ltJs, "--port", "$Port"
) -WorkingDirectory $Root -PassThru -NoNewWindow -RedirectStandardOutput $outLog -RedirectStandardError $errLog

$publicUrl = $null
try {
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 400
        if ($tunnelProc.HasExited) {
            $blob = ""
            if (Test-Path $outLog) { $blob += Get-Content $outLog -Raw -ErrorAction SilentlyContinue }
            if (Test-Path $errLog) { $blob += Get-Content $errLog -Raw -ErrorAction SilentlyContinue }
            throw "El tunnel se cerro. Salida:`n$blob"
        }
        $blob = ""
        if (Test-Path $outLog) { $blob += Get-Content $outLog -Raw -ErrorAction SilentlyContinue }
        if (Test-Path $errLog) { $blob += Get-Content $errLog -Raw -ErrorAction SilentlyContinue }
        $m = [regex]::Match($blob, "https://[a-zA-Z0-9._\-]+")
        if ($m.Success) {
            $publicUrl = $m.Value
            break
        }
    }
    if (-not $publicUrl) {
        throw "El tunnel no publico una URL a tiempo."
    }

    $pwdHint = ""
    try {
        $pwdHint = (Invoke-RestMethod "https://loca.lt/mytunnelpassword" -TimeoutSec 8).ToString().Trim()
    } catch {}

    Write-Host ""
    Write-Host "Listo. Comparte este link:"
    Write-Host $publicUrl
    if ($pwdHint) {
        Write-Host "Si pide una clave, usa tu IP: $pwdHint"
    }
    Write-Host "Ctrl+C para cortar."
    Write-Host ""
    Wait-Process -Id $tunnelProc.Id
} finally {
    if ($tunnelProc -and -not $tunnelProc.HasExited) {
        Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($uvicorn -and -not $uvicorn.HasExited) {
        Stop-Process -Id $uvicorn.Id -Force -ErrorAction SilentlyContinue
    }
}
