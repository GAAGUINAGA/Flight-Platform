# ADR-F8-05 — Tickets emitidos en la respuesta de creación
- Estado: Aceptado · Fecha: 2026-10-16 · Fase/Tarea: F8 / RSV-06, RSV-12
## Contexto
La emisión síncrona confirmaba la reserva, pero el caso de uso descartaba los tickets devueltos por Ticketing. La respuesta gRPC de CreateReservation contenía entonces una lista vacía, aunque los tickets se hubieran emitido.
## Decisión
En la primera respuesta confirmada, devolver los tickets recibidos de Ticketing junto con la reserva. La persistencia del agregado y la respuesta pendiente siguen usando el modelo existente.
## Consecuencias
El consumidor recibe los tickets emitidos sin otra consulta. Las repeticiones idempotentes conservan la vista persistida existente; GetReservation sigue consultando Ticketing.
