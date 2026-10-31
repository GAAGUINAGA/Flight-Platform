# Auditoría F12 — #3
- Fecha: 2026-10-31 · Commit auditado: 6f0090d (rama `feat/F12a2-pre-despliegue`; último commit de código `4d70cb4`, PRC-12 `51b7830`) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle (checkout `C:\Proyectos\fp-audit`, Postgres local en 127.0.0.1:15432, sin `--forceExit`, sin omitidas salvo el `it.todo` de OP-02):

| Comando | Resultado |
|---|---|
| `npm run lint` · `node scripts/audit-policy.cjs` | exit 0 · exit 0 |
| `RUN_GATEWAY_REAL=true npx jest platform/api-gateway --runInBand` | 3 corridas completas: 1.ª 1 fallo (ver observación 1); 2.ª y 3.ª seguidas: 33 suites, 823 passed, 1 todo |
| `RUN_DCS_REAL=true npx jest microservices/pricing-service --runInBand` ×2 (incluye PRC-12) | 11 suites, 55 passed ambas; Jest terminó solo |
| `RUN_DCS_REAL=true npx jest microservices/operations-service --runInBand` ×2 | 21 suites, 85 passed ambas |
| Clon limpio `C:\Proyectos\fp-audit-clean-f12a2b` (6f0090d): `npm ci`, prisma generate, lint, build shared/contracts/servicio, `audit:policy` | todo exit 0 |
| Pruebas de cada workflow en el clon limpio | gateway-ci 12 suites 181 passed · pricing 6 suites 37 passed · operations 17 suites 64 passed |

Observaciones de audit-2:
- 1 (límite por tramo): resuelta. Contraste con fuerza bruta (4800 escenarios aleatorios: 1–3 tramos, límites 1, 2, 3 y 10, con empates; script local no commiteado): 0 diferencias en conjunto y orden (precio total, salida del primer tramo, ids). F1-C/R/M-1/2 pasan.
- 2 (infantes): resuelta. `prisma-check-in.ts:56-58` cuenta pares reserva+asiento; F2-01 pasa.
- 3 (fallo no identificado en clon): sin recurrencia en el clon.
- 6 (401 sobre 400): resuelta. Matriz F3 generada desde el OpenAPI v2 (26 rutas protegidas × 401/403, cabeceras inválidas, ruta pública `search` sin cambios) pasa; v1 sin cambios.
- 4, 5, 7: sin cambios; se mantienen.

Otros: sin cambios en `contracts/` ni migraciones (`git diff 8dfa117..HEAD`). Plazos de F5 (`jest.setTimeout` 60 s/30 s, J2 con `ExpireHolds` real y `expiredCount > 0`) no debilitan aserciones. PRC-12 termina sola. `docker build` y negativa del gateway sin llave del dev-auth no repetidos por instrucción.
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
1. Gateway real, primera corrida completa con Postgres operativo: 1 fallo en `real-stack.e2e.spec.ts` › «PLT-A/B e I5/I6: compra, postventa y smoke de check-in» (suite de 51 s; 822 passed). No se capturó el mensaje de error. No reproducido: la prueba sola y la suite `real-stack` completa pasan, y dos corridas completas posteriores pasan (823). Los logs muestran `getOfferHold code=5` (NOT_FOUND) en esa prueba también cuando pasa.
2. F3: `POST /api/v2/vuelos/offers/hold/` (barra final) y `POST /api/v2/vuelos/Offers/hold` (mayúscula), sin token y con cuerpo `{}`, responden 400 VALIDATION_FAILED en lugar de 401 (`http.ts`: la expresión regular de rutas protegidas exige coincidencia exacta y sensible a mayúsculas). Las rutas del contrato exactas responden 401/403 correctamente.
3. F5: `p5-stock.e2e.spec.ts` calcula la expectativa con `GATEWAY_CONFIG.v2.stock.timezones` (la misma configuración que usa el código) en lugar de `{}`.
4. PRC-12: se eliminó `expect(searched.offers).toHaveLength(1)` (de audit-2); las aserciones de capacidad se mantienen.
5. B: las pruebas de la excepción `NODE_ENV=test` no fijan el caso `test`.
6. Primera corrida real del gateway abortada por Postgres caído (16 suites con `Can't reach database server`); repetida con la base arriba. Entorno, no código.
- Clon a borrar: `C:\Proyectos\fp-audit-clean-f12a2b`.
