# ADR-F11-09 — Adaptación REST de postventa
- Estado: Aceptado · Fecha: 2026-10-22 · Fase/Tarea: F11 / PLT-E
## Contexto
Reservation envuelve los listados de equipaje y cambios en mensajes gRPC, mientras OpenAPI exige arrays. Las respuestas de cambio y cancelación pueden indicar una operación pendiente; el contrato REST exige 202 sin cuerpo.
## Decisión
El Gateway extrae los arrays, entrega 200 para operaciones completadas y 202 sin cuerpo para cambio o cancelación pendientes. Los estados de error que el plan exige pero la operación no declara se validan contra `ProblemDetails` con Ajv. El RPC de equipaje solo devuelve `BaggageAddedResponse` y no expone un estado pendiente: por decisión del humano, la ruta conserva el 200 soportado y se documenta la limitación.
## Consecuencias
No se modifican servicios ni contratos para PLT-E. La prueba real valida entrada, autorización, propietario, esquemas y efectos, además de recuperación después de 202 en cambio y cancelación. Un 202 de equipaje requeriría una señal inequívoca desde Reservation.
