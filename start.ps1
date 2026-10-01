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

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host 'Configuração local criada em .env'
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Host 'Instalando dependências...'
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Preparando Prisma e banco local...'
npm run db:prepare
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

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
