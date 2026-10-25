# F11d-2: configuración final de Render y recorridos J1–J7

## Variables finales del Gateway en Render (PLT-J2)

Son los valores previstos por el código y el plan. No he leído ningún `.env` ni el panel de Render: confirma cada valor contra el panel.

| Variable | Valor final | Secreto | Nota |
|---|---|---|---|
| `NODE_ENV` | `production` | no | Ya fijado por el `Dockerfile` del Gateway. Activa el rechazo de emisores de desarrollo |
| `PORT` | lo inyecta Render | no | |
| `LOG_LEVEL` | `info` | no | |
| `INTERNAL_API_KEY` | idéntica a la de los siete microservicios | **sí** | |
| `JWT_ISSUERS` | solo el emisor de Supabase: `iss` `https://<project-ref>.supabase.co/auth/v1`, `aud` `authenticated`, `jwksUri` del proyecto | no | Sin `publicKeyFile`: el Gateway no arranca con él en producción. Añadir aquí el emisor B2B de Booking con `role: "partner"` cuando exista |
| `CORS_ORIGINS` | dominio del frontend (HTTPS), separado por comas | no | Vacío = ningún origen recibe cabeceras CORS |
| `RATE_LIMIT_PUBLIC_PER_MIN` | `60` | no | |
| `RATE_LIMIT_AUTH_PER_MIN` | `120` | no | |
| `IDEMPOTENCY_TTL_HOURS` | `24` | no | |
| **`VALIDATE_RESPONSES`** | **`false`** | no | Producción. En el entorno de pruebas: `true` |
| `SCHEDULER_ENABLED` | `true` | no | ADR-F11-11 |
| `SCHEDULER_EVERY_MS` | `60000` | no | |
| `SCHEDULER_PURGE_EVERY_MS` | `3600000` | no | |
| `SCHEDULER_BATCH_SIZE` | `50` | no | |
| `SCHEDULER_LOCK_LEASE_MS` | `55000` | no | Debe ser menor que `SCHEDULER_EVERY_MS` |
| `GRPC_TLS` | `true` | no | |
| `GATEWAY_ORCHESTRATION_DEADLINE_MS` | `30000` (opcional, es el valor por defecto) | no | ADR-F11-07 |
| `DATABASE_URL`, `DIRECT_URL` | rol `svc_gateway`, esquema `gateway` | **sí** | Idempotencia y lease del scheduler |
| `INVENTORY_GRPC_URL`, `PRICING_GRPC_URL`, `ANCILLARIES_GRPC_URL`, `RESERVATION_GRPC_URL`, `TICKETING_GRPC_URL`, `OPERATIONS_GRPC_URL`, `WEBHOOKS_GRPC_URL` | `<host de Cloud Run>:443` | no | Una por servicio |

El entorno de pruebas es el mismo servicio con `VALIDATE_RESPONSES=true` (cada respuesta se valida contra el OpenAPI y falla si no lo cumple). No hay ninguna otra variable de prueba que deba existir en Render.

## Script de recorridos (PLT-J3)

`platform/api-gateway/scripts/render-journeys.cjs` ejecuta, en este orden: precalentamiento, J1, J2, J5, J6 y J7. No usa dependencias externas (Node 20).

Variables de entorno (en tu máquina; el script nunca las imprime):

| Variable | Obligatoria | Uso |
|---|---|---|
| `BASE_URL` | sí | Origen del Gateway, sin `/flights/v1` (por ejemplo `https://flight-gateway-o37n.onrender.com`) |
| `SUPABASE_CUSTOMER_TOKEN` | sí | Access token de un `customer` con `flights:read flights:hold flights:book flights:cancel` |
| `SUPABASE_ADMIN_TOKEN` | sí | Access token de un `admin` (también vale `SMOKE_ADMIN_TOKEN`) |
| `SMOKE_ORIGIN`, `SMOKE_DESTINATION` | no | Ruta de la búsqueda; por defecto `UIO` y `GYE` |
| `SMOKE_POSTSALE_FLIGHT_NUMBER`, `SMOKE_CHECKIN_FLIGHT_NUMBER` | no | Fija el vuelo de J5 y de J6 |
| `SMOKE_WEBHOOK_URL` | no | URL HTTPS pública de un receptor (p. ej. webhook.site) para ver `hold.expired` en J2 |
| `SMOKE_CORS_ALLOWED_ORIGIN` | no | Un origen de `CORS_ORIGINS` para comprobar también el caso permitido |
| `SMOKE_JOURNEYS` | no | Subconjunto, por ejemplo `J1,J7`. Por defecto `J1,J2,J5,J6,J7` |
| `SMOKE_J2_MAX_WAIT_MINUTES` | no | Espera máxima del vencimiento en J2 (30 por defecto: TTL real de 20 min más 10 de margen) |
| `SMOKE_J2_EVENT_GRACE_SECONDS` | no | Espera tras el vencimiento para dar tiempo al scheduler a publicar el evento (90 por defecto) |
| `SMOKE_POLL_SECONDS`, `SMOKE_RETRY_SECONDS`, `SMOKE_WARMUP_SECONDS`, `SMOKE_RATE_LIMIT_MAX` | no | Sondeo (20), espera entre reintentos (5), tiempo máximo de precalentamiento (180) y peticiones máximas para alcanzar el 429 (150) |

En PowerShell 7:

```powershell
$env:BASE_URL = "https://flight-gateway-o37n.onrender.com"
$env:SUPABASE_CUSTOMER_TOKEN = Read-Host -AsSecureString "customer" | ConvertFrom-SecureString -AsPlainText
$env:SUPABASE_ADMIN_TOKEN    = Read-Host -AsSecureString "admin"    | ConvertFrom-SecureString -AsPlainText
node platform/api-gateway/scripts/render-journeys.cjs
```

Salida: una línea `OK   <paso>` por paso, `==== Jn OK|FALLO|OMITIDO` por recorrido y un `RESUMEN`. Ante un fallo informa paso, estado y código, nunca cuerpos ni tokens. Código de salida: `0` todo en orden, `1` algún recorrido falló, `2` algún recorrido se omitió (J2 con espera mayor al límite) y ninguno falló.

Qué comprueba cada recorrido:

- **Precalentamiento:** `GET /health` hasta 200 y una búsqueda con reintentos ante 503 (despierta Pricing e Inventory).
- **J1:** sin token ⇒ 401; búsqueda, mapa, hold, reserva 201 `CONFIRMED`, detalle y tickets emitidos.
- **J2 (como `admin`):** hold idempotente (misma clave ⇒ mismo `holdId`), consulta, liberación y liberación repetida (204), hold nuevo, espera del vencimiento real, `POST /bookings` con el hold vencido ⇒ 410 `OFFER_NO_LONGER_AVAILABLE`. Con `SMOKE_WEBHOOK_URL` registra un webhook `hold.expired` (y lo borra al terminar) e imprime el `holdId` que debes ver en el receptor.
- **J5:** reserva, equipaje, cambio de fecha, cotización y cancelación; la reserva queda `CANCELLED`.
- **J6:** reserva en un vuelo con salida entre 2 y 47 h, check-in y boarding pass con su asiento y código.
- **J7:** sin token ⇒ 401; `customer` sin rol para webhooks y admin ⇒ 403; reserva ajena (con el token admin) ⇒ 404 indistinguible de una inexistente; 429 con `Retry-After` en `/search`; origen CORS no permitido sin cabeceras `access-control-*`.

Los datos que crea (holds, reservas, tickets) quedan en la base de Render/Supabase: cada ejecución añade reservas de prueba a las identidades usadas. J5 las cancela; las de J1, J6 y J7 permanecen confirmadas.

## J2 y el plazo del hold

No se cambia `HOLD_TTL_MINUTES` en producción: J2 espera el vencimiento **real** del hold (20 minutos). El límite por defecto, `SMOKE_J2_MAX_WAIT_MINUTES=30`, deja 10 minutos de margen sobre ese TTL; si el TTL desplegado fuera mayor, el recorrido termina como OMITIDO (código 2) en lugar de darse por bueno.

**Duración:** J2 tarda unos 23 minutos (20 del hold, hasta 1 del scheduler y 90 s de espera del evento) y todo el script, unos 25–30.

**El script mantiene despierto al Gateway mientras espera.** Cada sondeo (`GET /offers/hold/{id}` cada `SMOKE_POLL_SECONDS`, 20 s) es una petición al Gateway; Render suspende el servicio tras unos 15 minutos sin tráfico, y con él el scheduler que publica `hold.expired` (ADR-F11-11). Con el tráfico del sondeo el scheduler sigue corriendo cada minuto, y tras el vencimiento el script espera `SMOKE_J2_EVENT_GRACE_SECONDS` (90 s) antes de terminar. No lo ejecutes desde un equipo que se suspenda.

## J3 y J4

No se ejecutan contra Render (ADR-F11-17). Se cubren con la suite real local:

```powershell
$env:RUN_GATEWAY_REAL = "true"
npx jest platform/api-gateway/test/e2e/real-stack.e2e.spec.ts --runInBand --verbose -t "PLT-I3|PLT-I4"
```

## Suite local completa del gateway

```powershell
npx jest platform/api-gateway/src --runInBand
$env:RUN_GATEWAY_REAL = "true"; npx jest platform/api-gateway/test/e2e/real-stack.e2e.spec.ts --runInBand --verbose
```

La matriz de autorización (PLT-SEC-03) y J7 (PLT-I7) salen con `-t "PLT-SEC-03 / PLT-I7"`.
