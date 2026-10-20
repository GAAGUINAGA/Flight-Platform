# Auditoría F11 — #1
- Fecha: 2026-10-20 · Commit auditado: 742f021 · Veredicto: APROBADO
- Alcance: entrega F11a (PLT-SEC-01, PLT-SEC-02, PLT-A, PLT-B, PLT-C, PLT-D, PLT-I1). Clon `C:\Proyectos\fp-audit`, rama `feat/F11a-auth-compra`, Postgres local en 127.0.0.1:15432.
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos ejecutados por el auditor:
- `npm run lint`: sin errores ni advertencias.
- `npx jest platform/api-gateway/src/gateway.spec.ts --runInBand` (comando CI del gateway): 43/43.
- `npx jest platform/api-gateway --runInBand --silent`: 4 suites aprobadas, 1 omitida (e2e real sin `RUN_GATEWAY_REAL`); 46 aprobadas, 7 omitidas.
- `RUN_GATEWAY_REAL=true npx jest platform/api-gateway --runInBand --verbose`, dos ejecuciones seguidas: 5/5 suites, 52 aprobadas, 1 `todo` (OP-02 segmento compartido, ADR-F11-03), 0 omitidas y 0 fallidas en ambas.
- `git diff --stat origin/main HEAD -- microservices contracts packages`: vacío. No existe rama `main` local; se comparó con `origin/main`.
- Salidas de las tres ejecuciones sin tokens (`eyJ`, `Bearer`) ni datos personales (documento, email, teléfono, nombres); el log de error de gRPC muestra `ownerId` e `internalApiKey` como `[REDACTED]`.
- No se ejecutaron `npm audit` ni el docker build (este último verificado por el humano según la bitácora).

Revisión por tarea:
- PLT-A (OP-01, OP-02): K con Ajv de `SearchResponse`, `SeatMapResponse` y `ProblemDetails` (404 `OFFER_NO_LONGER_AVAILABLE`, 429 `RATE_LIMIT_EXCEEDED` con `Retry-After`); 400 de `/search` en `gateway.spec.ts:76`; 429 por `X-Device-Fingerprint`.
- PLT-B (OP-03 a OP-05): 401, 403 y 400 con `ProblemDetails`; hold de otro sub ⇒ 404 en OP-04; ciclo crear, consultar y liberar (204).
- PLT-C (OP-06 a OP-08): 201 `CONFIRMED` y 202 `PENDING_PAYMENT` validados contra `BookingDetail`; listado validado contra `BookingListResponse`; reserva ajena ⇒ 404; 401, 403 y 400.
- PLT-D (OP-18, OP-19): `TicketListResponse` y `Ticket` validados; booking y ticket ajenos ⇒ 404; 401 y 403.
- PLT-I1 (J1): `real-stack.e2e.spec.ts:226-274` comprueba hold `HELD` y luego `CONSUMED` en Inventory, reserva `CONFIRMED` con `holdId` y tickets `ISSUED` en persistencia, y tickets visibles por OP-18 y OP-19. Además ejecuta `render-j1-smoke.cjs` contra el gateway en proceso.
- PLT-SEC-01: `f11a-supabase-auth-hook.sql` concede `admin` solo desde `app_metadata.app_role = 'admin'`, cualquier otro valor ⇒ `customer`, y solo `supabase_auth_admin` conserva `EXECUTE`. La prueba con tokens reales queda fuera de esta auditoría (la ejecuta el humano contra Render).
- PLT-SEC-02: `partner-issuer.spec.ts` verifica el token `partner` y que `loadConfig` rechaza en producción `publicKeyFile` o el emisor `flight-platform-dev` (`config.ts:36`). La lista de variables para Render (bitácora) incluye `JWT_ISSUERS` solo con el emisor de Supabase (`jwksUri`, `aud` `authenticated`) y excluye el emisor B2B de desarrollo.
- ADR-F11-03: la limitación es aceptable como no bloqueante. El contrato OpenAPI solo exige 404 `ProblemDetails` para OP-02 y no define cuándo; el humano decidió no ampliar Pricing (PLAN §4.4 regla 5, decisión no discutida). Su alcance real se detalla en la observación O1.
- CI: el workflow ejecuta solo `platform/api-gateway/src/gateway.spec.ts`. Quedan fuera del CI las pruebas relevantes de F11a de `src/partner-issuer.spec.ts` y `src/openapi-path.spec.ts`, además de `test/e2e/real-stack.e2e.spec.ts` y `test/integration/prisma-idempotency.integration.spec.ts` (estas dos requieren Postgres, según AGENTS.md).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| — | — | — | Ninguno |
## Observaciones (no bloquean → BACKLOG)
- O1 (PLT-A / ADR-F11-03): `GetSeatMapForOffer` solo valida `offerId` como UUID y no lo usa (`ancillaries-service/src/application/seat-map.ts:13-14`); el gateway resuelve solo `segmentId` (`shopping.controller.ts:38`). Un `offerId` inexistente o expirado con un segmento presente en alguna oferta activa devuelve 200. PRC-07 del plan describe `ResolveSegment(offerId, segmentId)`. Cubierto por `it.todo` (`real-stack.e2e.spec.ts:323`).
- O2 (PLT-B): no hay prueba REST de OP-05 (DELETE) con hold de otro sub ⇒ 404, ni de OP-07 con `holdId` de otro sub; solo se prueba OP-04. El código es owner-scoped (`pricing-service/src/application/offer-holds.ts:46`).
- O3 (PLT-C): no hay prueba de que `GET /bookings` de un sub no liste reservas de otro.
- O4 (PLT-SEC-02): no hay prueba con token `partner` contra rutas REST. La parte «gestiona webhooks» depende de OP-15 a OP-17 (F11c). Además `auth.ts:17` da precedencia al claim `app_role` del token sobre `issuer.role`; PLAN §2.2 dice que el rol `partner` se asigna por emisor.
- O5 (PLT-SEC-01): `supabase-auth-smoke.cjs` espera 403 en `/flights/v1/admin/flights`, ruta que aún no existe en el gateway (PLT-H1, F11c).
- O6 (PLT-I1): `render-j1-smoke.cjs` valida campos clave pero no los schemas con Ajv; el contrato contra Render depende de `VALIDATE_RESPONSES`.
- O7 (PLT-I1): J1 y la prueba PLT-A/B comparten un único `it` (`real-stack.e2e.spec.ts:195-297`); un fallo en B no distingue la tarea.
- O8 (auth): `createRemoteJWKSet` se crea en cada petición (`auth.ts:13`), sin reutilizar la caché de claves.
- O9 (documentación del developer): la sesión modificó `docs/dev/progress/2026-10-17_dev_F9_4.md` (bitácora de otra fase; AGENTS.md lo prohíbe). La sección «Pendientes / bloqueos» de `2026-10-20_dev_F11_1.md` quedó desactualizada frente al cierre, y esa bitácora declara `fa7d8d6` como commit verificado mientras el código final es `742f021`.
- O10 (CI): el workflow no ejecuta `partner-issuer.spec.ts` ni `openapi-path.spec.ts`, que cubren PLT-SEC-02 y la resolución de la ruta del OpenAPI.
