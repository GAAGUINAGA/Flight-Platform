# Utilidades compartidas de up.ps1, down.ps1 y seed.ps1 (plataforma local de F12a). No imprimen valores de variables.
Set-StrictMode -Version Latest
# Salida en UTF-8 (acentos) también cuando se redirige a un archivo.
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$script:LocalDir = Join-Path $script:Repo '.local'
$script:PidDir = Join-Path $script:LocalDir 'pids'
$script:LogDir = Join-Path $script:LocalDir 'logs'
$script:DefaultProfile = Join-Path $script:LocalDir 'integracion.env'

# Orden de arranque: dependencias primero. Cada servicio escucha solo en 127.0.0.1 (INTEGRATION_LOCAL=true).
$script:Services = @(
  @{ Name = 'inventory';   Dir = 'microservices/inventory-service';   Port = 50051; Pass = '^$' },
  @{ Name = 'pricing';     Dir = 'microservices/pricing-service';     Port = 50052; Pass = '^$' },
  @{ Name = 'ancillaries'; Dir = 'microservices/ancillaries-service'; Port = 50053; Pass = '^$' },
  @{ Name = 'ticketing';   Dir = 'microservices/ticketing-service';   Port = 50055; Pass = '^$' },
  @{ Name = 'operations';  Dir = 'microservices/operations-service';  Port = 50056; Pass = '^$' },
  @{ Name = 'webhooks';    Dir = 'microservices/webhooks-service';    Port = 50057; Pass = '^WEBHOOK_' },
  @{ Name = 'reservation'; Dir = 'microservices/reservation-service'; Port = 50054; Pass = '^BOOKING_PAYMENTS_' }
)
# Variables del perfil que recibe el Gateway (el resto del perfil no se le pasa).
$script:GatewayPass = '^(PUBLIC_BASE_URL|NODE_ID|PROVIDER_NAME|BOOKING_EVENTS_|BOOKING_STOCK_|STOCK_SYNC_|AIRPORT_TIMEZONES|SAGA_|DEV_AUTH_|WEBHOOK_SOURCE_CODE|HEALTH_|SCHEDULER_|RATE_LIMIT_|DOMESTIC_AIRPORTS|CORS_ORIGINS)'

function Read-Profile([string]$Path) {
  $values = [ordered]@{}
  if (-not (Test-Path -LiteralPath $Path)) { return $values }
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    $text = $line.Trim()
    if ($text -eq '' -or $text.StartsWith('#')) { continue }
    $index = $text.IndexOf('=')
    if ($index -lt 1) { throw "Línea inválida en $Path (se esperaba CLAVE=valor)." }
    $key = $text.Substring(0, $index).Trim(); $value = $text.Substring($index + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
    $values[$key] = $value
  }
  return $values
}

function Test-PortOpen([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null); return ($async.AsyncWaitHandle.WaitOne(400) -and $client.Connected) }
  catch { return $false }
  finally { $client.Close() }
}

function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Description (código $LASTEXITCODE)." }
}

function Start-LocalProcess([string]$Name, [string]$WorkDir, [string[]]$NodeArgs, [hashtable]$EnvVars) {
  New-Item -ItemType Directory -Force -Path $script:PidDir, $script:LogDir | Out-Null
  $saved = @{}
  foreach ($key in $EnvVars.Keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process'); [Environment]::SetEnvironmentVariable($key, [string]$EnvVars[$key], 'Process') }
  try {
    $quoted = $NodeArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
    $process = Start-Process -FilePath 'node' -ArgumentList $quoted -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $script:LogDir "$Name.out.log") -RedirectStandardError (Join-Path $script:LogDir "$Name.err.log")
  } finally { foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') } }
  Set-Content -LiteralPath (Join-Path $script:PidDir "$Name.pid") -Value $process.Id
  return $process
}

function Stop-LocalProcess([string]$Name) {
  $file = Join-Path $script:PidDir "$Name.pid"
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  $id = [int](Get-Content -LiteralPath $file -TotalCount 1)
  $process = Get-Process -Id $id -ErrorAction SilentlyContinue
  # Solo se detiene si sigue siendo un proceso node (el PID pudo reutilizarse tras un reinicio). /T incluye al proceso hijo que
  # node lanza para sí mismo en algunas instalaciones (el que realmente escucha el puerto).
  if ($process -and $process.ProcessName -eq 'node') { & taskkill.exe /PID $id /T /F | Out-Null }
  Remove-Item -LiteralPath $file -Force
  return [bool]$process
}
