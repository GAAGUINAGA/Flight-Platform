# F12a — Despliegue en la nube (preparación, sin desplegar)

Estado: preparado en F12a-2 (rama `feat/F12a2-pre-despliegue`). Booking **aún no está en la nube**: nada de Booking queda fijo en el código y la plataforma funciona sin él. Cuando Booking llegue se agregan sus variables (sección 6) sin tocar código.

Despliegue solo desde `main` y después de la auditoría de código (`docs/audit/context/flujo-cierre.md`). El humano verifica `docker build` de las imágenes antes de publicar.

## 1. Orden

1. Aplicar las **ocho migraciones** en Supabase (sección 3), con `migrate deploy` y luego `migrate status` (el Datasource debe apuntar a `pooler.supabase.com`).
2. Crear en Secret Manager y en Render los secretos nuevos (secciones 2 y 4).
3. Hacer el push a `main`: los workflows de Cloud Run redesplegan los servicios (sección 5).
4. Actualizar las variables de Render y desplegar el Gateway.
5. Verificar: `GET /api/v2/vuelos/health` (`nodo_id = NODE_VUE_GABATAIR`), `GET /api/v2/.well-known/jwks.json` con una llave y un recorrido v2 con un cliente de prueba.

## 2. Variables nuevas

### Render (API Gateway)

| Variable | Valor | Secreta | Obligatoria |
|---|---|---|---|
| `PUBLIC_BASE_URL` | URL pública de Render, `https://…onrender.com`, sin ruta ni barra final. Es el emisor de los tokens del dev-auth | No | **Sí** (el Gateway no arranca en producción sin ella) |
| `DEV_AUTH_PRIVATE_KEY` | PEM pkcs8 RSA (≥ 2048 bits) con los saltos de línea como `\n` | **Sí** | **Sí** (no arranca sin llave; `DEV_AUTH_PRIVATE_KEY_FILE` está prohibida en producción) |
| `DEV_AUTH_ENABLED` | `false` solo si se quiere apagar el dev-auth (entonces no hacen falta las dos anteriores) | No | No |
| `NODE_ID` | `NODE_VUE_GABATAIR` (por defecto) | No | No |
| `BOOKING_STOCK_GRPC_URL` | `host:puerto` del stock de Booking | No | No (vacío = stock apagado) |
| `BOOKING_STOCK_API_KEY` | `x-api-key` emitida por Booking | **Sí** | No (vacía = stock apagado) |
| `BOOKING_STOCK_TLS_CA_FILE`, `BOOKING_STOCK_TIMEOUT_MS`, `STOCK_SYNC_ENABLED` | Ajustes del stock | No | No |
| `BOOKING_EVENTS_SECRET` | Secreto HMAC con el que Booking firma sus eventos | **Sí** | No (vacío = `booking-events` rechaza todo con 401) |
| `BOOKING_EVENTS_CLIENT_ID` | `client_id` de Booking en el dev-auth | No | **Sí si hay `BOOKING_EVENTS_SECRET`** (el Gateway no arranca sin él) |
| `BOOKING_EVENTS_SIGNATURE_HEADER`, `BOOKING_EVENTS_SIGNATURE_PREFIX` | Por defecto `x-webhook-signature` y `sha256=` | No | No |

El TLS del stock es obligatorio en producción: `BOOKING_STOCK_TLS=false` exige `INTEGRATION_LOCAL=true`, que a su vez está prohibido con `NODE_ENV=production`. Las variables de Booking pueden quedar sin definir o vacías.

La llave privada se genera una sola vez y no se versiona ni se imprime:

```powershell
node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});require('fs').writeFileSync(process.argv[1],k.privateKey,{mode:0o600})" "$env:TEMP\dev-auth.pem"
```

Para pegarla en Render con `\n`: `(Get-Content "$env:TEMP\dev-auth.pem" -Raw) -replace "`r?`n",'\n'`. Después se borra el archivo. Cambiar la llave invalida los tokens vigentes (duran 1 h).

### Cloud Run (cada servicio)

No hay variables obligatorias nuevas. Estas tienen valor por defecto:

| Servicio | Variable | Defecto | Secreta |
|---|---|---|---|
| pricing | `SEARCH_MAX_OFFERS` (límite de ofertas por búsqueda, ADR-F12a2-01) | `10` | No |
| operations | `CHECKIN_OPEN_HOURS`, `CHECKIN_CLOSE_MINUTES` (ya existentes) | `48`, `60` | No |
| reservation | `BOOKING_PAYMENTS_BASE_URL` | vacía = los pagos de clientes de Booking responden 503 | No |
| reservation | `BOOKING_PAYMENTS_AUTH_VALUE` (valor de la cabecera de autenticación hacia la API de pagos de Booking) | vacía | **Sí** |
| reservation | `BOOKING_PAYMENTS_AUTH_HEADER`, `BOOKING_PAYMENTS_PATH_TEMPLATE`, `BOOKING_PAYMENTS_TIMEOUT_MS`, `BOOKING_PAYMENTS_STATUS_MAP`, `BOOKING_PAYMENTS_FIELDS` | ver `microservices/reservation-service/src/infrastructure/clients/booking-payments.ts` | No |

`BOOKING_PAYMENTS_VERIFY=off` y `INTEGRATION_LOCAL` no se definen en la nube (el servicio se niega a arrancar con ellos en producción).

## 3. Migraciones para Supabase (ocho)

Se ejecutan desde la carpeta de cada servicio, solo el humano: `npx --yes @dotenvx/dotenvx run -f .env.supabase -- npx prisma migrate deploy`, y después `migrate status`. Todas son aditivas.

| # | Servicio | Migración |
|---|---|---|
| 1 | webhooks | `20261026000000_v2_events_and_api_version` |
| 2 | reservation | `20261026000000_payment_channel` |
| 3 | operations | `20261027100000_flight_gate_reason` |
| 4 | operations | `20261027220000_boarding_pass_cabin` (F12a-2, bloque D) |
| 5 | gateway | `20261026000000_gateway_dev_auth` |
| 6 | gateway | `20261026010000_gateway_v2_bookings` |
| 7 | gateway | `20261027000000_gateway_stock_outbox` |
| 8 | gateway | `20261027110000_gateway_promotion_agreement` |

Las migraciones solo alteran objetos del esquema del servicio (sin `CREATE SCHEMA`, extensiones ni permisos). Si el rol `svc_gateway` no tiene permisos sobre las tablas nuevas, se resuelve en `infra/db/roles.sql` por el humano.

## 4. Secretos: cómo crearlos en Secret Manager

Se crean una vez, sin escribir el valor en la terminal ni en un archivo versionado (`gcloud secrets create … --data-file=-` leyendo de la entrada estándar, o desde la consola de GCP):

```powershell
# Ejemplo: secreto del servicio de pagos de Booking (cuando Booking lo entregue)
gcloud secrets create booking-payments-auth --replication-policy=automatic
# pegar el valor y terminar con Ctrl+Z, Enter:
gcloud secrets versions add booking-payments-auth --data-file=-
gcloud secrets add-iam-policy-binding booking-payments-auth `
  --member="serviceAccount:reservation-service-runtime@project-a1d2e3ba-f6ff-469e-854.iam.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor"
```

Secretos del Gateway (`DEV_AUTH_PRIVATE_KEY`, `BOOKING_STOCK_API_KEY`, `BOOKING_EVENTS_SECRET`): el Gateway corre en Render, así que se guardan como variables secretas de Render (la llave del dev-auth también puede guardarse en Secret Manager como copia de respaldo, pero el Gateway la lee de la variable de entorno, nunca de un archivo).

## 5. Servicios que se redesplegan

| Servicio | Plataforma | Motivo |
|---|---|---|
| inventory | Cloud Run | RPC `ListCabinOccupancy` (F12a P6) |
| pricing | Cloud Run | Búsqueda con varias ofertas (F12a-2 C) |
| ancillaries | Cloud Run | `ChangeSeats` (F12a P4) |
| reservation | Cloud Run | Canal de pago (F12a P2/P3) |
| webhooks | Cloud Run | Eventos v2 y versión de API (F12a P3) |
| operations | Cloud Run | `departureGate`/`reason` (P6), cabina en el check-in y RPC `CountCheckedIn` (F12a-2 D) |
| ticketing | Cloud Run | Solo el bind del perfil local; se redespliega con los demás para que todas las imágenes salgan del mismo `main` |
| gateway | Render | Fachada v2, dev-auth, stock, panel y configuración de producción |

Los workflows (`.github/workflows/deploy-*.yml`) se revisaron en F12a-2: **no hace falta cambiarlos** porque ninguna variable nueva es obligatoria. Dos advertencias:

- `deploy-service.yml` usa `--set-env-vars` y `--set-secrets`, que **reemplazan** el conjunto completo en cada despliegue. Las variables de Booking de reservation (sección 2) deben agregarse a `extra_env_vars` / `extra_secrets` de `deploy-reservation.yml` (por ejemplo `extra_secrets: DATABASE_URL=reservation-database-url:latest,BOOKING_PAYMENTS_AUTH_VALUE=booking-payments-auth:latest`); si solo se ponen a mano en Cloud Run, el siguiente despliegue las borra.
- Las pruebas de CI de pricing y operations incluyen las nuevas de F12a-2 (`microservices/pricing-service/test/unit/search-multi-offers.spec.ts`, `microservices/operations-service/test/count-checked-in.spec.ts`).

## 6. Cuando llegue Booking: crear su cliente `client_credentials` en producción

Con la base de producción accesible solo para el humano (`DATABASE_URL` del gateway en Supabase vía `dotenvx`, desde la carpeta `platform/api-gateway`). El `client_id` solo admite `[A-Za-z0-9_-]` (3 a 40 caracteres) y no puede tener forma de UUID. Booking necesita únicamente estos scopes: `flights:read`, `flights:hold`, `flights:book`, `flights:cancel`, `flights:webhooks` (nunca `flights:ops` ni `flights:admin`).

```powershell
cd platform/api-gateway
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run --prefix ../.. dev-auth:client -- create --client-id booking --scopes flights:read,flights:hold,flights:book,flights:cancel,flights:webhooks --name "Booking" --out platform/api-gateway/.local/booking.secret
```

- El secreto se genera ahí, solo se guarda su hash (scrypt) y se escribe en `.local/booking.secret` (ignorado por git, modo 0600). Se entrega a Booking **una sola vez** por enlace de un solo uso y el `client_id` por correo aparte; después se borra el archivo.
- `disable` / `enable --client-id booking` apagan o reactivan el cliente sin borrarlo.
- Después se configuran en Render `BOOKING_EVENTS_CLIENT_ID=booking`, `BOOKING_EVENTS_SECRET` (y `BOOKING_STOCK_*` si Booking ya expone el stock) y, en Cloud Run, `BOOKING_PAYMENTS_BASE_URL` y `BOOKING_PAYMENTS_AUTH_VALUE` (sección 5).
- Un cliente para uso interno de operaciones (`flights:ops`, `flights:admin`) se crea igual, con otro `client_id` y sus scopes.

## 7. Comportamiento sin Booking (comprobado por pruebas)

| Elemento | Sin configurar |
|---|---|
| Stock a Booking | Apagado; el Gateway lo registra al arrancar y no encola nada (V2-STK-01, V2-E-09…11) |
| `POST /api/v2/vuelos/booking-events` | 401 a todo, incluida una firma calculada con cualquier secreto (V2-P3-40, V2-E-22) |
| Pago de un cliente `client_credentials` | 503 `PROVIDER_UNAVAILABLE` con `Retry-After`; no crea reserva ni llama a Booking (V2-E-21, PAY-14) |
| v1 y clientes de Supabase | Sin cambios; v1 no consulta a Booking |
| Búsqueda, hold, mapa de asientos, estado de vuelo, health | Funcionan igual (V2-E-20) |
