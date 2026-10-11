# Auditoría F5 — #1
- Fecha: 2026-10-11 · Commit auditado: a1bd375 · Veredicto: RECHAZADO
- Alcance: auditoría de código. PRC-13 y PRC-14 (migración, seed, deploy y smoke en Cloud Run) quedan fuera por instrucción y no bloquean.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (`npx jest microservices/pricing-service --runInBand`: 8 suites, 20/20; PRC-01..PRC-12 con prueba correspondiente; PRC-12 contra Inventory real) | ✔ |
| Regresiones (`packages/shared` 11/11, `inventory-service` 74/74, `webhooks-service` 16/16, `platform/api-gateway` 44/44; build de shared, pricing, inventory, ticketing, webhooks y gateway) | ✔ |
| Pruebas de seguridad (PRC-SEC-01..03; suite §2.5) | ✘ |
| Checklist de cierre (código: pruebas verdes, `SearchResponse` validado con Ajv contra el OpenAPI; smoke Cloud Run excluido) | ✔ |
| Conformidad con el contrato (`SearchResponse`, `HoldResponse`, `HoldStatusResponse` validados contra los schemas; `contracts/proto` solo aditivo, `contracts/openapi` sin cambios) | ✔ |
| Contenedor (`docker build --no-cache` + `docker run` con `PORT=8080` ⇒ health `SERVING` con llave; sin llave rechazado) | ✔ |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | PRC-SEC-03 (suite PLAN §2.5) | `grep -rniE 'redact\|stack\|forced' microservices/pricing-service/test` ⇒ sin resultados; `test/security/security.spec.ts:28-36` cubre solo llave ausente, entrada inválida de `searchOffers` y rol | No existe prueba de «error interno forzado ⇒ respuesta sin stack trace ni mensaje interno» ni de «log de una operación con PII ⇒ campos redactados» en Pricing |

## Observaciones (no bloquean → BACKLOG)
- `npm run lint` en el clon falla con 2 errores: `microservices/pricing-service/src/main.ts:1` (`'__dirname' is defined but never used`) y `microservices/pricing-service/test/integration/search.spec.ts:25` (`'process' is not defined`). `deploy-service.yml:62` ejecuta `npm run lint`; la bitácora dev F5 #2 (línea 42) registra lint como aprobado.
- La llave interna incorrecta no se prueba en el servicio (solo ausente); la incorrecta se cubre en `packages/shared`.
- `PostSalePricing.quoteChange` (`post-sale-pricing.ts:19-21`): `fareDifference` y `taxDifference` siempre `0.00`, no usa `newDepartureDate`, y la cambiabilidad se evalúa con `some` sobre todas las opciones del itinerario, no sobre la del pasajero.
- `QuoteCancellation` de tarifa no reembolsable (solo tasas) no tiene prueba; `GetPriceLock` no tiene prueba de camino exitoso.
- `PRC-SEC-01` valida entrada inválida con un solo RPC (`searchOffers`).
- `npm audit --audit-level=high` ⇒ exit 0; 22 moderadas (incluye `ajv` y `yaml`, dependencias directas nuevas de Pricing), ninguna alta.
- ADR-F5-03: `git diff origin/main -- microservices/inventory-service` vacío; Inventory no se modifica.
- Cambios compartidos acotados: `packages/shared/src/grpc-client.ts` (+2 líneas: `includeDirs` y opciones del loader) y `pricing.ts` generado (+5); `contracts/proto/.../pricing.proto` solo añade campos 4–5 y 3–4.
