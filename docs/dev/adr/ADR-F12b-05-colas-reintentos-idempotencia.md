# ADR-F12b-05 — Colas por propósito, reintentos acotados, cola de fallidos e idempotencia
- Estado: Aceptado (bloque 0 aprobado por el humano 2026-11-08) · Fecha: 2026-11-08 · Fase/Tarea: F12b-2 / Bloque 0
## Contexto
Con consumo por lotes y sin consumidores permanentes, los reintentos no pueden depender de un `nack` con redelivery inmediato (reintentaría en el mismo lote) ni de un proceso que espere.
## Decisión
- Convención `q.<consumidor>.<propósito>` (+ `.espera.N` + `.fallidos`). Hoy un solo propósito: `q.webhooks.entrega` (registrar el evento en Webhooks y crear sus entregas), enlazada a `booking.#`, `hold.#`, `flight.#`.
- Reintentos con espera creciente mediante colas de espera con TTL (30 s, 2 min, 10 min; `EVENTS_RETRY_TTLS_MS`) cuyo dead-letter devuelve el mensaje a la cola principal. Tres intentos; el contador viaja en la cabecera `x-intento`. El consumidor publica la copia (con confirmación) y luego hace `ack`; si no puede publicarla, `nack` con `requeue`.
- Cola de fallidos `q.webhooks.entrega.fallidos`, sin consumidor, con `x-motivo` (solo un código). Los errores no reintentables (sobre o evento inválido) van directo allí.
- Idempotencia por `eventId`: ingreso a la outbox (`event_id` único) y consumo (ya existentes `webhooks.events.event_id` único y `deliveries (event_id, subscription_id)` único). **No se crea tabla de idempotencia.**
- Los reintentos del bus cubren solo el ingreso a Webhooks; la entrega HTTP conserva sus reintentos 1/5/30/120/360 min.
- El ESB es el único que declara la topología; Webhooks solo usa los nombres (variables con valor por defecto). Una prueba con broker real verifica la coincidencia.
## Consecuencias
- Un evento reintentado recibe un `seq` mayor que eventos posteriores; no se pierde para quien lee con `after=<seq>`.
- Un fallo entre la copia de reintento y el `ack` genera un duplicado inocuo.
- El reproceso de la cola de fallidos es manual (consola de RabbitMQ); queda en `BACKLOG.md`.
