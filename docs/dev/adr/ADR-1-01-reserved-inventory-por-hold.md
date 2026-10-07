# ADR-1-01 ? Inventario vendido enlazado a la reserva
- Estado: Reemplazado por ADR-F0-PATCH-01 (la interpretaci?n original queda sin efecto) ? Fecha: 2026-10-06 ? Fase/Tarea: F1 / INV-09, INV-10

## Contexto
`ConsumeHold` solo recib?a `hold_id` y `owner_id`, y `ReleaseReservedInventory` recibe `booking_id`. La primera versi?n de este ADR interpretaba `booking_id` como el id del hold porque el contrato no transportaba la reserva.

## Decisi?n
Reemplazada. ADR-F0-PATCH-01 a?adi? `ConsumeHoldRequest.reservation_id`. Inventory lo usa as? (sin cambiar el proto):
- `ConsumeHold` guarda `reservation_id` en `holds` y en cada fila de `reserved_inventory`, y es idempotente por reserva: repetirlo con la misma `reservation_id` sobre un hold `CONSUMED` devuelve el mismo hold; con otra reserva ? `OFFER_NO_LONGER_AVAILABLE`.
- `ReleaseReservedInventory.booking_id` es esa `reservation_id`; es owner-scoped e idempotente (`released_at`).
- Migraci?n `20261007000000_reservation_id` a?ade las columnas (nullable) y el ?ndice.

## Consecuencias
Un id de reserva desconocido o de otro owner no restituye nada y responde ?xito, sin revelar existencia.
