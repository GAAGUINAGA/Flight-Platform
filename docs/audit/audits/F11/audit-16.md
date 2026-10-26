# Auditoría F11 — #16
- Fecha: 2026-10-26 · Commit auditado: f6b53e7 (main; contiene `7c2f5fa` F11d-2 y `f7bc926` ajuste partner) · Veredicto: APROBADO

Auditoría de despliegue (`flujo-cierre.md`). No se vuelve a auditar código ni se ejecutan suites; el código consta en audit-14 y audit-15.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Verificaciones propias (sin llave ni token reales):
- `git branch -r --contains`: `7c2f5fa` y `f7bc926` están en `origin/main`. `git diff 8db70b5 HEAD`: sin cambios en `contracts/`, `infra/`, `.proto` ni migraciones; el ajuste partner solo toca gateway (scripts, pruebas) y documentación.
- Cloud Run: `gcloud run services list` ⇒ las siete revisiones coinciden con la bitácora (inventory 00015-jjw, pricing 00011-mvl, ticketing 00016-rrm, webhooks 00012-scd, operations 00009-vmp, ancillaries 00010-jnj, reservation 00013-8l6). `describe ticketing-service`: Ready, ConfigurationsReady y RoutesReady `True`; 100 % a `ticketing-service-00016-rrm`; variables solo `INTERNAL_API_KEY` y `DATABASE_URL` (secretos), sin `TICKETING_FAIL_MODE`.
- Health gRPC sin llave (grpcurl con el proto de `grpc-health-check`) contra los siete servicios: `Unauthenticated` en todos.
- Render (`https://flight-gateway-o37n.onrender.com`): `GET /flights/v1/health` ⇒ 200. `GET /flights/v1/bookings`, `/webhooks` y `/admin/flights`, sin token y con token inventado ⇒ 401 `application/problem+json` (6 de 6). CORS: `OPTIONS /flights/v1/search` con `Origin: http://localhost:5173` ⇒ 204 con `access-control-allow-origin: http://localhost:5173`; con `http://evil.example.com` ⇒ 204 sin esa cabecera.
- Scheduler: health de Render a las 12:15:35Z; `gcloud logging read` (`correlationId=gateway-scheduler`) entre 12:15:57Z y 12:18:59Z: 4 ciclos (12:15:57, 12:16:58, 12:17:58, 12:18:59) con `expireHolds` (inventory), `resumePending` (reservation), `dispatchPending` (webhooks) y `recoverCheckIns` (operations), 16 llamadas, todas `rpc ok`.

Evidencia del humano (registrada como tal, `2026-10-26_dev_F11d2_deploy_1.md`; no reejecutada por el auditor porque requiere token, receptor y ~22 min cada una):
- Salud con llave de los siete `SERVING`, scheduler, smoke de reservation (RSV-13, tickets `ISSUED`).
- `render-journeys.cjs` contra Render: 1.ª ejecución, J7 falló solo por la barra final en `SMOKE_CORS_ALLOWED_ORIGIN` (error de configuración de la prueba); 2.ª, J1, J2, J5, J6 y J7 en OK (código 0) sin entrega de `hold.expired` (suscripción del admin vs hold del customer); 3.ª, tras el ajuste partner, J2 OK con `hold.expired` entregado con firma válida y `data.holdId`.
- Rol `partner` en el hook de Supabase y cuenta `partner.test@test.com`.
- Los resultados son coherentes con lo verificado en vivo (401 sin token, CORS, health, scheduler) y con audit-14/15.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- PLT-J3: la bitácora de despliegue encabeza «Commit en main: f7bc926» y la evidencia lista como «Commit desplegado» `7c2f5fa`; ambos están en `origin/main`, pero la bitácora no distingue qué revisión de Render corresponde a cada uno.
- PLT-J3: la 3.ª ejecución solo recorre J2; J1, J5, J6 y J7 constan en la 2.ª, anterior al ajuste partner (que no cambió código de producción).
- Despliegue: el hook de Supabase, la cuenta partner y la entrega firmada contra Render constan solo como evidencia del humano.

## Cierre de F11
Con esta auditoría, **F11 queda completa según el PLAN**: PLT-A a PLT-J (código aprobado en audit-1…15; despliegue aprobado aquí) y los recorridos J1 a J7 (J1, J2, J5, J6 y J7 contra Render; J3 y J4 cubiertos por la suite real local, excepción documentada en ADR-F11-17). Checklist de F11: J1–J7 verdes contra el despliegue real (con esa excepción), matriz de autorización verde, documento de integración entregado.
