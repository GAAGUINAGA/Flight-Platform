$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$services = @('inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks')

foreach ($service in $services) {
  $directory = Join-Path $repo "microservices/$service-service"
  $localPath = Join-Path $directory '.env'
  $supabasePath = Join-Path $directory '.env.supabase'
  if (-not (Test-Path -LiteralPath $localPath) -or -not (Test-Path -LiteralPath $supabasePath)) {
    throw "Missing local or Supabase env file for $service"
  }

  $localLines = [System.IO.File]::ReadAllLines($localPath)
  $supabaseLines = [System.IO.File]::ReadAllLines($supabasePath)
  $supabaseUrls = @{}
  foreach ($line in $supabaseLines) {
    if ($line -match '^(DATABASE_URL|DIRECT_URL)=(.*)$') {
      if ($supabaseUrls.ContainsKey($matches[1])) { throw "Duplicate Supabase URL for $service" }
      $supabaseUrls[$matches[1]] = $line
    }
  }
  if ($supabaseUrls.Count -ne 2) { throw "Expected two Supabase URLs for $service" }

  $result = @('# Supabase: Transaction pooler para DATABASE_URL; Session pooler para DIRECT_URL.')
  $seen = @{}
  foreach ($line in $localLines) {
    if ($line -notmatch '^([A-Z][A-Z0-9_]*)=') { continue }
    $name = $matches[1]
    if ($seen.ContainsKey($name)) { throw "Duplicate local variable $name for $service" }
    $seen[$name] = $true
    if ($supabaseUrls.ContainsKey($name)) {
      $result += $supabaseUrls[$name]
    } else {
      $result += $line
    }
  }
  if (-not $seen.ContainsKey('DATABASE_URL') -or -not $seen.ContainsKey('DIRECT_URL')) {
    throw "Missing local database URL for $service"
  }
  [System.IO.File]::WriteAllLines($supabasePath, $result)
  Write-Output "$service synced"
}
