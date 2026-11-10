# ADR-F12b2-01 — Los emisores eligen su transporte de eventos por `ESB_URL`
- Estado: Aceptado · Fecha: 2026-11-08 · Fase/Tarea: F12b-2 / Bloque B
## Contexto
Inventory, Reservation y Operations publicaban eventos por gRPC a Webhooks. F12b-2 los redirige al ESB (outbox → bus), pero las pruebas de integración y los arneses del Gateway (`stack.ts`, `real-stack.e2e.spec.ts`, `check-in-dependencies`, `dcs-real`) levantan los servicios con un Webhooks gRPC real o falso y deben seguir pudiendo hacerlo sin cambiar sus aserciones.
## Decisión
- Si `ESB_URL` está definida, el emisor publica por HTTP al ESB con `EsbEventClient` (`packages/shared/src/esb-event-client.ts`, D-1): mismo mensaje `PublishEvent`, `X-Internal-Key`, `X-Role: system`, correlación y plazo de 5 s (`ESB_EVENT_TIMEOUT_MS`). Los errores se traducen a `{code}` numérico (14, 4, 13 o el código del servicio) para que `SafeEventPublisher` y `readDependency` actúen igual que con gRPC.
- Si no está definida, se conserva el cliente gRPC a Webhooks (`WEBHOOKS_GRPC_URL`), sin cambios. Los puertos `EventPublisher`, los casos de uso y el dominio no se tocan; solo cambia la composición en `main.ts`.
- Producción y el perfil local definen `ESB_URL` (con ello los servicios dejan de llamar a Webhooks). El arnés de regresión de F12b-2 la define apuntando al ESB en proceso con BD y RabbitMQ reales.
## Consecuencias
- Hay dos caminos de emisión mientras exista la vuelta atrás; `ESB_EVENTS_MODE=grpc` en el ESB permite volver sin redesplegar emisores.
- Un despliegue de emisor sin `ESB_URL` seguiría llamando a Webhooks (idempotente por `eventId`, convive con el bus). Se retira el camino gRPC en F12b-3.
- En `inventory-service` el aviso `event publish failed` ahora nombra la dependencia `esb` (antes `webhooks`).
