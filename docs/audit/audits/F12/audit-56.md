# Auditoría F12 — #56
- Fecha: 2026-11-26 · Commit auditado: 102e82ad01b6a306881ab88aaacf387a92855926 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ — E2E panel 1/1; Operations real 113/113; Gateway real 679/679 dos veces; CI limpio Operations 93/93 y Gateway 424/424 en repetición. |
| Pruebas de seguridad | ✔ — Suites reales de Operations y Gateway, con validación de entradas, roles, dueño, errores y redacción. |
| Checklist de cierre | ✔ — `npm run lint`, `node scripts/audit-policy.cjs`, builds y CI limpios; imágenes verificadas por el humano. |
| Conformidad con el contrato | ✔ — OpenAPI intacto; `booking.checked_in.status` del snapshot real; `gate` opcional en ambas respuestas y ausente sin asignación; protobuf aditivo y generado concordante; sin migraciones. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- El primer pase unitario limpio del Gateway falló 1/424 en `esb-transport.spec.ts:181` (salud ESB); la suite aislada pasó 18/18 y la repetición completa pasó 424/424.
