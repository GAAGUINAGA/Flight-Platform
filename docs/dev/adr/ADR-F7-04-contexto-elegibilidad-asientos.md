# ADR-F7-04 — Contexto de elegibilidad en comandos de asiento
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F7 / ANC-05, ANC-06, ANC-07

## Contexto
Los comandos gRPC de asientos no transportaban ni la cabina adquirida ni el tipo de pasajero. Sin esos datos Ancillaries no puede imponer los invariantes de cabina, infante y salida de emergencia.

## Decisión
Se añaden `passenger_type` y `cabin_class` a `SeatAssignment`, y esos mismos campos a `AssignSeatAtCheckInRequest`, usando nuevos números protobuf. Son obligatorios para las validaciones de aplicación.

## Consecuencias
El cambio es aditivo y no modifica OpenAPI. Los clientes anteriores reciben `VALIDATION_FAILED` si invocan una operación que requiera la información recién obligatoria.
