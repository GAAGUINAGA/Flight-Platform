# Auditoría F12 — #27
- Fecha: 2026-11-13 · Commit auditado: 7f3c4d57aeb301c85e8abb5306b71b29e4725ee5 · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Despliegue: squash en `origin/main`; GraphQL Ready, 100 % del tráfico en imagen del commit; `/health` 200; Reservation y ESB Ready; Gateway v1 y v2 200. Paginación de producción: evidencia del humano en `2026-11-13_dev_F12c-1_deploy_1.md`. |
| Pruebas de seguridad | ✔ Cuenta `graphql-service-runtime` sin roles de proyecto; solo `flight-platform-deployer` tiene `serviceAccountUser` sobre ella. Variables de producción y CORS cerrados; consultas libre e introspección 403; origen ajeno sin cabecera CORS; registros sin errores ni datos sensibles. |
| Checklist de cierre | ✔ Configuración de Reservation conservada, secreto referenciado; GraphQL con mínimo 0 instancias; logs sin errores de las tres revisiones. Despliegue y smoke humano registrados; sin migraciones. |
| Conformidad con el contrato | N/A — auditoría de despliegue; código aprobado en audit-26 y contrato público sin cambios. |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- La guía `docs/dev/f12c1-graphql-despliegue.md` §2 aún describe la configuración de variables después del primer despliegue; el humano documentó el orden usado. La compra de prueba de Booking sigue pendiente de su disponibilidad.
