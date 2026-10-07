# ADR-F0-PATCH-01 — Ajustes aditivos al catálogo de errores y al contrato gRPC
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: F0-PATCH (coordinación)
## Contexto
El PLAN §3.3 requiere que `ConsumeHold` y `IssueTickets` reciban la identidad de la reserva / solicitud para ser idempotentes (INV-09, TKT-05, RSV-06), y los servicios necesitan señalar «recurso inexistente» sin usar un código público del OpenAPI.
## Decisión
- `packages/shared`: se añade el código interno `NOT_FOUND` a `ERROR_CODES` con gRPC `NOT_FOUND`. No figura en el OpenAPI (que no se modifica); el Gateway resuelve su mapeo HTTP en F4. La prueba del catálogo sigue exigiendo igualdad exacta con los 24 códigos públicos más la lista explícita de códigos internos (`NOT_FOUND`), y que ninguno interno aparezca en el contrato.
- `inventory.v1`: nuevo mensaje `ConsumeHoldRequest {hold_id=1, owner_id=2, reservation_id=3}`; `ConsumeHold` pasa de `GetHoldRequest` a este mensaje. Los campos 1-2 conservan número y tipo, por lo que es compatible en el cable.
- `ticketing.v1`: `IssueTicketsRequest.request_id = 5`.
- `packages/contracts` regenerado con `npm run gen:contracts`.
## Consecuencias
Ningún campo existente cambia de número ni tipo; los clientes previos siguen funcionando. Los consumidores TypeScript de `ConsumeHold` deberán usar `ConsumeHoldRequest` (aún no hay ninguno implementado).
