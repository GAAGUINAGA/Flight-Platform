# ADR-F10-07 — Identificador del evento de Operations
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / DCS-03

## Contexto
El contrato protobuf representa `event_id` como cadena no opcional y el servidor Webhooks valida que sea UUID. Con los valores por defecto del cargador gRPC, omitirlo entrega una cadena vacía y rechaza la publicación.

## Decisión
El adaptador de Operations genera un UUID por publicación antes de llamar a Webhooks. No incluye información del pasajero ni del owner en ese identificador.

## Consecuencias
Webhooks acepta el evento en la integración real. Como se documenta en ADR-F10-05, una respuesta remota perdida todavía puede provocar publicaciones duplicadas al reintentar; generar el UUID por llamada no garantiza entrega exactamente una vez.
