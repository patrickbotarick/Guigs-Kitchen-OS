$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js e npm são necessários. Instale Node.js 20.19+ e tente novamente.' -ForegroundColor Red
    exit 1
}

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Host 'Node.js 20.19+ é necessário.' -ForegroundColor Red
    exit 1
}

$apiListener = Get-NetTCPConnection -LocalPort 3333 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$webListener = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apiListener -or $webListener) {
    $apiIsKitchen = $false
    $webIsKitchen = $false
    if ($apiListener) {
        try { $apiIsKitchen = (Invoke-RestMethod -Uri 'http://127.0.0.1:3333/health' -TimeoutSec 5).status -eq 'ok' } catch {}
    }
    if ($webListener) {
        try { $webIsKitchen = (Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 5).Content.Contains("Guig's Kitchen") } catch {}
    }
    if ($apiIsKitchen -and $webIsKitchen) {
        Write-Host "Guig's Kitchen já está em execução em http://localhost:5173 (API: http://localhost:3333)." -ForegroundColor Yellow
        Write-Host 'Encerre a instância anterior com Ctrl+C antes de iniciar uma versão atualizada.'
        exit 0
    }
    Write-Host 'Não foi possível iniciar: uma ou ambas as portas estão ocupadas.' -ForegroundColor Red
    if ($apiListener) { Write-Host "Porta 3333: processo $($apiListener.OwningProcess)" }
    if ($webListener) { Write-Host "Porta 5173: processo $($webListener.OwningProcess)" }
    Write-Host 'Verifique esses processos e tente novamente. Nenhum processo foi encerrado.'
    exit 1
}

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host 'Configuração local criada em .env'
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Host 'Instalando dependências...'
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

node scripts/setup-state.mjs check
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Preparando Prisma e banco local...'
    npm run setup
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Falha ao preparar o banco. Verifique os logs acima.' -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host ''
Write-Host '======================================='
Write-Host " GUIG'S KITCHEN"
Write-Host '======================================='
Write-Host 'Painel: http://localhost:5173'
Write-Host 'API:    http://localhost:3333'
Write-Host 'Ctrl+C para encerrar.'
Write-Host ''
npm run dev
exit $LASTEXITCODE
