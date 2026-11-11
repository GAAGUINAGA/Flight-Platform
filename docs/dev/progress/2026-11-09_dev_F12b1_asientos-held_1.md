# Bitácora dev F12b1 — asientos apartados en el hold (rama feat/asientos-held)

Fecha: 2026-11-09 · Estado: **listo para auditoría (código)** · SHA del código: `304c98c`

## Decisiones del humano
- (a) Migración aditiva `ancillaries/20261109120000_seat_hold` (esquema `ancillaries`); la aplicó el humano en la base local (`migrate status`: up to date).
- (b) `assignedSeats` en el hold como extensión compatible; el contrato v2 no cambia (acuerdo con Booking, 09-11-2026). ADR y `docs/booking-integration.md` §5.1.
- La imagen Docker de ancillaries la verifica el humano (no se construyó aquí).
- El ADR se llama `ADR-F12b2fix-01-asientos-apartados-hold.md` (F12d es la entrega de telemetría).

## Entregables
`docs/dev/diseno-asientos-held.md`, `docs/dev/adr/ADR-F12b2fix-01-asientos-apartados-hold.md`, `docs/booking-integration.md` §5.1; código en ancillaries, ESB (catálogo), api-gateway y reservation; `.proto` solo aditivos; sin cambios en `contracts/openapi/`; sin variables de entorno nuevas.

## Checklist de cierre
| Ítem | Resultado |
|---|---|
| `npm run lint` (eslint, dist, SQL con esquema, check-deploy-env) | OK (local y clon limpio) |
| `npm run audit:policy` | OK |
| `tsc` ancillaries, reservation, esb-service, api-gateway | 0 errores (local y clon limpio) |
| Clon limpio `C:\Proyectos\flight-platform-cleancheck-asientos` (npm ci, prisma generate, lint, build, audit, unitarias de los workflows) | ancillaries 33/33, reservation 195/195, gateway src 246/246, ESB unit 119/119 |
| Ancillaries completo (incluye integración H-01…H-14 contra Postgres) | 83 pasan, 1 omitida |
| Reservation `RUN_RSV12_REAL`, `RUN_PST_REAL`, `RUN_PST_SMOKE_REAL`, suite completa | 231/231 en 3 de 4 corridas completas (ver nota PST-07); dos corridas consecutivas limpias |
| Operations `RUN_DCS_REAL=true`, dos veces | 91/91 y 91/91 |
| Gateway `RUN_GATEWAY_REAL=true`, `GATEWAY_TRANSPORT=esb`, dos veces seguidas | 896/896 (+1 todo) y 896/896 |
| `GET /vuelos/eventos` ascendente y `after` | `events-feed.spec.ts` 4/4; además V2-P3-11/13 (real) y `webhooks-v2` (Postgres) |

## Notas
- **rsv-12-real "Test suite failed to run"**: `TypeError: Prisma.raw is not a function` en `inventory-service/.../schema.ts`. Causa: el cliente de Prisma generado de inventory (el único que se genera en `node_modules/@prisma/client`) estaba desfasado/sobrescrito en el checkout; no está relacionado con este cambio. Se resolvió ejecutando `prisma generate` de los servicios (inventory primero). La prueba pasó después.
- **PST-07 intermitente**: en una de las cuatro corridas completas de reservation falló «el mismo cancellation quote en paralelo solo cancela una vez» (carrera entre dos cancelaciones simultáneas); pasó sola y en las tres corridas siguientes. Esa ruta no usa asientos apartados (`assignedSeats: []`, hold sin asientos). Se deja registrado para la auditoría; no se modificó.
- Se actualizaron expectativas antiguas por el nuevo estado del mapa: `ESB-CAT-01` (44→46 operaciones), `V2-P2-11` y `V2-P4-40` (asiento con boleto emitido: `BOOKED`→`TICKETED`, que es el estado correcto del contrato). Ninguna prueba se debilitó.
- Pruebas nuevas: ancillaries `f12b2fix-held-seats` (unit 10, integración H-01…H-14), reservation `f12b2fix-held-seats` (7), gateway `hold-seats` (13), `events-feed` (4), e2e real `held-seats.e2e.spec.ts` (V2-HELD-01…07: los tres escenarios de Booking, vencimiento, hold→reserva, v1).

## Pendiente del humano
- Construir y arrancar la imagen de ancillaries (health SERVING con PORT=8080).
- Borrar el clon `C:\Proyectos\flight-platform-cleancheck-asientos`.
- Orden de despliegue: migración, ancillaries, ESB, gateway, reservation.


## Verificaciones del humano
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 17:40 | Pedido de Booking | Para su prueba completa: assignedSeats en el hold con 409 SEAT_TAKEN, HELD en el mapa mientras el hold esté vigente, y CHECKED_IN tras el check-in; confirmado con Booking que el contrato v2 no cambia (acuerdo de integración, ADR-F12b2fix-01). Reglas decididas por el humano antes del código. | Decidido |
| 17:40 | Migración | 20261109120000_seat_hold (ancillaries: hold_id, hold_expires_at, converted_booking_id, nulas, e índice por hold_id), revisada (solo aditiva) y aplicada en la base local. | ✓ |
| 17:40 | Alcance | `git diff main`: ancillaries, reservation, ESB (dos operaciones), gateway, .proto solo aditivos, OpenAPI sin cambios. Aserciones cambiadas: V2-P2-11 y V2-P4-40 (BOOKED → TICKETED, pedido de Booking) y el conteo del catálogo del ESB (44 → 46). | ✓ |
| 17:40 | Pruebas | Lint, audit-policy, check-deploy-env, CI de todos los workflows, los tres escenarios de Booking (held-seats.e2e.spec.ts) y suites de ancillaries, reservation (reales), operations y gateway real con GATEWAY_TRANSPORT=esb sobre 304c98c. | ✓ Sin fallos; un único todo (OP-02). |
| 17:40 | Plataforma local | local:up y local:journey 31/31. | ✓ |
| 17:40 | Imágenes | ancillaries y reservation: image-startup-smoke.sh en verde; ancillaries SERVING con llave y Unauthenticated sin ella. | ✓ |

## Corrección de audit-17 (2026-11-10)
Estado: **listo para auditoría (código)**. El SHA final se informa en el chat (es el del commit `fix(ancillaries): [F12b1] ...`).

| Hallazgo | Qué cambié | Prueba |
|---|---|---|
| H1 — migración `20261109120000_seat_hold` sin esquema | Reescrita con `"ancillaries"."seat_assignments"` en `ALTER TABLE` y en `CREATE INDEX ... ON`; sigue siendo solo aditiva. El humano deshizo la versión vieja y aplicó la nueva en su base local (`migrate status`: up to date). | `npm run lint` con el verificador extendido: OK; `check-raw-sql.spec.ts` rechaza el SQL original sin esquema |
| H1 (prevención) | `scripts/check-raw-sql.cjs` revisa las migraciones con marca `>= 20261109000000` (corte por fecha; las anteriores exentas). ADR-F12b1fix-03. BACKLOG: migraciones históricas sin calificar por compatibilidad. | `npx jest scripts/check-raw-sql.spec.ts`: 8/8 |

Checklist:
| Ítem | Resultado |
|---|---|
| `npm run lint` (eslint, dist, SQL y migraciones con esquema, check-deploy-env) | OK |
| Ancillaries completo (integración contra Postgres con la migración nueva) | 83 pasan, 1 omitida |
| Gateway real `RUN_GATEWAY_REAL=true`, `GATEWAY_TRANSPORT=esb`, una vez (`npx jest platform/api-gateway`) | 896 pasan, 1 todo |
| Código de los asientos apartados | Sin cambios |

Solo se tocó SQL de migración, `scripts/` y documentación; no hay cambios de TypeScript de servicios, por lo que no se repitió `tsc`.


## Verificaciones del humano
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 20:09 | Pedido de Booking | Para su prueba completa: assignedSeats en el hold con 409 SEAT_TAKEN, HELD en el mapa mientras el hold esté vigente, y CHECKED_IN tras el check-in; confirmado con Booking que el contrato v2 no cambia (acuerdo de integración, ADR-F12b2fix-01). Reglas decididas por el humano antes del código. | Decidido |
| 20:09 | Migración | 20261109120000_seat_hold (ancillaries: hold_id, hold_expires_at, converted_booking_id, nulas, e índice por hold_id), revisada (solo aditiva) y aplicada en la base local. | ✓ |
| 20:09 | Alcance | `git diff main`: ancillaries, reservation, ESB (dos operaciones), gateway, .proto solo aditivos, OpenAPI sin cambios. Aserciones cambiadas: V2-P2-11 y V2-P4-40 (BOOKED → TICKETED, pedido de Booking) y el conteo del catálogo del ESB (44 → 46). | ✓ |
| 20:09 | Pruebas | Lint, audit-policy, check-deploy-env, CI de todos los workflows, los tres escenarios de Booking (held-seats.e2e.spec.ts) y suites de ancillaries, reservation (reales), operations y gateway real con GATEWAY_TRANSPORT=esb sobre 304c98c. | ✓ Sin fallos; un único todo (OP-02). |
| 20:09 | Plataforma local | local:up y local:journey 31/31. | ✓ |
| 20:09 | Imágenes | ancillaries y reservation: image-startup-smoke.sh en verde; ancillaries SERVING con llave y Unauthenticated sin ella. | ✓ |