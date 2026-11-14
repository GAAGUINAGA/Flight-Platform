# F12c-2b — La compra y las reservas desde la web

Complementa `docs/dev/f12c2a-web-despliegue.md`. Diseño: `docs/dev/f12c0-diseno-front.md` (§3.5–§3.12, §3.14, §4, §6.3, §10.2). Decisiones: `ADR-F12c2b-01` y la adenda de `ADR-F12c-04`.

**Nada de esto se ejecuta solo:** lo despliega el humano, después de la auditoría de código y desde `main`.

## Orden de despliegue (obligatorio)

1. **`graphql-service` primero.** Esta entrega agrega al servicio la traducción de los rechazos del canal WEB a códigos propios (`WEB_ACTIVE_BOOKINGS_LIMIT`, `WEB_PASSENGERS_PER_DAY_LIMIT`, `EMAIL_NOT_VERIFIED`, `WEB_PAYMENTS_DISABLED`; ADR-F12c-04, adenda). Si la web nueva se publica antes, esos cuatro casos le llegan con el código genérico de su categoría: el de «venta en línea no disponible» (422) se vería como un pago rechazado. Workflow: `deploy-graphql`. Sin cambios de variables, de SDL ni de las 28 operaciones.
2. **La web después** (Render, *Manual Deploy*). `render.yaml` fija ahora `VITE_ENV_NAME=produccion`: el sitio publicado **no** muestra la banda «Entorno de pruebas».

## Comprobaciones después de publicar

- Un usuario con el correo **confirmado** compra de punta a punta (búsqueda → asientos → pasajeros → pago → confirmación). Con el correo sin confirmar, el pago muestra «Confirma tu correo electrónico para poder reservar» con el botón para reenviar el enlace (necesita el claim `email_verified` del hook de Supabase; ver `docs/dev/f12c-backend-previo-despliegue.md`).
- Con `WEB_PAYMENT_MODE` apagado en el Gateway, el pago muestra «La venta en línea no está disponible por ahora» (no «pago rechazado»).
- El paso de pago **no** tiene selector de escenarios (`VITE_TEST_PAYMENT_SCENARIOS` no está en `render.yaml` y se ignora en producción).
- El pie dice que GabatAIR es un proyecto académico de demostración; el recorrido de compra no lo repite. La nota «Pago procesado en modo de demostración; no se realiza ningún cargo» aparece solo en el paso de pago.
- Las marcas internas de prueba de los datos (`salesChannel` `WEB_TEST`) no se muestran al cliente: la web no las pide (las 28 operaciones no las exponen al cliente).

## Local

```powershell
npm run local:up -- -SkipDocker -Web     # la web local se construye con VITE_TEST_PAYMENT_SCENARIOS=true (escenarios de pago rechazado y pendiente)
npm run test:e2e -w @flight-platform/web  # incluye la compra completa, postventa, check-in y los errores principales
npm run local:down
```

El e2e de check-in dentro de su ventana necesita un vuelo sembrado que salga en menos de 48 h y más de 60 min; si no lo hay, la prueba se marca como no aplicable con su motivo.
