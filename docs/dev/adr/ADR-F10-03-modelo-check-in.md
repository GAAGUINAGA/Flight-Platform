# ADR-F10-03 — Persistencia de check-in y pases
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / DCS-01
## Contexto
Operations debe guardar el resultado idempotente y los pases por pasajero y segmento, aislados por owner.
## Decisión
Guardar un agregado de check-in por reserva, con owner y resultado JSON; cada pase es una fila hija única por reserva, pasajero y segmento, con owner, asiento, barcode y validez. El identificador de pasajero acepta hasta 128 caracteres, como Reservation. Los índices incluyen owner y reserva.
## Consecuencias
Las lecturas deben filtrar por owner y revalidar el snapshot en Reservation. La migración solo modifica objetos de Operations. El resultado JSON debe contener exclusivamente los datos de respuesta, no documentos ni contacto.
