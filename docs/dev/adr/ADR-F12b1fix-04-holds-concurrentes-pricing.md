# ADR-F12b1fix-04 — Holds simultáneos de la misma oferta: precio bloqueado idempotente y errores de dependencia
- Estado: Aceptado · Fecha: 2026-11-14 · Fase/Tarea: F12b1 / corrección (BACKLOG, E2E-13)
## Contexto
Dos holds casi simultáneos de la misma oferta devolvían INTERNAL_ERROR desde `Pricing.holdOffer` (antes de llamar a Ancillaries). La reproducción con concurrencia real contra Postgres mostró dos causas independientes:
1. **Error de negocio de Inventory convertido en INTERNAL_ERROR.** Un cupo agotado (`OFFER_NO_LONGER_AVAILABLE`) llega a Pricing como error gRPC de cliente `{ code, details }`, sin `getError()`. `safeGrpcError` solo reconocía `DomainError` y `RpcException`, así que lo traducía a INTERNAL_ERROR (registro: "internal error: Error").
2. **Repetición idempotente rota.** Inventory devuelve el mismo hold para el mismo (dueño, Idempotency-Key). Pricing hacía `INSERT` del precio bloqueado con el `holdId` como llave primaria: el segundo intento chocaba (Prisma P2002) y la compensación **liberaba el hold que ya era de la primera llamada**.
## Decisión
- `safeGrpcError` (paquete compartido, único punto de traducción) devuelve tal cual un error de cliente con un código del catálogo **y su estado exacto** (p. ej. 9 + `OFFER_NO_LONGER_AVAILABLE`, 10 + `SEAT_TAKEN`). Texto libre, estados que no coinciden y `UNAUTHENTICATED`/`PERMISSION_DENIED` de la dependencia siguen siendo INTERNAL_ERROR. No cambia ningún código que ya se devolvía por otra vía; solo deja de ocultar los de catálogo que llegan de dependencias.
- `describeInternalError` (compartido) genera el texto del registro: tipo y códigos acotados (Prisma `P2xxx`, errno, estado gRPC, código de catálogo). Nunca mensaje, `meta` ni valores. Pricing lo usa en su filtro.
- `createPriceLock` pasa a `INSERT ... ON CONFLICT DO NOTHING` (`createMany({ skipDuplicates: true })`) y devuelve si insertó. Si el hold ya tenía precio bloqueado se devuelve ese precio y **no** se libera. Una sola sentencia: atómica y compatible con el pooler de Supabase en modo transacción. Sin migración: la llave primaria ya existía.
- La liberación compensatoria ya no oculta la causa original si también falla.
## Consecuencias
- Si hay cupo, todos los holds válidos se crean (dueños distintos o el mismo con llaves distintas); si no, quien no cabe recibe `OFFER_NO_LONGER_AVAILABLE`, nunca INTERNAL_ERROR; la misma llave no crea dos holds.
- Sin cambios en contratos, gateway, GraphQL ni web.
- El cambio en `packages/shared` dispara el CI de los demás servicios al llegar a main.
- Fuera de alcance: los filtros de Inventory y Operations aún registran solo el nombre del error (candidato a BACKLOG: usar `describeInternalError`).
