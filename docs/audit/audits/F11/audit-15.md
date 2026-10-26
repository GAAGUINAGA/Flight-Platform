# Auditoría F11 — #15
- Fecha: 2026-10-25 · Commit auditado: 0eeb9cf (código; 7f51ead y 9253e71 solo añaden documentación) · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle:
- `npm run lint` y `node scripts/audit-policy.cjs` en el clon de trabajo: código 0.
- CI de `gateway-ci.yml` en clon limpio (`git clone` + `checkout 9253e71` + `npm ci`: prisma generate, lint, build shared, contracts y api-gateway, audit:policy, `jest platform/api-gateway/src`): 8 suites, 98 pruebas, todo en código 0.
- `RUN_GATEWAY_REAL=true jest platform/api-gateway --runInBand`, dos veces seguidas: 11 suites, 383 pasan, 0 fallan, 0 omitidas, 1 `todo` (OP-02) en ambas.
- `-t "el partner"`: 8 pasan (webhooks propios; hold y reserva propios con `ownerId` = `sub` del partner, ajeno ⇒ 404; las 6 rutas `/admin` ⇒ 403, también con `flights:admin` forjado), emisor JWKS local de forma Supabase. `-t "PLT-A/B e I5/I6"`: pasa; incluye `render-journeys.cjs` completo (J1, J2, J5, J6, J7) con la línea `OK   J2 hold.expired entregado con firma válida y data.holdId`.
- `git diff 7c2f5fa HEAD`: sin cambios en `platform/api-gateway/src` salvo el plazo de una prueba (`gateway.spec.ts`), ni en `contracts/`, `.proto`, migraciones o código de producción.
- Hook (`f11a-supabase-auth-hook.sql`): `partner` ⇒ `flights:read hold book cancel webhooks`, sin `flights:admin`, igual que PLAN §2.3; `admin` y `partner` solo se leen de `app_metadata.app_role`; cualquier otro valor ⇒ `customer`.
- `render-journeys.cjs`: sin `BASE_URL`, sin `SMOKE_RECEIVER_API_URL` o sin `SMOKE_WEBHOOK_URL` (J2 pedido) sale con código 1; con destino inalcanzable y token ficticio sale con código 1 sin imprimir el token. Revisión de código: hold y suscripción con `partnerToken`; éxito solo con `hold.expired` de ese `holdId` y firma HMAC válida (formato `t=…,v1=…` igual al del despachador de Webhooks); `EVENT_NOT_RECEIVED`/`BAD_SIGNATURE` ⇒ J2 FALLO ⇒ código 1; el secreto y el cuerpo no se imprimen; la suscripción se elimina en `finally`.
- `docs/booking-integration.md`: Booking = cuenta `partner`; webhooks solo de recursos de la misma cuenta; `customer` no recibe ni registra webhooks; sin secretos.
- ADR-F11-18 no contradice PLAN §1 ni §2.
- Sin procesos de Node en ejecución al terminar. Clon limpio para borrar: `C:\Proyectos\fp-clean-audit-f11d2b`; archivos de salida fuera del repo: `C:\Proyectos\fp-clean-*.log`, `fp-real-1.log`, `fp-real-2.log`, `fp-partner.*`, `fp-ab.*`.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- PLT-J3: `render-journeys.cjs:120-124` — el cuerpo recibido se acepta comprobando solo `eventType`, `data.holdId` y la firma; no se valida contra el schema `WebhookPayload` (`eventId`, `occurredAt`, `apiVersion`).
- PLT-J3: `real-stack.e2e.spec.ts` (receptor simulado) — la firma que el script verifica la calcula la propia prueba, no el despachador de Webhooks; la verificación contra la firma real solo ocurre contra Render (ejecución del humano).
- Checklist / despliegue: el hook en producción, la cuenta `partner.test@test.com` y J2 contra Render constan solo como verificaciones del humano en la bitácora; corresponden a la auditoría de despliegue (audit-16).
- Bitácora `2026-10-25_dev_F11d_4.md` (tarea 2) — dice «7 rutas admin»; la prueba cubre las 6 de `/admin`.
