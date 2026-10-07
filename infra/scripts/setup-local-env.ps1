$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$infraEnv = Join-Path $repo 'infra/.env'
if (Test-Path -LiteralPath $infraEnv) {
  throw 'infra/.env already exists; refusing to rotate local credentials.'
}

$services = @('inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks', 'gateway')
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}
$passwords = @{}
foreach ($service in $services) {
  $passwords[$service] = New-LocalSecret
}
$postgresPassword = New-LocalSecret
$apiKey = New-LocalSecret
$rng.Dispose()

foreach ($service in $services | Where-Object { $_ -ne 'gateway' }) {
  $path = Join-Path $repo "microservices/$service-service/.env"
  $template = Join-Path $repo "microservices/$service-service/.env.docker.example"
  if (-not (Test-Path -LiteralPath $template)) { throw "Missing template: $template" }
  if (Test-Path -LiteralPath $path) {
    $current = [System.IO.File]::ReadAllText($path)
    if ($current -notmatch 'REPLACE_WITH_LOCAL_ROLE_PASSWORD') {
      throw "Existing .env may contain real credentials: $path"
    }
  }
}

foreach ($service in $services | Where-Object { $_ -ne 'gateway' }) {
  $path = Join-Path $repo "microservices/$service-service/.env"
  $template = Join-Path $repo "microservices/$service-service/.env.docker.example"
  $content = [System.IO.File]::ReadAllText($template)
  $content = $content.Replace('REPLACE_WITH_LOCAL_ROLE_PASSWORD', $passwords[$service])
  $content = $content.Replace('REPLACE_WITH_32_PLUS_BYTE_RANDOM_SECRET', $apiKey)
  [System.IO.File]::WriteAllText($path, $content)
}

$lines = @("POSTGRES_PASSWORD=$postgresPassword")
foreach ($service in $services) {
  $lines += "ROLE_PASSWORD_$($service.ToUpperInvariant())=$($passwords[$service])"
}
[System.IO.File]::WriteAllLines($infraEnv, $lines)
Write-Output 'Local credentials generated in ignored files (values not displayed).'
