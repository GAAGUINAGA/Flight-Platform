# F12b-2 — Diseño del bus de eventos (Bloque 0)

- Estado: **APROBADO (D-1 a D-6 como se recomendaron, 2026-11-08).** Precisiones: D-2 documentado en `docs/booking-integration.md`; D-4 registrado como limitación en ADR-F12b-04; `booking.ticket_issuing` sin emisor y el reproceso de fallidos van a `BACKLOG.md`.
- Fecha: 2026-11-08 · Rama: `feat/F12b2-bus-eventos` · Base: `e5536aa` (main, F12b-1 y búsqueda por día local desplegadas)
- Fuentes: `docs/plan/PLAN_F12b.md` (§1–§4, F12b-2), `docs/dev/f12b1-diseno-esb.md`, ADR-F12-03, ADR-F12b-01/02/03/09, ADR-F12b1fix-01/02, código de los emisores y de `webhooks-service`.

## 1. Inventario de los eventos actuales

### 1.1 Cómo llegan hoy a Webhooks (dos caminos, ambos síncronos)

| Camino | Emisor | Cómo llega | Destino |
|---|---|---|---|
| **A** | `inventory-service`, `reservation-service`, `operations-service` | gRPC directo `WebhooksService.PublishEvent` (`WEBHOOKS_GRPC_URL`, llave interna, rol `system`) desde un adaptador `GrpcEventPublisher` que implementa el puerto `EventPublisher` de cada servicio | `webhooks-service` |
| **B** | Gateway (fachada v2): `publishV2Event` | `callGatewayGrpc('webhooks','publishEvent')` → con `GATEWAY_TRANSPORT=esb` va por la operación `clientes.publicar-evento` del ESB, que la reenvía por gRPC a Webhooks | `webhooks-service` |

`PublishEvent` (use case `WebhookUseCases.publish`): valida con Zod (`publishEvent`, lista cerrada `WEBHOOK_EVENTS`), asigna `eventId` si falta, **registra el evento en `webhooks.events`** (`seq` BIGSERIAL, único por `event_id`, `skipDuplicates`) y **crea una `delivery` PENDING por suscripción activa** (único `(event_id, subscription_id)`). Es ya idempotente por `event_id`.

### 1.2 Quién consume qué

| Consumidor | Qué toma | Cuándo |
|---|---|---|
| Entrega de webhooks (`dispatch`, tarea `dispatch-pending` del scheduler del Gateway → `sistema.despachar-webhooks`) | `deliveries` PENDING (lote de 100, `claimPending`) → firma y POST a suscriptores. v1: cuerpo de cinco propiedades + `x-flight-signature`. v2: CloudEvents + `X-Webhook-Signature`. Reintentos 1/5/30/120/360 min | cada tick (`SCHEDULER_EVERY_MS`, 60 s) |
| Feed `GET /api/v2/vuelos/eventos` | `webhooks.events` vía ESB `clientes.listar-eventos` → `webhooks.listEvents` (por `ownerPrefix`, `afterSeq`, orden por `seq`) | bajo demanda |

### 1.3 Eventos y emisores (15 tipos permitidos en `WEBHOOK_EVENTS`)

| Evento | Emisor | `eventId` | `apiVersion` |
|---|---|---|---|
| `booking.confirmed` | reservation (`create-reservation`, `resume-pending`) | `bookingId` (no manda id) | `v1` |
| `booking.failed` | reservation (`resume-pending`; `fail-reservation`) | `bookingId` / determinista | `v1` |
| `booking.changed` | reservation (`confirm-date-change`, `resume-pending`) | `randomUUID` / `bookingId` | `v1` |
| `booking.cancelled` | reservation (`post-sale-cancellation`) | `quoteId` | `v1` |
| `booking.baggage_added` | reservation (`post-sale-baggage`) | id de la compra | `v1` |
| `booking.ticket_issued`, `booking.ticket_failed` | reservation (solo reservas v2) | determinista (`deterministicEventId`) | `v1` |
| `booking.ticket_issuing` | **sin emisor encontrado en el código actual** (solo en la lista permitida) | — | — |
| `booking.checked_in` | operations (`check-in`) | `randomUUID` | `1.5.0.0` |
| `flight.cancelled`, `flight.schedule_changed` | operations (`flight-status`) | `randomUUID` | `1.5.0.0` |
| `hold.expired` | inventory (`publish-expired`) | `randomUUID` | `1.5.0.0` |
| `hold.created` | Gateway (`v2/hold.controller`) | determinista | `v2` |
| `booking.seat_changed` | Gateway (`v2/postsale.controller`) | — | `v2` |
| `flight.status_changed` | Gateway (`v2/operations.controller`) | — | `v2` |

Política de error hoy (se conserva): inventory traga el fallo (`SafeEventPublisher`, solo `warn`); reservation lo trata como dependencia (`readDependency('webhooks', …)`, algunos con `.catch(() => undefined)`); Gateway traga el fallo (`publishV2Event`, `warn`).

### 1.4 Lo que el cliente ve hoy (no debe cambiar)

Webhooks v1 (cuerpo de 5 propiedades, `x-flight-signature: t=…,v1=…`), webhooks v2 (CloudEvents, `id = evt-vue-<seq>`, `correlationid`, `X-Webhook-Signature = HMAC-SHA256(cuerpo)`), el feed (`seq`, filtros, `total`) y los reintentos de entrega a suscriptores (1/5/30/120/360 min).

## 2. Topología del bus

RabbitMQ **solo para eventos**. Conexión abierta únicamente durante una corrida (no hay consumidores permanentes: Cloud Run reduce CPU entre peticiones y la plataforma se apaga entre sesiones). Un mensaje en la cola es siempre durable (`deliveryMode 2`, colas `durable`).

### 2.1 Objetos (vhost `flight`; el ESB los declara de forma idempotente al publicar)

| Objeto | Tipo / argumentos | Función |
|---|---|---|
| `flight.events` | exchange `topic`, durable | Entrada única de eventos |
| `q.webhooks.entrega` | cola durable, enlazada a `flight.events` con `booking.#`, `hold.#`, `flight.#` | Propósito: **registrar el evento en Webhooks y crear sus entregas** |
| `q.webhooks.entrega.espera.1` / `.2` / `.3` | colas de espera: `x-message-ttl` 30 000 / 120 000 / 600 000 ms, `x-dead-letter-exchange=""`, `x-dead-letter-routing-key=q.webhooks.entrega` | Reintento con espera creciente (al vencer el TTL el mensaje vuelve a la cola principal). Sin consumidor |
| `q.webhooks.entrega.fallidos` | cola durable, sin TTL, sin consumidor | Cola de mensajes fallidos (DLQ) |

- **Claves de enrutamiento** = el `eventType` (`booking.confirmed`, `hold.expired`, `flight.cancelled`…): ya tiene la forma `familia.nombre` y es la lista cerrada que valida Webhooks.
- **Colas por propósito:** hoy existe un solo propósito (entrega de webhooks). La convención `q.<consumidor>.<propósito>` + `.espera.N` + `.fallidos` permite sumar otro propósito (otra cola enlazada a `flight.events`) sin tocar emisores. No se crean colas que el plan no pide (D-5).
- TTL y número de intentos configurables: `EVENTS_RETRY_TTLS_MS=30000,120000,600000` (la longitud define `EVENTS_MAX_ATTEMPTS`=3). Las pruebas usan TTL de milisegundos.
- El ESB es el **único que declara** la topología. Webhooks solo hace `get`/`ack` sobre `q.webhooks.entrega` y publica a las colas de espera/fallidos por nombre (variables con esos valores por defecto). Si la cola aún no existe, Webhooks trata el lote como vacío (sin error). Una prueba con broker real verifica que ambos coinciden (sin tocar `packages/shared`).

### 2.2 Formato del mensaje: CloudEvents 1.0 (modo estructurado, JSON)

```json
{ "specversion": "1.0",
  "id": "<eventId>",
  "type": "ec.edu.epn.booking.vuelos.<eventType>",
  "source": "/gabatair/esb",
  "time": "<occurredAt ISO-8601>",
  "datacontenttype": "application/json",
  "correlationid": "<X-Correlation-Id del origen; si falta, el eventId>",
  "data": { "ownerId": "<dueño>", "payload": { …exactamente el WebhookPayload del PublishEvent actual… } } }
```

`data` es el mismo mensaje que hoy viaja por gRPC (`ownerId` + `payload`). Así Webhooks reutiliza **el mismo caso de uso y el mismo Zod**: el feed y la entrega v1/v2 salen idénticos. Propiedades AMQP: `messageId=eventId`, `type=<eventType>`, `contentType=application/cloudevents+json`, cabecera `x-correlation-id`, `x-intento` (0, 1, 2…) en los reintentos. Este CloudEvent es **interno del bus**; el CloudEvent que ve el cliente lo sigue construyendo Webhooks (`buildCloudEvent`, con `evt-vue-<seq>`).

### 2.3 Reintentos y fallidos (consumidor, por mensaje)

1. `basic.get` (sin autoack). 2. Valida el sobre CloudEvents y llama a `WebhookUseCases.publish`. 3. Éxito → `ack`.
- **Error transitorio** (BD de Webhooks caída, timeout): si `x-intento < 3` publica una copia con `x-intento+1` en `q.webhooks.entrega.espera.<n+1>` (con confirmación) y luego `ack` del original. Si `x-intento = 3` → `fallidos` con cabecera `x-motivo` (código, sin datos) y `ack`.
- **Error no reintentable** (JSON inválido, sobre inválido, `VALIDATION_FAILED`): directo a `fallidos`.
- Si ni siquiera se puede publicar la copia → `nack` con `requeue=true` (el mensaje no se pierde). Un fallo entre "copia publicada" y "ack" produce un duplicado, que absorbe la idempotencia (§3.3).
- Los reintentos del bus solo cubren el **ingreso del evento a Webhooks**. La entrega HTTP a suscriptores sigue con su propia tabla `deliveries` y sus reintentos (1/5/30/120/360 min), sin cambios.
- Orden: el `seq` del feed lo asigna Webhooks al ingresar. Un evento reintentado recibe un `seq` mayor que el de eventos posteriores; ningún lector de `after=<seq>` lo pierde, solo lo ve más tarde.

### 2.4 Si RabbitMQ no está disponible

- **Ingreso (emisor → ESB):** no toca al broker; escribe en la outbox y responde 200. Sigue funcionando.
- **Publicación:** conexión con plazo (`RABBITMQ_CONNECT_TIMEOUT_MS=3000`). Si falla, las filas reclamadas se liberan con `available_at = now + min(5 s · 2^(intentos-1), 300 s)`; la operación responde `{brokerAvailable:false, pending:N}` con 200 (el scheduler no lo cuenta como fallo del ESB). Cuando el broker vuelve, el siguiente tick publica todo en orden de `seq`. **Nada se pierde:** la fila sale de la outbox solo tras la confirmación del broker (`PUBLISHED`).
- **Consumo:** Webhooks no consigue conectar → registra `warn` (dependencia, código) y sigue con las entregas ya pendientes. Los mensajes esperan en la cola (durable).
- Garantía: **al menos una vez** en publicación y consumo; el efecto es **exactamente una vez** por la idempotencia por `eventId`.

## 3. Esquema `esb`

### 3.1 Tabla `esb.outbox_events`

| Columna | Tipo | Nota |
|---|---|---|
| `seq` | `BIGSERIAL` PK | Orden de publicación |
| `event_id` | `UUID` UNIQUE | Idempotencia del ingreso (`INSERT … ON CONFLICT DO NOTHING`) |
| `routing_key` | `VARCHAR(64)` | = `eventType` |
| `owner_id` | `VARCHAR(128)` | Solo para diagnóstico/índices; no se registra en logs |
| `envelope` | `JSONB` | El CloudEvent de §2.2 |
| `status` | `VARCHAR(12)` | `PENDING` · `PUBLISHED` |
| `attempts` | `INT` default 0 | Intentos de publicación |
| `available_at` | `TIMESTAMPTZ(3)` | No antes de (backoff cuando el broker falla) |
| `locked_until` | `TIMESTAMPTZ(3)` NULL | Arriendo del lote |
| `last_error` | `VARCHAR(32)` NULL | Solo un código (`BROKER_UNAVAILABLE`, `UNROUTABLE`, `CONFIRM_TIMEOUT`) |
| `created_at`, `published_at` | `TIMESTAMPTZ(3)` | |

Índices: `(status, available_at, seq)` para el reclamo y `(status, published_at)` para la limpieza. Retención: las filas `PUBLISHED` se borran tras `ESB_OUTBOX_RETENTION_DAYS=7` (en la misma corrida de publicación, lotes de 1 000).

### 3.2 Tabla de idempotencia: no hace falta

- Ingreso: la unicidad de `event_id` en la outbox.
- Consumo: ya existen `webhooks.events.event_id` único (`skipDuplicates`) y `deliveries (event_id, subscription_id)` único. No se agrega tabla en `esb` ni en `webhooks`. La prueba BUS-I3 demuestra que el mismo mensaje dos veces produce una fila de evento y una entrega por suscripción.

### 3.3 Sección para `infra/db/roles.sql` (la aplica el humano; sin contraseñas)

```sql
-- F12b-2 (ADR-F12b-06): esquema y rol del ESB. Idempotente. Sin contraseña.
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS esb;
  REVOKE ALL ON SCHEMA esb FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA esb FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA esb FROM authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_esb') THEN CREATE ROLE svc_esb LOGIN; END IF;
  ALTER ROLE svc_esb SET search_path = esb, public;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO svc_esb', current_database());
END $$;
GRANT USAGE, CREATE ON SCHEMA esb TO svc_esb;
```

Equivalente a lo que ya hace el archivo para los otros ocho servicios; en el archivo real basta con agregar `'esb'` a los dos arreglos y a los `GRANT`. Para la contraseña local: `ROLE_PASSWORD_ESB` en `infra/.env`, en el bloque `environment` de `postgres` y `esb` en el bucle de `02-role-passwords.sh`. Como el volumen local ya está inicializado (los scripts de `initdb` no se repiten), el humano ejecuta el bloque SQL y un `ALTER ROLE svc_esb PASSWORD …` una vez. En Supabase: el mismo bloque y `DATABASE_URL`/`DIRECT_URL` de `svc_esb` en `microservices/esb-service/.env.supabase` siguiendo el patrón de los otros servicios. Las migraciones del ESB solo crean objetos dentro de `esb`.

## 4. Cómo se dispara la publicación y el consumo

Todo lo dispara la tarea **`dispatch-pending`** del scheduler del Gateway (la misma, con el mismo arriendo `store.acquire`, 55 s), en dos pasos ordenados:

| Paso | Llamada | Qué hace | Tamaño / plazo |
|---|---|---|---|
| 1 | ESB `sistema.publicar-eventos` (operación **nativa** del ESB, rol `system`) | Reclama un lote de la outbox, publica con confirmación, marca `PUBLISHED`, limpia. Si no hay filas pendientes **no abre conexión al broker** | `EVENTS_PUBLISH_BATCH=100`, hasta `EVENTS_PUBLISH_MAX_BATCHES=5` por corrida mientras el lote salga lleno; plazo 30 s |
| 2 | ESB `sistema.despachar-webhooks` → `webhooks.dispatchPending` (existente) | Webhooks **primero retira** mensajes (`basic.get`) hasta `EVENTS_PULL_BATCH=100`, hasta `EVENTS_PULL_MAX_BATCHES=5` o `EVENTS_PULL_BUDGET_MS=15000`, los ingresa y luego **entrega** las `deliveries` pendientes como hoy | plazo 30 s |

`dispatchPending` conserva proto y respuesta (`dispatched_count` = entregas, como hoy); el número de eventos ingresados va al log. Sin `RABBITMQ_URL`, Webhooks omite el retiro (modo de vuelta atrás, D-3).

**Latencia:** un evento queda en la cola dentro del mismo tick en que lo ve la outbox y se ingresa/entrega en ese mismo tick (pasos 1 → 2). Peor caso: **un tick** (60 s en la nube; el perfil local usa `SCHEDULER_EVERY_MS` corto). Antes el evento era visible en el feed al instante. Ver D-2.

**Dos instancias no procesan el mismo lote** (defensa en tres capas):
1. Arriendo de tarea del Gateway (`store.acquire`, BD del Gateway): una sola corrida de `dispatch-pending` a la vez.
2. Outbox: el reclamo es **una sola sentencia** `UPDATE "esb"."outbox_events" … WHERE seq IN (SELECT seq … ORDER BY seq LIMIT n FOR UPDATE SKIP LOCKED) RETURNING …` que fija `locked_until = now + ESB_OUTBOX_LEASE_MS (60 000)`. Dos ESB concurrentes reciben filas distintas. Una instancia que muere deja la fila reclamable al vencer el arriendo. Una sola sentencia es compatible con el pooler de Supabase en modo transacción (sin bloqueos asesores ni estado de sesión).
3. Cola: un mensaje retirado con `get` sin `ack` es invisible para otros consumidores y vuelve a la cola si el canal se cae; si aun así hubiera un duplicado, lo absorbe la idempotencia por `eventId`.

## 5. Qué cambia y qué no

### 5.1 Servicios emisores (inventory, reservation, operations)

Solo la **infraestructura**: `GrpcEventPublisher` se reemplaza por `EsbEventPublisher`, que hace `POST {ESB_URL}/internal/v1/operations/clientes.publicar-evento` con `X-Internal-Key`, `X-Correlation-Id`, `X-Owner-Id`, `X-Role: system`, `X-Deadline-Ms` y el cuerpo `{input:{ownerId,payload}}` **idéntico al mensaje gRPC actual**. Los puertos `EventPublisher`, los casos de uso y el dominio no cambian. Los errores se convierten a la misma forma (`code` numérico) para que `SafeEventPublisher`/`readDependency` se comporten igual. Variables nuevas: `ESB_URL` (+ `INTERNAL_API_KEY`, ya existe); `WEBHOOKS_GRPC_URL` deja de usarse en inventory y operations (reservation lo conserva si otro adaptador lo necesita; se verifica al implementar).

### 5.2 ESB

- Base de datos y Prisma (6.12.0 exacto) con esquema `esb`; `amqplib`; puerto `EventOutbox` y `EventBus` en `application/`, adaptadores en `infrastructure/`; dominio sin Nest/Prisma/amqplib (construcción del CloudEvent, backoff, reglas de ingreso).
- `clientes.publicar-evento` pasa de gRPC a **operación nativa** (`ESB_EVENTS_MODE=outbox`, por defecto): valida con Zod (`ownerId` ≤128, `eventType` con forma `familia.nombre` ≤64, `eventId` GUID opcional —si falta, el ESB lo asigna y queda estable en los reintentos—, `data` objeto, sobre ≤ `ESB_EVENT_MAX_BYTES`=65 536), inserta en la outbox y responde `{eventId}`. La validación completa de la lista cerrada de eventos la sigue haciendo Webhooks (el ESB no duplica `WEBHOOK_EVENTS`); un evento que Webhooks rechace termina en `fallidos`.
- `sistema.publicar-eventos` (nueva, nativa, rol `system`).
- `GET /health/deps` agrega un bloque aparte `bus` (`broker: UP|DOWN`, `outboxPendientes`). **`sistema.salud` no cambia** (siguen siendo siete dependencias, para no alterar el cálculo `HEALTHY/DEGRADED/DOWN` del Gateway).
- `ESB_EVENTS_MODE=grpc` mantiene el comportamiento actual (el ESB reenvía a Webhooks por gRPC): vuelta atrás **sin redesplegar emisores**.
- Logs por operación como hoy: tipo de evento, `eventId`, resultado, latencia; nunca `data`, `ownerId` ni `pnr`.

### 5.3 Gateway

Sin cambios en `publishV2Event` ni en las rutas. El scheduler (`dispatch-pending`) agrega la llamada previa a `sistema.publicar-eventos` (nueva entrada en `esb-operations.ts`; solo con `GATEWAY_TRANSPORT=esb`) y pide plazo de 30 s para las dos llamadas. Con `GATEWAY_TRANSPORT=grpc` el Gateway publica directo a Webhooks por gRPC, como hoy (la idempotencia por `eventId` permite convivir con eventos del bus).

### 5.4 Webhooks

- Puerto `EventBusConsumer` (`application/`) y adaptador AMQP (`infrastructure/`). `dispatch()` ejecuta primero `ingest()` y luego la entrega actual. `ingest()` llama a `publish()` (mismo código y mismo Zod) por cada mensaje.
- `PublishEvent` (RPC) **se conserva**: lo usan el modo gRPC, los scripts de humo y las pruebas existentes.
- Dependencia nueva `amqplib`; variables `RABBITMQ_URL`, `EVENTS_QUEUE`, `EVENTS_PULL_*`, `EVENTS_RETRY_TTLS_MS`. Sin migración en `webhooks`.

### 5.5 Lo que NO cambia para los clientes

Rutas y respuestas de v1/v2; suscripciones; cuerpo, cabeceras y firma de webhooks v1 (`x-flight-signature`) y v2 (`X-Webhook-Signature`, `id = evt-vue-<seq>`, `correlationid`); filtros y paginación del feed; reintentos de entrega a suscriptores; OpenAPI y `.proto` (sin cambios). Único cambio temporal observable: el evento puede tardar hasta un tick en aparecer en el feed y entregarse (D-2).

## 6. Plataforma local

### 6.1 `infra/docker-compose.yml` (lo agrega el humano; bloque exacto)

```yaml
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-flight}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:?Set RABBITMQ_PASSWORD in infra/.env}
      RABBITMQ_DEFAULT_VHOST: flight
    ports:
      - "127.0.0.1:5672:5672"
      - "127.0.0.1:15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 10s
      retries: 10
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq

volumes:
  postgres-data:
  rabbitmq-data:
```

Además en `postgres.environment`: `ROLE_PASSWORD_ESB: ${ROLE_PASSWORD_ESB:?Set ROLE_PASSWORD_ESB in infra/.env}` (ver §3.3). El humano agrega a los `.env` (nunca a git): `RABBITMQ_URL=amqp://<user>:<pass>@127.0.0.1:5672/flight` en `microservices/esb-service/.env` y `microservices/webhooks-service/.env`, y `DATABASE_URL`/`DIRECT_URL` de `svc_esb` en el del ESB.

### 6.2 Integración con los scripts (lo hago yo en el bloque A/C; son `scripts/`, no `infra/`)

- `local:up`: verifica el puerto 5672 antes de arrancar (mensaje claro si falta el contenedor), pasa `RABBITMQ_URL` solo por entorno del proceso (sin imprimirlo) a ESB y Webhooks, y ejecuta la migración del ESB igual que con los otros servicios.
- `local:health`: agrega el broker (TCP 5672 + bloque `bus` de `/health/deps`) sin cambiar los siete servicios ni el ESB existentes.
- `local:journey`: los 31 pasos actuales se conservan sin cambio de aserciones; el recorrido bombea el bus (publicación + ingreso) donde hoy espera el despacho, y se agregan pasos nuevos (evento emitido por una reserva llega al feed por el bus; la entrega v2 mantiene firma y `correlationid`). El conteo final se informa como `31/31` + los nuevos.
- Perfil local: `SCHEDULER_EVERY_MS` corto (el perfil de prueba ya lo ajusta; se documenta).

## 7. Pruebas (RabbitMQ real y Postgres local; fallan rápido si falta `RABBITMQ_URL` o `DATABASE_URL`, cierran conexiones en `afterAll` aunque `beforeAll` falle, datos propios por prueba, dos ejecuciones seguidas)

| ID | Qué demuestra |
|---|---|
| BUS-U1..U6 (unitarias) | Sobre CloudEvents y clave de enrutamiento; validación del ingreso (límites, tipo mal formado); backoff; reclamo por lotes con falso; resultado con broker caído; mapeo de errores del consumidor (reintentable/no) |
| BUS-I1 | Publicación: N filas de la outbox → N mensajes persistentes en `q.webhooks.entrega`, con `correlationid` y `messageId`; las filas quedan `PUBLISHED` |
| BUS-I2 | Consumo por lote: se retiran, se registran en `webhooks.events`, se crean las `deliveries`, se hace `ack`; la cola queda vacía |
| BUS-I3 | Idempotencia: el mismo evento dos veces (ingreso doble y mensaje duplicado) → una fila de evento y una entrega por suscripción |
| BUS-I4 | Reintentos: manejador que falla → el mensaje pasa por espera.1, .2, .3 (TTL de ms) y termina en `fallidos` al agotar los intentos; `x-intento` correcto |
| BUS-I5 | Mensaje no reintentable (sobre inválido / evento fuera de la lista) → directo a `fallidos` |
| BUS-I6 | Broker caído (URL a puerto cerrado y un proxy TCP que se corta a media corrida): el ingreso responde 200, las filas siguen `PENDING` con backoff, nada se pierde; al restablecer se publican todas, en orden |
| BUS-I7 | Dos publicadores concurrentes sobre la misma outbox: cada evento se publica una vez |
| BUS-I8 | Dos consumidores concurrentes: cada mensaje se procesa una vez |
| BUS-I9 | Recuperación: arriendo vencido tras una caída simulada → el lote se reclama de nuevo |
| BUS-I10 | Limpieza de filas publicadas tras la retención |
| BUS-I11 | Los nombres de topología del ESB y de Webhooks coinciden (el consumidor lee lo que el ESB declaró) |
| BUS-SEC1..4 | `clientes.publicar-evento` y `sistema.publicar-eventos` sin llave → 401, con rol distinto de `system` → denegado; sobre excedido → 400; los logs no contienen `data`, `ownerId`, `pnr` ni la URL del broker; `RABBITMQ_URL` sin TLS rechazada en `NODE_ENV=production` salvo `INTEGRATION_LOCAL` |
| Regresión | Suites reales del Gateway v1 y v2 (incluidos webhooks v1 y v2, feed y matriz de autorización) con `GATEWAY_TRANSPORT=esb` y el bus activo, dos veces seguidas; una vez con `ESB_EVENTS_MODE=grpc`; una vez con `GATEWAY_TRANSPORT=grpc`; `local:journey`. Los ajustes permitidos son solo de arranque (levantar ESB con BD y broker, y un auxiliar que bombee publicación + ingreso antes de leer el feed o despachar); no cambia ninguna aserción |

Alcance de la verificación: la prueba con broker real y las suites que lo usan las ejecuta el checkout principal (contenedor local del humano); CI de cada servicio sigue con lint, build, audit y unitarias.

## 8. Despliegue (bloque D, lo ejecuta el humano)

CloudAMQP plan gratuito (cuenta, instancia, vhost y usuario los crea el humano; `RABBITMQ_URL` con `amqps://` en Secret Manager para ESB y Webhooks; los límites del plan gratuito —mensajes/mes, conexiones, cola— se confirman al crearla); aplicar el bloque de §3.3 en Supabase; `ESB_URL`, `RABBITMQ_URL`, `DATABASE_URL`/`DIRECT_URL` del ESB en Cloud Run; `ESB_EVENTS_MODE=outbox`; `SCHEDULER_EVERY_MS` sin cambio; orden: esquema → migración del ESB → ESB → Webhooks → emisores; el precalentamiento incluye `/health/deps`. Con las conexiones abiertas solo durante cada corrida, el consumo es del orden de una conexión por tick por lado.

## 9. Decisiones que necesito de ti

1. **D-1 — Un archivo nuevo en `packages/shared`** (`esb-event-client.ts`, sin dependencias nuevas, `fetch` de Node 20) con el POST al ESB, para no copiarlo en los tres emisores. Costo: el cambio dispara los workflows de todos los servicios. *Recomendado: sí.* Alternativa: copiar ~25 líneas en cada emisor.
2. **D-2 — Latencia del feed y la entrega: hasta un tick** (60 s en la nube) en lugar de inmediata. *Recomendado: sí* (es la consecuencia del consumo por lotes ya decidido).
3. **D-3 — Vuelta atrás `ESB_EVENTS_MODE=outbox|grpc`** (por defecto `outbox`; sin ella no hay retorno en la nube sin redesplegar los emisores). *Recomendado: sí.*
4. **D-4 — Emisor → ESB es una llamada HTTP síncrona.** Si el ESB está caído, la emisión falla igual que hoy cuando Webhooks está caído (no hay outbox en cada emisor; "broker caído" sí está cubierto). *Recomendado: sí.*
5. **D-5 — Una sola cola de propósito** (`q.webhooks.entrega`) con topología lista para más. *Recomendado: sí.*
6. **D-6 — Reintentos 30 s / 2 min / 10 min, 3 intentos, luego `fallidos`; sin proceso de reproceso automático** (se reprocesa a mano desde la consola de RabbitMQ; la herramienta queda en `BACKLOG.md`). *Recomendado: sí.*

**Lo que necesito que hagas tú (no puedo editar `infra/`):** bloque `rabbitmq` y `ROLE_PASSWORD_ESB` en el compose (§6.1), aplicar la sección de `roles.sql` (§3.3) en local y en Supabase y `ALTER ROLE svc_esb PASSWORD …`, `.env` del ESB y de Webhooks (§6.1). Hasta entonces escribo todo con falsos para lo unitario; las pruebas con broker real esperan a tu confirmación.
