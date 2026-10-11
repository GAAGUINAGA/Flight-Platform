# Auditoría F4 — #4
- Fecha: 2026-10-11 · Commit auditado: ddba1fa · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | N/A |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | Corrección Dockerfile (alcance 6; lint en CI, PLAN D-14) | `npm run lint` en clon limpio (ddba1fa), `platform/api-gateway/src/app.ts:25` | Sale con exit 1: `25:37 error A require() style import is forbidden @typescript-eslint/no-require-imports` y `25:37 error 'require' is not defined no-undef` (2 errores, `--max-warnings=0`) |
## Observaciones (no bloquean → BACKLOG)
- Docker build desde clon limpio sin caché: exit 0, `shared` y `api-gateway` compilados, Prisma generó el cliente sin aviso de OpenSSL.
- `docker run` (NODE_ENV=production, PORT=8080, valores de prueba) → `GET /flights/v1/health` = HTTP 200 `{"status":"ok"}`; solo se mapea la ruta de health (sin `/__test`). Contenedor eliminado.
- `find / -name '.env*'` en la imagen con `.env` falso en el clon: solo `/app/platform/api-gateway/.env.example`.
- `.dockerignore` cubre node_modules, dist, `.env`/`.env.*` (salvo ejemplos), infra/dev-keys, clientes Prisma generados y .git. La imagen no contiene `/app/infra`, `/app/.git` ni `/app/docs`.
- `test-grpc.ts`: import solo de tipo y `require` bajo `NODE_ENV === 'test'`; `dist/src/test-grpc.js` sí se emite pero no se carga en producción.
- Build de shared y del Gateway: exit 0. `npx jest platform/api-gateway/src/gateway.spec.ts --runInBand`: 43/43. El spec de integración Prisma requiere Postgres y no se ejecutó en el clon limpio (AGENTS.md).
