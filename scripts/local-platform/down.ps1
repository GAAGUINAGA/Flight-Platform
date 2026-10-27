<#
.SYNOPSIS
  Detiene la plataforma local levantada por up.ps1 (Gateway y los 7 microservicios).
.PARAMETER StopDocker  También ejecuta docker compose down (por defecto el Postgres se deja en marcha y sus datos intactos).
#>
param([switch]$StopDocker, [int]$GatewayPort = 3000)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:Repo

$names = @('gateway') + @($script:Services | ForEach-Object { $_.Name })
foreach ($name in $names) {
  $stopped = Stop-LocalProcess $name
  Write-Host ("  {0,-12} {1}" -f $name, $(if ($stopped) { 'detenido' } else { 'no estaba en marcha' }))
}
Start-Sleep -Seconds 1
$still = @($script:Services | Where-Object { Test-PortOpen $_.Port } | ForEach-Object { "$($_.Name):$($_.Port)" })
if (Test-PortOpen $GatewayPort) { $still += "gateway:$GatewayPort" }
if ($still.Count -gt 0) { Write-Warning "Siguen abiertos: $($still -join ', '). Algún proceso no lo inició up.ps1; ciérralo a mano."; exit 1 }
if ($StopDocker) { docker compose -f infra/docker-compose.yml down; if ($LASTEXITCODE -ne 0) { exit 1 } }
Write-Host 'Plataforma detenida: ningún puerto de los servicios sigue abierto.'
exit 0
