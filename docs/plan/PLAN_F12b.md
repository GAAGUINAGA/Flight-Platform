# PLAN F12b — ESB, bus de eventos y orquestador de sagas (GabatAIR)

**Base:** F12a y F12a-2 desplegadas en la nube (`main`, etiqueta `f12a-desplegada`). Plan general: `docs/plan/PLAN_F12_v2.md`.
**Objetivo:** cumplir la arquitectura obligatoria del curso en sus capas 3 (ESB) y transversal (bus de eventos), **sin cambiar lo que ven los clientes**: v1, v2 y Booking siguen viendo exactamente las mismas respuestas. Las suites reales y los recorridos actuales son la prueba de regresión de cada entrega.

---

## 1. Arquitectura objetivo al terminar F12b

```
Clientes ──REST──► API Gateway (capa 4: seguridad, validación, idempotencia, scheduler)
                        │ HTTP interno (llave interna)
                        ▼
                  esb-service (capa 3)
                  ├─ Conectividad: endpoint HTTP interno de operaciones con nombre
                  ├─ Mediación: Enrutador (un MS de gestión) · Orquestador de sagas (F12b-3)
                  └─ Integración externa: Booking (pagos, stock, eventos) con circuit breaker y kill-switch (F12b-3)
                        │ gRPC (TLS)
                        ▼
            Inventory · Pricing · Ancillaries · Reservation · Ticketing · Webhooks · Operations
            (desde F12b-3, sin llamarse entre sí)

esb-service ──outbox──► RabbitMQ (exchange de eventos) ──colas por propósito──► Webhooks ──► Booking y otros
```

## 2. Decisiones (ADR a crear)

| ID | Decisión | Entrega |
|---|---|---|
| ADR-F12b-01 | ESB propio NestJS en Cloud Run, en tres capas (conectividad, mediación, integración externa); la mediación se organiza en los dominios del contrato: Vuelos, Reservas, Postventa, Clientes, más Sistema (scheduler) | F12b-1 |
| ADR-F12b-02 | Gateway → ESB por HTTP interno autenticado con la llave interna actual; operaciones con nombre (`<dominio>.<operación>`); el ESB devuelve el código gRPC y el código del catálogo de cada error, para que el Gateway conserve su traducción a HTTP sin cambios | F12b-1 |
| ADR-F12b-03 | Vuelta atrás: `GATEWAY_TRANSPORT=esb\|grpc` (por defecto `esb`) hasta cerrar F12b-3 | F12b-1 |
| ADR-F12b-04 | Bus de eventos en RabbitMQ (CloudAMQP, plan gratuito), solo para eventos. Publicación con outbox en el esquema `esb`. **Consumo por lotes disparado por el scheduler** (basic.get), sin consumidores permanentes: sin costo extra y compatible con la plataforma apagada entre sesiones | F12b-2 |
| ADR-F12b-05 | Colas por propósito, reintentos acotados con espera creciente y cola de mensajes fallidos; consumidores idempotentes por id de evento | F12b-2 |
| ADR-F12b-06 | Esquema propio `esb` con usuario `svc_esb`, creados por el humano (local y Supabase); migraciones solo dentro del esquema | F12b-2 |
| ADR-F12b-07 | Sagas en el orquestador del ESB, con registro persistente de saga y pasos por `correlationId`, compensación en orden inverso y recuperación de pendientes; los microservicios quedan como dueños de sus datos y dejan de llamarse entre sí | F12b-3 |
| ADR-F12b-08 | Capa de integración externa: adaptador por socio (Booking), circuit breaker por socio y kill-switch configurable | F12b-3 |
| ADR-F12b-09 | Autenticación entre servicios sin cambios hasta terminar F12 (llave interna + identidad en metadatos) | F12b-1 |

## 3. Entregas

### F12b-1 — El ESB y su enrutador

**Objetivo:** todo acceso del Gateway a los microservicios (v1, v2, rutas admin y tareas del scheduler) pasa por el ESB. Las sagas siguen donde están (Reservation y Operations). No hay base de datos del ESB todavía.

| Bloque | Contenido |
|---|---|
| **0** | Inventario de **todas** las llamadas actuales del Gateway a los microservicios (método gRPC, quién la usa: v1, v2, admin, scheduler) y de las **composiciones** que hoy hace el Gateway (varias llamadas para una respuesta). Diseño del contrato HTTP interno (sobre de petición y respuesta, identidad, `X-Correlation-Id`, `Idempotency-Key`, plazo, errores) y catálogo de operaciones con nombre por dominio. ADR-F12b-01, 02, 03 y 09. **Lo aprueba el humano antes de escribir código.** |
| **A** | `microservices/esb-service` (NestJS): conectividad (`POST` interno de operaciones con nombre, llave interna, propagación de correlación, plazos), health (incluye a los siete servicios), logs por operación con nombre, resultado y latencia (preparados para la telemetría de F12d), Dockerfile, workflow `deploy-esb.yml`, `.env.example`. |
| **B** | Mediación: el **enrutador** con los clientes gRPC (se mueven del Gateway al ESB, sin duplicarlos), las composiciones que hoy hace el Gateway, la traducción de errores (código gRPC + código del catálogo) y la integración con la plataforma local (`local:up`, `local:health`, `local:journey` incluyen al ESB). |
| **C** | Gateway: transporte hacia el ESB detrás de `GATEWAY_TRANSPORT` (por defecto `esb`); el scheduler también va por el ESB; con `esb`, el Gateway no abre ninguna conexión gRPC a los microservicios (comprobado por prueba). |
| **D** | Pruebas: unitarias del ESB (enrutador, errores, plazos, identidad); **todas las suites reales del Gateway (v1 y v2) pasan sin cambiar sus aserciones con `GATEWAY_TRANSPORT=esb`**, dos veces seguidas; pruebas de falla (ESB caído ⇒ 503 con `Retry-After` y el código del catálogo vigente; servicio caído ⇒ la misma respuesta que hoy; plazo vencido); `local:journey` 31/31 con el ESB. |
| **E** | Despliegue (documentado, lo ejecuta el humano): cuenta de servicio y secretos del ESB, permisos para llamar a los siete servicios, ingreso del servicio (Render llega por internet, autenticado con la llave interna), variables nuevas de Render (`ESB_URL`, `GATEWAY_TRANSPORT`), precalentamiento actualizado y latencia medida en la nube. |

**Criterios de aceptación de F12b-1:** v1 y v2 responden igual (suites reales y matriz de autorización sin cambios); el Gateway no habla gRPC con `GATEWAY_TRANSPORT=esb`; el scheduler funciona a través del ESB; recorrido local 31/31; en la nube, health del ESB con los siete servicios y recorridos de regresión en verde.

### F12b-2 — El bus de eventos

| Bloque | Contenido |
|---|---|
| **0** | Diseño: eventos actuales (quién los emite y cómo llegan hoy a Webhooks), exchange y colas por propósito, claves de enrutamiento, formato (CloudEvents, con `correlationid`), reintentos y cola de fallidos. Esquema `esb` y usuario `svc_esb` (el agente agrega la sección a `infra/db/roles.sql` sin contraseñas; el humano los crea). |
| **A** | RabbitMQ local en `infra/docker-compose.yml`; outbox en el esquema `esb`; publicador por lotes (disparado por el scheduler). |
| **B** | Los servicios dejan de llamar a Webhooks: sus eventos llegan al ESB y salen por la outbox. Webhooks retira mensajes de su cola por lotes (disparado por el scheduler), entrega idempotente, reintentos y cola de fallidos. Feed `GET /vuelos/eventos` sin cambios observables. |
| **C** | Pruebas con RabbitMQ real local: publicación, consumo, idempotencia, reintentos, cola de fallidos, broker caído (los eventos esperan en la outbox, sin perderse), y regresión completa de webhooks v1 y v2. |
| **D** | Despliegue: cuenta de CloudAMQP (la crea el humano), secretos, variables, precalentamiento. |

### F12b-3 — El orquestador de sagas y la integración externa

| Bloque | Contenido |
|---|---|
| **0** | Diseño: cada saga actual (compra, emisión, maletas, cambio de asiento, cambio de fecha, cancelación, check-in, compensación por `payment.failed` y `package.cancelled`) con sus pasos y compensaciones; registro de sagas; cómo se migran las sagas en curso; integración con Booking (pagos, stock, eventos) con circuit breaker y kill-switch. |
| **A** | Orquestador en el ESB con registro persistente (saga y pasos por `correlationId`), compensación en orden inverso, idempotencia y recuperación de pendientes (reemplaza `ResumePending`). |
| **B** | Mudanza de las sagas de Reservation y Operations al orquestador; los microservicios exponen operaciones simples y dejan de llamarse entre sí. |
| **C** | Emisión como paso separado (`BOOKED` frente a `TICKETED`, sin cambiar lo observable para Booking), pago pendiente en postventa con reintento, `HELD` por asiento. |
| **D** | Pruebas de cada saga y de cada compensación, de la recuperación tras una caída a mitad de saga, y regresión completa (v1, v2, J1 a J7). |
| **E** | Despliegue; se retira `GATEWAY_TRANSPORT=grpc`. |

## 4. Reglas transversales

Las de `docs/plan/PLAN_F12_v2.md` (sección 9) y `AGENTS.md`: contratos OpenAPI intactos y `.proto` solo aditivos; v1 y v2 sin cambios observables; cada caso con su `it` e ID; datos por propiedad; dos ejecuciones seguidas; plazos propios; verificación de compilación desde clon limpio; sin secretos en git ni en logs; sin leer `.env` ni `.local/`; migraciones y esquemas: los crea/aplica el humano; sin procesos en segundo plano; sin `docker build` (lo verifica el humano); una cosa a la vez si la memoria es escasa.

## 5. Notas para el developer — F12b-1

```markdown
## Notas para esta fase: F12b-1 (el ESB y su enrutador)
Lee docs/plan/PLAN_F12b.md completo (secciones 1 a 4) y docs/plan/PLAN_F12_v2.md. F12a y F12a-2 están desplegadas en la nube. Trabaja SOLO en la rama feat/F12b1-esb; confírmalo al inicio y antes de cada commit. Crea tu bitácora en docs/dev/progress/.

Bloque 0 primero: inventario de llamadas y composiciones del gateway, contrato HTTP interno, catálogo de operaciones con nombre por dominio y ADR-F12b-01, 02, 03 y 09, en docs/dev/f12b1-diseno-esb.md. DETENTE y espera mi aprobación antes de escribir código.
Después, bloques A a E en orden, con commit `wip(esb): [F12b-1] <bloque>` al cierre de cada uno.

Alcance:
- Nuevo microservices/esb-service y cambios en platform/api-gateway (transporte), scripts/local-platform y docs/.
- Los clientes gRPC se MUEVEN del gateway al ESB; no se duplica lógica.
- Las sagas de reservation y operations NO se tocan en esta entrega (son F12b-3).
- Cambios en otros microservicios, contracts/ o packages/ solo si el bloque 0 aprobado lo exige; avísame antes. Los contratos OpenAPI no se modifican; los .proto solo aditivos.

Criterio central: con GATEWAY_TRANSPORT=esb, todas las suites reales del gateway (v1 y v2, más de 800 pruebas) y la matriz de autorización pasan SIN cambiar ninguna aserción, dos veces seguidas. Si alguna prueba necesita ajustes, solo de arranque (levantar el ESB en la composición), nunca de lo que comprueba.

Antes de "listo para auditoría (código)": lint, audit-policy, el CI de los workflows afectados (incluido el nuevo deploy-esb.yml) desde un clon limpio (dime la ruta para borrarlo), las suites reales del gateway (RUN_GATEWAY_REAL=true) con GATEWAY_TRANSPORT=esb dos veces seguidas y una vez con GATEWAY_TRANSPORT=grpc, la suite del ESB, y npm run local:up y local:journey con el perfil de prueba (31/31). Commit, SHA y "listo para auditoría (código)".
```
