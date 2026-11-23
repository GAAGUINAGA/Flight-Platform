# Decisiones del humano sobre el triaje del BACKLOG — 2026-11-22

Origen: `docs/dev/backlog-triaje-2026-11.md` (138 entradas, tabla de «Decisiones que necesitan al humano o a Booking»). Este documento fija lo decidido el 2026-11-22 y la verificación de los flujos con Booking. Entrega solo documental: no se cambió código, contratos ni migraciones.

## A. Regla permanente

> Ningún cambio puede modificar el contrato con Booking (`contracts/openapi/vuelos-openapi-v2.yaml`, la forma de los eventos y webhooks que reciben, ni el comportamiento que hoy observan). La plataforma se acoge a Booking. Si una mejora exige cambiar el contrato, no se hace: se registra en el BACKLOG como fuera de alcance.

Escrita en `AGENTS.md` (Reglas aprendidas), `docs/audit/context/PLAN.md` (§1.5) y `docs/audit/context/flujo-cierre.md`, donde la leen el developer y el auditor.

## B. Decisiones

| # | Decisión | Entradas | Efecto |
|---|---|---|---|
| 1 | La edad por tipo se mantiene: YOUTH 12–17, ADULT ≥ 18, medida al comprar. La plataforma se acoge a la regla de Booking (no se adopta PLAN Q-010). | B-002 | Cerrada como decidida. `AGE_RANGES` en `packages/shared/src/passenger-rules.ts` no cambia. |
| 2 | Sin instancias mínimas (proyecto académico, sin costo). Los 503 transitorios del escalado a cero quedan **aceptados**. Reintentos con espera en las tareas programadas: al BACKLOG con prioridad baja. | B-052 (y G2) | La decisión 2 del triaje queda resuelta; F12d no incluye instancias mínimas. |
| 3 | Sin automatizar el seed. Renovado el 2026-11-22, con vuelos hasta fines de enero de 2027. | B-042, B-076 (la rotación sigue pospuesta; ver BACKLOG) | Procedimiento actualizado en `docs/dev/supabase-seed-renewal.md`. Próxima renovación antes del 2027-01-07 (bitácora `2026-11-22_dev_seed-supabase_1.md`). |
| 4 | Se mantiene la regla actual para abrir vuelos: cada cabina con asientos necesita al menos una tarifa válida. | B-131, B-128 | Sin persistir el conjunto esperado de marcas. Quedan como límite conocido. |
| 5 | El índice único de vuelos **NO** se hace: cada vuelo ya tiene id único, la creación es idempotente, hay un solo administrador y requeriría una migración. | B-125 | Decidido no hacerlo (no era una de las 43 cerradas; queda anotado en el BACKLOG). |
| 6 | Ver C (verificación de los flujos con Booking). `booking.ticket_issuing` no se quita; solo se registra. | B-086 | Ver C y BACKLOG. |
| 7 | La regla A. | — | Ver A. |
| 8 | La cédula de 10 dígitos para Ecuador y los rangos de fechas de nacimiento y expiración quedan **solo en la web**. | B-007, B-009 | Cerradas como decididas; el servidor y el contrato no los imponen. |
| 9 | La búsqueda por PNR pasa a **disponibilidad**: si Operations no responde, se muestra la reserva con el check-in «desconocido». **Es código para una entrega posterior**; en esta no se tocó. | B-121 | BACKLOG: entrega de código pendiente (panel de administrador, no toca a Booking). |
| 10 | `HIDDEN_CABINS` se conserva como interruptor de emergencia. | B-134 | Documentado en `docs/dev/guia-operacion.md`. |
| 11 | Se actualiza el PLAN: GAP-025, `holdId` en `hold.expired`. | B-059 | Hecho: `PLAN.md` §1.3 (cuerpo real `{ holdId, status: "EXPIRED" }`, ADR-F11-13). |
| 12 | Orden de las ampliaciones: (1) catálogo de rutas, (2) cancelar reservas ajenas, (3) listado del registro de accesos. Premium y primera clase quedan **fuera de alcance**. | B-092, B-118, B-119, B-012 (siembra PREMIUM_ECONOMY y FIRST) | Prioridades anotadas en el BACKLOG. De B-012 sigue vigente solo la prueba de humo de BUSINESS con asiento. |
| 13 | La marca y las fotos no se tocan. | B-102 | Sin acción; el crédito visible sigue siendo obligatorio mientras las fotos sean provisionales. |
| 14 | Se cierran las 43 entradas (32 resueltas y 11 obsoletas del triaje). | ver D | Hecho en `BACKLOG.md`. |

### Consecuencias de la regla A sobre entradas abiertas (para que el humano las confirme)

El triaje propuso un grupo (G8) que cambia lo que Booking observa. Con la regla A **no deben implementarse** sin revisarlas una a una; mientras tanto no se tocan y el BACKLOG las marca como «sujeta a la regla A»:

| Entrada | Por qué toca a lo que Booking observa |
|---|---|
| B-011 (publicar el máximo de maletas) | Exige cambiar el contrato: fuera de alcance. |
| B-090 (`gate` en estado de vuelo y pases) | Agrega un campo a respuestas v2 que hoy no lo traen (el contrato lo declara, pero Booking observa su ausencia). |
| B-071 (202 con pago pendiente en equipaje y cambio de fecha) | Cambia el código de respuesta que hoy observan (422 `PAYMENT_NOT_AUTHORIZED`). |
| B-070 (`CHILDRE`/`TOTAL` en Pricing) | Solo es seguro si la salida v2 que ven queda idéntica (hoy el Gateway ya la normaliza). |
| B-112, B-033, B-093 | Internas (Pricing, proto aditivo, validación v1): permitidas mientras no cambien respuestas v2 ya observables. |

## C. Verificación de los flujos con Booking (solo lectura)

Método: lectura del contrato v2, del código y de las pruebas; **no se ejecutó ninguna prueba** y no se tocó nada. «Funciona» significa que el recorrido está implementado y cubierto por pruebas por tramos; «verificado en la nube» no se afirma (no se llamó a ningún despliegue).

Cadena común de eventos salientes: el servicio publica por el ESB (`esbEventClientFromEnv`, o gRPC directo si no hay `ESB_URL`: `reservation-service/src/main.ts:37`, `operations-service/src/main.ts:30-36`) → cola principal del bus con enlaces `booking.#`, `hold.#`, `flight.#` (`esb-service/src/domain/events.ts:8`) → Webhooks retira del bus y ejecuta el mismo `PublishEvent` (`webhooks-service/src/application/webhook-use-cases.ts:32-41, 52-81`) → registra el evento en el feed y crea una entrega por cada suscripción activa del dueño **o de su cliente** (`subscriberOwners`, `domain/webhook.ts:23`; `prisma-webhook-store.ts:10`) → entrega CloudEvents v1.0 firmado (`webhook-use-cases.ts:93-96`, `buildCloudEvent` en `domain/webhook.ts:31-40`). El feed `GET /api/v2/vuelos/eventos` lista por prefijo `<clientId>` y `<clientId>~*` (`api-gateway/src/v2/webhooks.controller.ts:57`; `prisma-webhook-store.ts:17`).

### (a) Avisar a Booking cuando se EMITEN los boletos — FUNCIONA

- Contrato v2: `booking.ticket_issued` / `booking.ticket_failed` (`vuelos-openapi-v2.yaml:124`, enum en `:3231-3232`; `POST /bookings` 202 `TICKET_ISSUING` y resultado por esos eventos, `:820`; `GET/POST …/tickets` «Emite `booking.ticket_issued`», `:918`).
- Código: `reservation-service/src/application/create-reservation.ts:114` (`booking.ticket_issued`, solo si la reserva es v2: `allocation.ts:68`, `isV2Reservation`), `resume-pending.ts:64` (emisión diferida) y `resume-pending.ts:57` (`booking.ticket_failed`, `TICKET_ISSUANCE_FAILED`). Ids deterministas (`deterministicEventId`) para deduplicar.
- Pruebas: `api-gateway/test/e2e/v2/p2-booking.e2e.spec.ts:37-40` (V2-P2-36: publica `booking.confirmed` y `booking.ticket_issued` como CloudEvents válidos solo al cliente dueño); `webhooks-service/test/unit/webhook-v2.spec.ts:62` y `test/integration/webhooks-v2.spec.ts:62`; `esb-service/test/e2e/bus-end-to-end.spec.ts` (bus→webhooks→entrega).
- Límite (no cambia el contrato): la publicación de `ticket_issued` es de mejor esfuerzo (`.catch(() => undefined)`); si falla, ese evento no se registra y no hay reintento propio. El comentario del código lo atribuye al «reintento de Booking»; corregirlo (reintentar desde Reservation o el planificador) **no cambiaría el contrato**.

### (b) Avisar cuando la RESERVA se confirma — FUNCIONA

- Contrato v2: `booking.confirmed` (`:123`, `:3224`; «Emite `booking.confirmed`», `:821`).
- Código: `create-reservation.ts:112` (camino síncrono, tras emitir los boletos) y `resume-pending.ts:63` (camino diferido tras `resumeReservation`, por ejemplo vía `payment.confirmed` de Booking en `api-gateway/src/v2/booking-events.controller.ts:76-83`). Con pago pendiente (`create-reservation.ts:100`) no se emite hasta que se resuelve.
- Pruebas: V2-P2-36 (arriba); `api-gateway/test/e2e/real-stack.e2e.spec.ts:319` y `:524` (entrega de `booking.confirmed` contra el stack real); `webhooks-service/test/unit/webhook-v2.spec.ts:38` (CloudEvent con `bookingId`, `pnr`, `status`).
- Límite: igual que (a), `booking.failed` se publica en compensación con `compensate(...)` de mejor esfuerzo.

### (c) Ofrecer nuestros VUELOS disponibles (búsqueda v2) — FUNCIONA

- Contrato v2: `POST /vuelos/search` (`:433`), `GET /vuelos/offers/{offerId}/seatmap` (`:472`), `GET /vuelos/flights/{flightNumber}/status` (`:505`), y el stock hacia Booking por gRPC (`ADR-F12-08`).
- Código: `api-gateway/src/v2/shopping.controller.ts:54-56` (rutas públicas), búsqueda en Pricing/Inventory con día local del aeropuerto de salida (`packages/shared/src/airport-time.ts`; ADR-F12b1fix-02) y `HIDDEN_CABINS` sin efecto cuando está vacía (`shopping.controller.ts:29-36`).
- Pruebas: `api-gateway/test/e2e/v2/p2-shopping.e2e.spec.ts` (56 referencias), `c-multi-offers.e2e.spec.ts`, `cabin-purchase.e2e.spec.ts`, `held-seats.e2e.spec.ts`. Evidencia real: la bitácora `2026-11-22_dev_seed-supabase_1.md` registra la búsqueda pública v2 UIO→GYE del 2027-01-15 con 2 ofertas (ECONOMY y BUSINESS), gateway 200.
- Dependencia operativa: depende del seed vigente (hasta fines de enero de 2027; ver `supabase-seed-renewal.md`).

### (d) Avisar del CHECK-IN hecho desde NUESTRO panel de la aerolínea (F12c-4b) — FUNCIONA (por tramos; sin prueba que encadene todo)

- Contrato v2: `booking.checked_in` está en la lista de eventos (`:127`, enum `VuelosEventName` en `:3233`, esquema `EventCheckedIn` en `:3444-3457`). Está en la lista permitida de suscripción de webhooks de Webhooks (`webhooks-service/src/domain/webhook.ts:3`, `WEBHOOK_EVENTS`), por lo que el socio puede suscribirse; el enlace `booking.#` del bus lo enruta (`esb-service/src/domain/events.ts:8`).
- Código: `operations-service/src/application/admin-airline-check-in.ts:18-25` recibe solo el PNR, resuelve el dueño real con Reservation (`adminResolveBookingOwner`, devuelve el `ownerId` guardado, incluido el compuesto `<clientId>~<usuario>`: `reservation-service/test/f12c4b-resolve-owner.spec.ts:20-23`) y ejecuta el **mismo** `CheckInUseCase` del cliente, que publica `booking.checked_in` con ese dueño (`check-in.ts:34` y `:98`). Webhooks lo entrega a la suscripción del cliente `booking` (`subscriberOwners`) y lo lista en `GET /vuelos/eventos` (prefijo del cliente).
- Pruebas: `operations-service/test/f12c4b-admin-airline-check-in.spec.ts:43-51` (OPS-AC-01: publica con el dueño real; el evento no lleva al administrador); `reservation-service/test/f12c4b-resolve-owner.spec.ts`; `webhooks-service/test/integration/webhooks-v2.spec.ts:34` (WHK-V2-IT-02) y `test/unit/webhook-v2.spec.ts:79` (WHK-V2-09): la suscripción del cliente recibe `<clientId>~*`; `esb-service/test/e2e/bus-end-to-end.spec.ts:63-99` (`booking.checked_in` por el bus hasta el webhook v2 y el feed); `api-gateway/test/e2e/v2/p4-postsale.e2e.spec.ts:219-224` (V2-P4-50, check-in del cliente por v2 y evento en el feed).
- Qué falta (no se corrige aquí):
  1. **No hay una prueba que encadene** el check-in del panel con un dueño compuesto `booking~<usuario>` hasta el webhook o feed del socio: OPS-AC-01 usa un dueño simple (`partner-owner-777`) y la entrega al cliente por prefijo se prueba aparte. Por lectura el recorrido es correcto. Agregar esa prueba **no cambia el contrato**.
  2. **El cuerpo del evento no trae `status`**, que `BookingEventData` declara obligatorio (`:3307-3309`), ni `passengersCheckedIn` (opcional, `:3457`). Operations publica `data = { bookingId, pnr }` (`operations-service/src/infrastructure/adapters/grpc-adapters.ts:64`); el CloudEvent entregado sale con `bookingId`, `pnr` y `ownerId` (por lectura de `buildCloudEvent`, `domain/webhook.ts:31-40`, que no agrega `status`; `bus-end-to-end.spec.ts:99` comprueba `{ bookingId, pnr }` sin cubrir `status`). Es el mismo cuerpo para el check-in del cliente y el de la aerolínea, y es lo que Booking observa hoy. **Completarlo sí cambiaría lo que Booking recibe** (campo nuevo en el evento) y por la regla A **no se hace**: queda en el BACKLOG como fuera de alcance, para consultarlo con Booking si lo piden.

### `booking.ticket_issuing` (solo registro)

Booking no lo pidió. Está en el enum del contrato (`:3230`, «se mantiene por compatibilidad con v1», `:3219`) y en la lista permitida (`webhook.ts:3`), pero ningún servicio lo emite (`grep` en `microservices/*/src` y `platform/*/src`: solo hay definiciones, sin `publish`). **No se quita** (podría cambiar lo que observan un suscriptor que lo haya registrado). Reservation sí usa el estado `TICKET_ISSUING` (`create-reservation.ts:101`), pero sin evento. Anotado en el BACKLOG.

### Resumen de C

| Flujo | ¿Funciona hoy? | Qué falta | ¿Corregirlo cambiaría el contrato (regla A)? |
|---|---|---|---|
| (a) boletos emitidos | Sí | Publicación de mejor esfuerzo, sin reintento propio | No |
| (b) reserva confirmada | Sí | Nada | — |
| (c) vuelos disponibles (búsqueda v2) | Sí | Nada (depende del seed vigente) | — |
| (d) check-in desde el panel | Sí, por tramos | Prueba de punta a punta con dueño compuesto; el cuerpo no trae `status` | Prueba: no. Agregar `status`: **sí** (no se hace) |
