# ADR-F12b2fix-01 — Asientos apartados por un hold

Estado: Aceptado (decisión del humano, 2026-11-09). Mecanismo en `docs/dev/diseno-asientos-held.md`.

## Contexto
Booking pidió (1) que `POST /vuelos/offers/hold` aplique `assignedSeats` (409 `SEAT_TAKEN` si el asiento está ocupado), (2) que el mapa de asientos muestre `HELD` mientras el hold está vigente y (3) `CHECKED_IN` después del check-in. Hoy el campo se ignora y el mapa solo distingue libre/ocupado.

## Acuerdo de integración con Booking (09-11-2026), extensión compatible de HoldRequest; el contrato formal no se modifica
Booking afirma que `assignedSeats` está en `HoldRequest` del contrato v2; nuestra copia (`vuelos-openapi-v2.yaml`, `HoldRequest`) no lo declara (solo `PassengerInput`). Se confirmó con Booking que **el contrato v2 no cambia (sigue 2.0.0)**: `assignedSeats` en el hold, `HELD` en el mapa y `CHECKED_IN` tras el check-in son acuerdos por encima del contrato. Se aceptan como propiedad opcional adicional (el esquema no declara `additionalProperties: false`, así que no invalida a nadie). Formato exacto y comportamiento en `docs/booking-integration.md` §5.1.

## Decisiones
1. **Ancillaries es el dueño**: el asiento apartado es una `seat_assignments` con `status = 'HELD'`, `hold_id` y `hold_expires_at` (= vencimiento del hold).
2. **Vencimiento sin scheduler**: una HELD vencida cuenta como libre. La lectura del mapa la descarta en la consulta (no escribe); apartar/reservar/cambiar/check-in la pasan a `RELEASED` en su misma transacción. Sin limpieza programada.
3. **Carrera**: el índice único parcial existente `(flight_instance_id, seat_number) WHERE status <> 'RELEASED'`; transacciones ordinarias, sin bloqueos asesores ni estado de sesión (pooler de Supabase en modo transacción). El perdedor recibe `SEAT_TAKEN`.
4. **Identidad provisional**: `booking_id = holdId` y `passenger_id` sintético = 24 primeros caracteres del holdId + índice del asiento (12 hex). Solo existe bajo ese `booking_id`, que es único del hold, así que no colisiona con pasajeros reales. La fila se reconoce sin ambigüedad (`HELD` + `hold_id`), no tiene `booking_owners` (las consultas por reserva responden `NOT_FOUND`) y no cuenta como check-in. La propiedad es la del hold: `owner_id` del hold; liberar, listar y convertir filtran por `hold_id` **y** `owner_id`.
5. **Hold → reserva** (una transacción): se liberan todas las filas HELD del hold (`converted_booking_id` = reserva) y se crean las de la reserva. Reparto de asientos sin `assignedSeats` en la reserva: **en el orden de los pasajeros**, los infantes sin asiento; **los apartados que sobran se liberan y un pasajero sin asiento queda sin asiento**. Con `assignedSeats` en la reserva mandan esos (iguales u otros). Un asiento nuevo ocupado ⇒ `SEAT_TAKEN` y el hold queda intacto.
6. **Compensación**: `releaseAll` con `restoreHold` devuelve al hold vigente los asientos que la reserva tomó de él (los que otro ya tomó quedan libres). Si el hold se libera por fallo de la reserva, se liberan también los asientos.
7. **Validación en el apartado**: el asiento debe existir en el avión del segmento (`SEAT_CABIN_MISMATCH` si no) y pertenecer a un segmento de la oferta, con a lo sumo tantos asientos por segmento como pasajeros con asiento (422 en el gateway). La elegibilidad por tipo de pasajero y cabina (salida de emergencia, niño, infante) se verifica al convertir en reserva, que es cuando se conoce el pasajero.
8. **Mapa v2**: `status` desde la asignación (`HELD`→HELD, `PROVISIONAL`→BOOKED, `CONFIRMED`→TICKETED, `CHECKED_IN`→CHECKED_IN); `isAvailable` es false salvo AVAILABLE. **Mapa v1**: sin `status`; el apartado es `isAvailable: false`.
9. **Fallo parcial al crear el hold**: el hold se crea antes porque su id y vencimiento los fijan Pricing/Inventory; si Ancillaries rechaza, el gateway lo libera (compensación) y devuelve el error: no queda hold vigente.

## Alternativas descartadas
- Columnas `booking_id`/`passenger_id` nulables en `seat_assignments`: cambia una clave única y obliga a revisar todo el servicio; la identidad provisional lo evita con una migración aditiva.
- Apartar desde Pricing: crea una dependencia nueva Pricing→Ancillaries (variable de entorno y despliegue nuevos) y un ciclo con `resolveSegment`; el gateway ya orquesta y pasa por el ESB.
- Limpieza programada de HELD vencidas: innecesaria con la regla de vencimiento en lectura y escritura.

## Consecuencias
- Migración aditiva `ancillaries/20261109120000_seat_hold` (3 columnas nulas + índice); la aplica el humano.
- `.proto` solo aditivos: `common.Seat.status`; ancillaries `HoldSeats`, `ReleaseHeldSeats`, `GetHeldSeats`, `ReserveSeatsRequest.hold_id`, `BookingOwnerRequest.restore_hold`. Contratos OpenAPI sin cambios.
- ESB: dos operaciones nuevas (`vuelos.apartar-asientos`, `vuelos.liberar-asientos-hold`); hay que desplegar el ESB junto con el gateway y ancillaries. Sin variables de entorno nuevas.
- Pruebas: `ancillaries/test/f12b2fix-held-seats.spec.ts` y `test/integration/f12b2fix-held-seats.spec.ts` (H-01…H-14), `reservation/test/f12b2fix-held-seats.spec.ts`, `api-gateway/src/v2/hold-seats.spec.ts`, `api-gateway/src/v2/events-feed.spec.ts`.
