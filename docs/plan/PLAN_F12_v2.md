# PLAN F12 (v2) — GabatAIR: integración con Booking, ESB, bus de eventos, GraphQL y UI

**Proyecto:** Flight Platform — aerolínea **GabatAIR** · **Repositorio:** `GAAGUINAGA/Flight-Platform`
**Nodo ante Booking:** `NODE_VUE_GABATAIR`
**Estado de partida:** F0–F11 cerradas y desplegadas (siete microservicios gRPC en Cloud Run, API Gateway en Render, Supabase Auth con roles customer, partner y admin).
**Reemplaza a:** `PLAN_F12.md` (que suponía petición y respuesta por RabbitMQ y sagas en los microservicios).

---

## 1. Principios

1. GabatAIR es una plataforma **independiente**: existe con o sin Booking. Booking es un cliente más.
2. La arquitectura de seis capas del curso es **obligatoria** en su comunicación: UI → GraphQL → MS de respuesta → ESB (enrutador y orquestador) → MS de gestión → datos, con un **bus de eventos en RabbitMQ** y el `X-Correlation-Id` atravesando todas las capas.
3. Booking entra **por REST** por una sola URL base, a la capa de MS de respuesta (`/api/v2/vuelos/...`). No usa GraphQL.
4. **Se hace bien antes que rápido.** La integración del martes se construye sobre la arquitectura actual, ya probada, en la capa 4; el ESB se construye después, por debajo, sin que Booking note el cambio.

---

## 2. Arquitectura objetivo

```
Booking ─────REST /api/v2/vuelos─────────────┐
                                             ▼
UI React ──HTTPS──► GraphQL (capa 5) ──REST──► API Gateway (capa 4: Vuelos · Reservas · Postventa · Clientes)
(capa 6)                                     │  HTTP interno
                                             ▼
                                   ESB (capa 3)
                                   ├─ Enrutador: un solo MS de gestión, sin coordinación
                                   ├─ Orquestador: sagas con compensación LIFO y registro persistente
                                   └─ Integración externa: Booking (stock gRPC, eventos), circuit breaker y kill-switch
                                             │ gRPC
                                             ▼
                     MS de gestión (capa 2): Inventory · Pricing · Ancillaries · Reservation · Ticketing · Webhooks · Operations
                                             │
                                             ▼
                                   Datos (capa 1): un esquema por servicio

ESB ──publica booking.* y flight.*──► RabbitMQ (bus de eventos) ──consume──► Webhooks ──► Booking y otros sistemas
```

| Capa del curso | GabatAIR |
|---|---|
| 6. UI | Aplicación web React (F12c) |
| 5. GraphQL | Servicio GraphQL propio (F12c) que llama al Gateway reenviando el JWT y el `X-Correlation-Id` |
| 4. MS de respuesta | **API Gateway**, organizado en los dominios Vuelos, Reservas, Postventa y Clientes |
| 3. ESB | Servicio `esb-service` (F12b): enrutador, orquestador de sagas y capa de integración externa |
| 2. MS de gestión | Los siete microservicios, dueños de sus datos, **sin llamarse entre sí** (desde F12b) |
| 1. Datos | Un esquema por servicio en Supabase, con clientes Prisma aislados |
| Seguridad | Supabase Auth (usuarios) + `dev-auth` propio con OAuth2 `client_credentials` (Booking) |
| Bus de eventos | RabbitMQ (CloudAMQP), solo para eventos (F12b) |

---

## 3. Entregas y orden

| Entrega | Contenido | Plazo |
|---|---|---|
| **F12a — Contrato v2 e integración con Booking** | Fachada `/api/v2/vuelos` sobre la arquitectura actual, `dev-auth`, webhooks CloudEvents, feed de eventos, eventos de Booking, stock por gRPC | **Martes 19h30** (integración con Booking) |
| **F12b — ESB y bus de eventos** | Enrutador, orquestador con las sagas (movidas desde Reservation y Operations), registro de sagas, RabbitMQ con colas por propósito, capa de integración externa | Sin plazo forzado |
| **F12c — GraphQL y UI React** | Capa 5 y capa 6, con paneles de usuario y de administración | Después de F12b |
| **F12d — Telemetría** | OpenTelemetry: métricas y trazas distribuidas, con `correlationId` | Después de F12c |

**Por qué este orden no genera retrabajo:** F12a vive en la capa 4. En F12b solo cambia hacia dónde llama el Gateway (al ESB en lugar de a los microservicios); lo que ve Booking no cambia. Las pruebas de F12a sirven como regresión de F12b.

---

## 4. Decisiones (ADR a crear)

| ID | Decisión | Entrega |
|---|---|---|
| ADR-F12-01 | Arquitectura de seis capas del curso; correspondencia de la sección 2 | F12a |
| ADR-F12-02 | Supabase Auth para usuarios y `dev-auth` propio para `client_credentials` (en lugar de Keycloak): ya funciona, sin servicio pesado adicional; el diagrama del curso deja el servidor OAuth2 "por definir" | F12a |
| ADR-F12-03 | v2 conviviendo con v1 en el mismo Gateway; ninguno de los dos contratos se modifica | F12a |
| ADR-F12-04 | Emisión de boletos en v2 (ver 5.4) | F12a |
| ADR-F12-05 | Nodo `NODE_VUE_GABATAIR`: `nodo_id` del health y `service_id` del stock | F12a |
| ADR-F12-06 | RabbitMQ solo para eventos; el ESB llama a los MS de gestión por gRPC | F12b |
| ADR-F12-07 | Las sagas pasan al orquestador del ESB, con registro persistente (saga y pasos, por `correlationId`) y recuperación de las pendientes | F12b |
| ADR-F12-08 | Colas por propósito en RabbitMQ, reintentos acotados y cola de mensajes fallidos para eventos; consumidores idempotentes | F12b |
| ADR-F12-09 | Capa de integración externa en el ESB: adaptador por socio, circuit breaker y kill-switch | F12b |
| ADR-F12-10 | GraphQL como servicio aparte; límites de profundidad, DataLoaders, introspección solo fuera de producción | F12c |

---

## 5. F12a — Contrato v2 e integración con Booking (martes)

Contrato: `contracts/openapi/vuelos-openapi-v2.yaml` (se agrega al repositorio sin modificarlo). URL base para Booking: `https://flight-gateway-o37n.onrender.com/api/v2`.

### 5.1. Alcance (Booking probará todos los flujos)

| Prioridad | Contenido |
|---|---|
| **P1 — conexión y seguridad** | `dev-auth`: `POST /api/v2/oauth2/token` (`client_credentials`), JWKS publicado, registro de clientes con secreto hasheado, emisor aceptado por el Gateway junto al de Supabase, *scopes* del contrato (`flights:read`, `hold`, `book`, `cancel`, `webhooks`; además `ops` y `admin` para uso interno). Con token de partner, el dueño de los recursos es `X-User-Id`. `GET /vuelos/health` con `nodo_id = NODE_VUE_GABATAIR` (público, menos de 1 s, 503 si `DOWN`). `ProblemDetails` v2 (`instance`, `correlation_id`, `timestamp` y los códigos nuevos). Cabeceras `X-Correlation-Id` (se propaga y se devuelve siempre) y `X-Request-Id`. |
| **P2 — compra** | `search`, `seatmap` (con `status` por asiento) y `GET flights/{n}/status` públicos; `offers/hold` (con `ttlMinutes`) y `GET/DELETE hold/{id}`; `GET/POST bookings` (con `salesChannel` y `paymentReference`), `GET bookings/{id}`; `POST tickets` y `GET tickets[/{id}]`; `_links`. |
| **P3 — eventos** | Webhooks en CloudEvents v1.0 (`application/cloudevents+json`) firmados con `X-Webhook-Signature: sha256=<HMAC>`, con los tipos `ec.edu.epn.booking.vuelos.<evento>` del contrato. `GET /vuelos/eventos` (feed outbox). `POST /api/v2/vuelos/booking-events` para `payment.confirmed`, `payment.failed` y `package.cancelled`, idempotente por `id` del evento. |
| **P4 — postventa y check-in** | `baggage-options`, `baggage`, `date-change/search`, `date-change`, `cancellation-quote`, `cancel` (respuesta ampliada y `reasonCode`), `PUT seats`, `check-in`, `boarding-passes`. |
| **P5 — stock** | Cliente gRPC `inventory.InventoryStockService/PushStockUpdate` hacia `booking.epn.edu.ec:50051` con TLS, `x-api-key` (secreto emitido por Booking) y `x-correlation-id`, `service_id = NODE_VUE_GABATAIR`, `item_id = <vuelo>-<cabina>`, en cada hold, liberación, venta o cancelación. Best-effort: un fallo hacia Booking nunca revierte la operación; se registra y se reintenta. Variable para desactivarlo. |
| **P6 — operaciones** | `PATCH flights/{n}/status` y `GET operaciones/vuelos` (scope `flights:ops`), `GET/PUT promociones/contrato` (scope `flights:admin`). |

Si el tiempo no alcanza para todo antes del martes, se entrega en orden de prioridad, y lo que falte se informa a Booking antes de la sesión.

### 5.2. Bloque 0 — Análisis de brechas (antes de escribir código)

Matriz operación por operación entre v2 y la implementación (ruta, campos, estados, códigos de error, seguridad y eventos), con una propuesta para cada brecha. **La aprueba el humano.** Debe resolver como mínimo: la máquina de estados v2 de la reserva y del asiento frente a la actual; la emisión (5.4); el cambio de asiento; dónde se guardan las promociones; de dónde sale el feed de eventos; y qué servicio publica cada tipo de evento nuevo.

### 5.3. Reglas de la fachada v2

1. v1 (`/flights/v1`) sigue respondiendo exactamente igual: sus pruebas no cambian.
2. v2 reutiliza los casos de uso existentes; solo se traduce la forma (rutas, campos, errores, cabeceras).
3. Cambios en microservicios y en los `.proto` solo si una brecha aprobada lo exige, y solo aditivos.
4. Toda respuesta v2 se valida con Ajv (con ajv-formats) contra el contrato v2 en las pruebas.

### 5.4. Emisión de boletos (propuesta para ADR-F12-04)

Booking cobra **antes** de crear la reserva y envía el `paymentReference` en `POST /vuelos/bookings`. Propuesta para F12a: la reserva v2 valida la referencia y **emite en la misma operación**, como hoy; `POST /vuelos/bookings/{id}/tickets` y el evento `payment.confirmed` son **idempotentes** (si ya hay boletos emitidos, devuelven los existentes sin duplicar). La emisión diferida como paso propio se implementa en el orquestador del ESB (F12b). Pendiente de confirmar contra las respuestas que exige el contrato en el bloque 0.

### 5.5. Pruebas y criterios de aceptación

1. Matriz rol × operación v2 (anonymous, cliente de Booking con `client_credentials`, customer, admin) con su resultado esperado, una celda por `it`.
2. Pruebas K (Ajv contra v2) y S (401, 403, 404 de otro `X-User-Id`, 400) por operación.
3. Recorridos v2 de punta a punta: compra, postventa, check-in, eventos (webhook CloudEvents con firma verificada y feed), `booking-events` (pago confirmado y fallido, paquete cancelado) y stock contra un servidor gRPC simulado con TLS.
4. v1 completo sigue pasando (suite real del Gateway, dos veces seguidas).
5. Despliegue: recorridos v2 contra Render con un cliente `client_credentials` de prueba; health con `nodo_id` correcto.
6. Antes del martes: credenciales de Booking entregadas (`client_secret` por enlace de un solo uso, `client_id` por correo aparte) y su webhook registrado.

### 5.6. Pendientes con Booking

1. Cómo autentican los eventos que envían a `booking-events` (firma, cabecera y secreto).
2. Cómo nos entregan la `x-api-key` del servicio de stock.

---

## 6. F12b — ESB y bus de eventos (resumen)

- **Enrutador**: operaciones con nombre, una por llamada a un solo MS de gestión; métricas de uso y latencia por operación.
- **Orquestador**: crear reserva, emitir, cambiar fecha, agregar maletas, cambiar asiento, cancelar y check-in, con compensación LIFO, idempotencia, registro persistente de cada saga y paso por `correlationId`, y recuperación de las pendientes (lo que hoy hace `ResumePending`). Los MS de gestión dejan de llamarse entre sí.
- **Integración externa**: adaptador por socio (Booking: stock, eventos), circuit breaker y kill-switch.
- **Bus de eventos**: el ESB publica `booking.*` y `flight.*` en RabbitMQ con `correlation_id` (outbox en la base del ESB); colas por propósito, reintentos acotados y cola de fallidos; Webhooks consume y notifica.
- **Gateway**: llama al ESB por HTTP interno; el scheduler también.
- **Encendido por ventanas**: scripts que activan instancias mínimas en Cloud Run antes de cada sesión y las desactivan después.
- **Validación**: v1 y v2 completos pasan sin cambios en sus aserciones.

## 7. F12c — GraphQL y UI React (resumen)

- **GraphQL**: *queries* y *mutations* orientadas a las pantallas (búsqueda, mis reservas, checkout, postventa, check-in, administración, auditoría de sagas por `correlationId`, salud de los nodos), suscripciones opcionales (estado de la reserva), DataLoaders, profundidad máxima, introspección solo fuera de producción, autenticación también en WebSocket.
- **UI React**: login con Supabase; cliente (búsqueda, compra, mis viajes, postventa, check-in con pase) y paneles de administración (vuelos y tarifas, operaciones, webhooks, auditoría por `correlationId`, salud).

## 8. F12d — Telemetría (resumen)

OpenTelemetry en el Gateway, GraphQL, el ESB y los microservicios: trazas distribuidas y métricas por operación, con `correlationId` como atributo, exportadas a Google Cloud (Trace y Monitoring) o a un proveedor con plan gratuito.

---

## 9. Notas para el developer — F12a

```markdown
## Notas para esta fase
Entrega F12a de PLAN_F12_v2.md (docs/plan/): contrato v2 e integración con Booking sobre la arquitectura actual. La aerolínea se llama GabatAIR y su nodo ante Booking es NODE_VUE_GABATAIR. Booking probará todos los flujos el martes a las 19h30.
- Lee PLAN_F12_v2.md completo (secciones 1 a 5) y contracts/openapi/vuelos-openapi-v2.yaml.
- Bloque 0 primero: matriz de brechas entre v2 y la implementación (sección 5.2), con una propuesta por brecha, en docs/dev/. DETENTE y espera mi aprobación antes de escribir código.
- Luego, por prioridad (sección 5.1), con commit `wip(gateway): [F12a] <bloque>` al cierre de cada una: P1, P2, P3, P4, P5 y P6.

Alcance de servicios:
- Trabajas en platform/api-gateway (fachada v2 y dev-auth) y docs/.
- Cambios en microservicios, contracts/proto o packages/ solo si una brecha aprobada en el bloque 0 lo exige; avísame antes.
- No modifiques ninguno de los dos contratos OpenAPI.

Reglas (ver AGENTS.md):
- Trabaja SOLO en la rama feat/F12a-contrato-v2; confírmalo al inicio y antes de cada commit.
- v1 debe seguir respondiendo exactamente igual: su suite completa y real pasa sin cambios en sus aserciones.
- Toda respuesta v2 se valida con Ajv (con ajv-formats) contra vuelos-openapi-v2.yaml en las pruebas. Cada caso es un it(...) propio con su ID; datos por propiedad; cada escenario crea y limpia sus datos; todo pasa dos veces seguidas; plazos propios y holgados.
- Los secretos (llaves del dev-auth, secretos de clientes, x-api-key de Booking) nunca se versionan ni se imprimen; los secretos de clientes se guardan hasheados.
- Toda verificación de compilación se hace desde un clon limpio, fuera de la carpeta temporal; avísame la ruta para borrarlo.
- Nunca leas .env, .env.supabase, infra/.env ni infra/dev-keys. Sin procesos en segundo plano. No hagas docker build (lo verifico yo). Si necesitas una migración local, dime el servicio y la aplico.

Antes de "listo para auditoría (código)": lint, audit-policy, el CI de cada workflow afectado desde un clon limpio, la suite completa y real del gateway (v1 y v2) dos veces seguidas, y la lista --verbose de la matriz v2 y de los recorridos v2 en la bitácora.
```
