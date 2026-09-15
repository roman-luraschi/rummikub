# Publica el juego con localtunnel (HTTPS / puerto 443).
# La PC tiene que quedar encendida. El link cambia cada vez que lo arrancás.
param(
    [int]$Port = 4173
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

Write-Host "Levantando preview en http://127.0.0.1:$Port ..."
$preview = Start-Process -FilePath "npm.cmd" -ArgumentList @(
    "run", "preview", "--", "--host", "127.0.0.1", "--port", "$Port"
) -WorkingDirectory (Join-Path $Root "web") -PassThru -NoNewWindow
Pop-Location

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
        $response = Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing
        if ($response.StatusCode -eq 200) { $ok = $true; break }
    } catch {
        if ($preview.HasExited) {
            throw "vite preview salio antes de quedar listo (exit $($preview.ExitCode)). El puerto $Port esta ocupado?"
        }
    }
}
if (-not $ok) {
    Stop-Process -Id $preview.Id -Force -ErrorAction SilentlyContinue
    throw "vite preview no respondio en http://127.0.0.1:$Port/"
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
    if ($preview -and -not $preview.HasExited) {
        Stop-Process -Id $preview.Id -Force -ErrorAction SilentlyContinue
    }
}
