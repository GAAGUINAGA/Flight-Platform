<#
.SYNOPSIS
  Siembra los datos de la reunión en el Postgres local: vuelos de los próximos 60 días (Inventory), sus tarifas (Pricing) y los mapas de asientos (Ancillaries).
.DESCRIPTION
  Los tres seeds son idempotentes (ids deterministas y skipDuplicates): repetir el comando solo agrega lo que falta y no toca held/sold.
  Orden obligatorio: Inventory crea las instancias de vuelo; Pricing crea después las tarifas para esas instancias; Ancillaries define los asientos por aeronave.
  Cada seed carga el .env de su servicio dentro de su propio proceso; este script no lee ningún .env. Los vuelos que ya pasaron no se crean: vuelve a ejecutarlo
  antes de cada reunión para tener vuelos futuros.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:Repo
if (-not (Test-PortOpen 15432)) { throw 'Postgres no responde en 127.0.0.1:15432.' }
foreach ($name in @('inventory', 'pricing', 'ancillaries')) {
  Write-Host "Seed de $name..."
  Push-Location (Join-Path $script:Repo "microservices/$name-service")
  try { npm run seed --silent; if ($LASTEXITCODE -ne 0) { throw "El seed de $name falló (código $LASTEXITCODE)." } } finally { Pop-Location }
}
Write-Host 'Seed completo: Inventory, Pricing y Ancillaries.'
