# Diseño — asientos apartados por un hold (pedido de Booking, 09-11-2026)

Decisiones en `docs/dev/adr/ADR-F12b2fix-01-asientos-apartados-hold.md`. Este documento describe el mecanismo.

## Reglas (decididas por el humano)
1. **Ancillaries es el dueño.** El asiento apartado es una fila de `seat_assignments` en estado `HELD`, ligada al hold (`hold_id`), con el mismo vencimiento (`hold_expires_at`).
2. **Vencimiento sin scheduler.** Una `HELD` vencida cuenta como libre: al *leer* el mapa se descarta en la misma consulta (sin escribir); al *apartar, reservar, cambiar o hacer check-in* se pasa a `RELEASED` dentro de la misma transacción antes de insertar. No hay limpieza programada (no hace falta; si algún día se agrega, irá por el ESB como las demás tareas de sistema).
3. **Carrera.** La garantía es el índice único parcial que ya existe, `seat_assignments_active_flight_seat_key (flight_instance_id, seat_number) WHERE status <> 'RELEASED'`. Todo se hace con transacciones normales (sin estado de sesión ni bloqueos asesores): compatible con el pooler de Supabase en modo transacción. El que pierde recibe `P2002` → `SEAT_TAKEN` (409).
4. **Hold → reserva.** En una transacción: se liberan *todas* las filas HELD del hold (marcándolas `converted_booking_id`) y se crean las asignaciones de la reserva. Los mismos asientos no chocan con su propio hold porque ya están `RELEASED` en esa transacción; otros asientos ocupados dan `SEAT_TAKEN` y la transacción deshace todo (el hold queda como estaba).
5. **Liberación.** `DELETE /vuelos/offers/hold/{id}` y el vencimiento liberan los asientos.
6. **v1** no cambia de contrato: el asiento apartado sale `isAvailable: false` y el gateway quita `status`.
7. **Estados del mapa v2:** `AVAILABLE`, `HELD`, `BOOKED`, `TICKETED`, `CHECKED_IN`, cada uno desde la asignación (`HELD`→HELD, `PROVISIONAL`→BOOKED, `CONFIRMED`→TICKETED, `CHECKED_IN`→CHECKED_IN).

## Flujo de `POST /vuelos/offers/hold` con `assignedSeats`
```
Gateway v2: valida assignedSeats (forma, sin repetidos, ≤ 18)
  → pricing.holdOffer                       (crea el hold: inventario + precio)
  → pricing.getOfferHold                    (segmentos de la oferta; ≤ pasajeros con asiento por segmento → 422)
  → ancillaries.holdSeats (por el ESB)      (todo o nada; SEAT_TAKEN → 409)
      si falla: pricing.releaseOfferHold (compensa) y se devuelve el error; no hay hold
  → 201 con la forma de siempre
```
El hold se crea primero porque su `holdId` y su vencimiento los fija Pricing/Inventory; si Ancillaries rechaza, se libera de inmediato. Es la misma compensación que ya usa Pricing cuando falla al guardar el candado de precio.

## Filas apartadas: cómo no se confunden con reservas reales
- `status = 'HELD'` y `hold_id` con valor. Las reales nunca tienen `HELD`.
- `booking_id = holdId` (provisional) y **sin** fila en `booking_owners`: `GetAssignments`/`ConfirmSeats`/`ReleaseAll` exigen dueño de la reserva y responden `NOT_FOUND` para un holdId.
- `passenger_id` sintético: los primeros 24 caracteres del holdId + índice del asiento en 12 hex. Solo existe bajo `booking_id = holdId`, que es único del hold: no colisiona con pasajeros reales (la clave única es `(booking_id, passenger_id, segment_id)`).
- `markCheckedIn` solo actúa sobre `PROVISIONAL|CONFIRMED|CHECKED_IN`: un `HELD` jamás cuenta como check-in. El panel de operaciones cuenta desde reservas, no desde estas filas.
- Propiedad: `owner_id` = dueño del hold. Liberar, listar y convertir filtran por `hold_id` **y** `owner_id`; un hold ajeno no se ve, no se libera ni se convierte.

## Hold → reserva (Reservation)
1. `CreateReservation` (y `ResumePending.allocate`) pide `ancillaries.getHeldSeats(holdId)`.
2. Si la reserva no trae asientos, `withHeldSeats` reparte los del hold **en el orden de los pasajeros** (los infantes no ocupan asiento). Sobran apartados → no se asignan y se liberan; faltan → el pasajero queda sin asiento. Si la reserva trae asientos, mandan los de la reserva.
3. `ancillaries.reserveSeats({..., holdId})` hace la conversión de la regla 4. Los asientos asignados se guardan en el pasajero (`assignedSeats`), de modo que el detalle de la reserva los muestra.
4. **Compensación.** Si la reserva falla después de tomar los asientos (equipaje, consumo del hold), `releaseAll` con `restoreHold: true` libera los de la reserva y devuelve al hold (si sigue vigente) los que tomó de él; uno que otro ya tomó queda libre y no impide devolver los demás. Si la reserva falla del todo y el hold se libera (`failBeforeIssuance`, `payment.failed`), también se liberan los asientos apartados.

## Cambios por servicio
| Servicio | Cambio |
|---|---|
| ancillaries | migración `20261109120000_seat_hold` (3 columnas nulas + índice); `HoldSeats`, `ReleaseHeldSeats`, `GetHeldSeats`; `ReserveSeats.hold_id`; `ReleaseAll.restore_hold`; `Seat.status` en el mapa |
| contratos `.proto` | solo campos/RPC nuevos (aditivo): `common.Seat.status`, `ancillaries` ver arriba |
| esb | dos operaciones: `vuelos.apartar-asientos`, `vuelos.liberar-asientos-hold` |
| api-gateway | `assignedSeats` en el hold; liberar al hacer `DELETE`; `status` en el mapa v2; v1 sin `status` |
| reservation | usa los asientos del hold y compensa |

Sin variables de entorno nuevas (nada que declarar en `check-deploy-env.cjs`); sin cambios en `contracts/openapi/`.
