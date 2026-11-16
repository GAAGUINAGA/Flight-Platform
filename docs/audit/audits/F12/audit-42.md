# Auditoría F12 — #42
- Fecha: 2026-11-15 · Commit auditado: e0c1e93cdeafa6fdd4731a8937e119293f2f776d · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ — CI limpio de siete workflows pasa; Inventory real 100/100, Operations real 111/111, registro 7/7; ADM4-O-02 no cubre una tarifa faltante de la misma cabina. |
| Pruebas de seguridad | ✔ — Suites reales de Inventory, Operations y Gateway; autorización GraphQL, Gateway y ESB verificada. |
| Checklist de cierre | ✘ — Apertura manual de vuelo incompleto; Gateway real: segunda corrida 1067/1067, primera con un timeout que pasó aislado. |
| Conformidad con el contrato | ✔ — OpenAPI público v2 sin cambios; contratos internos aditivos; `packages/shared` solo agrega dos códigos internos. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12c-4c / ADM4-O-02 | `platform/api-gateway/src/admin-api.ts:223`; `platform/api-gateway/src/admin-checkin-flights.spec.ts:166,266` | Tras fallar el guardado de `Flex`, queda `Basic` y el vuelo cerrado; `POST /flights/{id}/open` acepta esa única tarifa de `ECONOMY` y abre el vuelo sin todas las tarifas enviadas. |
## Observaciones (no bloquean → BACKLOG)
- `rsv-12-real` PST-03/04: 1/298 falla por datos locales; consta también en `main` y en BACKLOG.
- Gateway real, primera corrida: timeout de 5 s en `webhook-emitters.e2e.spec.ts`; segunda corrida completa 1067/1067 y repetición aislada 3/3 pasan.
