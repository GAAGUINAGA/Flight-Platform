# F12c-1 — Despliegue y operación del servicio GraphQL

Servicio: `platform/graphql` (Express + graphql-js, sin base de datos). Contrato: `packages/graphql-schema/schema.graphql` (el SDL de `docs/dev/f12c0-diseno-front.md` §6.1) y `packages/graphql-schema/operations/operations.graphql` (las operaciones conocidas). Decisiones: `docs/dev/adr/ADR-F12c-04-servicio-graphql.md`.
El servicio **no guarda sesión ni emite tokens**: valida el JWT de Supabase, decide `@authenticated`/`@admin`, y reenvía el token al Gateway **v2** (`/api/v2/vuelos`) y a la API interna (`/api/admin/v1`).

## 1. Variables (Cloud Run; se configuran a mano, el workflow no las borra)

| Variable | Obligatoria | Qué es |
|---|---|---|
| `GATEWAY_BASE_URL` | sí | URL pública del Gateway (https en producción), sin barra final |
| `JWT_ISSUERS` | sí | JSON con los mismos emisores que el Gateway (`iss`, `aud`, `jwksUri`); en producción solo `jwksUri` |
| `CORS_ORIGINS` | sí en la práctica | Origen exacto de la web (`https://…`), separados por coma; sin comodín; `http://localhost:5173` solo fuera de producción |
| `NODE_ENV` | `production` (lo fija el workflow y la imagen) | En producción: introspección apagada y solo operaciones conocidas; el servicio no arranca con valores inseguros |
| `MAX_QUERY_DEPTH` (8), `MAX_COMPLEXITY` (4000), `MAX_ALIASES` (15), `MAX_BODY_BYTES` (102400), `MAX_VARIABLES_BYTES` (65536) | no | Límites de la consulta |
| `OPERATION_TIMEOUT_MS` (10000), `GATEWAY_TIMEOUT_MS` (8000) | no | Tiempos por operación y por llamada al Gateway |
| `RATE_LIMIT_PER_MIN` (120), `RATE_LIMIT_AUTH_PER_MIN` (240) | no | Límite propio por huella + IP real y por `sub` (en memoria, por instancia) |
| `INTROSPECTION`, `KNOWN_OPERATIONS_ONLY` | no | Solo fuera de producción; en producción no se pueden relajar (el servicio no arranca) |

No hay secretos propios: el servicio no usa claves ni base de datos (`JWT_ISSUERS` solo tiene URLs públicas).

## 2. Primera vez (lo hace el humano)

1. Cuenta de servicio de ejecución `graphql-service-runtime@project-a1d2e3ba-f6ff-469e-854.iam.gserviceaccount.com` (sin roles adicionales) y permiso del despliegue para usarla (`roles/iam.serviceAccountUser` para `GCP_DEPLOY_SA`).
2. Primer despliegue (desde `main`, con el workflow `deploy-graphql.yml`), que crea el servicio `graphql-service` en `us-east1` (mínimo 0 instancias).
3. Variables de entorno una sola vez (los despliegues posteriores usan `--update-env-vars` y las conservan):
   ```powershell
   gcloud run services update graphql-service --region us-east1 `
     --update-env-vars "GATEWAY_BASE_URL=https://<gateway>.onrender.com,CORS_ORIGINS=https://<web>" `
     --update-env-vars "^@^JWT_ISSUERS=[{\"iss\":\"https://<proyecto>.supabase.co/auth/v1\",\"aud\":\"authenticated\",\"jwksUri\":\"https://<proyecto>.supabase.co/auth/v1/.well-known/jwks.json\"}]"
   ```
   (el JSON lleva comas: se pasa con el separador alternativo `^@^`, como en `ADR-F12c-01-pago-booking-cubre-tarifa`/`ADR-F12b2fix-02`.) Usar **los mismos valores** que el Gateway tiene en Render.
4. Comprobar: `GET <url>/health` → `{"status":"ok"}`; una consulta libre `POST /graphql` → 403 (producción solo ejecuta operaciones conocidas).

## 3. Precalentamiento (B-6)

Agregar al script de precalentamiento (`docs/dev/f11c-scheduler-render.md`, `docs/dev/f12b1-despliegue-esb.md` §5), en este orden: `GET <graphql>/health`; `POST /graphql` con la operación `PlatformHealth` (despierta Gateway, ESB y servicios); `SearchFlights` de prueba con reintentos ante 503 (despierta Pricing e Inventory). La web usa `PlatformHealth` o `Viewer` en segundo plano al abrirse.

## 4. Local

`npm run local:up` ahora construye, levanta y verifica el servicio GraphQL (puerto 4000, `-GraphqlPort`; `JWT_ISSUERS` del perfil o de la terminal más el emisor de desarrollo si existe `infra/dev-keys`; `CORS_ORIGINS` del perfil), y `npm run local:down` lo detiene. `local:health` comprueba su `/health`. A mano:

```powershell
$env:NODE_ENV='development'; $env:GATEWAY_BASE_URL='http://127.0.0.1:3000'; $env:PORT='4000'
$env:JWT_ISSUERS='[{"iss":"flight-platform-dev","aud":"flight-platform","publicKeyFile":"<ruta>/infra/dev-keys/dev-public.pem"}]'
npm run build -w @flight-platform/graphql; npm start -w @flight-platform/graphql
```
### Recorridos locales (sin variables a mano)

`local:up` aplica por sí mismo, **solo en local** (`NODE_ENV=development`, `INTEGRATION_LOCAL=true`; el Gateway lo rechaza en producción), lo que necesitan los recorridos:
- el Gateway acepta el emisor de desarrollo (`infra/dev-keys/dev-public.pem`, solo se pasa la ruta) **sumado** a sus emisores, con `JWT_ISSUERS_EXTRA` (nuevo, solo con `INTEGRATION_LOCAL=true`); si el perfil (`-ProfileFile`) o la terminal traen `JWT_ISSUERS`, esos son la base;
- `WEB_PAYMENT_MODE=simulated` (en Reservation, que valida el pago, y en el Gateway) y `WEB_REQUIRE_VERIFIED_EMAIL=false` (en el Gateway) (un valor explícito en el perfil o la terminal gana);
- GraphQL usa los mismos emisores: los del perfil/terminal más el de desarrollo. Los emisores de `platform/api-gateway/.env` no se leen (prohibido leer `.env`): si solo están allí, GraphQL recibe únicamente el de desarrollo; ponga `JWT_ISSUERS` en el perfil para compartirlos.
Requisito único: `infra/dev-keys` (`npm run dev:token -- --init-keys`). `local:up` deja `.local/platform-config.json` (sin secretos) y `local:down` lo borra.

```powershell
npm run local:up -- -SkipDocker          # Postgres y RabbitMQ ya levantados; también con -ProfileFile .local\integracion.prueba.env
npm run local:journey                    # recorrido del socio (Booking) por v2: 31 comprobaciones
node platform/graphql/scripts/local-journey.cjs   # recorrido de GraphQL (usa el servicio de local:up; tokens de npm run dev:token; cancela lo que crea)
node platform/api-gateway/scripts/f12c-pruebas-reales.cjs --local   # S-1…S-6 (docs/dev/f12c-pruebas-reales.md §6; ya no hace falta fijar variables a mano)
npm run local:down
```
El recorrido de GraphQL comprueba al empezar esa configuración y, si falta algo (emisor, pago simulado, correo), lo dice y termina antes de la primera prueba en lugar de fallar a mitad con un 401.

## 5. Operación

- Registros (pino, lista blanca): `operationName`, `correlationId`, `requestId`, `role`, `status`, `category`, `code`, `httpStatus`, `latencyMs`, `gatewayCalls`. Nunca `variables`, la consulta, `Authorization` ni datos personales. Con el `correlationId` del error se reconstruye la compra en el Gateway y los servicios.
- Límite propio (riesgo conocido, diseño §7): en memoria por instancia y combina la huella (que el cliente puede cambiar) con la IP real del balanceador; la barrera real es el Gateway (límite por `sub`) y los topes del canal WEB.
- `availableActions` de `myBookings` va vacío (la lista v2 solo trae `self`); la fuente es `booking(bookingId)`.
