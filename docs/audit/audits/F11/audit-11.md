# Auditoría F11 — #11
- Fecha: 2026-10-25 · Commit auditado: 528bc91 · Veredicto: RECHAZADO
- Alcance: auditoría de código #1 de la entrega F11d-1 (migración de Zod 3 a Zod 4, retiro de la excepción de audit). Rama `feat/F11d1-zod4`; commits 2bf98f7, cf880c5, dcef0a4, 0167a6f, 0baf1a3 y 528bc91.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor:
- Checkout de trabajo (`C:\Proyectos\fp-audit`): `npm run lint` ⇒ 0 (incluye `verify-workspace-dist.cjs`); `node scripts/audit-policy.cjs` ⇒ 0, "no high or critical vulnerabilities" con `security/npm-audit-exceptions.json` vacío; `npm ls zod --all` ⇒ solo `zod@4.6.6` en los diez workspaces; `npm ls prisma @prisma/client --all` ⇒ solo 6.12.0; `npm run build` ⇒ 0 en todos los workspaces y sin `dist/` en la raíz; sin imports `zod/v3`; `git diff` sin cambios en `contracts/` ni migraciones; el lockfile solo cambia zod y la dependencia de pricing en contracts.
- Suites completas (`npx jest <servicio> --runInBand`): inventory 76/76, pricing 32/32, ticketing 12/12, webhooks 19/19, ancillaries 35/35 (1 suite opt-in ANC-10 omitida, fuera de lo pedido), operations 62/62, reservation 114/114, gateway 58/58, shared/hello/scripts 21/21.
- Suites reales, dos veces seguidas, 0 fallos: gateway `RUN_GATEWAY_REAL=true` ⇒ 152 pasan + 1 todo (153); operations `RUN_DCS_REAL=true` ⇒ 64/64; reservation `RUN_RSV12_REAL`, `RUN_PST_REAL`, `RUN_PST_SMOKE_REAL` ⇒ 133/133; pricing PRC-12 ⇒ 1/1.
- Clon limpio (`git clone` + `checkout 528bc91` + `npm ci`), pasos del workflow: CI de inventory, ticketing, webhooks, ancillaries, operations, reservation, gateway y hello ⇒ prisma generate, build, pruebas unitarias y `audit:policy` en verde. CI de pricing ⇒ falla el build (H1).
- Validación y logs: los errores siguen saliendo como `VALIDATION_FAILED` / `INVALID_ARGUMENT` (pruebas de seguridad de los servicios y del gateway en verde); los logs de las suites reales muestran solo `error:"VALIDATION_FAILED"` sin valores; el código registra únicamente rutas de campo (`reservation.controller.ts:32`, `fare-admin.ts:33`, `admin.schemas.ts:50`).
- Comparación zod 3.25.76 vs 4.6.6 con lotes de entradas (`email`, `url`, `date`, `guid` frente a `uuid`, enteros, `strict`, `passthrough`, `preprocess`): sin diferencias en `email`, `url`, `date`, `strict`, `passthrough`, `preprocess`/`optional`, rutas de error y `guid` (acepta `1111…`, rechaza formas inválidas); diferencias en `datetime` y números (ver Observaciones).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F11d-1 · CI del servicio pricing (PLAN D-14; AGENTS: mismos pasos del workflow en clon limpio) | En clon limpio de 528bc91 tras `npm ci`: `npm run prisma:generate -w microservices/pricing-service`, `npm run lint`, `npm run build -w @flight-platform/shared`, `npm run build -w microservices/pricing-service` (pasos de `.github/workflows/deploy-service.yml:58-64`) ⇒ `src/application/openapi-mappers.ts(1,33): error TS2307: Cannot find module '@flight-platform/contracts'`, exit 2 | El workflow de pricing no compila `@flight-platform/contracts` antes del build del servicio (solo shared y el servicio), por lo que el build del CI falla; en el checkout de trabajo pasa porque `packages/contracts/dist` ya existe. Solo el Dockerfile fue ajustado. |
## Observaciones (no bloquean → BACKLOG)
- O1 (comportamiento Zod 4): `z.string().datetime()` y `datetime({ offset: true })` rechazan ahora `2026-10-24T00:00Z` (sin segundos) y, con offset, `2026-10-24T00:00:00+0200` (sin dos puntos); Zod 3 los aceptaba. Afecta `webhooks-service/src/application/schemas.ts:8`, `operations-service/src/application/schemas.ts:3` y `api-gateway/src/admin.schemas.ts` (`dateTime`). Ninguna prueba existente lo fija; el ADR-F11-16 solo documenta el cambio de UUID.
- O2 (comportamiento Zod 4): `z.number()` rechaza `Infinity` y `.int()` rechaza enteros fuera del rango seguro (≥ 2^53); Zod 3 los aceptaba. No alcanzable por JSON ni por los rangos acotados de los esquemas.
- O3 (despliegue): la verificación de contenedores de la bitácora del humano cubre las imágenes, no el CI de GitHub Actions.
- O4: el ADR-F11-16 documenta GUID; `z.string().email()` y `z.string().url()` no mostraron diferencias en los lotes probados, pero la bitácora del developer no incluye prueba que lo fije.
