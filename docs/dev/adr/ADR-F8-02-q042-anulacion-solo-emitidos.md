# ADR-F8-02 — Q-042: anulación solo de tickets emitidos
- Estado: Aceptado · Fecha: 2026-10-12 · Fase/Tarea: F8 / RSV-07, RSV-12

## Contexto

Al agotar reintentos de emisión, Q-042 exige liberar recursos y anular los tickets emitidos. Con `TICKETING_FAIL_MODE=always`, Ticketing persiste tickets `FAILED`; no existe un ticket emitido que anular.

## Decisión

Reservation consulta los tickets al fallar definitivamente y llama `VoidTickets` solo si existe al menos uno con estado `ISSUED`. Siempre libera inventario y asientos y persiste la reserva en `FAILED`.

## Consecuencias

El escenario de fallo total comprueba ausencia de `ISSUED`, recursos restituidos y `FAILED`. Si existían tickets emitidos, se comprueba su transición a `VOIDED`.
