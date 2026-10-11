# Auditoría F5 — #2
- Fecha: 2026-10-11 · Commit auditado: 8f5c79f · Veredicto: APROBADO
- Alcance: auditoría de código. PRC-13 y PRC-14 (migración, seed, deploy y smoke en Cloud Run) fuera por instrucción. Sobre 8f5c79f solo hay commits de documentación.

## Verificación de audit-1
| Hallazgo | Estado |
|---|---|
| H1 (PRC-SEC-03, suite §2.5) | Resuelto: `security.spec.ts:41` (llave incorrecta ⇒ 16), `:50` (error interno forzado ⇒ 13 `INTERNAL_ERROR` sin el mensaje forzado), `:54` (logs sin owner ni llave, con `[REDACTED]`); 6/6 en verde |
| Obs. lint | Resuelta: `npm run lint` exit 0 |
| Obs. `quoteChange` (PRC-10) | Resuelta: consulta Inventory y tarifas de la fecha nueva; pruebas con diferencias reales (`50.00`/`10.00` ⇒ `110.00`) y tarifa más barata (`-20.00`/`-10.00` ⇒ `totalToPay 50.00`) |
| Obs. cancelación no reembolsable (Q-033) | Resuelta: `post-sale-pricing.spec.ts:54` ⇒ `refundAmount 20.00` (solo tasas) |

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (`npx jest microservices/pricing-service --runInBand --verbose`: 8 suites, 26/26, incluida PRC-12 contra Inventory real) | ✔ |
| Regresiones (shared 11/11, inventory 74/74, webhooks 16/16, ticketing 12/12, gateway 44/44; tras el cambio en `packages/shared/src/logger.ts`) | ✔ |
| Pruebas de seguridad (PRC-SEC-01..03; suite §2.5 completa) | ✔ |
| Checklist de cierre (código; smoke Cloud Run excluido) | ✔ |
| Conformidad con el contrato (`SearchResponse`, `HoldResponse`, `HoldStatusResponse` validados contra el OpenAPI; `priceDifference` son strings; proto solo aditivo) | ✔ |
| CI en clon: lint, build de shared y pricing, `npm audit --audit-level=high` (exit 0, sin altas) | ✔ |
| Contenedor (`docker build --no-cache`, `docker run --rm` con `PORT=8080`) ⇒ health `SERVING` con llave, `UNAUTHENTICATED` sin ella | ✔ |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | — |

## Observaciones (no bloquean → BACKLOG)
- `post-sale-pricing.ts` (`quoteChange`): la tarifa vigente se toma de `pricingOptions[0]` del itinerario recibido, y se cotiza con `flights[0]` del resultado de Inventory.
- La prueba de logs (`security.spec.ts:54`) verifica la redacción sobre un objeto `sensitive` que el propio interceptor añade al log.
- Bitácora dev F5 #4: la fila de las 14:40 conserva el marcador `<N> suites, <N> pruebas` y la sección «Pendientes» sigue indicando que la suite completa no se ejecutó, pese a la verificación del humano (8 suites, 26 pruebas).
- `npm audit`: 22 moderadas, ninguna alta.
