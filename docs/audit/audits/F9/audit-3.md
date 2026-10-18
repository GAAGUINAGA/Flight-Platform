# Auditoría F9 — #3
- Fecha: 2026-10-17 · Commit auditado: b9d5340 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Alcance: solo la corrección acotada (ADR-F9-06, `docs/dev/progress/2026-10-17_dev_F9_4.md`); el resto de F9 quedó aprobado en audit-2.

Detalle de lo ejecutado (checkout `--detach b9d5340`; clon con `npm ci`, clientes Prisma generados y Postgres local):
- `npm run lint`: exit 0, sin advertencias.
- CI ancillaries (`npx jest microservices/ancillaries-service/test --runInBand --testPathIgnorePatterns=integration`): 11 suites, 20/20. CI reservation: 18 suites, 86/86.
- Suites completas: ancillaries 34 pasan (+1 omitida); reservation 96 pasan (+17 opt-in omitidas).
- `RUN_RSV12_REAL=true RUN_PST_REAL=true npx jest .../rsv-12-real.spec.ts --runInBand --verbose`, dos ejecuciones seguidas: 17/17 y 17/17.
- `f9-pool-pressure.spec.ts` con el código del commit: pasa. Con `microservices/ancillaries-service/src` de `origin/main` restaurado temporalmente: falla (`code: "P2028"` y gRPC `code: 13`); árbol devuelto a b9d5340 tras la prueba.
- `git diff origin/main b9d5340 -- contracts/ packages/`: vacío. El diff toca solo ancillaries, reservation (filtro + diagnóstico), ADR y bitácora.
- Punto 1 (logs): `prisma-diagnostic.ts` en ambos servicios registra solo `prisma_code=P2xxx` y modelo/campo/índice contra listas permitidas del esquema; `prisma-diagnostic.spec.ts` (ambos servicios) confirma que mensaje y valores sensibles artificiales no aparecen. La respuesta gRPC sigue siendo `INTERNAL_ERROR`.
- Punto 2 (transacciones): lecturas simples (`list`, `listAllowances`, `assignments`, `ownership`) sin `$transaction`; `reserve`, `registerAllowances` y `purchase` son las únicas transacciones, con `maxWait` y `timeout` explícitos y configurables (`ANCILLARIES_TX_MAX_WAIT_MS`, `ANCILLARIES_TX_TIMEOUT_MS`, defecto 4000, validados como enteros positivos); sin llamadas de red dentro; `getBaggageOptions` y `releaseAll` secuenciales; una sola transacción interactiva por petición.
- Punto 3 (PgBouncer): solo `pg_advisory_xact_lock` dentro de transacción; sin `FOR UPDATE`, sin locks de sesión.
- Punto 4: la prueba de presión usa `connection_limit=1`, ocupa la conexión 2,5 s y lanza en paralelo getAssignments, getBaggageOptions, purchaseBaggage (gRPC y store) y releaseAll.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
1. La bitácora `2026-10-17_dev_F9_4.md` termina con Estado "en curso" y "Commit final: pendiente"; la verificación en clon limpio la reporta el humano fuera de ella.
2. La bitácora cita CI ancillaries 15/15; en esta auditoría el mismo comando da 20/20 (sin fallos).
3. Los errores no Prisma P2xxx ahora se registran como `internal error` sin el nombre de la excepción que se registraba antes (`prismaDiagnostic` en ambos servicios).
4. El código exacto del fallo en Cloud Run sigue sin confirmarse (ADR-F9-06 lo reconoce); P2028 es reproducción local.
5. `maxWait` + `timeout` por defecto (4 s + 4 s) pueden superar el deadline gRPC de 5 s (señalado en el ADR).
