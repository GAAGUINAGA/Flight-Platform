# Auditoría F12 — #30
- Fecha: 2026-11-14 · Commit auditado: 158745ad2045b7fc37a44b978f99db29ed366d6e · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ — GraphQL 117/117, paquetes 94/94 y web 221/221, dos corridas; web-ci y verificación de deploy-graphql en clon limpio: ✔; W3-03 y W4-02 incumplidas. |
| Pruebas de seguridad | ✔ — suites, lint, audit-policy, check-deploy-env, codegen:check y check:bundle; imagen y e2e verificados por el humano. |
| Checklist de cierre | ✘ — build web de producción con valores ficticios: ✔; pase sin QR. |
| Conformidad con el contrato | ✘ — traducción de `ProblemDetails.type` fuera de la lista cerrada autorizada. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | GQL-ERR-09 / F12c-2b | `platform/graphql/src/domain/errors.ts:119`; `fromGatewayFailure({status:422,body:{type:'https://otro.example/problems/web-payments-disabled',code:'PAYMENT_NOT_AUTHORIZED'}}).code` → `WEB_PAYMENTS_DISABLED` | Un `type` ajeno con el mismo sufijo se traduce como rechazo del canal WEB, pese a la lista cerrada; la prueba GQL-ERR-10 no cubre ese caso. |
| H2 | W3-03 | `platform/web/src/bookings/BaggageTab.tsx:37-42` | Si la primera de varias líneas de equipaje se confirma y la segunda devuelve 503, el reintento vuelve a enviar la primera con otra `Idempotency-Key` y puede comprarla dos veces. |
| H3 | W4-02 | `platform/web/src/bookings/CheckInPage.tsx:128-129` | El pase imprimible solo presenta `barcodeType` y el valor en texto; no muestra el QR exigido por PLAN §6 W4-02. |
## Observaciones (no bloquean → BACKLOG)
- `platform/web/src/bookings/SeatsTab.tsx:28`: el mapa de postventa pasa `bookingId` como `offerId`; el servicio actual usa `segmentId`, por lo que funciona hoy, pero depende de ese comportamiento documentado en ADR-F12c2b-01.
