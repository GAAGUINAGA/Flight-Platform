# ADR-F8-06 — Lectura de reservas sin registro en Ancillaries
- Estado: Aceptado · Fecha: 2026-10-16 · Fase/Tarea: F8 / RSV-08, RSV-12
## Contexto
Ancillaries registra el owner en la primera escritura y devuelve `NOT_FOUND` para una reserva sin asientos ni equipaje. Reservation comprueba previamente el owner de la reserva y genera su identificador. En F8 no se modifica Ancillaries ni el contrato gRPC.
## Decisión
Solo al componer el detalle de una reserva ya verificada, interpretar el código gRPC `NOT_FOUND` de `GetAssignments` o `GetBaggageOptions` como colección vacía. Propagar cualquier otro error y cualquier error de Ticketing; registrar dependencia, operación y código gRPC seguro sin datos de la solicitud ni detalles del error.
## Consecuencias
Un `NOT_FOUND` también podría ocultar un registro Ancillaries perdido o con owner inconsistente, mostrando datos incompletos. El riesgo se acepta temporalmente porque Reservation autoriza la lectura antes de consultar por el identificador propio; el registro explícito de la franquicia y owner queda como primera tarea de F9. No se enmascaran fallos de disponibilidad ni errores de Ticketing.
