<#
.SYNOPSIS
  Detiene la plataforma local levantada por up.ps1 (Gateway y los 7 microservicios).
.PARAMETER StopDocker  También ejecuta docker compose down (por defecto el Postgres se deja en marcha y sus datos intactos).
#>
param([switch]$StopDocker, [int]$GatewayPort = 3000, [int]$GraphqlPort = 4000, [int]$WebPort = 5173, [int]$WebAuthPort = 54329)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:Repo

# La web y su servicio de acceso local (local:up -Web) se detienen primero; si no se levantaron, «no estaba en marcha».
$webWasUp = (Test-Path -LiteralPath (Join-Path $script:PidDir 'web.pid')) -or (Test-Path -LiteralPath (Join-Path $script:PidDir 'web-auth.pid'))
$names = @('web', 'web-auth', 'graphql', 'gateway', 'esb') + @($script:Services | ForEach-Object { $_.Name })
foreach ($name in $names) {
  $stopped = Stop-LocalProcess $name
  Write-Host ("  {0,-12} {1}" -f $name, $(if ($stopped) { 'detenido' } else { 'no estaba en marcha' }))
}
Remove-Item -LiteralPath (Join-Path $script:LocalDir 'platform-config.json') -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$still = @($script:Services | Where-Object { Test-PortOpen $_.Port } | ForEach-Object { "$($_.Name):$($_.Port)" })
if (Test-PortOpen $GatewayPort) { $still += "gateway:$GatewayPort" }
if (Test-PortOpen $GraphqlPort) { $still += "graphql:$GraphqlPort" }
if (Test-PortOpen $script:Esb.Port) { $still += "esb:$($script:Esb.Port)" }
if ($webWasUp) { if (Test-PortOpen $WebPort) { $still += "web:$WebPort" }; if (Test-PortOpen $WebAuthPort) { $still += "web-auth:$WebAuthPort" } }
if ($still.Count -gt 0) { Write-Warning "Siguen abiertos: $($still -join ', '). Algún proceso no lo inició up.ps1; ciérralo a mano."; exit 1 }
if ($StopDocker) { docker compose -f infra/docker-compose.yml down; if ($LASTEXITCODE -ne 0) { exit 1 } }
Write-Host 'Plataforma detenida: ningún puerto de los servicios sigue abierto.'
exit 0
