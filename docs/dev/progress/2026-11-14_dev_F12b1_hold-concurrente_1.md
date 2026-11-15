# Sesión dev — F12b1 (corrección: holds simultáneos de la misma oferta en Pricing) — 2026-11-14 #1
- Agente: developer · Rama: fix/pricing-hold-concurrente (desde main) · Commit inicial: 6a19daa

## Objetivo de la sesión
BACKLOG detectado por E2E-13 (correlationId local ac39d943-18a3-40de-ad7b-bc2905031e04): con dos holds casi simultáneos de la MISMA oferta, el segundo recibe INTERNAL_ERROR (500) desde Pricing.holdOffer, ~20 ms antes de llamar a Ancillaries.holdSeats; el registro solo decía "internal error: Error". Reproducir con concurrencia real contra Postgres, encontrar la causa exacta, corregirla, registrar la causa de INTERNAL_ERROR sin PII y revisar el traductor compartido. Sin cambios en contratos (OpenAPI/.proto), gateway, GraphQL ni web. Sin migración.

## Causa exacta (reproducida; ver registro)
Dos causas independientes en `OfferHolds.hold` / traductor de errores:
1. **Error de negocio de Inventory convertido en INTERNAL_ERROR.** Cuando Inventory rechaza por cupo agotado (`OFFER_NO_LONGER_AVAILABLE`), el error llega a Pricing como error gRPC de cliente `{ code: 9, details }` sin `getError()`. `safeGrpcError` solo reconocía `DomainError` y `RpcException` y lo traducía a INTERNAL_ERROR; el filtro registraba solo `error.name` ("Error"). Ocurre ~20 ms después de iniciar el hold, antes de Ancillaries, y coincide con el registro de E2E-13.
2. **Repetición idempotente rota (Prisma P2002).** Inventory devuelve el MISMO hold para el mismo (dueño, Idempotency-Key). Pricing insertaba el precio bloqueado con `holdId` como llave primaria: el segundo intento violaba la PK y la compensación liberaba el hold que ya pertenecía a la primera llamada (el hold quedaba RELEASED y el cliente recibía INTERNAL_ERROR).
Ni una restricción nueva ni una transacción de Pricing intervienen: la lectura de la oferta es de solo lectura y el cupo lo decide Inventory con un UPDATE condicional atómico (`tryReserve`).

## Registro
| Hora | Tarea | Acción | Resultado de la prueba |
|------|-------|--------|------------------------|
| 19:50 | Estado inicial | `npx jest microservices/pricing-service --runInBand --testPathIgnorePatterns inventory-real` | 11 suites, 56 pruebas ✔ |
| 19:54 | Reproducción (SIN corrección) | Nueva `test/integration/hold-concurrency.spec.ts` (Postgres real de Pricing + Inventory en memoria atómico, idempotente y con errores gRPC de cliente) | ✘ 4 de 5 fallan: INTERNAL_ERROR (code 13) para quien no cabe, y para la misma llave (registro: `internal error: Error` y `PrismaClientKnownRequestError`). La prueba falla sin la corrección, como se exigía |
| 19:55 | Corrección | `safeGrpcError` devuelve errores de catálogo de dependencias (código + estado exactos); `createPriceLock` con `ON CONFLICT DO NOTHING` (idempotente, una sentencia, apta para pooler en modo transacción); compensación que no oculta la causa; `describeInternalError` en el registro | — |
| 19:56 | Prueba de la carrera (CON corrección) | `npx jest .../hold-concurrency.spec.ts --runInBand` | ✔ 5/5: dueños distintos con cupo (8/8), sin cupo (3 ok, 5 OFFER_NO_LONGER_AVAILABLE), mismo dueño con llaves distintas, misma llave simultánea (1 hold, 1 precio, HELD), repetición posterior; ninguna respuesta INTERNAL_ERROR |
| 19:56 | Registro de la causa sin PII | `test/unit/internal-error-log.spec.ts` y `shared.spec.ts` (traductor + `describeInternalError`) | ✔ el registro dice `type=PrismaClientKnownRequestError code=P2002` / `grpc_code=14`; sin mensaje, meta, correo ni teléfono |
| 19:57 | Build de tipos | `npm run build -w @flight-platform/pricing-service`, `-w @flight-platform/shared` | ✔ 0 errores |
| 19:58 | Regresión | `npx jest packages/shared microservices/pricing-service --runInBand --testPathIgnorePatterns inventory-real` | ✔ 16 suites, 109 pruebas |
| 19:59 | Regresión de servicios que usan el traductor compartido | unit de inventory, ancillaries, ticketing, operations, webhooks + reservation (f12c-web-limits, grpc-pricing-gateway, rsv-08) | ✔ 21 suites, 146 pruebas |
| 20:00 | `npm run lint` (incluye check-raw-sql, verify-workspace-dist y check-deploy-env), `npm run audit:policy` | checkout principal | ✔ lint 0 avisos; check-deploy-env OK (5 servicios); audit-policy sin high/critical |
| 20:10 | CI de deploy-pricing.yml en clon limpio | `C:\Proyectos\_clon-limpio-pricing-hold` @ 3a19b37: `npm ci`, `prisma:generate`, `lint`, build shared/contracts/pricing, `npx jest microservices/pricing-service/test/unit`, `audit:policy` | ✔ lint; build 0 errores; 8 suites / 42 pruebas; audit-policy ✔ |
| 20:14 | Humo de la imagen | `sh scripts/ci/image-startup-smoke.sh microservices/pricing-service/Dockerfile smoke-pricing-service` en el clon | ✔ "arrancó sin errores del motor de Prisma" |

## Pruebas que ejecuta el humano / auditor
- `microservices/pricing-service/test/integration/hold-concurrency-inventory-real.spec.ts`: la misma carrera con Pricing contra el Inventory local real. Carga `microservices/inventory-service/.env` (como PRC-12), por eso no la ejecuté. Comando (con los dos clientes Prisma generados, como PRC-12): `npx jest microservices/pricing-service/test/integration/hold-concurrency-inventory-real.spec.ts --runInBand --verbose`. Pendiente de verificación del humano.
- Suite real completa del gateway: no ejecutada por indicación; el gateway no cambió.
- Sin Dockerfile modificado: el humo de la imagen se corrió igualmente en el clon.

## ADRs creados
- ADR-F12b1fix-04-holds-concurrentes-pricing

## Pendientes / bloqueos
- Verificación humana de `hold-concurrency-inventory-real.spec.ts` (arriba).
- El cambio en `packages/shared` dispara el CI de los demás servicios al llegar a main.
- BACKLOG sugerido: los filtros de Inventory y Operations registran solo `error.name`; pueden usar `describeInternalError` (no se tocó para no ampliar el alcance).
- Clon limpio para borrar: `C:\Proyectos\_clon-limpio-pricing-hold` (más la imagen Docker local `smoke-pricing-service`).

## Cierre
- Commit final de código: 3a19b37 · Estado: listo para auditoría (código) · Marcado por el humano (ver "Verificaciones del humano"); la suite real completa del gateway dos veces la corre el auditor.

## Verificaciones del humano
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 22:00 | Alcance | `git diff main`: pricing (precio bloqueado idempotente con INSERT … ON CONFLICT DO NOTHING; registro de tipo y código de la causa), packages/shared (el traductor devuelve tal cual un error de catálogo de una dependencia con su estado exacto) y docs. Sin cambios en contratos, gateway, GraphQL, web ni migraciones. | ✓ |
| 22:00 | Pruebas | Lint, audit-policy, check-deploy-env, CI de todos los workflows (cambió packages/shared); la carrera contra el Inventory real (PRC-12) <resultado>; suites reales de pricing, inventory, ancillaries, operations, reservation y la del gateway (GATEWAY_TRANSPORT=esb) una vez, sobre 3a19b37. La suite real completa del gateway dos veces la corre el auditor. | ✓ |
| 22:00| Imágenes | pricing, inventory y gateway: image-startup-smoke.sh en verde. | ✓ |