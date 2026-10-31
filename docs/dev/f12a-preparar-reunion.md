# F12a · Preparar la reunión con Booking (plataforma local por Tailscale)

La prueba del martes (19h30) es **100 % local**: la plataforma de GabatAIR (nodo `NODE_VUE_GABATAIR`) corre en tu máquina y Booking la alcanza por **Tailscale** (IPs `100.x.x.x`), con http y gRPC sin TLS, de servidor a servidor. El despliegue en la nube de F12a es posterior. Todo se construye con configuración de producción por defecto; el **perfil de integración local** se activa solo con `INTEGRATION_LOCAL=true`, que los scripts fijan únicamente en sus procesos y que se rechaza con `NODE_ENV=production`.

Qué cambia en ese perfil: los microservicios escuchan solo en `127.0.0.1`; el Gateway escucha en `0.0.0.0` (es lo único alcanzable); el stock va por gRPC a una dirección configurable con TLS opcional; los webhooks admiten `http` y `100.64.0.0/10`; el emisor del dev-auth y los `_links` salen de `PUBLIC_BASE_URL`.

## 1. Requisitos
- Node 20 (`.nvmrc`), Docker Desktop, Tailscale conectado, PowerShell. Política de scripts `RemoteSigned` (la de Windows por defecto para el usuario) o más permisiva.
- `npm ci` hecho en la raíz.
- Los `.env` de cada servicio (`microservices/<servicio>-service/.env`) y `platform/api-gateway/.env` ya existen (plantillas `.env.example` / `.env.docker.example`; `INTERNAL_API_KEY` **idéntico** en los ocho). Los scripts **no los leen**: cada proceso carga el suyo.
- Migraciones aplicadas en el Postgres local (la base la administras tú):

| Servicio | Migración |
|---|---|
| api-gateway | `20261026000000_gateway_dev_auth`, `20261026010000_gateway_v2_bookings`, `20261027000000_gateway_stock_outbox` |
| reservation-service | `20261026000000_payment_channel` |
| webhooks-service | `20261026000000_v2_events_and_api_version` |

## 2. Perfil de integración local (variables)
Copia `docs/dev/integracion-local.env.example` a `.local/integracion.env` (carpeta ignorada por git). Es el **único** lugar donde se escriben los datos de la reunión; `up.ps1` entrega a cada proceso solo las variables que le corresponden y no las imprime.

| Variable | Proceso | Para qué |
|---|---|---|
| `PUBLIC_BASE_URL` | gateway | `http://<IP Tailscale>:3000`. Emisor del dev-auth y base de los `_links`. Sin barra final ni ruta |
| `NODE_ID`, `PROVIDER_NAME` | gateway | Identidad del nodo (`NODE_VUE_GABATAIR`, `GabatAIR`) |
| `BOOKING_EVENTS_SECRET` (+ `_SIGNATURE_HEADER`, `_SIGNATURE_PREFIX`) | gateway | Firma HMAC de `POST /vuelos/booking-events`. Sin secreto el endpoint rechaza todo |
| `SAGA_PENALTY_WAIVER_MINUTES` | gateway | Ventana sin penalidad de `SAGA_COMPENSATION` (120) |
| `BOOKING_STOCK_GRPC_URL`, `BOOKING_STOCK_API_KEY`, `BOOKING_STOCK_TLS=false` | gateway | Stock por gRPC. Sin llave el envío queda apagado |
| `AIRPORT_TIMEZONES` | gateway | Zonas de aeropuertos fuera de Ecuador (hora local del stock) |
| `BOOKING_PAYMENTS_BASE_URL`, `_PATH_TEMPLATE`, `_AUTH_HEADER`, `_AUTH_VALUE`, `_STATUS_MAP`, `_FIELDS`, `_TIMEOUT_MS` | reservation | API de pagos de Booking |
| `BOOKING_PAYMENTS_VERIFY=off` | reservation | ⚠ Contingencia: ver `f12a-reunion-booking.md` §1 |
| `WEBHOOK_BACKOFF_MINUTES_V2` | webhooks | Reintentos de entrega hacia Booking |

Variables fijas del perfil (las pone el script, no se editan): `INTEGRATION_LOCAL=true`, `NODE_ENV=development`, `PORT` de cada servicio (50051–50057; el Gateway 3000), `*_GRPC_URL=127.0.0.1:<puerto>`, `DEV_AUTH_PRIVATE_KEY_FILE=.local/dev-auth-key.pem` (llave RSA generada la primera vez, no se versiona ni se imprime) y `SCHEDULER_ENABLED=true` con `SCHEDULER_EVERY_MS=5000` (entrega de webhooks, reverificación de pagos y envío de stock).

## 3. Seed con vuelos futuros
```powershell
npm run local:seed
```
Siembra, en el orden obligatorio, Inventory (vuelos de los **próximos 60 días**: UIO–GYE, UIO–BOG, UIO–LIM, BOG–MIA, LIM–MAD, GYE–MIA, ida y vuelta, números `FP100…`), Pricing (tarifas) y Ancillaries (mapas de asientos por aeronave). Es idempotente (ids deterministas, no toca `held`/`sold`): repítelo antes de cada reunión para tener vuelos futuros. Si la búsqueda no devuelve ofertas, falta este paso.

## 4. Levantar y verificar
```powershell
npm run local:up        # Postgres (docker compose), construcción, 7 servicios, Gateway y health final
npm run local:health    # cuando quieras repetir la verificación
npm run local:journey   # recorrido v2 completo (31 comprobaciones)
npm run local:down      # detener todo (el Postgres y sus datos se dejan)
```
Opciones de `up.ps1`: `-SkipBuild` (usa `dist/`), `-SkipDocker` (el Postgres ya está arriba), `-GatewayPort`, `-ProfileFile`. Termina con el **health de los ocho procesos**: `GET /api/v2/vuelos/health` debe ser `HEALTHY` con los siete servicios `UP`; si no, sale con error y deja los logs en `.local/logs/<proceso>.err.log`. `down.ps1` verifica que ningún puerto siga abierto. Tras cambiar el perfil: `down` y luego `up -SkipBuild -SkipDocker`.

El recorrido (`journey.cjs`) crea su propio cliente, simula la API de pagos de Booking si `BOOKING_PAYMENTS_BASE_URL` apunta a `127.0.0.1` y firma los eventos con `BOOKING_EVENTS_SECRET`; recorre token, búsqueda, asientos, hold, reserva con pago pendiente, `payment.confirmed`, equipaje, asiento, cancelación, feed y webhooks, y desactiva su cliente al terminar.

## 5. Firewall: un solo puerto
Solo se abre el puerto del **Gateway** (`3000/tcp`) y solo hacia Tailscale. Los microservicios y Postgres escuchan en `127.0.0.1`.
```powershell
New-NetFirewallRule -DisplayName "GabatAIR gateway (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 100.64.0.0/10 -Action Allow
# al terminar la prueba:
Remove-NetFirewallRule -DisplayName "GabatAIR gateway (Tailscale)"
```
Tu IP Tailscale: `tailscale ip -4`. Desde la máquina de Booking: `curl http://<tu-IP>:3000/api/v2/vuelos/health`.

## 6. Cliente `client_credentials` para Booking
```powershell
npx tsx --env-file=platform/api-gateway/.env platform/api-gateway/scripts/dev-auth-client.ts create --client-id booking --scopes flights:read,flights:hold,flights:book,flights:cancel,flights:webhooks --out .local/booking.secret
```
- `client-id`: `[A-Za-z0-9_-]`, 3 a 40 caracteres, sin `~` ni forma de UUID. Scopes disponibles: `flights:read/hold/book/cancel/webhooks/ops/admin`.
- El secreto se guarda **hasheado** (scrypt) y se escribe una sola vez en `.local/booking.secret` (modo 0600, fuera de git). Entrégalo a Booking por un canal seguro y bórralo después. Nunca se imprime.
- `disable` / `enable --client-id booking` lo suspenden o reactivan.
- Booking pide el token con `POST {PUBLIC_BASE_URL}/api/v2/oauth2/token` (`grant_type=client_credentials`, `client_id`, `client_secret`) y usa `Authorization: Bearer …` más `X-User-Id` en cada llamada. Los recursos pertenecen a `<clientId>~<X-User-Id>`.

## 7. Registrar el webhook de Booking
Booking registra la URL donde recibirá nuestros eventos, con su token (scope `flights:webhooks`):
```
POST {PUBLIC_BASE_URL}/api/v2/vuelos/webhooks      Idempotency-Key: <uuid>
{ "url": "http://<IP Tailscale de Booking>:<puerto>/<ruta>", "events": ["booking.confirmed","booking.cancelled", ...], "secret": "<mínimo 16 caracteres>" }
```
- `http` y `100.64.0.0/10` se aceptan **solo** con `INTEGRATION_LOCAL=true`; en producción solo `https`. Loopback y redes internas se rechazan siempre.
- Las entregas son CloudEvents con `X-Webhook-Signature: sha256=<HMAC-SHA256(secret, cuerpo)>`. Reintentos 1, 5, 30, 120 y 360 min; lo no entregado queda en `GET /api/v2/vuelos/eventos`.
- El `secret` nunca se devuelve. `GET /vuelos/webhooks` lista y `DELETE /vuelos/webhooks/{id}` elimina.
- Hacia nosotros, Booking firma con `BOOKING_EVENTS_SECRET` (el mismo valor en ambos lados) y envía a `POST {PUBLIC_BASE_URL}/api/v2/vuelos/booking-events`.

## 8. Postman
Importa `docs/dev/postman/gabatair-vuelos-v2.postman_collection.json` y el entorno `docs/dev/postman/gabatair-integracion-local.postman_environment.json`. Cambia solo `baseUrl` (`http://100.x.x.x:3000`) y rellena `clientId`, `clientSecret` (tipo secret), `bookingEventsSecret` y `webhookSecret`. Ejecuta las carpetas en orden 0 → 1 → 2 → 3; la 4 firma los eventos de Booking con CryptoJS y la 5 registra el webhook. La colección se valida contra `vuelos-openapi-v2.yaml` en `scripts/local-platform/postman.spec.ts`.

## 9. Solución de problemas
| Síntoma | Causa y arreglo |
|---|---|
| `up` dice "Puertos ocupados" | Un arranque anterior sigue vivo: `npm run local:down` |
| Health `DEGRADED`/`DOWN` | Un servicio no arrancó: `.local/logs/<servicio>.err.log`; revisa su `.env` y la migración |
| Búsqueda sin ofertas | Falta `npm run local:seed` o los vuelos ya pasaron |
| Pagos: 503 `Retry-After` | `BOOKING_PAYMENTS_BASE_URL` vacío o Booking no responde (ver contingencia en la lista de verificación) |
| `booking-events` responde 401 | Secreto, cabecera o prefijo distintos a los de Booking |
| Token válido pero 403 | Al cliente le falta el scope de esa operación |
| Cambié el perfil y no hace efecto | Reinicia: `down` y `up -SkipBuild -SkipDocker` |

Nunca uses `INTEGRATION_LOCAL=true` en un despliegue en la nube: el servicio se niega a arrancar con `NODE_ENV=production`.
