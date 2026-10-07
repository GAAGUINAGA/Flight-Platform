# Auditoría F2 — #5
- Fecha: 2026-10-07 · Commit auditado: 19c99b9 (main; bitácora `2026-10-07_dev_F2_deploy_1.md`) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (TKT-09: clon limpio en `19c99b9` + `npm ci`; lint OK; build shared + ticketing OK con `dist/.../prisma-client` copiado; `npm audit --audit-level=high` exit 0; unit 3/3. Migración remota y smoke según salidas registradas; el log de Cloud Run corrobora `IssueTickets`, `ListTickets`, `GetTicket` y `ListTickets` sin llave el 13:11:11–13:11:16Z en la revisión `00002-sbw`) | ✔ |
| Pruebas de seguridad (llamada propia sin llave a `ListTickets` en Cloud Run ⇒ `Unauthenticated`; el smoke registrado confirma `UNAUTHENTICATED` code 16) | ✔ |
| Checklist de cierre (smoke en Cloud Run; revisión `ticketing-service-00003-2zh` `Ready=True`, 100% tráfico, puerto `h2c` 8080, `INTERNAL_API_KEY` y `DATABASE_URL` desde Secret Manager) | ✔ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
- La migración remota y la llave interna no fueron verificadas por el auditor (sin acceso a `.env.supabase` ni al secreto); se usó la evidencia registrada por el humano, corroborada por el log de Cloud Run.
- La bitácora tiene cambios sin commitear en el working tree (`git status`: `M docs/dev/progress/2026-10-07_dev_F2_deploy_1.md`); se auditó la versión comprometida en `19c99b9`, cuyo contenido de evidencia es equivalente.
- El smoke registrado corrió contra la revisión `00002-sbw`; la revisión vigente `00003-2zh` (creada 13:12Z) no tiene smoke propio con llave.
- Un `npm run build -w @flight-platform/ticketing-service` aislado falla (`Cannot find module '@flight-platform/shared'`) si `shared` no se compiló antes; el workflow compila `shared` primero.
- El health gRPC con llave (`SERVING`) no fue reproducido por el auditor; sin llave ⇒ `Unauthenticated`.
- Numeración: es el informe #5 de `docs/audit/audits/F2/`; cuenta como la 3.ª auditoría de despliegue de F2 (`audit-3` y `audit-4` RECHAZADO; `audit-2` APROBADO fue de código).
