# ADR-F11-13 — hold.expired identifica el hold
- Estado: Aceptado · Fecha: 2026-10-24 · Fase/Tarea: F11c-1 / PLT-I2
## Contexto
`WebhookPayload.data` del OpenAPI no declara `additionalProperties: false`. Sin una referencia al hold, el consumidor no puede relacionar `hold.expired` con su bloqueo.
## Decisión
Inventory publica `hold.expired` con `data: { holdId, status: "EXPIRED" }`. Para transportarlo por gRPC se añade `WebhookEventData.hold_id = 5` sin reutilizar números. Webhooks preserva `holdId` y campos adicionales permitidos por el contrato, conservando validación de tipo para los campos conocidos.
## Consecuencias
Los consumidores pueden correlacionar la expiración. El cambio en `common.proto` redespliega los siete microservicios consumidores. La guía de integración de Booking debe documentar este campo en F11d (PLT-J1).
