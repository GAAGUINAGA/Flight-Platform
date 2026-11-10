# F12b-2 — Guía de despliegue del bus de eventos (bloque D)

Lo ejecuta el humano. Orden: **CloudAMQP y su secreto `rabbitmq-url` (con acceso para las cuentas de ESB y Webhooks) → esquema `esb` y `svc_esb` en Supabase → migración del ESB → configuración del servicio ESB en Cloud Run → push a `main` (redespliegue de todo) → verificación**.

> **Webhooks referencia `RABBITMQ_URL=rabbitmq-url:latest` en `deploy-webhooks.yml` (`--set-secrets` reemplaza los secretos del servicio: si no se declara en el workflow, Webhooks arranca sin broker y no retira eventos, en silencio; audit-12 H1). Por eso el secreto `rabbitmq-url` debe existir y `webhooks-service-runtime` debe tener `roles/secretmanager.secretAccessor` sobre él ANTES del push; si no, el despliegue de Webhooks falla al referenciarlo.** Ver §1.

> **El push a `main` redespliega el ESB (por el cambio de `packages/shared` y del propio ESB) y con `ESB_EVENTS_MODE=outbox` (valor por defecto) el ESB nuevo exige `DATABASE_URL`, `DIRECT_URL` y `RABBITMQ_URL` (`amqps://` en producción): sin ellas **se niega a arrancar** (`DATABASE_URL and RABBITMQ_URL are required when ESB_EVENTS_MODE=outbox`; `RABBITMQ_URL must use amqps in production`). Por eso todo lo anterior debe estar hecho ANTES del push.** `deploy-esb.yml` usa `--update-secrets` (no `--set-secrets`) para conservar los secretos que se configuren a mano en el servicio.
>
> **Arrancar el ESB sin bus** (si hiciera falta, p. ej. antes de tener CloudAMQP): `ESB_EVENTS_MODE=grpc` en el servicio de Cloud Run. El ESB no necesita base ni broker, `clientes.publicar-evento` vuelve a reenviarse a Webhooks por gRPC y `sistema.publicar-eventos` responde `UNIMPLEMENTED` (el scheduler lo registra como aviso y sigue despachando). Es también la vuelta atrás en cualquier punto, sin redesplegar emisores. En modo `grpc` Webhooks puede dejar `RABBITMQ_URL` sin definir (solo entrega).
>
> **Imagen:** `microservices/esb-service/Dockerfile` instala `openssl` en las dos etapas como el de `webhooks-service` (Prisma elige su motor `debian-openssl-3.0.x` según el openssl presente al generar). Los workflows ejecutan `scripts/ci/image-startup-smoke.sh` (arranque con `NODE_ENV=production`, base y `RABBITMQ_URL` ficticios) y fallan si Prisma no puede cargar su motor; un error de conexión a la base ficticia no cuenta.

## 1. Cuenta de CloudAMQP (plan gratuito)
1. Crear la instancia y un vhost `flight`; un usuario con permisos solo sobre ese vhost.
2. `RABBITMQ_URL` debe ser `amqps://usuario:clave@host/flight` (TLS obligatorio en producción: el ESB y Webhooks rechazan `amqp://` si `NODE_ENV=production`, salvo `INTEGRATION_LOCAL=true`).
3. Confirmar los límites del plan gratuito (mensajes por mes, conexiones, colas). El diseño abre **una conexión por corrida y por lado** y no mantiene consumidores permanentes.
4. Crear el secreto **`rabbitmq-url`** en Secret Manager (el mismo lo usan el ESB y Webhooks) y dar acceso de lectura a las dos cuentas de ejecución, ANTES del push (PowerShell; el valor no se escribe en el historial: pegarlo desde el portapapeles o un archivo temporal que luego se borra):
   ```powershell
   $P = "project-a1d2e3ba-f6ff-469e-854"
   gcloud secrets create rabbitmq-url --project $P --replication-policy automatic --data-file=ruta\rabbitmq-url.txt
   foreach ($sa in "webhooks-service-runtime", "esb-service-runtime") {
     gcloud secrets add-iam-policy-binding rabbitmq-url --project $P `
       --member "serviceAccount:$sa@$P.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
   }
   gcloud secrets get-iam-policy rabbitmq-url --project $P
   ```
   Comprobar en la salida que ambas cuentas aparecen con `roles/secretmanager.secretAccessor`. Los secretos del ESB `esb-database-url` y `esb-direct-url` (§2) se crean igual, con acceso solo para `esb-service-runtime`.
5. La topología (exchange `flight.events`, `q.webhooks.entrega`, tres colas de espera y `q.webhooks.entrega.fallidos`) la declara el ESB en su primera publicación; no se crea a mano.

## 2. Esquema y rol del ESB en Supabase
Aplicar el bloque de `infra/db/roles.sql` para `esb` (esquema `esb`, rol `svc_esb` con `search_path = esb, public`, `GRANT CONNECT` y `GRANT USAGE, CREATE ON SCHEMA esb`), fijar la contraseña de `svc_esb` y construir `DATABASE_URL` (pooler) y `DIRECT_URL` en `microservices/esb-service/.env.supabase` siguiendo el patrón de los otros servicios. Después, desde `microservices/esb-service`:

```powershell
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npx prisma migrate deploy
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npx prisma migrate status
```
`migrate status` debe mostrar "up to date" y el Datasource con `pooler.supabase.com`.

## 3. Secretos y variables
| Servicio | Secreto / variable | Obligatoria | Nota |
|---|---|---|---|
| **esb-service** | `DATABASE_URL=esb-database-url`, `DIRECT_URL=esb-direct-url` (rol `svc_esb`), `RABBITMQ_URL=rabbitmq-url` (`amqps://`) en Secret Manager | sí (modo `outbox`) | Sin ellas el ESB no arranca en modo `outbox`. **Se configuran a mano en el servicio** (`gcloud run services update esb-service --update-secrets "DATABASE_URL=esb-database-url:latest,DIRECT_URL=esb-direct-url:latest,RABBITMQ_URL=rabbitmq-url:latest"`) y `deploy-esb.yml` (`--update-secrets`) los conserva |
| esb-service | `ESB_EVENTS_MODE=outbox` | no (es el valor por defecto) | `grpc` = vuelta atrás |
| **webhooks-service** | `RABBITMQ_URL=rabbitmq-url:latest` (`amqps://`) en Secret Manager | sí, para usar el bus | Declarado en `extra_secrets` de `deploy-webhooks.yml`. Sin ella solo entrega (no retira del bus) y en producción escribe al arrancar el aviso `RABBITMQ_URL is not set in production; the event bus will not be consumed` |
| **inventory-service** | `ESB_URL=https://<host-del-esb>` | **sí, para usar el bus** | Sin `ESB_URL` publica por gRPC directo a Webhooks, sin el bus |
| **reservation-service** | `ESB_URL=https://<host-del-esb>` | **sí, para usar el bus** | ídem |
| **operations-service** | `ESB_URL=https://<host-del-esb>` | **sí, para usar el bus** | ídem |
| gateway (Render) | sin variables nuevas | — | El scheduler ya publica la outbox antes de despachar (con `GATEWAY_TRANSPORT=esb`) |

Los tres emisores usan la misma `INTERNAL_API_KEY` que ya tienen. **Un emisor en `NODE_ENV=production` sin `ESB_URL` escribe al arrancar un aviso JSON `ESB_URL is not set in production; events are published by direct gRPC to Webhooks, bypassing the event bus`** (revisar los logs de arranque de cada servicio tras el despliegue; `WEBHOOKS_GRPC_URL` deja de ser necesaria en ellos cuando `ESB_URL` existe, ADR-F12b2-01).

Workflows: los de inventory, reservation y operations ya pasan `ESB_URL=https://esb-service-gtl24uc77a-ue.a.run.app` en `extra_env_vars` (junto con las demás variables); `deploy-esb.yml` usa `--update-secrets`/`--update-env-vars` (conserva los secretos del ESB configurados a mano, ver arriba); `deploy-webhooks.yml` declara `RABBITMQ_URL=rabbitmq-url:latest`. `npm run lint` ejecuta `scripts/ci/check-deploy-env.cjs`, que falla si un servicio exige en producción un secreto o variable que su workflow no declara. Los cambios de `packages/shared` disparan los workflows de todos los servicios.

## 4. Orden de verificación en la nube
1. Desplegar ESB → `GET /health/deps` (con llave): siete dependencias `UP` y bloque `bus` con `broker: "UP"` y `outboxPendientes` numérico.
2. Desplegar Webhooks → logs sin `event ingestion skipped`.
3. Desplegar inventory, reservation y operations → sin aviso de `ESB_URL` en los logs de arranque.
4. Hacer una reserva de prueba y esperar hasta un tick del scheduler (60 s): el evento aparece en `GET /api/v2/vuelos/eventos` y la entrega firmada llega al suscriptor. Con eso la outbox queda en `PUBLISHED` y la cola `q.webhooks.entrega` en 0.
5. Revisar `q.webhooks.entrega.fallidos` en la consola de CloudAMQP: debe estar en 0 (el reproceso es manual, BACKLOG).
6. Precalentamiento: incluir `GET /health/deps` del ESB; medir la latencia del tick completo (publicación + retiro + entrega).

## 5. Contrato observable
Los eventos (webhooks y feed `GET /vuelos/eventos`) pueden tardar hasta un tick del scheduler (60 s). Está documentado para Booking en `docs/booking-integration.md` §8.
