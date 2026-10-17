# ADR-F9-05 — Liberación idempotente de ancillaries
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F9 / corrección O4

## Contexto
Reservation puede reintentar la compensación de una reserva que todavía no alcanzó a crear filas de asientos o equipaje. La operación de liberación debe ser repetible para ese booking y owner.

## Decisión
`ReleaseSeats`, `ReleaseAll` y sus adaptadores de persistencia tratan cero filas del mismo owner como liberación idempotente. La comprobación de `BookingOwner` ocurre antes de escribir: un booking inexistente o de otro owner sigue devolviendo `NOT_FOUND`, sin actualizar filas. No se relaja el filtro por `bookingId` y `ownerId`.

## Consecuencias
La saga puede repetir la compensación sin convertir la ausencia de filas propias en error. Las pruebas gRPC ANC-SEC-02 para `ReleaseSeats` y `ReleaseAll` verifican que owner ajeno recibe `NOT_FOUND` y el snapshot permanece intacto.
