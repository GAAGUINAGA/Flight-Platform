# Auditoría F11 — #6
- Fecha: 2026-10-24 · Commit auditado: a3d02cd985352129d1fad4e43bdea52b138c18c9 · Veredicto: APROBADO
- Alcance: auditoría de CÓDIGO de la entrega F11c-1 (tarea 0 RecoverCheckIns, PLT-H2 scheduler, PLT-H3 publicadores, J2/J3/J4). Clon limpio en `C:\Proyectos\fp-audit`, rama `feat/F11c1-scheduler`, `npm ci` previo, Postgres local 127.0.0.1:15432. Informe previo: audit-5 (APROBADO, despliegue F11b).
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor (sin leer ningún `.env`, sin gcloud/push/docker compose):
- `npm run lint` ⇒ exit 0. `node scripts/audit-policy.cjs` ⇒ exit 0 («npm audit policy passed…»); `security/npm-audit-exceptions.json` contiene solo zod `GHSA-mrhx-c7xc-m3w5`, vence 2026-11-23.
- Builds (`tsc`) de shared, los siete microservicios y el gateway ⇒ 0 errores.
- CI de cada workflow (test_command de `deploy-*.yml` y `gateway-ci.yml`, sin `DATABASE_URL`): inventory 3 suites/19; pricing 3/10; ticketing 1/3; webhooks 1/3; operations 12/40; ancillaries 10/16; reservation 20/97; gateway `src` 5/53 ⇒ todos verdes.
- Suites completas (con integración): gateway 7 suites/58 (14 omitidas = reales sin bandera); operations 15/57; inventory 7/76; webhooks 4/17; reservation 24/107 ⇒ verdes.
- Reales, dos veces seguidas con `--detectOpenHandles`: `RUN_GATEWAY_REAL=true npx jest platform/api-gateway` ⇒ 8 suites, 71 passed + 1 todo (OP-02), ×2; `RUN_DCS_REAL=true npx jest microservices/operations-service/test` ⇒ 16 suites, 59/59, ×2. Sin omitidas salvo el `it.todo` de OP-02, sin avisos de handles abiertos ni de formato `date-time` ignorado; `tasklist` sin `node.exe` al terminar.
- Scheduler (PLT-H2): `scheduler.spec.ts` PLT-H2-01..06 (ronda inicial con las cinco tareas, rol `system`, lote `limit` 7, exclusión concurrente, fallo aislado, desactivado sin temporizadores y `run()` invocable, activado con cinco temporizadores cancelados al destruir). Verificación adicional con script fuera del repo contra la base local del gateway: 8 `acquire` simultáneos de `PrismaSchedulerStore` ⇒ 1 `true`; con bloqueo vigente ⇒ `false`; tras `release` ⇒ `true`; tras vencer el lease ⇒ `true`. `createGatewayApp` con `SCHEDULER_ENABLED=true` ejecuta al arrancar `inventory.expireHolds`, `reservation.resumePending {limit:50}`, `webhooks.dispatchPending` y `operations.recoverCheckIns {limit:50}` con rol `system`; con `false` ⇒ 0 llamadas. Lotes en servidor: ExpireHolds 500, DispatchPending 100, RecoverCheckIns 1–100 (Zod).
- J2, J3, J4 (`real-stack.e2e.spec.ts`: «PLT-I2 / E», «PLT-I3 / E», «PLT-I4 / E»): payloads de webhook validados con Ajv contra `WebhookPayload` (hold.expired con `holdId` del hold vencido y `status: EXPIRED`; booking.confirmed; booking.failed) y efectos reales: J2 booking 410 `OFFER_NO_LONGER_AVAILABLE`; J3 202 → `CONFIRMED` + tickets `ISSUED`; J4 `FAILED`, ticket `VOIDED`, asiento `RELEASED`, inventario reservado liberado y capacidad `held/sold` restituida.
- RecoverCheckIns: `dcs-real.spec.ts` (real, ×2): `customer` ⇒ `PERMISSION_DENIED`; `system` con `IN_PROGRESS` vencido ⇒ `recoveredCheckIns: 1`, pase regenerado, 1 delivery; con `eventPublished=false` pendiente ⇒ `publishedEvents: 1`, 1 delivery. `recover-check-ins.spec.ts`: fallo de un check-in lo deja bloqueado sin detener el lote.
- Contratos: `git diff origin/main...HEAD -- contracts/openapi` vacío. gRPC: solo `optional string hold_id = 5` (WebhookEventData) y `rpc RecoverCheckIns` + dos mensajes nuevos; sin números reutilizados ni campos eliminados. `holdId` está permitido por `WebhookPayload.data` (sin `additionalProperties: false`).
- `scripts/audit-policy.spec.ts` AUDIT-01..04 ⇒ 4/4 (código 1 con JSON y excepción vigente pasa; alta no exceptuada falla; excepción vencida falla; sin JSON válido falla con «npm audit did not produce a valid JSON report»).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | Ninguno |
## Observaciones (no bloquean → BACKLOG)
- O1 (PLT-H2): `platform/api-gateway/src/scheduler.ts:15,24` — `acquire`/`release` fuera del `try`; si el almacén de bloqueo lanza, `run()` rechaza. Con un almacén que falla tras la ronda inicial, `node` termina con código 1 por rechazo no manejado en el temporizador (`void this.run(task)`, línea 11); ADR-F11-11 afirma que un fallo no detiene el Gateway.
- O2 (PLT-I2): ADR-F11-13 y `common.proto` cambian `data` de `hold.expired` a `{ holdId, status }`, mientras PLAN §1.3 (GAP-025) dice `{ status: "EXPIRED" }`; autorizado por el humano y conforme al OpenAPI.
- O3 (PLT-I2): `webhooks-service/src/application/schemas.ts` pasó `payloadData` de `.strict()` a `.passthrough()`; acepta cualquier campo adicional en `data`.
- O4 (PLT-H2): `PrismaSchedulerStore` no tiene prueba en el repositorio contra Postgres; los e2e lo sustituyen y las unitarias usan un almacén en memoria (verificado por el auditor con script ad hoc).
- O5 (PLT-H2): `SCHEDULER_BATCH_SIZE` solo acota `resumePending` y `recoverCheckIns`; `expireHolds` y `dispatchPending` usan lotes fijos del servicio (500 y 100).
- O6 (tarea 0): la rama de reversión (`markBlocked`) de RecoverCheckIns solo se prueba con almacén simulado, no contra la base real.
- O7 (dependencias): la excepción de zod vence el 2026-11-23; la migración a zod 4 sigue en BACKLOG.
