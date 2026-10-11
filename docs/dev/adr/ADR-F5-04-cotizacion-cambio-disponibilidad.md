# ADR-F5-04 — Cotización de cambio contra disponibilidad de la nueva fecha
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F5 / PRC-10
## Contexto
La solicitud de cambio contiene el snapshot del itinerario comprado, pero no una selección adicional de brand. Para cotizar una nueva fecha sin acceder a Reservation, Pricing debe consultar Inventory y sus propias tarifas.
## Decisión
La opción de precio incluida en el snapshot de cada itinerario representa la tarifa comprada y se usa como selección. Pricing consulta `InventoryGateway` con origen, destino, fecha nueva, pasajeros y cabina; busca el mismo brand entre las tarifas del vuelo disponible y calcula diferencias en unidades menores.
## Consecuencias
Una fecha sin disponibilidad o sin el mismo brand devuelve `OFFER_NO_LONGER_AVAILABLE`. El total por cobrar se limita a cero antes de sumar la tarifa de cambio; el crédito de una tarifa más barata no se devuelve desde este caso de uso.
