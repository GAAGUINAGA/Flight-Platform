# Sesión dev — F12c pruebas con usuarios reales S-1 a S-6 — 2026-11-12 #1
- Agente: developer · Rama: test/F12c-pruebas-reales (desde main, con el backend previo desplegado: canal WEB y API interna) · Base: 81e231c

## Objetivo de la sesión
Un script que el HUMANO ejecuta contra la nube para comprobar con tokens reales todo lo que el servicio GraphQL va a usar (S-1 a S-6, diseño F12c-0 §5.4 y §14), con modo de ensayo local. Sin cambios en el código de la plataforma, contratos ni workflows: solo el script, su documentación y esta bitácora.

## Registro
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| inicio | Dependencias | Backend previo (canal WEB `WEB_PAYMENT_MODE=simulated`, topes en Reservation y API interna `/api/admin/v1`) desplegado según la bitácora `2026-11-12_dev_F12c-backend-previo_deploy_1.md` | Cumplidas |
| — | Lectura | Diseño §5.4 (S-1…S-6) y §14, contrato v2, `admin-v1.yaml`, `web-sales.ts`, `booking.controller.ts`, `security.ts` (límites 60/min por huella, 120/min por sub), `prisma-reservation-store.ts` (topes: 5 activas, 10 pasajeros/día contando canceladas) | Hecho |
| — | Script | `platform/api-gateway/scripts/f12c-pruebas-reales.cjs`: variables `BASE_URL`, `CUSTOMER_A_TOKEN`, `CUSTOMER_B_TOKEN`, `ADMIN_TOKEN`, `PARTNER_CLIENT_ID/SECRET` (opcionales: sin ellas salta al socio y lo informa), `ADMIN_PATCH_FLIGHT`, `CAP_PROBE_MAX`, `RATE_LIMIT_MAX`, `SKIP_CAPS`, `SKIP_RATE_LIMIT`, `SKIP_PENDING`; modo `--local` | Hecho |
| — | Documentación | `docs/dev/f12c-pruebas-reales.md` (variables, tokens sin historial, qué hace con los datos, limpieza, significado para F12c-1, ensayo local) | Hecho |
| — | Ensayo local | `local:up -SkipDocker` con `WEB_PAYMENT_MODE=simulated`, `WEB_REQUIRE_VERIFIED_EMAIL=false` y `JWT_ISSUERS` del emisor de desarrollo en el entorno de la terminal; 10 corridas iterando hasta verde (ver «Hallazgos del ensayo») | **72 OK, 0 FALLA, 2 N/A de 74; limpieza completa** |
| — | Lint | `npm run lint` | 0 errores, 0 advertencias (salida 0) |

## Cómo funciona (resumen)
- Elige el vuelo solo (panel de operaciones del admin, próximos 13 días): `SCHEDULED`, sale en >48 h y con ≥6 asientos libres, y confirma que la búsqueda pública devuelve su oferta. Los vuelos de <48 h solo se usan para el check-in y únicamente si están completamente vacíos (sin reservas de nadie, por tanto sin reservas de Booking).
- Cubre: S-1 (recorrido de A con huella, mapa con `HELD`, hold con `assignedSeats`, reserva con pago simulado, boletos, mis reservas, detalle, equipaje, cambio de asiento, cotización/cancelación, check-in y pases si hay vuelo en ventana —si no, N/A—; aislamiento de B y del socio en hold y reserva, con el recurso de A comprobado intacto después; el cliente no fuerza canal ni publica como socio), S-2 (admin: panel, PATCH —lectura sobre un vuelo inexistente o reversible sobre `ADMIN_PATCH_FLIGHT`—, promociones), S-3 (cambio de asiento), S-4 (límite por huella y por `sub`), S-5 (`pay_ok_*`, `pay_denied_*`, `pay_pending_*`, socio con `pay_ok_*`, tope del canal WEB), S-6 (API interna: 401/403/200).
- Una línea `OK`/`FALLA`/`N/A` por comprobación, resumen por prueba y total; nunca imprime tokens, secretos, correos, documentos ni la referencia de pago (solo su prefijo en el texto de la comprobación). Comprobado con `grep` sobre la salida del ensayo.
- Limpieza en `finally`: cancela con cotización lo creado (A, B y socio) y libera holds; ante 429 espera `Retry-After`. Lo no cancelable por regla de negocio (reserva `PENDING_PAYMENT` de `pay_pending_*`) se avisa sin contarlo como falla.

## Hallazgos del ensayo (defectos del script corregidos durante la sesión; ninguno de la plataforma)
- El panel de operaciones acepta `limit` ≤ 50 (contrato): el script pedía 100 → 400; ahora pagina de 50 en 50. Lo mismo en `GET /bookings`.
- Los tokens de desarrollo no traen `email_verified` y el Gateway local no listaba el emisor de desarrollo: el ensayo arranca `local:up` con tres variables de entorno heredadas por los procesos (no se tocó ningún `.env` ni el perfil; no se leyó ningún `.env` ni `infra/dev-keys`: los tokens salen del CLI `dev:token`).
- `DELAYED → SCHEDULED` es `409 INVALID_STATUS_TRANSITION`: un PATCH real a `DELAYED` no es reversible. El PATCH real del script es ahora reversible (mismo estado `SCHEDULED`, hora estimada +30 min y se devuelve); si el vuelo no lo admite no cambia nada y sale N/A.
- Una reserva `PENDING_PAYMENT` no se puede cancelar (409 `BOOKING_NOT_CANCELLABLE`; la API solo cancela `CONFIRMED`): el pago pendiente deja un residuo de prueba; el script lo avisa y `SKIP_PENDING=1` lo evita.
- Error propio en la limpieza (desestructuración) que dejaba reservas sin cancelar: corregido; la última corrida limpia todo lo cancelable.

## Evidencia (última corrida del ensayo local, con el script final)
```
S-1: 40 OK, 0 FALLA, 0 N/A
S-2: 9 OK, 0 FALLA, 1 N/A   (acuerdo de promociones: 404, no hay acuerdo guardado en local; autorizado, no 403)
S-3: 1 OK, 0 FALLA, 0 N/A
S-4: 4 OK, 0 FALLA, 0 N/A   (límite público: 429 en la petición 61; autenticado: 429 en la 85 de B; A y otra huella no afectados)
S-5: 8 OK, 0 FALLA, 1 N/A   (tope del canal WEB: la reserva 6 de B → 429 web-active-bookings-limit; N/A: modo apagado y correo sin confirmar no se pueden provocar desde fuera, los cubren WEB-E2E-02/06)
S-6: 7 OK, 0 FALLA, 0 N/A
Total: 72 OK, 0 FALLA, 2 N/A de 74. Limpieza: completa (1 reserva con pago pendiente no cancelable, avisada).
```
Diferencias del ensayo local frente a la nube (en la doc §6): el socio local no tiene la API de pagos de Booking (su `pay_ok_*` da 503 en vez de 422; ambas significan «no vende») y el correo no se exige.

## Efectos en la base LOCAL (no en la nube)
El ensayo dejó datos de prueba en la base local de desarrollo (usuarios con `sub` aleatorio, reservas canceladas y alguna `PENDING_PAYMENT`) y el vuelo `FP103` del 2026-11-14 quedó en `DELAYED` por una corrida intermedia (antes de volver el PATCH reversible); el ensayo local elige otros vuelos. La plataforma local se detuvo con `local:down` (Postgres y RabbitMQ no se tocaron; no se ejecutó docker compose).

## ADRs creados
Ninguno (no hay decisión de plataforma: solo un script de verificación).

## Pendientes / bloqueos
- **Lo ejecuta el humano en la nube**: tokens reales de A, B (correo confirmado) y admin; opcional el socio de prueba y `ADMIN_PATCH_FLIGHT`. Ver `docs/dev/f12c-pruebas-reales.md`. Si S-1 o S-6 fallan, corregir antes de F12c-1; el resultado va a la bitácora del humano.
- Cambio de fecha (`date-change`) no está en el alcance pedido para este script (S-1 del diseño lo menciona): queda para F12c-1.
- Cupo diario del canal WEB: cada ejecución consume 3 pasajeros de A y hasta 5 de B (tope por defecto 10/día por usuario): máximo ~2 ejecuciones al día con las mismas cuentas, o `SKIP_CAPS=1`.
- Esta sesión no ejecutó CI ni pruebas unitarias de servicio porque no hay cambios de código de plataforma (solo script, doc y bitácora). Sin Dockerfile ni imagen que construir.

## Cierre
- Estado: listo para ejecutar en la nube.
- SHA final: ver el commit `test(gateway): [F12c] script de pruebas con usuarios reales S-1 a S-6` (se registra en la respuesta de la sesión).
