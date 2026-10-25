# Auditoría F11 — #12
- Fecha: 2026-10-25 · Commit auditado: 2c642f5 · Veredicto: APROBADO
- Alcance: auditoría de código #2 de la entrega F11d-1 (migración a Zod 4). Corrección de audit-11 con los commits 30fdbdd, f92c097, 42e4a8c (código final) y c1b716a (bitácora `2026-10-25_dev_F11d_2.md`); encima de 42e4a8c solo hay documentación.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Verificación de H1 de audit-11 (resuelto):
- Clon limpio fuera de la carpeta temporal (`C:\Proyectos\fp-clean-audit12`, `git clone` + checkout `2c642f5` + `npm ci`). Antes de cada servicio se borró `dist/` de shared, contracts y del servicio. Pasos de `deploy-service.yml:58-69` en orden (prisma generate, lint, build shared, build contracts, build del servicio, pruebas del workflow, `audit:policy`): pricing ⇒ build 0 (el error TS2307 de audit-11 ya no aparece), 4 suites / 14 pruebas; inventory 19/19; ticketing 3/3; webhooks 10/10; ancillaries 16/16; operations 50/50; reservation 98/98. Gateway (pasos de `gateway-ci.yml`) ⇒ todo 0, 57/57. Todos con exit 0.
- `deploy-service.yml:64` y `gateway-ci.yml:19` compilan `@flight-platform/contracts` tras shared y antes del servicio; `deploy-pricing.yml:10,23` incluye `packages/contracts/**` en sus paths.

Comandos ejecutados por el auditor en el checkout (`C:\Proyectos\fp-audit`, rama `feat/F11d1-zod4`):
- `npm run lint` ⇒ 0; `node scripts/audit-policy.cjs` ⇒ 0 ("no high or critical vulnerabilities"); `npm ls zod --all` ⇒ solo `zod@4.6.6`.
- Suites completas (`npx jest <servicio> --runInBand`): pricing 32/32; webhooks 26/26; operations 69 pasan (1 suite y 2 pruebas opt-in omitidas); gateway 62 pasan (1 suite y 95 pruebas opt-in omitidas).
- Suites reales, dos veces seguidas, 0 fallos y sin omitidas: gateway `RUN_GATEWAY_REAL=true` ⇒ 156 pasan + 1 todo (OP-02); reservation `RUN_RSV12_REAL`, `RUN_PST_REAL`, `RUN_PST_SMOKE_REAL` ⇒ 133/133; operations `RUN_DCS_REAL=true` ⇒ 71/71.
- Fechas (ADR-F11-16): `datetime-zod4.spec.ts` (webhooks y operations) y `admin-datetime.spec.ts` (gateway) aceptan `…Z`, `….000Z` y `+02:00` y rechazan `T00:00Z` y `+0200` (gateway: `VALIDATION_FAILED`, 400); `webhook-use-cases.spec.ts:17-19` y `grpc-security.spec.ts:41-45` (webhooks), `operations-security.spec.ts:130-137` (operations, por RPC y en base de datos) fijan `2026-11-20T10:00:00+02:00` ⇒ `2026-11-20T08:00:00.000Z`. Todas pasan dentro de las suites anteriores. Sin cambios en `contracts/` ni migraciones respecto de audit-11.
- Los contenedores no se reconstruyeron (verificados por el humano en clon limpio sobre c1b716a, según lo indicado).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- O1 (CI): `gateway-ci.yml:4,7` no incluye `packages/contracts/**` en sus `paths`; el gateway no importa `@flight-platform/contracts`, por lo que no hay efecto hoy.
- O2 (CI, ya registrada por el developer): `deploy-hello.yml` usa `deploy-service.yml`, que ejecuta `prisma:generate` y `platform/hello` no define ese script; fallaría al hacer push a main que toque hello.
- O3: la comprobación del CI real de GitHub Actions sigue pendiente del humano (no reproducible en local).
