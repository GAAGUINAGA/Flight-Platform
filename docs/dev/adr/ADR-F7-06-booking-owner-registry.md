# ADR-F7-06 — Registro de dueño de reserva en Ancillaries
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F7 / ANC-SEC-02

## Contexto
Filtrar `seat_assignments` y `baggage_items` por owner impedía ver filas ajenas, pero no identificaba una reserva perteneciente a otro usuario cuando no tenía filas del tipo consultado. Como consecuencia, algunas lecturas devolvían colecciones vacías y una compra de equipaje podía crear datos bajo una reserva ajena.

## Decisión
`booking_owners` conserva una única pareja `booking_id`/`owner_id`. La primera escritura válida de creación de reserva hecha con `ReserveSeats` o `ReserveBaggage` la fija mediante inserción atómica; toda operación posterior por `bookingId`, de lectura o escritura, verifica esa pareja antes de tocar filas y ante ausencia o desacuerdo devuelve `NOT_FOUND`. Una reserva sin asientos ni equipaje aún no está materializada en Ancillaries: todas sus operaciones específicas de `bookingId` devuelven `NOT_FOUND` hasta la primera de esas dos escrituras.

## Consecuencias
Ancillaries no necesita consultar datos de Reservation ni revelar si un `bookingId` existe. La migración solo añade una tabla al esquema ancillaries. Reservation debe usar `ReserveSeats` o `ReserveBaggage` al crear los datos ancillaries de una reserva.
