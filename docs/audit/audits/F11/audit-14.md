# Auditoría F11 — #14
- Fecha: 2026-10-25 · Commit auditado: 1bafc92 (código; 373ece8 y 943cf37 solo añaden documentación) · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle:
- `npm run lint` y `node scripts/audit-policy.cjs` en el clon de trabajo: código 0.
- CI de `gateway-ci.yml` en clon limpio (`git clone` + `checkout 1bafc92` + `npm ci`: prisma generate, lint, build shared, contracts y api-gateway, audit:policy, `jest platform/api-gateway/src`): 8 suites, 98 pruebas, todo en código 0.
- CI de ticketing (`deploy-ticketing.yml`/`deploy-service.yml`: prisma generate, lint, build, audit:policy, `jest microservices/ticketing-service/test/unit`) en el mismo clon: 2 suites, 11 pruebas, código 0.
- Suite completa de ticketing, dos veces seguidas: 3 suites, 20 pruebas, ambas.
- `RUN_GATEWAY_REAL=true jest platform/api-gateway --runInBand`, dos veces seguidas: 11 suites, 375 pasan, 0 fallan, 0 omitidas, 1 `todo` (OP-02) en ambas.
- `git diff origin/main`: sin cambios en `contracts/`, en los `.proto` ni en migraciones; fuera del gateway solo cambian `server.ts` y `main.ts` de ticketing y su prueba `fail-mode.spec.ts`.
- `render-journeys.cjs` ejecutado sin variables y con un `BASE_URL` inalcanzable y tokens ficticios: sale con código 1 y no imprime los tokens.
- Clon limpio creado para borrar: `C:\Proyectos\fp-clean-audit-f11d2`.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- PLT-J3: `render-journeys.cjs:142-145` — `hold.expired` no se verifica de forma automática (solo imprime `INFO` con el `holdId`); J2 se da por bueno con el estado `EXPIRED` y el 410 de la reserva.
- PLT-I7 / PLT-J3: `render-journeys.cjs:208-212` — el sentido «origen permitido» de CORS solo se comprueba si existe `SMOKE_CORS_ALLOWED_ORIGIN`; ambos sentidos sí están cubiertos en `authz-matrix.ts:295-309`.
- PLT-SEC-03: `authz-matrix.ts` (OP-05, OP-10, OP-12, OP-14, OP-17) — las celdas de éxito validan estado HTTP y cuerpo, pero no releen el estado persistido; las celdas 401/403 no comprueban ausencia de efectos (sí lo hace la prueba de recurso ajeno).
- PLT-J3 / checklist: «J1–J7 verdes contra el despliegue real» queda pendiente de la ejecución del humano tras el despliegue (J3 y J4 excluidos por ADR-F11-17); corresponde a la auditoría de despliegue.
- Ticketing: `server.ts:21-24` — la negativa a arrancar depende de `NODE_ENV` exactamente igual a `production` (la imagen lo fija en el Dockerfile).
