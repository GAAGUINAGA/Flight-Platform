<#
.SYNOPSIS
  Levanta la plataforma local completa (Postgres de Docker, 7 microservicios y el Gateway) en perfil de integración local y verifica su salud.
.DESCRIPTION
  Pensado para la reunión con Booking por Tailscale (http/gRPC sin TLS, de servidor a servidor). Todo se construye con configuración de producción
  por defecto; el perfil de integración local se activa SOLO con INTEGRATION_LOCAL=true, que este script fija únicamente en sus procesos:
    - los microservicios escuchan solo en 127.0.0.1;
    - el Gateway escucha en 0.0.0.0 (es el único puerto que se abre en el firewall);
    - emisor del dev-auth y _links salen de PUBLIC_BASE_URL.
  No lee ningún .env: los procesos de cada servicio cargan el suyo. Los valores del perfil (.local/integracion.env) no se imprimen.
.PARAMETER SkipBuild   No reconstruye (usa dist/ existente).
.PARAMETER SkipDocker  No ejecuta docker compose (la base ya está levantada).
.PARAMETER GatewayPort Puerto del Gateway (por defecto 3000).
.PARAMETER ProfileFile Perfil de integración local (por defecto .local/integracion.env; plantilla en docs/dev/integracion-local.env.example).
#>
param(
  [switch]$SkipBuild,
  [switch]$SkipDocker,
  [int]$GatewayPort = 3000,
  [int]$GraphqlPort = 4000,
  [string]$ProfileFile,
  [int]$HealthTimeoutSec = 120,
  [ValidateSet('esb', 'grpc')][string]$Transport = 'esb'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:Repo
if (-not $ProfileFile) { $ProfileFile = $script:DefaultProfile }

# 1. Requisitos (solo existencia de archivos; no se lee ningún .env)
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { throw "Se necesita Node 20 o superior (hay $nodeMajor). Ver .nvmrc." }
if ($env:NODE_ENV -eq 'production') { throw 'NODE_ENV=production en esta terminal: el perfil de integración local lo rechaza. Ábrela sin esa variable.' }
foreach ($svc in $script:Services) { if (-not (Test-Path -LiteralPath (Join-Path $svc.Dir '.env'))) { throw "Falta $($svc.Dir)/.env (ver AGENTS.md y docs/dev/f12a-preparar-reunion.md)." } }
if (-not (Test-Path -LiteralPath 'platform/api-gateway/.env')) { throw 'Falta platform/api-gateway/.env (plantilla: platform/api-gateway/.env.example).' }
if (-not (Test-Path -LiteralPath (Join-Path $script:Esb.Dir '.env'))) { throw "Falta $($script:Esb.Dir)/.env (plantilla: $($script:Esb.Dir)/.env.example; INTERNAL_API_KEY igual que la del Gateway y los servicios)." }
foreach ($svc in $script:Services) { if (Test-Path -LiteralPath (Join-Path $script:PidDir "$($svc.Name).pid")) { throw "Ya hay una plataforma en marcha (pid de $($svc.Name)). Ejecuta scripts/local-platform/down.ps1 primero." } }
if (Test-Path -LiteralPath (Join-Path $script:PidDir 'esb.pid')) { throw 'Ya hay una plataforma en marcha (pid del esb). Ejecuta scripts/local-platform/down.ps1 primero.' }
if (Test-Path -LiteralPath (Join-Path $script:PidDir 'gateway.pid')) { throw 'Ya hay una plataforma en marcha (pid del gateway). Ejecuta scripts/local-platform/down.ps1 primero.' }
if (Test-Path -LiteralPath (Join-Path $script:PidDir 'graphql.pid')) { throw 'Ya hay una plataforma en marcha (pid de graphql). Ejecuta scripts/local-platform/down.ps1 primero.' }
$busy = @($script:Services | Where-Object { Test-PortOpen $_.Port } | ForEach-Object { "$($_.Name):$($_.Port)" })
if (Test-PortOpen $script:Esb.Port) { $busy += "esb:$($script:Esb.Port)" }
if (Test-PortOpen $GatewayPort) { $busy += "gateway:$GatewayPort" }
if (Test-PortOpen $GraphqlPort) { $busy += "graphql:$GraphqlPort" }
if ($busy.Count -gt 0) { throw "Puertos ocupados: $($busy -join ', '). Detén lo que los usa (o ejecuta down.ps1)." }

# 2. Perfil de integración local
$cfg = Read-Profile $ProfileFile
if (-not $cfg.Contains('PUBLIC_BASE_URL')) { $cfg['PUBLIC_BASE_URL'] = "http://127.0.0.1:$GatewayPort"; Write-Warning "El perfil no define PUBLIC_BASE_URL: se usa http://127.0.0.1:$GatewayPort. Para Booking debe ser la IP Tailscale (http://100.x.x.x:$GatewayPort)." }
if ($cfg.Contains('BOOKING_PAYMENTS_VERIFY') -and $cfg['BOOKING_PAYMENTS_VERIFY'] -eq 'off') {
  Write-Warning 'BOOKING_PAYMENTS_VERIFY=off: los pagos de Booking NO se verificarán. Úsalo solo si su API de pagos no está disponible.'
}
Write-Host "Perfil: $(if (Test-Path -LiteralPath $ProfileFile) { $ProfileFile } else { '(sin archivo; valores por defecto)' }) · $($cfg.Count) variables"

# 3. Llave del dev-auth: se genera una vez, queda en .local/ (ignorado por git) y no se imprime
New-Item -ItemType Directory -Force -Path $script:LocalDir | Out-Null
$keyFile = Join-Path $script:LocalDir 'dev-auth-key.pem'
if (-not (Test-Path -LiteralPath $keyFile)) {
  Invoke-Checked 'generar la llave del dev-auth' { node -e "const c=require('crypto');const k=c.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});require('fs').writeFileSync(process.argv[1],k.privateKey,{mode:0o600});" $keyFile }
  Write-Host 'Llave del dev-auth generada en .local/dev-auth-key.pem (no se versiona).'
}

# 4. Postgres local (la administra docker compose; el humano ya lo tiene si usa -SkipDocker)
if (-not $SkipDocker) {
  Invoke-Checked 'docker compose up' { docker compose -f infra/docker-compose.yml up -d }
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-PortOpen 15432)) { if ((Get-Date) -gt $deadline) { throw 'Postgres no responde en 127.0.0.1:15432.' }; Start-Sleep -Seconds 2 }
} elseif (-not (Test-PortOpen 15432)) { throw 'Postgres no responde en 127.0.0.1:15432 (usaste -SkipDocker).' }
Write-Host 'Postgres: 127.0.0.1:15432 responde.'
# RabbitMQ (F12b-2): el contenedor lo administra el humano con infra/docker-compose.yml. Sin él el ESB no puede publicar eventos.
if (-not $SkipDocker) {
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-PortOpen 5672)) { if ((Get-Date) -gt $deadline) { throw 'RabbitMQ no responde en 127.0.0.1:5672.' }; Start-Sleep -Seconds 2 }
} elseif (-not (Test-PortOpen 5672)) { throw 'RabbitMQ no responde en 127.0.0.1:5672 (usaste -SkipDocker). Levanta el servicio rabbitmq de infra/docker-compose.yml.' }
Write-Host 'RabbitMQ: 127.0.0.1:5672 responde.'

# 5. Construcción (clientes Prisma, utilidades compartidas, servicios y Gateway)
if (-not $SkipBuild) {
  Invoke-Checked 'build de @flight-platform/shared' { npm run build -w '@flight-platform/shared' --silent }
  foreach ($svc in $script:Services) {
    $pkg = "@flight-platform/$($svc.Name)-service"
    Invoke-Checked "prisma generate de $pkg" { npm run prisma:generate -w $pkg --silent }
    Invoke-Checked "build de $pkg" { npm run build -w $pkg --silent }
  }
  Invoke-Checked 'build del esb' { npm run build -w '@flight-platform/esb-service' --silent }
  Invoke-Checked 'build del gateway' { npm run build -w '@flight-platform/api-gateway' --silent }
  Invoke-Checked 'build del servicio graphql' { npm run build -w '@flight-platform/graphql' --silent }
  Write-Host 'Construcción terminada.'
}
foreach ($svc in $script:Services) { if (-not (Test-Path -LiteralPath (Join-Path $svc.Dir 'dist/main.js'))) { throw "Falta $($svc.Dir)/dist/main.js: ejecuta sin -SkipBuild." } }
if (-not (Test-Path -LiteralPath (Join-Path $script:Esb.Dir 'dist/main.js'))) { throw "Falta $($script:Esb.Dir)/dist/main.js: ejecuta sin -SkipBuild." }
if (-not (Test-Path -LiteralPath 'platform/api-gateway/dist/src/main.js')) { throw 'Falta platform/api-gateway/dist/src/main.js: ejecuta sin -SkipBuild.' }
if (-not (Test-Path -LiteralPath 'platform/graphql/dist/main.js')) { throw 'Falta platform/graphql/dist/main.js: ejecuta sin -SkipBuild.' }

# 6. Procesos. Los servicios se llaman entre sí por 127.0.0.1 (en Windows `localhost` puede resolver a ::1 y ellos escuchan en IPv4).
$grpcUrls = @{}
foreach ($svc in $script:Services) { $grpcUrls["$($svc.Name.ToUpperInvariant())_GRPC_URL"] = "127.0.0.1:$($svc.Port)" }
function Select-Profile([string]$Pattern) { $selected = @{}; foreach ($key in $cfg.Keys) { if ($key -match $Pattern) { $selected[$key] = $cfg[$key] } }; return $selected }
$started = @()
# Emisores JWT: los del perfil (JWT_ISSUERS) o, si no, los de la terminal; los de platform/api-gateway/.env NO se leen (el Gateway los carga él mismo).
# El emisor de desarrollo se suma si existe la llave pública (solo existencia del archivo; se pasa la RUTA, nunca el contenido).
$baseIssuers = @()
$issuersText = if ($cfg.Contains('JWT_ISSUERS')) { $cfg['JWT_ISSUERS'] } else { $env:JWT_ISSUERS }
if ($issuersText) { $baseIssuers = @(ConvertFrom-Json -InputObject $issuersText) }
$devPublicKey = (Join-Path $script:Repo 'infra/dev-keys/dev-public.pem').Replace('\', '/')
$devIssuer = $null
if (Test-Path -LiteralPath $devPublicKey) { if (-not (@($baseIssuers) | Where-Object { $_.iss -eq 'flight-platform-dev' })) { $devIssuer = [ordered]@{ iss = 'flight-platform-dev'; aud = 'flight-platform'; publicKeyFile = $devPublicKey } } }
else { Write-Warning 'No hay infra/dev-keys: el Gateway no aceptará tokens de desarrollo (los recorridos de GraphQL los necesitan; npm run dev:token -- --init-keys).' }
# Canal WEB local: pago simulado (lo necesitan Reservation, que valida el pago, y el Gateway) y correo sin verificar. Un valor explícito en el perfil o la terminal gana.
$webPaymentMode = if ($cfg.Contains('WEB_PAYMENT_MODE')) { $cfg['WEB_PAYMENT_MODE'] } elseif ($env:WEB_PAYMENT_MODE) { $env:WEB_PAYMENT_MODE } else { 'simulated' }
$webRequireVerified = if ($cfg.Contains('WEB_REQUIRE_VERIFIED_EMAIL')) { $cfg['WEB_REQUIRE_VERIFIED_EMAIL'] } elseif ($env:WEB_REQUIRE_VERIFIED_EMAIL) { $env:WEB_REQUIRE_VERIFIED_EMAIL } else { 'false' }
try {
  foreach ($svc in $script:Services) {
    $vars = Select-Profile $svc.Pass
    if ($svc.Name -eq 'reservation') { $vars['WEB_PAYMENT_MODE'] = $webPaymentMode }
    foreach ($key in $grpcUrls.Keys) { $vars[$key] = $grpcUrls[$key] }
    $vars['INTEGRATION_LOCAL'] = 'true'; $vars['NODE_ENV'] = 'development'; $vars['PORT'] = [string]$svc.Port
    # F12b-2: los emisores publican sus eventos por el ESB (outbox → bus). Webhooks los retira con su RABBITMQ_URL (de su .env).
    if (@('inventory', 'reservation', 'operations') -contains $svc.Name) { $vars['ESB_URL'] = "http://127.0.0.1:$($script:Esb.Port)" }
    $process = Start-LocalProcess $svc.Name (Join-Path $script:Repo $svc.Dir) @('dist/main.js') $vars
    $started += $svc.Name; Write-Host ("  {0,-12} 127.0.0.1:{1} (pid {2})" -f $svc.Name, $svc.Port, $process.Id)
  }
  $esbVars = @{}
  foreach ($key in $grpcUrls.Keys) { $esbVars[$key] = $grpcUrls[$key] }
  $esbVars['INTEGRATION_LOCAL'] = 'true'; $esbVars['NODE_ENV'] = 'development'; $esbVars['PORT'] = [string]$script:Esb.Port
  # OJO: PowerShell no distingue mayúsculas; el proceso no puede llamarse $esb (pisaría a $script:Esb).
  $esbProcess = Start-LocalProcess $script:Esb.Name (Join-Path $script:Repo $script:Esb.Dir) @('dist/main.js') $esbVars
  $started += $script:Esb.Name; Write-Host ("  {0,-12} 127.0.0.1:{1} (pid {2})" -f 'esb', $script:Esb.Port, $esbProcess.Id)
  $gatewayVars = Select-Profile $script:GatewayPass
  foreach ($key in $grpcUrls.Keys) { $gatewayVars[$key] = $grpcUrls[$key] }
  $gatewayVars['GATEWAY_TRANSPORT'] = $Transport; $gatewayVars['ESB_URL'] = "http://127.0.0.1:$($script:Esb.Port)"
  $gatewayVars['INTEGRATION_LOCAL'] = 'true'; $gatewayVars['NODE_ENV'] = 'development'; $gatewayVars['PORT'] = [string]$GatewayPort
  $gatewayVars['DEV_AUTH_PRIVATE_KEY_FILE'] = $keyFile
  # Lo que necesitan los recorridos locales (solo local: NODE_ENV=development e INTEGRATION_LOCAL=true; el Gateway lo rechaza en producción):
  # el emisor de desarrollo SUMADO a los del perfil/.env (JWT_ISSUERS_EXTRA), canal WEB con pago simulado y sin exigir correo verificado.
  # Un valor explícito en el perfil gana; el marcador .local/platform-config.json (sin secretos) lo lee el recorrido de GraphQL.
  if ($devIssuer) { $gatewayVars['JWT_ISSUERS_EXTRA'] = (ConvertTo-Json -InputObject @($devIssuer) -Compress) }
  $gatewayVars['WEB_PAYMENT_MODE'] = $webPaymentMode; $gatewayVars['WEB_REQUIRE_VERIFIED_EMAIL'] = $webRequireVerified
  $marker = [ordered]@{ devIssuer = [bool]($devIssuer -or (@($baseIssuers) | Where-Object { $_.iss -eq 'flight-platform-dev' })); webPaymentMode = $gatewayVars['WEB_PAYMENT_MODE']; webRequireVerifiedEmail = $gatewayVars['WEB_REQUIRE_VERIFIED_EMAIL']; gatewayPort = $GatewayPort; graphqlPort = $GraphqlPort }
  Set-Content -LiteralPath (Join-Path $script:LocalDir 'platform-config.json') -Value (ConvertTo-Json -InputObject $marker)
  if (-not $gatewayVars.ContainsKey('SCHEDULER_ENABLED')) { $gatewayVars['SCHEDULER_ENABLED'] = 'true' }
  if (-not $gatewayVars.ContainsKey('SCHEDULER_EVERY_MS')) { $gatewayVars['SCHEDULER_EVERY_MS'] = '5000' }
  $gateway = Start-LocalProcess 'gateway' (Join-Path $script:Repo 'platform/api-gateway') @('--env-file=.env', 'dist/src/main.js') $gatewayVars
  $started += 'gateway'; Write-Host ("  {0,-12} 0.0.0.0:{1} (pid {2})" -f 'gateway', $GatewayPort, $gateway.Id)
  # Servicio GraphQL (F12c-1): llama al Gateway por HTTP. Emisores JWT: los del perfil o del entorno de la terminal; sin ellos, el emisor de desarrollo (solo se pasa la RUTA de la llave pública).
  # GraphQL usa los MISMOS emisores que el Gateway: los del perfil (o de la terminal) más el de desarrollo.
  $gqlVars = Select-Profile $script:GraphqlPass
  $gqlVars['JWT_ISSUERS'] = (ConvertTo-Json -InputObject @($baseIssuers + $(if ($devIssuer) { @($devIssuer) } else { @() })) -Compress)
  if ($baseIssuers.Count -eq 0 -and -not $devIssuer) { throw 'GraphQL: sin emisores JWT (ni en el perfil ni en el entorno) y sin infra/dev-keys (npm run dev:token -- --init-keys).' }
  if (-not $gqlVars.ContainsKey('CORS_ORIGINS')) { $gqlVars['CORS_ORIGINS'] = 'http://localhost:5173' }
  $gqlVars['NODE_ENV'] = 'development'; $gqlVars['PORT'] = [string]$GraphqlPort; $gqlVars['GATEWAY_BASE_URL'] = "http://127.0.0.1:$GatewayPort"
  $graphql = Start-LocalProcess 'graphql' (Join-Path $script:Repo 'platform/graphql') @('dist/main.js') $gqlVars
  $started += 'graphql'; Write-Host ("  {0,-12} 127.0.0.1:{1} (pid {2})" -f 'graphql', $GraphqlPort, $graphql.Id)
  Start-Sleep -Seconds 3
  foreach ($name in $started) {
    $pidValue = [int](Get-Content -LiteralPath (Join-Path $script:PidDir "$name.pid") -TotalCount 1)
    if (-not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { throw "$name terminó al arrancar. Revisa .local/logs/$name.err.log" }
  }
} catch {
  Write-Host "Error al arrancar: $($_.Exception.Message)"
  foreach ($name in $started) { [void](Stop-LocalProcess $name) }
  exit 1
}

# 7. Health de todos al final
& node (Join-Path $PSScriptRoot 'health.cjs') --url "http://127.0.0.1:$GatewayPort" --esb "http://127.0.0.1:$($script:Esb.Port)" --broker '127.0.0.1:5672' --graphql "http://127.0.0.1:$GraphqlPort" --wait $HealthTimeoutSec
if ($LASTEXITCODE -ne 0) { Write-Host 'La plataforma no quedó sana. Revisa .local/logs/. Para detener: scripts/local-platform/down.ps1'; exit 1 }
Write-Host ''
Write-Host "Listo. URL pública declarada: $($cfg['PUBLIC_BASE_URL'])"
Write-Host "Servicio GraphQL: http://127.0.0.1:$GraphqlPort/graphql (solo local; no se abre en el firewall)."
Write-Host "Único puerto a abrir en el firewall: $GatewayPort/tcp (solo hacia la red Tailscale). Logs: .local/logs/. Detener: scripts/local-platform/down.ps1"
exit 0
