# ADR-F12b1fix-02 — Búsqueda por día local del aeropuerto de salida
- Estado: **Propuesto** (no implementado) · Fecha: 2026-11-06 · Fase/Tarea: fix/sql-esquema-explicito (hallazgo lateral) · Requisito: NFR-TI-01
## Contexto
NFR-TI-01 (investigacion-base.md §NFR): marcas de tiempo en UTC y fechas de vuelo en hora local del aeropuerto con zona IANA. Hoy `dayRange(date)` de inventory-service (`src/application/flight-queries.ts`) interpreta la fecha como día UTC: `[dateT00:00Z, +24 h)`. Lo usan `find`, `list` y `queryAvailability`. El día de la búsqueda coincide con el día local solo en UTC.
Caso LIM→MAD: salida 2026-11-10 22:30 en Lima (UTC-5) = 2026-11-11T03:30Z. Buscar `2026-11-10` no lo encuentra (cae en el día UTC 11) y buscar `2026-11-11` lo devuelve con una fecha que el pasajero no reconoce. El mismo desfase afecta a cualquier salida entre las 00:00 locales y el desfase de la zona.
Descubierto al hacer que las pruebas del gateway no dependan de la hora del reloj (se cruzaba el día UTC entre las 21:00 y las 24:00 de Lima); esa corrección solo toca pruebas.
## Puntos afectados
| Versión | Punto | Uso actual |
|---|---|---|
| v1 y v2 | inventory `flight-queries.ts` `dayRange` (find, list, queryAvailability) | día UTC |
| v2 | gateway `stock/stock-sync.ts:112` | `utcDate` de la salida hacia `queryAvailability` |
| v2 | gateway `operations.controller.ts:88`; operations `flight-status.ts:7` | `departure.at.slice(0, 10)` como `date` de `getFlightStatus` y `operational_flights.date` |
| v1 y v2 | reservation `queries.ts:10` | `departureDate` del resumen con `slice(0, 10)` |
| v2 | operations `check-in.ts:69` | caducidad de pasaporte contra `slice(0, 10)` de la salida |
| pruebas | pricing `fake-inventory.gateway.ts:13` | el falso debe reproducir la regla real |
## Decisión propuesta
1. Inventory guarda (o resuelve) la zona IANA del aeropuerto de salida; `dayRange(date, zona)` calcula `[00:00 local, 00:00 local del día siguiente)` convertido a UTC (24 h no siempre: cambios de horario).
2. Un único helper en `packages/shared` (`localDay(instantUtc, zona)` y `localDayRange(fecha, zona)`) que usen todos los puntos de la tabla; ninguno vuelve a cortar con `slice(0, 10)`.
3. Sin cambio de contrato OpenAPI: `departureDate` ya es una fecha; solo cambia su interpretación (local). Cualquier campo nuevo en proto: aditivo, con su ADR.
4. Pruebas: tabla por zona (LIM, MAD, UTC+14, cambio de horario) con reloj simulado.
## Consecuencias
Cambio coordinado de inventory, operations, reservation, gateway y pricing (falso), con auditoría y redespliegue. Mientras tanto la regla vigente es el día UTC; se registra en BACKLOG.md con PRIORIDAD ALTA.
