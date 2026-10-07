# Flight Platform — Investigación, Ingeniería Inversa Funcional y Diseño Arquitectónico Base

Sep 28, 2026 · @Gabato

## 1. Executive Summary

Flight Platform es un PSS propio (shopping, inventario, reservas, emisión, postventa, check-in y estado de vuelo) expuesto por un único API Gateway REST definido por el OpenAPI "GDS Flight Core API" v1.5.0.0, con 23 operaciones sobre 19 paths. Internamente se propone un MVP de **6 bounded contexts desplegables** más el Gateway, comunicados por gRPC (síncrono) y un bus de eventos privado (asíncrono).

**Decisiones centrales propuestas (PROPUESTO):**

- **Pricing & Fares posee `Offer`** (incluye `offerId`, snapshot de itinerarios, fare brands, precio por tipo de pasajero y TTL de oferta). Inventory no conoce precios.
- **Inventory & Schedule posee `FlightInstance`, `SeatInventory` e `InventoryHold`**. El hold es un contrato de capacidad; el precio congelado (`lockedPrice`) es un `PriceLock` de Pricing referenciado por `holdId`.
- **Flight Reservation / CRS posee `FlightReservation` (el recurso público `/bookings`), `PNR` y el `Passenger` del dominio aéreo**, y orquesta la Saga reserva → pago → emisión.
- **Ticketing / Fulfilment se separa desde el MVP**: tiene lifecycle propio (`Ticket`, `TicketCoupon`), requisitos de idempotencia estrictos y estados parciales que el contrato expone explícitamente.
- **Ancillaries posee `SeatAssignment` y `BaggageEntitlement`/`BaggagePurchase`**. El seat map público se sirve desde Ancillaries con disponibilidad de asientos físicos propia.
- **Departure Control (Check-in / Boarding Pass) y Flight Operations se mantienen inicialmente dentro de un mismo contexto "Operations & Departure"**; se separan en post-MVP si la carga o el ownership lo justifican.
- **Webhook Delivery es un componente de soporte MVP**, consumidor del bus interno y única vía de salida asíncrona hacia Booking Platform u otros consumidores.

**Hallazgos críticos del contrato:** 31 OpenAPI Gaps registrados (sección 28). Los que bloquean desarrollo: ausencia de moneda/punto de venta en `/search`, `/offers/{offerId}/seatmap` público pese a declarar que el asiento se selecciona según la cabina adquirida, `POST /bookings/{id}/check-in` sin cuerpo (no permite seleccionar pasajeros/segmentos), respuestas `202` y `200` sin schema en baggage/date-change/cancel, `status` de `/bookings` sin enum, ausencia de 401/403/404 en muchas operaciones, y el uso del término "GDS" en respuestas cuando el sistema es el propio PSS.

**Consistencia:** fuerte y local en Inventory (holds, último asiento) y Ancillaries (asignación de asientos); eventual entre contextos mediante Outbox/Inbox. La creación de reserva es una **Saga orquestada** por Flight Reservation, porque el contrato expone estados intermedios (`PENDING_PAYMENT`, `TICKET_ISSUING`, `FAILED`) y compensaciones (liberar hold, anular tickets).

**Estado del análisis:** el documento permite construir el plan de ejecución, salvo las decisiones listadas en la sección 25 marcadas como bloqueantes (moneda, TTLs, proveedor de pagos, política de check-in, broker de eventos). Deben resolverse antes de crear las tareas que dependen de ellas; el resto del sistema puede planificarse ya.

## 2. Scope and System Boundaries

Flight Platform es dueña de todo el dominio aéreo expuesto por el OpenAPI y de nada fuera de él: pagos, identidad, clientes, facturación y reembolsos monetarios pertenecen a otras plataformas (DOCUMENTADO en `info.description` del contrato).

```text
┌────────────────────────── Consumidores externos ──────────────────────────┐
│ Booking Platform · Web client · Mobile client · Integraciones B2B · Ops   │
└───────────────┬────────────────────────────────────────▲──────────────────┘
                │ HTTPS / REST / JSON (OpenAPI)          │ Webhooks HTTP firmados
┌───────────────▼────────────────────────────────────────┴──────────────────┐
│                         FLIGHT PLATFORM                                    │
│  API Gateway (frontera pública, authN/authZ, idempotencia, rate limit)     │
│        │ gRPC / Protobuf                                                   │
│        ▼                                                                   │
│  Inventory & Schedule │ Pricing & Fares │ Flight Reservation / CRS         │
│  Ticketing            │ Ancillaries     │ Operations & Departure           │
│  Webhook Delivery (soporte)                                                │
│        ▲▼ Bus de eventos privado (Kafka o RabbitMQ) + Outbox/Inbox          │
│  Una base de datos por servicio                                           │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ REST saliente (anti-corruption layer)
       Payment API (externa) · Authorization Server (externo)
```

| Pertenece a Flight Platform | NO pertenece a Flight Platform |
| --- | --- |
| Horarios, instancias de vuelo, capacidad por cabina | Procesamiento de tarjetas, 3DS, autorización, captura |
| Ofertas, fare brands, reglas tarifarias, precio congelado | Emisión de reembolsos monetarios y facturación |
| Holds de inventario y su expiración | Identidad, login y emisión de JWT (Authorization Server) |
| Reserva aérea (`/bookings`), PNR, pasajeros del viaje | Perfil de cliente / CRM |
| Emisión, estado y anulación de tickets | Carrito multiproducto (hoteles, autos, seguros) de Booking Platform |
| Asientos y equipaje adicional | Notificaciones al pasajero final (email/SMS), salvo decisión contraria (Q-017) |
| Check-in, boarding pass, estado operacional del vuelo | Sistemas de aeropuerto (DCS físico, BRS), APIS a gobiernos (post-MVP) |
| Suscripciones y entrega de webhooks | Consumo directo de gRPC, bases o bus por parte de terceros |

**Reglas de frontera (PROPUESTO, derivadas del mandato):**

- Booking Platform es un cliente más del API Gateway; se autentica con `clientCredentials` (B2B) o actúa en nombre de un usuario vía `authorizationCode`. Nunca ve IDs internos que no estén en el contrato.
- El término `booking` del OpenAPI significa **reserva aérea**. El servicio interno se llama **Flight Reservation / CRS Service** y su agregado `FlightReservation`; el recurso REST conserva el nombre `/bookings` porque el contrato manda.
- El servidor declarado `api.booking-hub.com/flights/v1` es solo el host público; no implica que Booking Platform aloje Flight Platform (ver GAP-001).
- La salida asíncrona hacia terceros es exclusivamente por webhooks; el bus de eventos nunca se expone.
- La Payment API es una dependencia externa consultada por REST desde Flight Reservation (y Ancillaries en postventa) a través de un adaptador anti-corrupción; Flight Platform solo guarda `paymentReference` y el resultado de su validación.

## 3. Source Analysis

Las cuatro aerolíneas confirman los conceptos que el contrato ya modela (fare brands con reglas de cambio/reembolso y equipaje, hold con TTL, infante en brazos de un adulto, ventana de check-in); ninguna fuente revela su arquitectura interna y no se asume.

**Evidencia OBSERVADA:** ninguna todavía. No se capturaron UI, HAR ni Fetch/XHR en esta etapa; cuando se entreguen, se añadirán como fila nueva y podrán reclasificar hallazgos INFERIDOS.

| # | Fuente | Tipo | Hallazgo | Impacto en Flight Platform |
| --- | --- | --- | --- | --- |
| S-01 | OpenAPI GDS Flight Core API v1.5.0.0 | DOCUMENTADO (fuente de verdad) | 23 operaciones, 24 códigos de error, 12 tipos de webhook, pagos solo por `paymentReference` | Define el alcance MVP completo |
| S-02 | [Avianca — tipos de tarifas](https://www.avianca.com/us/es/experiencia/comprar-en-avianca/tarifas/tipos-de-tarifas/) | DOCUMENTADO | Familias Basic/Light, Classic, Flex, Business; solo Flex y Business Flex cambian sin cargo antes del vuelo; ninguna tarifa reembolsa después del vuelo salvo eventos operacionales | `FareBrand` debe portar reglas de cambio, reembolso, penalidad y ventana temporal, no solo dos booleanos (GAP-015) |
| S-03 | [Avianca — check-in](https://ayuda.avianca.com/hc/es/articles/13083717654811--C%C3%B3mo-puedo-hacer-check-in) | DOCUMENTADO | Online desde 48 h (24 h a/desde EE. UU., Puerto Rico, Canadá); cierre 60 min internacional y 45 min nacional | La ventana de check-in es regla por ruta/país, no una constante (Q-012) |
| S-04 | [Avianca Trade — check-in](https://aviancatrade.zendesk.com/hc/es/articles/11585800258331--C%C3%B3mo-puedo-hacer-check-in) | DOCUMENTADO | Online no disponible con servicios especiales, código compartido o más de dos conexiones | Elegibilidad de check-in depende de operating carrier y SSR → `NOT_ELIGIBLE` |
| S-05 | [Iberia — prerreserva](https://www.iberia.com/us/prerreserva/) | DOCUMENTADO | Mantiene precio 24 h gratis o 72 h con señal; se cancela automáticamente al vencer; recordatorio 12 h antes | Valida el patrón hold + precio congelado + expiración automática; la señal pagada queda fuera del contrato actual |
| S-06 | [Iberia — condiciones de compra](https://www.iberia.com/es/informacion-legal/condiciones-adicionales/) | DOCUMENTADO | El periodo de retención varía por país de salida entre 24 y 72 h | El TTL del hold debe ser configurable por mercado/ruta (Q-004) |
| S-07 | [Iberia — niños y bebés](https://www.iberia.com/us/viajar-con-iberia/ninos-y-bebes/) | DOCUMENTADO | Infante (<2 años al finalizar el viaje) sin asiento; si cumple 2 antes del regreso debe emitirse como niño | Tipo de pasajero se valida contra la fecha del último segmento, no la de compra |
| S-08 | [Copa — bebés](https://www.copaair.com/es/web/cr/viajando-con-infantes) | DOCUMENTADO | Infante 0–23 meses, siempre con adulto, sin asiento; un adulto con más de un bebé debe comprar asiento para el adicional; no se aceptan menores de 7 días | Invariantes INV-RES-03/04/05 (1 infante en brazos por adulto; edad mínima) |
| S-09 | [Copa — reservas niños e infantes](https://help.copaair.com/hc/es-419/articles/360051190434-Reservaciones-para-pasajeros-ni%C3%B1os-e-infantes) | DOCUMENTADO | Hasta 8 pasajeros por transacción (infantes no cuentan), hasta 9 por PNR; niño 2–11 años | Límite de pasajeros por solicitud ausente en `PassengerBreakdown` (GAP-006) |
| S-10 | [Copa — familias tarifarias](https://help.copaair.com/hc/es-419/articles/360051189074--Cu%C3%A1les-son-las-tarifas-que-ofrece-Copa-Airlines) | DOCUMENTADO | Basic/Classic/Full: equipaje, selección de asiento con o sin cargo, cambios con cargo o sin cargo, reembolsable o no | Seat selection y equipaje son atributos del brand; el contrato no expone precio de asiento |
| S-11 | [LATAM — tarifas nacionales/regionales](https://www.latamairlines.com/cl/es/centro-ayuda/preguntas/compras/asistencia/tarifas-pasaje-domestico) | DOCUMENTADO | Basic/Light/Full y Premium; cambios deben hacerse antes del primer vuelo del itinerario; puede aplicar diferencia tarifaria | Regla FARE-CHG-01: cambio solo antes de la salida del primer segmento no volado |
| S-12 | [LATAM — check-in](https://www.latamairlines.com/us/es/centro-ayuda/preguntas/check-in/automatico/disponible-pasajeros) | DOCUMENTADO | Online entre 48 h y 2 h antes; check-in automático en nacionales vendidos directo; vuelos operados por otra aerolínea tienen reglas distintas | Check-in automático es POST-MVP; operating carrier ≠ marketing carrier afecta elegibilidad |
| S-13 | [LATAM — check-in no disponible](https://www.latamairlines.com/us/es/centro-ayuda/preguntas/check-in/automatico/no-disponible) | DOCUMENTADO | Tras cambio de hora o cancelación debe revisarse primero la nueva opción de vuelo | Schedule change bloquea check-in hasta que la reserva se reacomode (INV-DEP-04) |

**INFERIDO (no verificado en tráfico real):**

- Todas las aerolíneas separan "búsqueda con precio orientativo" de "precio confirmado" al retener o pagar; por eso el contrato distingue `grandTotal` de oferta y `lockedPrice` de hold.
- Cambio y cancelación se cotizan con una oferta de vida corta (`changeOfferId`, `quoteId` con `expiresAt`), igual que la búsqueda original.
- La emisión es asíncrona respecto del pago en canales indirectos; el contrato lo refleja con `202` y `TICKET_ISSUING`.

**Conceptos de negocio presentes en las aerolíneas y ausentes del contrato (no se agregan al MVP):** señal pagada por hold extendido, check-in automático, menor no acompañado, SSR (asistencia especial, mascotas), selección de asiento pagada, upgrades, millas, reembolso solo de tasas. Se registran como POST-MVP o preguntas abiertas.

## 4. OpenAPI Contract Assessment

El contrato es implementable para el MVP, pero 7 de sus 23 operaciones tienen respuestas sin schema o sin códigos de error necesarios, y la mitad de los flujos asíncronos no tienen forma de consulta más allá de webhooks. La tabla es el inventario de referencia para contract tests.

| ID | Método | Path | Auth / scope | Idempotency-Key | Respuestas declaradas | Owner propuesto |
| --- | --- | --- | --- | --- | --- | --- |
| OP-01 | POST | `/search` | Pública + `X-Device-Fingerprint` | No | 200, 400, 429 | Pricing & Fares |
| OP-02 | GET | `/offers/{offerId}/seatmap` | Pública | No | 200, 404, 429 | Ancillaries |
| OP-03 | POST | `/offers/hold` | `flights:hold` | Sí (uuid) | 201, 400, 409, 422 | Entrada: Pricing (Offer Mgmt); agregado: Inventory |
| OP-04 | GET | `/offers/hold/{holdId}` | `flights:read` | No | 200, 404 | Entrada: Pricing (Offer Mgmt); agregado: Inventory |
| OP-05 | DELETE | `/offers/hold/{holdId}` | `flights:hold` | No | 204, 404 | Entrada: Pricing (Offer Mgmt); agregado: Inventory |
| OP-06 | GET | `/bookings` | `flights:read` | No | 200 | Flight Reservation |
| OP-07 | POST | `/bookings` | `flights:book` | Sí | 201, 202, 400, 409, 410, 422 | Flight Reservation |
| OP-08 | GET | `/bookings/{bookingId}` | `flights:read` | No | 200, 404 | Flight Reservation |
| OP-09 | GET | `/bookings/{bookingId}/baggage-options` | `flights:read` | No | 200 | Ancillaries |
| OP-10 | POST | `/bookings/{bookingId}/baggage` | `flights:book` | Sí | 200, 202 (sin body), 409 | Ancillaries |
| OP-11 | POST | `/bookings/{bookingId}/date-change/search` | `flights:read` | No | 200, 409 | Flight Reservation (con Pricing) |
| OP-12 | POST | `/bookings/{bookingId}/date-change` | `flights:book` | Sí | 200, 202 (sin body), 409, 410 | Flight Reservation |
| OP-13 | GET | `/bookings/{bookingId}/cancellation-quote` | `flights:read` | No | 200 | Flight Reservation |
| OP-14 | POST | `/bookings/{bookingId}/cancel` | `flights:cancel` | Sí | 200 (sin body), 202 (sin body), 409 | Flight Reservation |
| OP-15 | GET | `/webhooks` | `flights:webhooks` | No | 200 | Webhook Delivery |
| OP-16 | POST | `/webhooks` | `flights:webhooks` | No | 201 + callback `WebhookPayload` | Webhook Delivery |
| OP-17 | DELETE | `/webhooks/{id}` | `flights:webhooks` | No | 204 | Webhook Delivery |
| OP-18 | GET | `/bookings/{bookingId}/tickets` | `flights:read` | No | 200, 404 | Ticketing |
| OP-19 | GET | `/bookings/{bookingId}/tickets/{ticketId}` | `flights:read` | No | 200, 404 | Ticketing |
| OP-20 | POST | `/bookings/{bookingId}/check-in` | `flights:book` | No | 200, 409, 422 | Operations & Departure |
| OP-21 | GET | `/bookings/{bookingId}/boarding-passes` | `flights:read` | No | 200, 404 | Operations & Departure |
| OP-22 | GET | `/flights/{flightNumber}/status` | Pública | No | 200, 404 | Operations & Departure |
| OP-23 | — | Callback `{$request.body#/url}` | Firma con `secret` (no especificada) | `eventId` | 200 esperado | Webhook Delivery |

**Fortalezas del contrato (DOCUMENTADO):** separación explícita de pagos mediante `PaymentReference` con `additionalProperties: false`; `ownerId` derivado del `sub` del JWT y nunca aceptado del cliente; `Idempotency-Key` obligatorio en las mutaciones monetarias; errores en RFC 7807 (`application/problem+json`) con un `code` cerrado de 24 valores; estados parciales de ticket por segmento; `Retry-After` en 409 y 429.

**Debilidades estructurales (resumen; detalle en sección 28):**

- Estados asíncronos sin recurso de seguimiento: los `202` de baggage, date-change y cancel no devuelven cuerpo; el cliente solo puede releer `GET /bookings/{id}` o esperar webhooks.
- Semántica de estados incompleta: `BookingDetail.status` tiene enum, pero `GET /bookings?status` y `BookingListResponse.status` no; `PENDING` y `PENDING_PAYMENT` no tienen diferencia definida.
- Errores faltantes: no hay 401 en ninguna operación, `ProblemDetails403` está definido pero no se usa, y faltan códigos para hold expirado/consumido y reutilización de `Idempotency-Key` con otro payload.
- `ProblemDetails` con `additionalProperties: false` impide añadir `traceId`/`correlationId` al cuerpo; la correlación debe viajar en headers (PROPUESTO, sección 19).
- Referencias a "GDS" (título, descripción del 202 de baggage) contradicen que Flight Platform sea el PSS; se tratan como lenguaje heredado hasta resolver Q-001.

**Mapeo `code` → HTTP asumido (PROPUESTO, debe validarse con el API owner, Q-031):**

| HTTP | Códigos |
| --- | --- |
| 400 | `VALIDATION_FAILED` |
| 409 | `SEAT_TAKEN`, `OFFER_NO_LONGER_AVAILABLE`, `BOOKING_NOT_CONFIRMED`, `ALREADY_CANCELLED`, `TICKET_ALREADY_ISSUED`, `BAGGAGE_LIMIT_EXCEEDED`, `FARE_NOT_CHANGEABLE`, `FLIGHT_ALREADY_DEPARTED`, `CUTOFF_PASSED`, `CHECK_IN_NOT_AVAILABLE` |
| 410 | `CHANGE_OFFER_EXPIRED`, `QUOTE_EXPIRED`, hold expirado (sin código propio, GAP-031) |
| 422 | `INFANT_SEAT_NOT_ALLOWED`, `SEAT_CABIN_MISMATCH`, `PAYMENT_REFERENCE_INVALID`, `PAYMENT_NOT_AUTHORIZED`, `AMOUNT_MISMATCH`, `CHECK_IN_FAILED` |
| 404 | `BOARDING_PASS_NOT_AVAILABLE`, `FLIGHT_STATUS_NOT_AVAILABLE` (además del 404 genérico) |
| 429 | `RATE_LIMIT_EXCEEDED` |
| 201/202 + estado `FAILED` | `PNR_CREATION_FAILED`, `TICKET_ISSUANCE_FAILED` (expuestos en `failureReason` o ProblemDetails si falla antes de persistir) |

## 5. Functional Capability Map

El OpenAPI cubre 12 capacidades de negocio; cada una tiene un único contexto propietario. Las capacidades sin endpoint (gestión de horarios y tarifas, operación de vuelos) existen como procesos internos o de carga, y su interfaz de administración queda fuera del contrato público (Q-016).

| ID | Capacidad | Operaciones | Contexto propietario | Clasificación |
| --- | --- | --- | --- | --- |
| CAP-01 | Flight shopping (búsqueda multidestino con precios por brand) | OP-01 | Pricing & Fares (lee disponibilidad de Inventory) | MVP REQUIRED |
| CAP-02 | Seat map de la oferta | OP-02 | Ancillaries | MVP REQUIRED |
| CAP-03 | Retención de inventario con precio congelado | OP-03, OP-04, OP-05 | Inventory & Schedule (precio: Pricing) | MVP REQUIRED |
| CAP-04 | Creación de reserva aérea y PNR | OP-07 | Flight Reservation / CRS | MVP REQUIRED |
| CAP-05 | Emisión y consulta de tickets | OP-07 (disparo), OP-18, OP-19 | Ticketing | MVP REQUIRED |
| CAP-06 | Consulta de reservas del owner | OP-06, OP-08 | Flight Reservation / CRS | MVP REQUIRED |
| CAP-07 | Equipaje adicional (en compra y postventa) | OP-07 (extraBaggage), OP-09, OP-10 | Ancillaries | MVP REQUIRED |
| CAP-08 | Cambio de fecha | OP-11, OP-12 | Flight Reservation / CRS (Pricing cotiza, Inventory retiene, Ticketing reemite) | MVP REQUIRED |
| CAP-09 | Cancelación con cotización | OP-13, OP-14 | Flight Reservation / CRS (Pricing calcula penalidad) | MVP REQUIRED |
| CAP-10 | Check-in y boarding pass | OP-20, OP-21 | Operations & Departure | MVP REQUIRED |
| CAP-11 | Estado de vuelo y cambios operacionales | OP-22, eventos `flight.*` | Operations & Departure (Schedule en Inventory) | MVP REQUIRED |
| CAP-12 | Suscripción y entrega de webhooks | OP-15, OP-16, OP-17, OP-23 | Webhook Delivery | MVP REQUIRED |
| CAP-13 | Carga de horarios y capacidad (schedule ingestion) | Sin endpoint público | Inventory & Schedule | MVP SUPPORTING |
| CAP-14 | Carga de tarifas, brands y reglas (fare filing) | Sin endpoint público | Pricing & Fares | MVP SUPPORTING |
| CAP-15 | Expiración automática de holds y ofertas | Sin endpoint (proceso) | Inventory / Pricing | MVP SUPPORTING |
| CAP-16 | Reacomodo por schedule change / cancelación de vuelo | Solo webhooks `flight.*`, `booking.changed` | Flight Reservation (reacciona a Operations) | MVP SUPPORTING (notificación) / POST-MVP (reacomodo automático) |
| CAP-17 | Idempotencia, rate limiting, autenticación | Transversal | API Gateway | MVP SUPPORTING |

La selección de asientos durante la compra (`assignedSeats` en OP-07) forma parte de CAP-02/CAP-07 bajo Ancillaries aunque llegue por el endpoint de reservas; Flight Reservation solo la orquesta.

## 6. End-to-End Business Flows

El journey principal cruza cinco contextos y tiene un solo punto de consistencia fuerte obligatorio: la creación del hold en Inventory. Todo lo posterior al hold es una Saga orquestada por Flight Reservation. Notación: `→` gRPC síncrono, `⇒` evento asíncrono, `⇢` REST externo.

### 6.1 Shopping (Search → Availability → Itinerary → Fare selection → Offer)

```text
Cliente ⇢ Gateway POST /search
Gateway → Pricing.SearchOffers(itineraries, pax, currency?)
  Pricing → Inventory.QueryAvailability(O&D, fecha, cabinas)   # instancias + asientos vendibles por cabina/booking class
  Pricing: combina itinerarios (directos + conexiones válidas por MCT), aplica fare brands y reglas,
           calcula precio por tipo de pasajero, persiste snapshot Offer (TTL corto)
Gateway ⇠ SearchResponse(offers[offerId, itineraries[pricingOptions[cabin, brand, availableSeats, precio]]])
```

La oferta es un snapshot con precio orientativo; `availableSeats` es informativo y puede estar desactualizado al retener (INFERIDO de S-05/S-06; PROPUESTO como regla).

### 6.2 Inventory (Offer → Hold → Expiration / Release / Consumption)

```text
Cliente ⇢ POST /offers/hold (Idempotency-Key)
Gateway → Pricing.HoldOffer(offerId, selecciones, pax, owner, idemKey)   # use case de Offer Management
  Pricing: valida oferta vigente, brand/cabina seleccionados, breakdown coherente con la oferta
  Pricing → Inventory.CreateHold(segmentos, cabina, booking class, nPaxConAsiento, owner, ttl)   # transacción local, decremento atómico
  Pricing: crea PriceLock(holdId, lockedPrice, expiresAt)            # si falla → Inventory.ReleaseHold (compensación)
Gateway ⇠ 201 HoldResponse(holdId, HELD, expiresAt, ttlMinutes, lockedPrice)

TTL vencido: Inventory expira hold ⇒ InventoryHoldExpired ⇒ Pricing (PriceLock EXPIRED), Webhook(hold.expired)
DELETE: Pricing.ReleaseOfferHold → Inventory.ReleaseHold ⇒ InventoryHoldReleased
Reserva: Flight Reservation → Inventory.ConsumeHold ⇒ InventoryHoldConsumed
```

Decisión (PROPUESTO, ADR-06): el use case de hold vive en Pricing & Fares como **Offer Management**, porque la respuesta combina estado de capacidad (Inventory) y precio congelado (Pricing). La dirección Pricing → Inventory ya existe por la búsqueda; ponerlo en Inventory crearía el ciclo Inventory → Pricing → Inventory. El agregado `InventoryHold` sigue siendo exclusivo de Inventory.

### 6.3 Reservation + Ticketing (Hold → Passenger data → Reservation → PNR → Payment → Ticket)

```text
Cliente ⇢ POST /bookings (Idempotency-Key, holdId, passengers, payment.paymentReference)
Gateway → FlightReservation.CreateReservation(owner=sub, ...)
  FR → Inventory.GetHold(holdId)           # HELD, owner, pax, no expirado  → si no: 410/409
  FR → Pricing.GetPriceLock(holdId)        # lockedPrice + precio de extras (equipaje)
  FR: valida pasajeros vs breakdown, infantes, documentos; crea FlightReservation(PENDING) + PNR; Outbox
  FR → Ancillaries.ReserveSeats/Baggage(reservationId, ...)   # si vienen assignedSeats/extraBaggage
  FR ⇢ Payment API: validar paymentReference (estado, monto, moneda, owner)
       ├─ no válido  → FAILED/422, compensar (liberar asientos; hold sigue HELD hasta TTL)
       ├─ pendiente  → PENDING_PAYMENT, 202
       └─ autorizado → Inventory.ConsumeHold → TICKET_ISSUING ⇒ TicketIssuanceRequested
  Ticketing ⇐ TicketIssuanceRequested: emite ticket por pasajero y cupón por segmento
       ⇒ TicketsIssued | TicketIssuancePartiallyFailed | TicketIssuanceFailed
  FR ⇐ resultado: CONFIRMED | FAILED (compensación: void tickets, liberar inventario, notificar refund)
Respuesta: 201 si CONFIRMED dentro del presupuesto síncrono (Q-006); si no, 202 con status actual.
```

### 6.4 Ancillaries (Baggage, Seats)

- **Seat map (OP-02):** Ancillaries devuelve mapa físico por segmento y disponibilidad; la cabina se toma del snapshot de la oferta.
- **Asiento en compra:** reservado provisionalmente por Ancillaries (`SeatAssignment` PROVISIONAL) y confirmado cuando la reserva queda CONFIRMED.
- **Equipaje en compra y postventa (OP-09, OP-10):** Ancillaries calcula `maxAllowed` con la franquicia del brand (dato de Pricing en snapshot) y cobra con `paymentReference` validado contra Payment API.

### 6.5 Post-sale

```text
Recuperar: GET /bookings, /bookings/{id}, /tickets → lecturas locales por owner
Equipaje:  POST /baggage → Ancillaries valida límite → Payment API → BaggagePurchased ⇒ FR (historial) ⇒ webhook booking.baggage_added
Cambio:    POST date-change/search → FR valida isChangeable/no volado → Pricing.QuoteChange(+Inventory.QueryAvailability) → ChangeOffer(TTL)
           POST date-change → FR: CHANGE_PENDING → Inventory.CreateHold(nuevo) → pago diferencia → Ticketing.Reissue
                              → Inventory.Release(antiguo) → Ancillaries.Reaccommodate seats → CONFIRMED ⇒ booking.changed
Cancelar:  GET cancellation-quote → Pricing.QuoteCancellation → CancellationQuote(TTL)
           POST cancel(quoteId) → CANCELLATION_PENDING → Ticketing.Void/Refund tickets → Inventory.Release
                              → Ancillaries.Release → CANCELLED ⇒ booking.cancelled(refundAmount) ⇒ (Refund domain externo, Q-015)
```

### 6.6 Operations (Flight status, Schedule change, Cancellation, Delay)

```text
Operador interno/feed ⇢ Operations: actualiza FlightInstance operacional (ETD/ETA/estado)
Operations ⇒ FlightDelayed | FlightCancelled | FlightDiverted | FlightScheduleChanged
  Inventory ⇐ (cancelado: cierra venta de la instancia)
  FlightReservation ⇐ identifica reservas afectadas → marca segmento afectado, historial
  Webhook Delivery ⇐ flight.schedule_changed / flight.cancelled a suscriptores con reservas afectadas
GET /flights/{flightNumber}/status?date → Operations (lectura, cacheable)
```

### 6.7 Departure (Check-in → Seat assignment → Boarding pass)

```text
POST /bookings/{id}/check-in
Gateway → Departure.CheckIn(bookingId, owner)
  Departure → FR.GetReservationSnapshot   # CONFIRMED, pasajeros, segmentos
  Departure → Ticketing.GetTickets        # cupones ISSUED por segmento
  Departure → Operations: ventana (apertura/cierre), vuelo no salido/cancelado
  Departure → Ancillaries.AssignSeatAtCheckIn  # asiento si no tenía (misma cabina)
  Departure: CheckIn por pasajero/segmento, genera BoardingPass (barcode) ⇒ PassengerCheckedIn ⇒ webhook booking.checked_in
GET /boarding-passes → lectura local de Departure
```

## 7. Endpoint-by-Endpoint Analysis

Cada ficha sigue la plantilla solicitada. Los nombres de use case, RPC y eventos son PROPUESTOS; request, response y errores son DOCUMENTADOS en el contrato salvo que se marque GAP.

### OP-01 · POST /search

- **Endpoint:** Method `POST` · Path `/search` · Authentication: ninguna (`security: []`) · Scopes: — · Idempotency: no aplica (lectura sin efectos persistentes para el cliente). Header obligatorio `X-Device-Fingerprint`.
- **Objetivo funcional:** búsqueda multidestino (1–6 tramos) que devuelve ofertas con itinerarios, segmentos, opciones por cabina/fare brand, reglas básicas, franquicia de equipaje y precio por tipo de pasajero.
- **Actor externo:** Booking Platform, web/mobile anónimo, metabuscadores B2B.
- **Request:** `itineraries[]` (origin, destination IATA 3 letras, departureDate) y `passengers` (adults ≥1, youths, children, infants). `additionalProperties: false`.
- **Response:** 200 `SearchResponse{totalOffers, offers[FlightOffer]}`; 400 `VALIDATION_FAILED`; 429 `RATE_LIMIT_EXCEEDED` + `Retry-After`.
- **Application Use Case:** `SearchFlightOffersUseCase`.
- **Microservicio propietario:** Pricing & Fares (Offer Management).
- **Colaboradores:** Inventory & Schedule (disponibilidad y horarios).
- **Flujo interno:** Gateway (valida schema, rate limit por fingerprint+IP) → `OfferService.SearchOffers` → `InventoryQueryService.QueryAvailability` (por tramo) → dominio `ItineraryBuilder` + `FareCalculator` → persiste `Offer` con TTL → respuesta.
- **gRPC:** `OfferService.SearchOffers(SearchOffersRequest{repeated OriginDestination od; PassengerMix pax; string currency; string point_of_sale; string correlation_id}) returns (SearchOffersResponse{repeated OfferView offers})`. Dependencia: `InventoryQueryService.QueryAvailability(AvailabilityRequest{string origin; string destination; Date date; repeated Cabin cabins}) returns (AvailabilityResponse{repeated FlightInstanceAvailability instances})` con `FlightInstanceAvailability{instance_id, flight_number, marketing_carrier, operating_carrier, departure, arrival, aircraft, repeated CabinAvailability{cabin, booking_class, sellable}}`.
- **Modelo de dominio:** Aggregate `Offer` (offerId, snapshot de itinerarios, `OfferItem` por itinerario × cabina × brand, `PassengerPrice`, `expiresAt`). VOs: `OriginDestination`, `Money`, `PassengerMix`, `FareBrandRef`, `BaggageAllowance`, `FareRulesSummary`. Invariantes: INV-PRC-01, INV-PRC-02, INV-PRC-03.
- **Persistencia:** Pricing guarda `Offer` (almacenamiento con TTL, p. ej. cache/tabla con expiración). Inventory no persiste nada por búsqueda.
- **Eventos:** ninguno de dominio. Métrica `search.requests`, `search.zero_results` (PROPUESTO). No hay webhook.
- **Consistencia:** lectura eventual de disponibilidad (snapshot); sin transacción distribuida. Timeout por llamada a Inventory; resultados parciales permitidos si un tramo falla (Q-032).
- **Failure modes:** Inventory lento → timeout y 503 o resultados vacíos (no declarado, GAP-018); explosión combinatoria en multidestino de 6 tramos → límite de combinaciones por tramo; abuso/scraping → 429.
- **OpenAPI gaps:** GAP-002 (moneda/POS), GAP-003 (fingerprint, filtros, orden, paginación), GAP-004 (`airline` único y `grandTotal` ambiguo), GAP-005 (sin `expiresAt` de oferta), GAP-006 (límites de pasajeros), GAP-030 (formato de montos).

### OP-02 · GET /offers/{offerId}/seatmap

- **Endpoint:** `GET` `/offers/{offerId}/seatmap?segmentId=` · Pública · Scopes: — · Idempotency: GET naturalmente idempotente.
- **Objetivo funcional:** mostrar el mapa de asientos de un segmento de una oferta, sin precios, para selección previa a la compra.
- **Actor externo:** web/mobile, Booking Platform.
- **Request:** `offerId` (path), `segmentId` (query, requerido).
- **Response:** 200 `SeatMapResponse{segmentId, cabins[rows[seats[seatNumber, isAvailable, characteristics]]]}`; 404; 429.
- **Application Use Case:** `GetOfferSeatMapUseCase`.
- **Propietario:** Ancillaries.
- **Colaboradores:** Pricing (resolver `offerId`+`segmentId` → `flightInstanceId` y cabina ofertada), Inventory (configuración de cabina/aeronave de la instancia).
- **Flujo interno:** Gateway → `SeatService.GetSeatMap` → `OfferService.ResolveSegment` → `SeatInventory` local de la instancia (asientos físicos, bloqueos, asignaciones) → mapa.
- **gRPC:** `SeatService.GetSeatMap(GetSeatMapRequest{string flight_instance_id; Cabin cabin_filter}) returns (SeatMapView)`; `OfferService.ResolveSegment(ResolveSegmentRequest{offer_id, segment_id}) returns (ResolvedSegment{flight_instance_id, repeated Cabin offered_cabins, bool offer_active})`.
- **Modelo de dominio:** Aggregate `FlightSeatMap` (por `flightInstanceId`: `Seat` entities con `SeatNumber`, `SeatCharacteristic`, `SeatStatus` AVAILABLE/BLOCKED/PROVISIONAL/ASSIGNED). La configuración (`CabinLayout`) se copia desde Inventory al abrir la instancia.
- **Persistencia:** Ancillaries (layout copiado + estado por asiento).
- **Eventos:** consume `FlightInstanceOpened`, `AircraftChanged` (re-mapeo), `FlightInstanceCancelled` de Inventory/Operations.
- **Consistencia:** lectura eventual; `isAvailable` es orientativo hasta la asignación.
- **Failure modes:** oferta expirada → 404 (el contrato no tiene 410 aquí); cambio de equipo tras la oferta → mapa distinto al del snapshot; segmento inexistente → 404.
- **OpenAPI gaps:** GAP-007 (endpoint público vs. "cabina adquirida", sin 400 por `segmentId` faltante, schema sin `required`, "gratuito al emitir" ambiguo).

## 8. Bounded Contexts

El MVP necesita 6 servicios de dominio y 2 componentes de soporte; se evaluaron 10 candidatos y 3 quedan absorbidos por otro contexto hasta que la carga o el ownership lo justifiquen.

| Contexto | Clasificación | Justificación de la separación | Lenguaje ubicuo propio |
| --- | --- | --- | --- |
| **Inventory & Schedule** | MVP obligatorio | Consistencia fuerte en capacidad y alta contención (último asiento); lifecycle de horarios independiente del de ventas | FlightInstance, ScheduledFlight, CabinInventory, BookingClass, InventoryHold, capacidad vendible |
| **Pricing & Fares (Offer Management)** | MVP obligatorio | Carga de lectura muy superior al resto (búsqueda); reglas tarifarias con ciclo de publicación propio; dueño de ofertas y precios congelados | Offer, OfferItem, FareBrand, FareRule, PassengerPrice, PriceLock, ChangeOffer |
| **Flight Reservation / CRS** | MVP obligatorio | Dueño del recurso público `/bookings`, PNR y PII de pasajeros; orquesta Sagas | FlightReservation, PNR, ReservationPassenger, ReservationSaga, CancellationQuote |
| **Ticketing / Fulfilment** | MVP obligatorio | Lifecycle propio por pasajero×segmento (cupones), emisión idempotente y numeración única; el contrato expone estados parciales | Ticket, ETicketNumber, TicketCoupon, Issuance, Void, Reissue |
| **Ancillaries** | MVP obligatorio | Contención de asientos físicos distinta de la capacidad por cabina; entitlements de equipaje con límites y cobro propio | FlightSeatMap, Seat, SeatAssignment, BaggageEntitlement, BaggagePurchase |
| **Operations & Departure** | MVP obligatorio (fusiona Flight Operations + Check-in/DCS) | Datos operacionales en tiempo real y control de salida comparten la misma instancia de vuelo y ventana temporal; volumen bajo en MVP | OperationalFlight, OperationalTimes, CheckIn, BoardingPass, ventana de check-in |
| **API Gateway / Edge** | MVP soporte | Frontera pública, traducción REST↔gRPC, authN/authZ, idempotencia HTTP, rate limiting; sin lógica de dominio | — |
| **Webhook Delivery** | MVP soporte | Entrega externa at-least-once con reintentos, firma y DLQ; aísla a terceros del bus interno | WebhookSubscription, DeliveryAttempt |
| Flight Operations (separado) | Recomendado posteriormente | Separar si llega un feed operativo real (ACARS/OOOI, sistemas de aeropuerto) con volumen alto | — |
| Notifications (email/SMS) | Recomendado posteriormente / fuera de alcance | El contrato no lo exige; posible responsabilidad de Booking Platform (Q-017) | — |
| Schedule Management (separado de Inventory) | Puede mantenerse dentro de Inventory | En MVP la carga de horarios es batch y de bajo volumen | — |

**Relaciones del context map (PROPUESTO):**

| Upstream | Downstream | Patrón | Nota |
| --- | --- | --- | --- |
| Inventory & Schedule | Pricing & Fares | Customer/Supplier (gRPC) | Pricing consume disponibilidad y crea holds |
| Inventory & Schedule | Flight Reservation | Customer/Supplier (gRPC + eventos) | Consumo y liberación de holds/inventario |
| Pricing & Fares | Flight Reservation | Customer/Supplier (gRPC) | Price lock, cotización de cambio y cancelación |
| Flight Reservation | Ticketing | Published Language (eventos) | `TicketIssuanceRequested`, `TicketReissueRequested`, `ReservationCancellationRequested` |
| Ticketing | Flight Reservation | Published Language (eventos) | Resultados de emisión/anulación |
| Flight Reservation | Ancillaries | Customer/Supplier (gRPC) | Reserva/confirmación/liberación de asientos y equipaje |
| Operations & Departure | Flight Reservation, Inventory, Webhook Delivery | Published Language (eventos) | Cambios operacionales |
| Todos los dominios | Webhook Delivery | Conformist hacia el catálogo público de webhooks + ACL interna | Traducción evento interno → `WebhookPayload` |
| Payment API (externa) | Flight Reservation, Ancillaries | Anti-Corruption Layer (REST) | Solo validación de `paymentReference` |

No hay un modelo global: `Passenger` en Flight Reservation (identidad y documento), `passenger_ref` en Ancillaries y Departure (referencia + tipo), `passengerId` en Ticketing (referencia) son modelos distintos del mismo concepto.

## 9. Domain Model

Cada contexto tiene su propio modelo; los conceptos compartidos cruzan fronteras solo como IDs o snapshots inmutables. Respuestas a las preguntas obligatorias: `Offer` → Pricing; `InventoryHold` → Inventory; `FareBrand` → Pricing; `Passenger` del dominio aéreo → Flight Reservation; `SeatAssignment` → Ancillaries; `Ticket` → Ticketing; `FlightInstance` → Inventory & Schedule (su estado operacional en tiempo real → Operations & Departure como `OperationalFlight`).

### 9.1 Inventory & Schedule

```text
BOUNDARY Inventory & Schedule
├── Aggregate Roots: ScheduledFlight (patrón de horario), FlightInstance (vuelo en fecha), InventoryHold
├── Entities: CabinInventory (por instancia×cabina), BookingClassBucket, HoldLine
├── Value Objects: FlightNumber, CarrierCode, AirportCode, LocalDateTime+TZ, CabinClass, BookingClass,
│                  Capacity{physical, sellable, sold, held}, HoldTtl, OwnerId, CodeshareLink{marketing, operating}
├── Domain Services: AvailabilityCalculator, HoldExpiryPolicy, ConnectionEligibility (MCT)
├── Domain Events: FlightInstanceScheduled, FlightInstanceClosedForSale, InventoryHoldCreated, InventoryHoldReleased,
│                  InventoryHoldExpired, InventoryHoldConsumed, ReservedInventoryReleased, AircraftChanged
├── Commands: CreateHold, ReleaseHold, ExpireHold, ConsumeHold, ReleaseReservedInventory, LoadSchedule, CloseInstance
├── Queries: QueryAvailability, GetHold, GetFlightInstance
└── Owned Data: horarios, instancias, capacidad por cabina/clase, holds, contadores vendidos/retenidos
```

### 9.2 Pricing & Fares (Offer Management)

```text
BOUNDARY Pricing & Fares
├── Aggregate Roots: FareBrand (con reglas), FareTable (tarifas por O&D/clase/brand), Offer, PriceLock, ChangeOffer
├── Entities: OfferItem (itinerario×cabina×brand), PassengerPrice, FareRule
├── Value Objects: Money{currency, amount decimal}, PriceBreakdown{baseFare, taxes, total}, FareRulesSummary{isRefundable,
│                  isChangeable, changeFee, refundPenalty}, BaggageAllowance, PassengerTypeDiscount, OfferTtl, PriceDifference
├── Domain Services: ItineraryBuilder, FareCalculator, TaxCalculator, ChangeQuoter, CancellationQuoter
├── Domain Events: OfferCreated, OfferHeld, PriceLockCreated, PriceLockExpired, ChangeOfferCreated, FareBrandPublished
├── Commands: SearchOffers, HoldOffer, ReleaseOfferHold, QuoteChange, QuoteCancellation, PublishFares
├── Queries: GetOffer, ResolveSegment, GetPriceLock, GetChangeOffer, GetBaggagePrice
└── Owned Data: brands, reglas, tarifas, impuestos, ofertas, price locks, change offers
```

### 9.3 Flight Reservation / CRS

```text
BOUNDARY Flight Reservation / CRS
├── Aggregate Roots: FlightReservation
├── Entities: ReservationPassenger, ReservationSegment (snapshot), DateChange, CancellationQuote, PaymentRecord, ChangeLogEntry
├── Value Objects: BookingId, Pnr (6 alfanuméricos), OwnerId, PersonName, TravelDocument{type, number, nationality, expiry},
│                  BirthDate, Gender, ContactInfo, PassengerType, InfantAssociation, PaymentReference, ReservationStatus
├── Domain Services: PassengerMixValidator, PnrGenerator, ReservationSagaOrchestrator, AffectedReservationFinder
├── Domain Events: FlightReservationCreated, ReservationPaymentValidated, ReservationPaymentFailed, TicketIssuanceRequested,
│                  FlightReservationConfirmed, FlightReservationFailed, DateChangeRequested, DateChangeConfirmed,
│                  ReservationCancellationRequested, FlightReservationCancelled, ReservationAffectedByOperation
├── Commands: CreateReservation, ConfirmDateChange, CreateCancellationQuote, CancelReservation, ApplyOperationalChange
├── Queries: ListReservations, GetReservation, GetReservationSnapshot, SearchDateChangeOptions
└── Owned Data: reservas, PNR, pasajeros con PII, snapshot de itinerario/precio, referencias de pago, estado de Sagas
```

### 9.4 Ticketing / Fulfilment

```text
BOUNDARY Ticketing
├── Aggregate Roots: Ticket (uno por pasajero por reserva/reemisión), IssuanceRequest (por bookingId+requestId)
├── Entities: TicketCoupon (por segmento)
├── Value Objects: ETicketNumber (13 dígitos: prefijo aerolínea + serial, Q-007), CouponNumber, TicketStatus, CouponStatus,
│                  FareCalculationSnapshot, FailureReason
├── Domain Services: TicketNumberAllocator, IssuancePolicy (reintentos), VoidPolicy
├── Domain Events: TicketIssuanceStarted, TicketIssued, TicketIssuancePartiallyFailed, TicketIssuanceFailed,
│                  TicketVoided, TicketRefunded, TicketReissued
├── Commands: IssueTickets, RetryFailedCoupons, VoidTickets, MarkRefunded, ReissueTickets
├── Queries: ListTickets, GetTicket, GetCouponsForBooking
└── Owned Data: tickets, cupones, secuencias de numeración, bookingId/ownerId copiados
```

### 9.5 Ancillaries

```text
BOUNDARY Ancillaries
├── Aggregate Roots: FlightSeatMap (por FlightInstance), BaggageEntitlement (por reserva×pasajero×itinerario)
├── Entities: Seat, SeatAssignment, BaggagePurchase
├── Value Objects: SeatNumber, SeatCharacteristic, SeatStatus, CabinLayout, PassengerRef{bookingId, passengerId, type},
│                  BaggageQuantity, BaggageLimit
├── Domain Services: SeatEligibility (cabina, infante, salida de emergencia), AutoSeatAllocator, BaggageLimitPolicy
├── Domain Events: SeatReserved, SeatAssigned, SeatReleased, BaggageReserved, BaggagePurchased, BaggageReleased
├── Commands: ReserveSeats, ConfirmSeats, ReleaseSeats, AssignSeatAtCheckIn, ReserveBaggage, PurchaseBaggage, Reaccommodate
├── Queries: GetSeatMap, GetBaggageOptions
└── Owned Data: layouts copiados, estado por asiento, asignaciones, entitlements y compras, ReservationProjection
```

### 9.6 Operations & Departure

```text
BOUNDARY Operations & Departure
├── Aggregate Roots: OperationalFlight, CheckIn (por reserva×segmento)
├── Entities: PassengerCheckIn, BoardingPass, OperationalChange
├── Value Objects: OperationalTimes{scheduled, estimated, actual}, FlightOpsStatus, Gate/Terminal, CheckInWindow,
│                  Barcode{type, payload}, BoardingGroup, BoardingSequence
├── Domain Services: CheckInEligibility, CheckInWindowPolicy, BoardingPassGenerator
├── Domain Events: FlightDelayed, FlightCancelled, FlightDiverted, FlightScheduleChanged, FlightDeparted, FlightArrived,
│                  PassengerCheckedIn, CheckInFailed, BoardingPassIssued, BoardingPassInvalidated
├── Commands: RecordOperationalUpdate, CheckIn, InvalidateBoardingPass
├── Queries: GetFlightStatus, ListBoardingPasses
└── Owned Data: estado operacional, historial, check-ins, boarding passes
```

### 9.7 Webhook Delivery (soporte)

```text
BOUNDARY Webhook Delivery
├── Aggregate Roots: WebhookSubscription, DeliveryJob
├── Entities: DeliveryAttempt
├── Value Objects: WebhookUrl, EventType (12 públicos), SigningSecret (cifrado), DeliveryStatus, RetrySchedule
├── Domain Services: EventTranslator (interno → WebhookPayload), RecipientResolver, Signer
├── Domain Events: WebhookDelivered, WebhookDeliveryFailed, SubscriptionDisabled
└── Owned Data: suscripciones, jobs, intentos, índice bookingId → ownerId (desde eventos)
```

## 10. Data Ownership Matrix

Cada concepto tiene exactamente un owner que es el único que lo escribe; los demás lo leen vía gRPC del owner o mediante una proyección local construida con sus eventos. Esta tabla se traduce 1:1 en reglas de architecture tests (sección 22).

| Concepto | Owner | Puede consultar | Puede modificar | Comunicación |
| --- | --- | --- | --- | --- |
| ScheduledFlight / FlightInstance (programado) | Inventory & Schedule | Pricing, Ancillaries, Operations & Departure | Inventory only | gRPC `QueryAvailability`/`GetFlightInstance`; eventos `FlightInstanceScheduled`, `AircraftChanged` |
| CabinInventory / BookingClassBucket | Inventory & Schedule | Pricing (disponibilidad agregada) | Inventory only | gRPC |
| InventoryHold | Inventory & Schedule | Pricing, Flight Reservation | Inventory only (comandos desde Pricing y FR) | gRPC `CreateHold`/`ConsumeHold`/`ReleaseHold`; eventos `InventoryHold*` |
| FareBrand / FareRule / FareTable | Pricing & Fares | Flight Reservation (en snapshot), Ancillaries (franquicia en snapshot) | Pricing only | Snapshot dentro de Offer/PriceLock; gRPC |
| Offer / OfferItem | Pricing & Fares | Ancillaries (`ResolveSegment`) | Pricing only | gRPC |
| PriceLock (`lockedPrice`) | Pricing & Fares | Flight Reservation | Pricing only | gRPC `GetPriceLock`; evento `InventoryHoldExpired` lo invalida |
| ChangeOffer | Pricing & Fares | Flight Reservation | Pricing only | gRPC |
| CancellationQuote | Flight Reservation (cálculo delegado a Pricing) | — | Flight Reservation only | gRPC `QuoteCancellation` a Pricing |
| FlightReservation / PNR / estado | Flight Reservation | Ancillaries, Departure, Webhook Delivery (proyecciones) | Flight Reservation only | Eventos `FlightReservation*`; gRPC `GetReservationSnapshot` (solo Departure) |
| Passenger (identidad, documento, contacto) | Flight Reservation | Departure (nombre, documento para check-in), Ticketing (nombre en ticket) | Flight Reservation only | Snapshot mínimo en eventos/gRPC; PII minimizada |
| PaymentReference y resultado de validación | Flight Reservation (reserva) / Ancillaries (equipaje) | — | Cada uno sus propios registros | REST ACL a Payment API |
| Ticket / TicketCoupon / ETicketNumber | Ticketing | Flight Reservation (proyección), Departure (gRPC) | Ticketing only | Eventos `Ticket*`; gRPC `GetCouponsForBooking` |
| FlightSeatMap / Seat / SeatAssignment | Ancillaries | Departure, Flight Reservation (proyección) | Ancillaries only | gRPC `ReserveSeats`/`AssignSeatAtCheckIn`; eventos `Seat*` |
| BaggageEntitlement / BaggagePurchase | Ancillaries | Flight Reservation (proyección para `changes` y detalle) | Ancillaries only | Eventos `Baggage*` |
| OperationalFlight (ETD/ETA/estado) | Operations & Departure | Flight Reservation, Inventory, Webhook Delivery | Operations only | Eventos `Flight*` |
| CheckIn / BoardingPass | Operations & Departure | Flight Reservation (proyección de estado) | Departure only | Eventos `PassengerCheckedIn`, `BoardingPassInvalidated` |
| WebhookSubscription / DeliveryAttempt | Webhook Delivery | — | Webhook Delivery only | gRPC desde Gateway |
| Idempotency record HTTP | API Gateway | — | Gateway only | Almacén propio del Gateway |
| Idempotency record de dominio | Cada servicio que muta | — | El propio servicio | Tabla local |

**Reglas derivadas:** ningún servicio guarda una FK hacia datos de otro; las referencias son IDs opacos (`holdId`, `offerId`, `bookingId`, `flightInstanceId`, `ticketId`). Toda proyección local debe declarar su evento fuente y ser reconstruible desde el bus (replay) o desde un endpoint gRPC de backfill.

## 11. Service Dependency Matrix

Las dependencias síncronas forman un grafo dirigido acíclico de 5 niveles (Operations & Departure → Flight Reservation → Ancillaries → Pricing → Inventory); toda relación en sentido inverso viaja por eventos. No hay dependencias circulares síncronas en el diseño propuesto.

&#91;embedded content: dependencias síncronas y externas · 8 componentes\]

Inventory es la hoja del grafo y no llama a nadie: por eso es el primer servicio que puede construirse y probarse aislado.

**Dependencias síncronas (gRPC) y externas (REST):**

| Caller | Callee | RPCs | Tipo |
| --- | --- | --- | --- |
| API Gateway | Pricing & Fares | `SearchOffers`, `HoldOffer`, `GetOfferHold`, `ReleaseOfferHold` | gRPC |
| API Gateway | Flight Reservation | `CreateReservation`, `ListReservations`, `GetReservation`, `SearchDateChangeOptions`, `ConfirmDateChange`, `QuoteCancellation`, `CancelReservation` | gRPC |
| API Gateway | Ancillaries | `GetSeatMap`, `GetBaggageOptions`, `PurchaseBaggage` | gRPC |
| API Gateway | Ticketing | `ListTickets`, `GetTicket` | gRPC |
| API Gateway | Operations & Departure | `CheckIn`, `ListBoardingPasses`, `GetFlightStatus` | gRPC |
| API Gateway | Webhook Delivery | `Register`, `List`, `Delete` | gRPC |
| Pricing & Fares | Inventory & Schedule | `QueryAvailability`, `CreateHold`, `GetHold`, `ReleaseHold` | gRPC |
| Flight Reservation | Inventory & Schedule | `GetHold`, `ConsumeHold`, `CreateHold` (cambio), `ReleaseReservedInventory` | gRPC |
| Flight Reservation | Pricing & Fares | `GetPriceLock`, `QuoteChange`, `GetChangeOffer`, `QuoteCancellation` | gRPC |
| Flight Reservation | Ancillaries | `ReserveSeats`, `ReserveBaggage`, `ConfirmAncillaries`, `ReleaseAncillaries` | gRPC |
| Ancillaries | Pricing & Fares | `ResolveSegment`, `GetBaggagePrice` | gRPC |
| Operations & Departure | Flight Reservation | `GetReservationSnapshot` | gRPC |
| Operations & Departure | Ticketing | `GetCouponsForBooking` | gRPC |
| Operations & Departure | Ancillaries | `AssignSeatAtCheckIn` | gRPC |
| Flight Reservation | Payment API | Validar `paymentReference` | REST externo (ACL) |
| Ancillaries | Payment API | Validar `paymentReference` (equipaje) | REST externo (ACL) |
| Webhook Delivery | Consumidores externos | Callback `WebhookPayload` | REST saliente |

**Dependencias asíncronas (eventos):**

| Producer | Evento(s) | Consumers |
| --- | --- | --- |
| Inventory & Schedule | `InventoryHoldExpired`, `InventoryHoldReleased`, `InventoryHoldConsumed` | Pricing (price lock), Webhook Delivery (`hold.expired`) |
| Inventory & Schedule | `FlightInstanceScheduled`, `AircraftChanged`, `FlightInstanceClosedForSale` | Ancillaries (layout), Operations & Departure (instancias), Pricing (cache de disponibilidad) |
| Flight Reservation | `TicketIssuanceRequested`, `TicketReissueRequested`, `ReservationCancellationRequested` | Ticketing; cancelación también Inventory, Ancillaries, Operations & Departure |
| Flight Reservation | `FlightReservationConfirmed/Failed/Changed/Cancelled` | Ancillaries (proyección), Webhook Delivery, Operations & Departure (invalidar check-in) |
| Ticketing | `TicketIssued`, `TicketIssuancePartiallyFailed`, `TicketIssuanceFailed`, `TicketVoided`, `TicketReissued` | Flight Reservation (Saga), Webhook Delivery |
| Ancillaries | `SeatAssigned`, `SeatReleased`, `BaggagePurchased` | Flight Reservation (proyección/historial), Operations & Departure (invalidar boarding pass), Webhook Delivery |
| Operations & Departure | `FlightDelayed`, `FlightCancelled`, `FlightScheduleChanged`, `FlightDiverted`, `PassengerCheckedIn` | Flight Reservation, Inventory (cierre de venta), Webhook Delivery |

**Dependencias circulares evaluadas y resueltas:**

- Inventory ↔ Pricing en el hold → resuelto moviendo el use case a Pricing (ADR-06).
- Flight Reservation ↔ Ancillaries en postventa de equipaje → resuelto con `ReservationProjection` local en Ancillaries.
- Flight Reservation ↔ Ticketing → solo por eventos en ambos sentidos; ninguno llama al otro por gRPC.
- Operations & Departure ↔ Flight Reservation → Departure llama a FR (lectura); FR reacciona a Operations solo por eventos.

**Regla verificable:** el grafo de llamadas gRPC declarado en los clientes generados debe coincidir con la primera tabla; cualquier arista nueva requiere ADR (sección 22, AC-05).

## 12. Internal gRPC Contracts

Se proponen 8 paquetes Protobuf (uno por contexto, con Operations & Departure dividido desde ya en departure y flightops para facilitar su futura separación) más uno `common`, separados en servicios de comando y de consulta; ningún mensaje interno se reutiliza como payload REST ni como payload de webhook.

**Convenciones (PROPUESTO):**

- Paquetes `flightplatform.<context>.v1` (p. ej. `flightplatform.inventory.v1`); cambios incompatibles solo en `v2` paralelo. Chequeo con `buf breaking` en CI.
- Metadata obligatoria en cada llamada: `x-correlation-id`, `traceparent` (W3C), `x-owner-id` (sub del JWT ya validado), `x-client-id`, `x-idempotency-key` cuando aplique, deadline explícito.
- Errores con `google.rpc.Status` + `ErrorInfo{reason = <code del OpenAPI o código interno>, domain = "flightplatform.<context>"}`; el Gateway mapea `reason` → `ProblemDetails.code` y `grpc.Code` → HTTP con una tabla única versionada.
- Dinero como `Money{string currency_code; int64 units; int32 nanos}` o decimal en string con escala fija (Q-035); nunca `double`.
- Fechas: `google.protobuf.Timestamp` para instantes; `LocalDate` + `iana_tz` para fechas de vuelo locales.
- Todo RPC mutante recibe `idempotency_key` y `owner_id`, y devuelve la vista resultante (no vacío).

| Paquete | Service | RPCs | Mensajes principales |
| --- | --- | --- | --- |
| `common.v1` | — | — | `Money`, `PassengerMix{adults, youths, children, infants}`, `OriginDestination`, `CabinClass` (enum), `PassengerType` (enum), `AirportCode`, `CarrierCode`, `OwnerContext`, `PageRequest/PageResponse` |
| `inventory.v1` | `InventoryQueryService` | `QueryAvailability`, `GetHold`, `GetFlightInstance` | `AvailabilityRequest/Response`, `FlightInstanceAvailability`, `CabinAvailability{cabin, booking_class, sellable}`, `HoldView{hold_id, status, expires_at, lines}` |
| `inventory.v1` | `InventoryCommandService` | `CreateHold`, `ReleaseHold`, `ConsumeHold`, `ReleaseReservedInventory` | `CreateHoldRequest{lines[SegmentHoldLine{flight_instance_id, cabin, booking_class, seats}], owner_id, ttl, idempotency_key}`, `ConsumeHoldRequest{hold_id, reservation_id}`, `ReleaseReservedInventoryRequest{reservation_id, lines}` |
| `pricing.v1` | `OfferService` | `SearchOffers`, `HoldOffer`, `GetOfferHold`, `ReleaseOfferHold`, `ResolveSegment` | `SearchOffersRequest`, `OfferView{offer_id, itineraries[ItineraryView], grand_total, expires_at}`, `ItineraryView{itinerary_id, segments[SegmentView], pricing_options[PricingOptionView]}`, `HoldOfferRequest/Response` |
| `pricing.v1` | `PriceLockService` | `GetPriceLock` | `PriceLockView{hold_id, locked_price, passenger_prices, extra_bag_price_by_itinerary, fare_snapshot}` |
| `pricing.v1` | `ChangePricingService` | `QuoteChange`, `GetChangeOffer`, `QuoteCancellation` | `QuoteChangeRequest{reservation_snapshot, changes}`, `ChangeOfferView{change_offer_id, segments, price_difference, expires_at}`, `CancellationQuoteView` |
| `pricing.v1` | `AncillaryPricingService` | `GetBaggagePrice` | `BaggagePriceRequest{route, fare_brand, currency}` |
| `reservation.v1` | `ReservationService` | `CreateReservation`, `ConfirmDateChange`, `CreateCancellationQuote`, `CancelReservation` | `CreateReservationRequest{hold_id, passengers[PassengerInput], payment_reference, owner_id, idempotency_key}`, `ReservationView` (mapeable 1:1 a `BookingDetail`) |
| `reservation.v1` | `ReservationQueryService` | `ListReservations`, `GetReservation`, `GetReservationSnapshot`, `SearchDateChangeOptions` | `ReservationSnapshot{booking_id, owner_id, status, passengers[PassengerRef + name + document minimal], segments[SegmentSnapshot], fare_brand_by_itinerary}` |
| `ticketing.v1` | `TicketQueryService` | `ListTickets`, `GetTicket`, `GetCouponsForBooking` | `TicketView{ticket_id, booking_id, passenger_id, e_ticket_number, status, issued_at, coupons[CouponView], failure_reason}` |
| `ancillaries.v1` | `SeatService` | `GetSeatMap`, `ReserveSeats`, `ConfirmSeats`, `ReleaseSeats`, `AssignSeatAtCheckIn` | `SeatMapView`, `SeatRequest{passenger_ref, flight_instance_id, seat_number, cabin, passenger_type}`, `SeatAssignmentView` |
| `ancillaries.v1` | `BaggageService` | `GetOptions`, `Reserve`, `Purchase`, `Release` | `BaggageOptionList`, `PurchaseBaggageRequest`, `BaggagePurchaseView` |
| `departure.v1` | `DepartureService` / `DepartureQueryService` | `CheckIn` / `ListBoardingPasses` | `CheckInRequest{booking_id, owner_id, scope?}`, `CheckInView`, `BoardingPassView` |
| `flightops.v1` | `FlightOpsQueryService` | `GetFlightStatus` | `GetFlightStatusRequest{flight_number, local_departure_date}`, `FlightStatusView` |
| `webhooks.v1` | `WebhookSubscriptionService` | `Register`, `List`, `Delete` | `SubscriptionView` (sin secreto en lecturas) |

Ticketing no expone RPCs de comando en MVP: la emisión, anulación y reemisión se disparan solo por eventos (`TicketIssuanceRequested`, `ReservationCancellationRequested`, `TicketReissueRequested`), lo que impide que un caller síncrono dependa de la latencia de emisión.

Los esquemas de eventos se definen también en Protobuf, en paquetes `flightplatform.<context>.events.v1`, con registro de esquemas y compatibilidad hacia atrás verificada en CI.

## 13. Event Model

Tres niveles de evento con reglas distintas: Domain Events (dentro del servicio, no salen), Integration Events (bus privado, esquema versionado) y eventos públicos (los 12 tipos de webhook del contrato). Un Integration Event nunca se publica tal cual hacia afuera: Webhook Delivery lo traduce.

**Envelope común de Integration Events (PROPUESTO):** `eventId` (uuid), `eventType`, `eventVersion`, `occurredAt`, `producer`, `aggregateType`, `aggregateId`, `aggregateVersion` (orden por agregado), `correlationId`, `causationId`, `traceparent`, `ownerId` (cuando aplica), `payload`. Clave de partición = `aggregateId` para garantizar orden por agregado.

| Integration Event | Producer | Trigger | Payload mínimo | Consumers | Reason for async | Webhook público |
| --- | --- | --- | --- | --- | --- | --- |
| `InventoryHoldCreated` | Inventory | `CreateHold` confirmado | holdId, ownerId, lines, expiresAt | Analítica (opcional) | No bloquea al cliente | — |
| `InventoryHoldExpired` | Inventory | Barrido TTL | holdId, ownerId, lines | Pricing, Webhook Delivery | Proceso temporal sin request | `hold.expired` |
| `InventoryHoldReleased` | Inventory | DELETE o compensación | holdId, reason | Pricing | Propagación de estado | — |
| `InventoryHoldConsumed` | Inventory | `ConsumeHold` | holdId, reservationId | Pricing | Propagación de estado | — |
| `ReservedInventoryReleased` | Inventory | Cancelación o cambio | reservationId, lines | Analítica | Propagación | — |
| `FlightInstanceScheduled` / `AircraftChanged` / `FlightInstanceClosedForSale` | Inventory | Carga de horario, cambio de equipo, cierre | flightInstanceId, flightNumber, fecha, equipo, capacidad | Ancillaries, Operations & Departure, Pricing | Replicar datos de referencia | — |
| `FlightReservationCreated` | Flight Reservation | Reserva PENDING persistida | bookingId, pnr, ownerId, status | Webhook Delivery (índice owner), Ancillaries (proyección) | Proyecciones | — |
| `TicketIssuanceRequested` | Flight Reservation | Pago validado + hold consumido | bookingId, requestId, ownerId, pasajeros (id, nombre), segmentos, fare snapshot | Ticketing | Emisión larga, reintentable | `booking.ticket_issuing` (vía traducción) |
| `TicketIssued` / `TicketIssuancePartiallyFailed` / `TicketIssuanceFailed` | Ticketing | Resultado de emisión | bookingId, requestId, tickets\[ticketId, eTicket, status, coupons\] , failureReason | Flight Reservation, Webhook Delivery | Resultado de proceso largo | `booking.ticket_issued`, `booking.ticket_failed` |
| `FlightReservationConfirmed` | Flight Reservation | Todos los tickets ISSUED | bookingId, pnr, ownerId, pasajeros ref, segmentos, brand | Ancillaries (confirmar asientos), Webhook Delivery, Operations & Departure | Fan-out | `booking.confirmed` |
| `FlightReservationFailed` | Flight Reservation | Saga fallida | bookingId, reason, paymentReference, requiresRefund | Webhook Delivery, Ancillaries (liberar) | Compensación | `booking.failed` |
| `DateChangeConfirmed` | Flight Reservation | Saga de cambio completa | bookingId, oldSegments, newSegments | Ancillaries, Operations & Departure, Webhook Delivery | Fan-out | `booking.changed` |
| `TicketReissueRequested` | Flight Reservation | Cambio pagado y hold nuevo consumido | bookingId, changeId, tickets a reemplazar, nuevos segmentos | Ticketing | Proceso reintentable | — |
| `ReservationCancellationRequested` | Flight Reservation | POST cancel aceptado | bookingId, quoteId | Ticketing, Inventory, Ancillaries, Operations & Departure | Pasos independientes de liberación | — |
| `FlightReservationCancelled` | Flight Reservation | Todas las liberaciones confirmadas | bookingId, quoteId, refundAmount, currency, paymentReference | Webhook Delivery, dominio de reembolsos (externo, Q-015) | Notificación | `booking.cancelled` |
| `TicketVoided` / `TicketRefunded` / `TicketReissued` | Ticketing | Comandos por evento | bookingId, ticketId, status | Flight Reservation | Resultado | — |
| `SeatAssigned` / `SeatReleased` | Ancillaries | Asignación o liberación | flightInstanceId, seat, passengerRef | Flight Reservation (proyección), Operations & Departure | Proyección | — |
| `BaggagePurchased` | Ancillaries | Compra confirmada | bookingId, passengerId, itineraryId, quantity | Flight Reservation (historial), Webhook Delivery | Proyección + notificación | `booking.baggage_added` |
| `FlightDelayed` / `FlightDiverted` | Operations | Actualización operacional | flightInstanceId, flightNumber, fecha, tiempos | Flight Reservation, Webhook Delivery | Fan-out a muchas reservas | `flight.schedule_changed` (retrasos significativos, umbral Q-036) |
| `FlightScheduleChanged` | Operations (origen interno, Q-016) | Cambio programado de horario | flightInstanceId, old/new times | Flight Reservation, Inventory, Webhook Delivery | Fan-out | `flight.schedule_changed` |
| `FlightCancelled` | Operations | Cancelación operacional | flightInstanceId, reason | Inventory (cierra venta), Flight Reservation, Webhook Delivery | Fan-out | `flight.cancelled` |
| `PassengerCheckedIn` | Departure | Check-in exitoso | bookingId, passengerId, segmentId | Flight Reservation, Webhook Delivery | Notificación | `booking.checked_in` |

**Reglas de publicación:** todo Integration Event se escribe en la tabla Outbox dentro de la misma transacción que el cambio de estado; un relay lo publica al bus. Todo consumidor registra `eventId` en su tabla Inbox antes de aplicar efectos (dedupe). Los consumidores toleran desorden entre agregados distintos y rechazan versiones antiguas del mismo agregado (`aggregateVersion`).

**Traducción a webhook:** `WebhookPayload.data` solo admite `bookingId`, `pnr`, `status`, `refundAmount`; `hold.expired` y `flight.*` no pueden transportar `holdId` ni `flightNumber` con el contrato actual (GAP-025).

## 14. State Machines

Nueve entidades tienen lifecycle propio y cada máquina vive en un solo contexto; los estados públicos del contrato se respetan tal cual y los estados internos adicionales se marcan como (interno). Cada tabla es directamente convertible en tests de transición (válidas e inválidas).

### 14.1 Offer (Pricing)

Estados: `ACTIVE` → `EXPIRED` (interno; el contrato no expone estado de oferta).

| Desde | Hacia | Comando / trigger | Evento |
| --- | --- | --- | --- |
| — | ACTIVE | `SearchOffers` | `OfferCreated` |
| ACTIVE | EXPIRED | TTL de oferta (Q-003) | — (sin evento; limpieza) |

Inválidas: `HoldOffer` sobre EXPIRED → 409 `OFFER_NO_LONGER_AVAILABLE`.

### 14.2 InventoryHold (Inventory) — estados públicos HELD, RELEASED, EXPIRED, CONSUMED

| Desde | Hacia | Comando / trigger | Evento |
| --- | --- | --- | --- |
| — | HELD | `CreateHold` | `InventoryHoldCreated` |
| HELD | RELEASED | `ReleaseHold` (DELETE o compensación) | `InventoryHoldReleased` |
| HELD | EXPIRED | `ExpireHold` (now ≥ expiresAt) | `InventoryHoldExpired` |
| HELD | CONSUMED | `ConsumeHold` (now < expiresAt) | `InventoryHoldConsumed` |

Inválidas: cualquier transición desde RELEASED, EXPIRED o CONSUMED (estados terminales); `ConsumeHold` con now ≥ expiresAt aunque el barrido no haya corrido.

### 14.3 FlightReservation (Flight Reservation) — enum público de 8 estados

| Desde | Hacia | Comando / trigger | Evento | Webhook |
| --- | --- | --- | --- | --- |
| — | PENDING | `CreateReservation` validado | `FlightReservationCreated` | — |
| PENDING | PENDING\_PAYMENT | Payment API responde pendiente | — | — |
| PENDING / PENDING\_PAYMENT | TICKET\_ISSUING | Pago autorizado + hold consumido | `TicketIssuanceRequested` | `booking.ticket_issuing` |
| PENDING / PENDING\_PAYMENT | FAILED | Pago inválido/no autorizado, hold expirado, PNR fallido | `FlightReservationFailed` | `booking.failed` |
| TICKET\_ISSUING | CONFIRMED | `TicketIssued` para todos los pasajeros | `FlightReservationConfirmed` | `booking.ticket_issued`, `booking.confirmed` |
| TICKET\_ISSUING | FAILED | `TicketIssuanceFailed` tras reintentos + compensación | `FlightReservationFailed` | `booking.ticket_failed`, `booking.failed` |
| CONFIRMED | CHANGE\_PENDING | `ConfirmDateChange` aceptado | `DateChangeRequested` | — |
| CHANGE\_PENDING | CONFIRMED | Reemisión completada o cambio fallido (se conserva itinerario previo) | `DateChangeConfirmed` / `DateChangeFailed` | `booking.changed` (solo si confirmado) |
| CONFIRMED | CANCELLATION\_PENDING | `CancelReservation` con quote vigente | `ReservationCancellationRequested` | — |
| CANCELLATION\_PENDING | CANCELLED | Todas las liberaciones confirmadas | `FlightReservationCancelled` | `booking.cancelled` |

Inválidas: cambio o cancelación desde PENDING, PENDING\_PAYMENT, TICKET\_ISSUING, FAILED o CANCELLED (409 `BOOKING_NOT_CONFIRMED` / `ALREADY_CANCELLED`); cualquier salida desde CANCELLED o FAILED; cancelar en CHANGE\_PENDING (Q-037). El historial `changes[]` registra cada transición.

### 14.4 Ticket (Ticketing) — enum público PENDING, ISSUING, ISSUED, FAILED, VOIDED, REFUNDED

| Desde | Hacia | Trigger | Evento |
| --- | --- | --- | --- |
| — | PENDING | `TicketIssuanceRequested` recibido | — |
| PENDING | ISSUING | Inicio de emisión | `TicketIssuanceStarted` |
| ISSUING | ISSUED | Todos los cupones ISSUED | `TicketIssued` |
| ISSUING | FAILED | Reintentos agotados | `TicketIssuanceFailed` |
| ISSUED | VOIDED | Cancelación dentro de ventana de void / compensación / reemisión | `TicketVoided` |
| ISSUED | REFUNDED | Cancelación reembolsable fuera de ventana de void | `TicketRefunded` |

Cupón (`TicketSegmentStatus`): PENDING → ISSUED | FAILED; FAILED → ISSUED solo por `RetryFailedCoupons`. Inválidas: ISSUED → ISSUING (INV-TKT-02), VOIDED/REFUNDED → cualquier estado.

### 14.5 SeatAssignment (Ancillaries)

Estados (internos): `PROVISIONAL` → `CONFIRMED` → `RELEASED`; `CHECKED_IN` bloquea cambios.

| Desde | Hacia | Trigger | Evento |
| --- | --- | --- | --- |
| — | PROVISIONAL | `ReserveSeats` en compra | `SeatReserved` |
| PROVISIONAL | CONFIRMED | `FlightReservationConfirmed` | `SeatAssigned` |
| PROVISIONAL | RELEASED | `FlightReservationFailed` o timeout | `SeatReleased` |
| — | CONFIRMED | `AssignSeatAtCheckIn` | `SeatAssigned` |
| CONFIRMED | RELEASED | Cancelación, cambio de fecha, cambio de equipo | `SeatReleased` |
| CONFIRMED | CHECKED\_IN | `PassengerCheckedIn` | — |

### 14.6 DateChange (Flight Reservation, entidad dentro del agregado)

`REQUESTED` → `HOLDING_NEW_INVENTORY` → `AWAITING_PAYMENT` (si `totalToPay > 0`) → `REISSUING` → `COMPLETED` | `FAILED` (todos internos). Compensación desde REISSUING: liberar hold nuevo y restaurar itinerario. El estado público visible es `CHANGE_PENDING` durante todo el proceso.

### 14.7 Cancellation (Flight Reservation)

`QUOTED` (CancellationQuote vigente) → `EXPIRED` | `ACCEPTED` → `RELEASING` → `COMPLETED`. Inválidas: aceptar un quote EXPIRED (410 `QUOTE_EXPIRED`), aceptar dos veces el mismo quote.

### 14.8 CheckIn (Operations & Departure) — enum público NOT\_ELIGIBLE, AVAILABLE, IN\_PROGRESS, COMPLETED, FAILED

| Desde | Hacia | Trigger |
| --- | --- | --- |
| NOT\_ELIGIBLE | AVAILABLE | Apertura de ventana y reserva CONFIRMED con cupones ISSUED |
| AVAILABLE | IN\_PROGRESS | `CheckIn` iniciado |
| IN\_PROGRESS | COMPLETED | Todos los pasajeros×segmentos solicitados CHECKED\_IN |
| IN\_PROGRESS | FAILED | Algún pasajero falla y ninguno completó (PROPUESTO; resultados mixtos se reportan como COMPLETED con pasajeros FAILED, Q-013) |
| AVAILABLE / COMPLETED | NOT\_ELIGIBLE | Cierre de ventana, vuelo cancelado, schedule change, cancelación de reserva |

Pasajero×segmento: NOT\_CHECKED\_IN → CHECKED\_IN | FAILED.

### 14.9 FlightInstance / OperationalFlight

Programación (Inventory): `SCHEDULED_FOR_SALE` → `CLOSED_FOR_SALE` → `DEPARTED_ARCHIVED` (interno). Operación (Operations, enum público): SCHEDULED → BOARDING → DEPARTED → ARRIVED; SCHEDULED/BOARDING → DELAYED → BOARDING; SCHEDULED/DELAYED → CANCELLED; DEPARTED → DIVERTED. Inválidas: ARRIVED → cualquier estado; CANCELLED → BOARDING (reactivar exige nueva instancia, PROPUESTO).

## 15. Domain Invariants

45 invariantes con owner, momento de validación y forma de prueba; cada una es candidata directa a acceptance criterion. Fuente: C = contrato, A = aerolíneas (sección 3), P = propuesta de arquitectura.

| ID | Invariante | Fuente | Owner | Momento de validación | Prueba |
| --- | --- | --- | --- | --- | --- |
| INV-INV-01 | Asientos retenidos + vendidos ≤ capacidad vendible por instancia×cabina×clase | P | Inventory | `CreateHold`, `ConsumeHold` (misma transacción) | Unit + concurrency (N holds paralelos sobre último asiento) |
| INV-INV-02 | Un hold no puede retener asientos para infantes sin asiento | A (S-08) | Inventory | `CreateHold` (Pricing envía nPaxConAsiento = adults+youths+children) | Unit |
| INV-INV-03 | Un hold con now ≥ expiresAt se considera EXPIRED y no puede consumirse aunque el barrido no haya corrido | C | Inventory | `ConsumeHold`, `GetHold` | Unit con reloj controlado |
| INV-INV-04 | Solo el owner del hold puede consultarlo, liberarlo o consumirlo | C (owner por `sub`) | Inventory | Todos los comandos | Integration (403/404) |
| INV-INV-05 | Una reserva no puede consumir más inventario que el retenido | P | Inventory | `ConsumeHold` | Unit |
| INV-INV-06 | Un hold se consume a lo sumo una vez | P | Inventory | `ConsumeHold` (optimistic locking) | Concurrency |
| INV-INV-07 | No se crean holds sobre instancias CLOSED\_FOR\_SALE o cuyo primer segmento ya salió | P | Inventory | `CreateHold` | Unit |
| INV-PRC-01 | Toda oferta tiene moneda única en todos sus montos | C (MoneyAmount) + P | Pricing | `SearchOffers` | Unit + contract |
| INV-PRC-02 | total = baseFare + taxes por pasajero; grandTotal = Σ precios por tipo × cantidad | P (Q-038) | Pricing | Construcción de oferta | Unit (property-based) |
| INV-PRC-03 | Los segmentos de una conexión respetan el tiempo mínimo de conexión y orden temporal | P | Pricing | `ItineraryBuilder` | Unit |
| INV-PRC-04 | `lockedPrice` no cambia durante la vida del hold | C | Pricing | `LockPrice`, `GetPriceLock` | Unit + integration |
| INV-PRC-05 (FARE-CHG-01) | Un cambio solo es cotizable si el brand es `isChangeable` y ningún cupón del itinerario afectado está volado | C + A (S-11) | Pricing (regla) / FR (estado) | `QuoteChange` | Unit |
| INV-PRC-06 | Un ChangeOffer o CancellationQuote expirado no es aceptable | C | Pricing / FR | Confirmación | Unit con reloj |
| INV-RES-01 | `ownerId` = `sub` del JWT; nunca proviene del body | C | Gateway + FR | Request | Contract + security test |
| INV-RES-02 | Número y tipos de pasajeros = `passengersBreakdown` del hold | P (GAP-013) | FR | `CreateReservation` | Unit |
| INV-RES-03 | Cada INFANT referencia en `associatedAdultId` a un ADULT de la misma reserva | C + A | FR | `CreateReservation` | Unit |
| INV-RES-04 | Cada ADULT tiene a lo sumo un INFANT asociado; infantes ≤ adultos | A (S-08) | FR | `CreateReservation` | Unit |
| INV-RES-05 | INFANT no tiene `assignedSeats` | C (`INFANT_SEAT_NOT_ALLOWED`) | FR / Ancillaries | `CreateReservation`, `ReserveSeats` | Unit |
| INV-RES-06 | La edad del pasajero corresponde a su tipo en la fecha del último segmento | A (S-07) | FR | `CreateReservation` | Unit (rangos de edad, Q-010) |
| INV-RES-07 | `passengerId` único dentro de la reserva | P | FR | `CreateReservation` | Unit |
| INV-RES-08 | Monto validado en Payment API = total esperado (lockedPrice + extras) en la misma moneda | C (`AMOUNT_MISMATCH`) | FR | Validación de pago | Integration con Payment API simulada |
| INV-RES-09 | Una `paymentReference` solo acredita una operación | P | FR / Ancillaries | Validación de pago | Integration |
| INV-RES-10 | La misma `Idempotency-Key` con el mismo payload devuelve la misma reserva; con otro payload se rechaza | C + P | Gateway + FR | Request | Concurrency + contract |
| INV-RES-11 | Un `changeOfferId` y un `quoteId` se usan a lo sumo una vez | P | FR | Confirmación | Unit + concurrency |
| INV-RES-12 | Solo reservas CONFIRMED admiten cambio, cancelación, equipaje postventa y check-in | C (`BOOKING_NOT_CONFIRMED`) | FR (y proyecciones) | Cada operación postventa | Unit |
| INV-RES-13 | Una reserva CANCELLED no vuelve a otro estado | C | FR | Todas las transiciones | Unit (state machine) |
| INV-RES-14 | El PNR es único entre reservas activas | P | FR | Creación | Unit + integration (constraint) |
| INV-TKT-01 | Un ticket por pasajero por emisión; un cupón por segmento | C (schema) | Ticketing | `IssueTickets` | Unit |
| INV-TKT-02 | Un ticket ISSUED no puede emitirse nuevamente | C (`TICKET_ALREADY_ISSUED`) | Ticketing | `IssueTickets` | Unit + concurrency (evento duplicado) |
| INV-TKT-03 | La emisión es idempotente por (bookingId, requestId) | P | Ticketing | Inbox + agregado | Concurrency (redelivery) |
| INV-TKT-04 | Una reserva no queda CONFIRMED con cupones FAILED; si los reintentos se agotan, todo lo emitido se anula | P | Ticketing + FR | Fin de Saga | Integration (fault injection) |
| INV-TKT-05 | El número de e-ticket es único globalmente y no se reutiliza | P | Ticketing | Asignación | Unit + integration |
| INV-TKT-06 | Solo cupones no volados pueden anularse o reembolsarse | P | Ticketing | Void/Refund | Unit |
| INV-ANC-01 | Un asiento no puede asignarse simultáneamente a dos pasajeros en la misma instancia | C (`SEAT_TAKEN`) | Ancillaries | `ReserveSeats`, `AssignSeatAtCheckIn` | Concurrency |
| INV-ANC-02 | El asiento pertenece a la cabina adquirida por el pasajero | C (`SEAT_CABIN_MISMATCH`) | Ancillaries | Asignación | Unit |
| INV-ANC-03 | Pasajeros con infante o menores no se asignan en salida de emergencia | A (regulatorio, INFERIDO) | Ancillaries | Asignación | Unit |
| INV-ANC-04 | Maletas incluidas + compradas ≤ `maxAllowed` por pasajero×itinerario | C (`BAGGAGE_LIMIT_EXCEEDED`) | Ancillaries | `PurchaseBaggage` | Unit + concurrency |
| INV-ANC-05 | No se compra equipaje para itinerarios ya volados o después del cutoff | C (`CUTOFF_PASSED`) | Ancillaries | `PurchaseBaggage` | Unit con reloj |
| INV-DEP-01 | Check-in solo dentro de la ventana \[apertura, cierre\] del segmento | C (`CUTOFF_PASSED`, `CHECK_IN_NOT_AVAILABLE`) + A (S-03, S-12) | Departure | `CheckIn` | Unit con reloj |
| INV-DEP-02 | Check-in requiere cupón ISSUED para ese pasajero×segmento | P | Departure | `CheckIn` | Integration |
| INV-DEP-03 | No hay check-in en vuelos DEPARTED o CANCELLED | C (`FLIGHT_ALREADY_DEPARTED`) | Departure | `CheckIn` | Unit |
| INV-DEP-04 | Un segmento afectado por schedule change o cancelación no admite check-in hasta reacomodo | A (S-13) | Departure | `CheckIn` | Integration |
| INV-DEP-05 | Boarding pass solo existe para pasajeros×segmentos CHECKED\_IN y se invalida si cambia el asiento o el vuelo | C + P | Departure | Emisión e invalidación | Unit |
| INV-WH-01 | Un evento público se entrega solo a suscripciones del owner afectado y con ese `eventType` | P (Q-018) | Webhook Delivery | Resolución de destinatarios | Integration |
| INV-WH-02 | `eventId` es estable entre reintentos de la misma entrega | P | Webhook Delivery | Entrega | Unit |

## 16. Failure and Edge Cases

33 casos: 28 Must support MVP (el contrato los exige explícita o implícitamente), 4 Should support y 1 Future, más partes Future dentro de EC-17 y EC-21. Cuando el contrato determina el comportamiento, prevalece.

| # | Caso | Comportamiento esperado | Contrato | Clasificación |
| --- | --- | --- | --- | --- |
| EC-01 | Offer expired | `POST /offers/hold` → 409 `OFFER_NO_LONGER_AVAILABLE`; seat map → 404 | Parcial (sin 410) | Must |
| EC-02 | Hold expired | `POST /bookings` → 410; `GET hold` → EXPIRED; webhook `hold.expired` | Sí (410) | Must |
| EC-03 | Precio cambiado entre búsqueda y hold | Hold se crea con el precio vigente y lo devuelve en `lockedPrice`; el cliente compara con `grandTotal` (PROPUESTO; alternativa 409, Q-039) | No | Must |
| EC-04 | Inventario agotado | `POST /offers/hold` → 409 `OFFER_NO_LONGER_AVAILABLE` | Sí | Must |
| EC-05 | Último asiento reservado simultáneamente | Decremento atómico: un 201, el resto 409 | Sí (409) | Must |
| EC-06 | Request duplicado (misma key, mismo payload) | Replay de la respuesta original con el mismo status | Sí (key obligatoria) | Must |
| EC-07 | Cliente reintenta después de timeout | Igual a EC-06; si la operación sigue en curso → 409 con `Retry-After` (PROPUESTO) | Parcial | Must |
| EC-08 | Misma key, payload distinto | 422 `VALIDATION_FAILED` con detalle (sin código específico, GAP-031) | No | Must |
| EC-09 | PaymentReference inválido | 422 `PAYMENT_REFERENCE_INVALID`; reserva no se crea o queda FAILED; hold sigue HELD | Sí | Must |
| EC-10 | Pago no autorizado / monto distinto | 422 `PAYMENT_NOT_AUTHORIZED` / `AMOUNT_MISMATCH` | Sí | Must |
| EC-11 | Pago autorizado pero ticketing falla | FAILED, void de emitidos, liberar inventario y asientos, `booking.failed` con `requiresRefund` hacia dominio de reembolsos | Sí (`TICKET_ISSUANCE_FAILED`, estados) | Must |
| EC-12 | Ticket parcialmente emitido | Reintento de cupones FAILED; si persiste, EC-11 (INV-TKT-04) | Sí (`TicketSegmentStatus`) | Must |
| EC-13 | Timeout de dependencia interna o externa (Payment API, emisor) | Circuit breaker; 202 con estado pendiente si ya se aceptó; 503 si no (no declarado, GAP-018) | Parcial (202) | Must |
| EC-14 | Cancelación de vuelo por la aerolínea | `flight.cancelled`; reserva marca segmento afectado; check-in bloqueado; reacomodo manual/POST-MVP; reembolso involuntario (Q-033) | Sí (webhook) | Must (notificación) / Should (reacomodo) |
| EC-15 | Retraso | Estado DELAYED en `/flights/{n}/status`; webhook `flight.schedule_changed` si supera umbral (Q-036) | Sí | Must |
| EC-16 | Schedule change | `flight.schedule_changed`, `booking.changed` si se reacomoda; conexiones que quedan bajo MCT se marcan | Sí (webhooks) | Must (notificación) / Should (validación MCT de reservas existentes) |
| EC-17 | Codeshare (marketing ≠ operating) | Mostrar ambos carriers; check-in NOT\_ELIGIBLE si opera un tercero (S-04, S-12) | Sí (campos) | Must (modelo) / Future (vender inventario de terceros, Q-022) |
| EC-18 | Multidestino hasta 6 tramos | Soportado en búsqueda y reserva | Sí (`maxItems: 6`) | Must |
| EC-19 | Conexiones | `stopsCount`, `layoverMinutes`; MCT en ItineraryBuilder | Sí | Must |
| EC-20 | Infante | Sin asiento, asociado a adulto, ≤ 1 por adulto, sin `assignedSeats` | Sí (422) | Must |
| EC-21 | Menores (CHILD, YOUTH) | Validación de edad por tipo; menor no acompañado no soportado (adults ≥ 1) | Parcial | Must (validación) / Future (UMNR) |
| EC-22 | Cambio de fecha | OP-11/OP-12 con CHANGE\_PENDING y 410 | Sí | Must |
| EC-23 | Tarifa no modificable | 409 `FARE_NOT_CHANGEABLE` en date-change/search | Sí | Must |
| EC-24 | Tarifa no reembolsable | Quote con `isRefundable=false`, `refundAmount` = tasas reembolsables o 0 (Q-033) | Sí (campos) | Must |
| EC-25 | Baggage limits | 409 `BAGGAGE_LIMIT_EXCEEDED` | Sí | Must |
| EC-26 | Seat cabin mismatch | 422 `SEAT_CABIN_MISMATCH` | Sí | Must |
| EC-27 | Check-in fuera de ventana | 409 `CHECK_IN_NOT_AVAILABLE` (antes de apertura) o `CUTOFF_PASSED` (después de cierre) | Sí | Must |
| EC-28 | Infante que cumple 2 años antes del regreso | Rechazar como INFANT y exigir CHILD (S-07, S-09) | No | Should |
| EC-29 | Cambio de equipo (aeronave) tras asignar asientos | Reasignación automática en misma cabina; liberar e informar si no cabe | No | Should |
| EC-30 | Evento duplicado o fuera de orden en el bus | Inbox dedupe + `aggregateVersion` | N/A (interno) | Must (soporte) |
| EC-31 | Webhook receptor caído | Reintentos con backoff, DLQ, desactivar suscripción tras N fallos (Q-018) | Parcial | Should |
| EC-32 | Cancelar mientras CHANGE\_PENDING o TICKET\_ISSUING | 409 hasta que termine la Saga (PROPUESTO, Q-037) | No | Should |
| EC-33 | Pago asíncrono confirmado después de expirar el hold | FAILED + refund; no se reserva inventario fuera de hold (PROPUESTO) | No | Future (depende de Q-005) |

Nota de conteo: EC-14, EC-16, EC-17 y EC-21 combinan una parte Must con otra posterior; en el total se cuentan como Must.

## 17. Non-Functional Requirements

No hay datos de volumen, SLA ni presupuesto; los objetivos numéricos quedan como decisión pendiente (Q-024) y solo se fijan aquí los requisitos estructurales que ya se derivan del contrato y del dominio. Los valores marcados "inicial" son propuestas para arrancar pruebas de carga, no compromisos.

| ID | Categoría | Requisito | Justificación | Verificación |
| --- | --- | --- | --- | --- |
| NFR-AV-01 | Availability | La búsqueda y el estado de vuelo degradan de forma independiente del flujo de reserva | Endpoints públicos con carga distinta | Chaos test: caída de FR no afecta `/search` |
| NFR-AV-02 | Availability | Si Ticketing o Payment API no responden, `POST /bookings` responde 202 con estado persistido en lugar de fallar | Contrato permite 202 | Fault injection |
| NFR-AV-03 | Availability | Si Inventory no está disponible, hold y reserva fallan rápido (fail-fast, sin reintentos largos en request) | Consistencia fuerte requerida | Integration |
| NFR-AV-04 | Availability | Webhook Delivery puede caer sin pérdida de eventos (bus persistente) | At-least-once | Chaos test |
| NFR-SC-01 | Scalability | Pricing escala horizontalmente y sin estado de sesión; ofertas en almacenamiento con TTL | Search-to-book alto (INFERIDO) | Load test |
| NFR-SC-02 | Scalability | Inventory serializa escrituras por instancia×cabina, no globalmente | Contención localizada | Concurrency test con 1 000 holds sobre 1 instancia (inicial) |
| NFR-SC-03 | Scalability | Disponibilidad para búsqueda servida desde réplica de lectura o cache con frescura acotada | Separar lectura de contención | Load test |
| NFR-CO-01 | Consistency | Fuerte: capacidad y holds (Inventory), asignación de asiento (Ancillaries), transiciones de un agregado | Overbooking y doble asignación son inaceptables | Concurrency tests |
| NFR-CO-02 | Consistency | Eventual: proyecciones (tickets en detalle de reserva, estado en Ancillaries/Departure, webhooks, disponibilidad en búsqueda) | Aislamiento entre servicios | Tests de convergencia |
| NFR-PE-01 | Performance | Presupuesto síncrono de `POST /bookings` antes de devolver 202 | Define 201 vs 202 | Decisión pendiente Q-006 |
| NFR-PE-02 | Performance | Objetivos iniciales p95: search 1,5 s; hold 500 ms; lecturas por id 200 ms | Referencia para primer load test, sin evidencia de negocio | Load test; revisar con Q-024 |
| NFR-PE-03 | Performance | Deadlines gRPC propagados; ningún hop sin deadline | Evitar cascadas | Architecture test (interceptor obligatorio) |
| NFR-SE-01 | Security | Ver sección 18 | — | — |
| NFR-OB-01 | Observability | Ver sección 19 | — | — |
| NFR-RE-01 | Reliability | Ver sección 20 | — | — |
| NFR-DA-01 | Data | Retención de PII limitada y borrado/anonimización tras fin de viaje + plazo legal | LOPDP Ecuador / GDPR si aplica | Q-021 |
| NFR-OP-01 | Operability | Cada servicio desplegable y escalable de forma independiente, con health/readiness y migraciones propias | Database per service | CI/CD |
| NFR-TI-01 | Time | Todas las marcas de tiempo en UTC; fechas de vuelo en hora local del aeropuerto con zona IANA | Vuelos cruzan zonas | Unit |

La disponibilidad objetivo (SLO) de cada endpoint no se inventa: queda en Q-024 junto con volumen esperado de búsquedas, reservas por día y picos.

## 18. Security Model

La autenticación termina en el Gateway, pero la autorización por owner se aplica en cada servicio dueño del dato: el Gateway no es la única barrera. Flight Platform no almacena datos de tarjeta; solo `paymentReference`.

**Autenticación y autorización (DOCUMENTADO + PROPUESTO):**

- OAuth2 con dos flujos: `authorizationCode` (usuario final; `sub` = persona) y `clientCredentials` (B2B; `sub` = cliente). El Gateway valida firma JWT (JWKS del Authorization Server), `iss`, `aud`, `exp`, `nbf` y scopes por operación (tabla de la sección 4).
- `ownerId` = `sub`; el Gateway lo propaga en metadata gRPC `x-owner-id` y los servicios filtran siempre por él. Un recurso de otro owner responde 404 (no 403) para no revelar existencia (PROPUESTO; el contrato no declara 403).
- Visibilidad B2B: un cliente B2B solo ve reservas creadas con su propio `sub`; si Booking Platform necesita ver reservas de sus usuarios finales, debe usar el token del usuario o un claim de delegación (Q-019).
- Endpoints públicos (`/search`, seatmap, flight status): sin token; protegidos por rate limiting por IP + `X-Device-Fingerprint`, y sin datos personales en la respuesta.
- Comunicación interna: mTLS entre Gateway y servicios y entre servicios; los servicios no aceptan tráfico que no venga del mesh o del Gateway.

**Idempotencia y abuso:**

- `Idempotency-Key` almacenada por (`sub`, método, path, key) con hash del cuerpo y respuesta, TTL mínimo de 24 h (inicial, Q-040).
- Rate limiting por cliente (`client_id`), por `sub` y por IP; 429 con `Retry-After` y `RATE_LIMIT_EXCEEDED`. Límites más estrictos en `/offers/hold` para evitar acaparamiento de inventario (máximo de holds activos por owner, Q-041).
- Webhooks: validación de URL (HTTPS, no IP privadas ni link-local, resolución DNS verificada al enviar) contra SSRF; el secreto nunca se devuelve en lecturas.

**Clasificación de datos:**

| Dato | Clase | Almacena | No debe almacenar |
| --- | --- | --- | --- |
| Nombre, fecha de nacimiento, género, email, teléfono del pasajero | PII | Flight Reservation | Pricing, Inventory, Webhook Delivery |
| Tipo y número de documento, nacionalidad, vencimiento | PII de identidad (alta sensibilidad) | Flight Reservation (cifrado a nivel de campo) | Todos los demás; Departure lo lee bajo demanda para check-in sin persistirlo más allá del registro requerido (Q-021) |
| Nombre en ticket | PII mínima | Ticketing (nombre en ticket) | — |
| Nombre en boarding pass | PII mínima | Departure | — |
| `paymentReference`, resultado de validación, monto | Dato financiero referenciado | Flight Reservation, Ancillaries | Número de tarjeta, CVV, datos 3DS (nunca llegan) |
| `sub` / `client_id` | Identificador | Todos los servicios que filtran por owner | — |
| Horarios, capacidad, estado de vuelo | Operacional | Inventory, Operations | — |
| Tarifas y reglas | Comercial | Pricing | — |
| Secreto de webhook | Secreto | Webhook Delivery (cifrado, KMS) | Logs, respuestas |

**Reglas de manejo:**

- Logs y trazas sin PII ni secretos: los campos de pasajero se enmascaran (`documentNumber` → últimos 3 caracteres) mediante un serializador común verificado por test.
- Eventos internos con PII mínima: `TicketIssuanceRequested` lleva nombre, no documento; eventos hacia Webhook Delivery no llevan PII (el payload público tampoco la tiene).
- Secretos (credenciales de DB, claves de firma, credenciales hacia Payment API) en un gestor de secretos; nada en variables de repositorio.
- Cifrado en tránsito (TLS 1.2+) y en reposo en todas las bases; cifrado de campo para documento de identidad.
- Auditoría: registro inmutable de accesos a PII y de mutaciones de reserva con `sub`, `client_id`, `correlationId`.

## 19. Observability Model

Una operación se correlaciona de punta a punta con dos identificadores: `traceparent` (W3C Trace Context, para trazas técnicas) y `correlationId` (negocio, estable a través de procesos asíncronos y reintentos). Como `ProblemDetails` no admite campos extra (GAP-031), ambos viajan en headers de respuesta.

```text
REST request ──► Gateway ──► gRPC ──► Servicio ──► Outbox ──► Bus ──► Consumer ──► Webhook
 X-Correlation-Id (o generado)     metadata x-correlation-id + traceparent
 traceparent (o generado)           envelope: correlationId, causationId, traceparent
 Respuesta: X-Correlation-Id, traceparent        WebhookPayload: eventId (+ header X-Correlation-Id, PROPUESTO)
```

**Reglas (PROPUESTO):**

- El Gateway acepta `X-Correlation-Id` del cliente si es válido o genera uno; siempre lo devuelve. También devuelve `X-Request-Id` por intento.
- Cada evento lleva `correlationId` del comando que lo originó y `causationId` = `eventId` o requestId inmediatamente anterior; la Saga de reserva se reconstruye filtrando por `correlationId` = `bookingId` desde su creación.
- Spans obligatorios: request HTTP, cada RPC (cliente y servidor), cada transacción de base, publicación Outbox, consumo Inbox, llamada a Payment API, entrega de webhook. El relay de Outbox continúa la traza del productor (link de span).
- Logs estructurados JSON con campos fijos: `timestamp`, `level`, `service`, `traceId`, `spanId`, `correlationId`, `ownerId` (hash), `operation`, `aggregateId`, `outcome`, `errorCode`. Sin PII (sección 18).

**Métricas mínimas por servicio (RED + negocio):**

| Área | Métrica |
| --- | --- |
| Gateway | requests por operación/status, latencia p50/p95/p99, 429 por cliente, replays de idempotencia |
| Pricing | búsquedas, ofertas por búsqueda, búsquedas sin resultados, holds creados/rechazados (409), look-to-book |
| Inventory | holds activos, expirados por minuto, consumo, conflictos de optimistic locking, capacidad restante por instancia |
| Flight Reservation | reservas por estado, duración de Saga por fase, 202 vs 201, compensaciones, validaciones de pago fallidas por código |
| Ticketing | emisiones OK/fallidas/parciales, reintentos, voids |
| Ancillaries | `SEAT_TAKEN`, compras de equipaje, `BAGGAGE_LIMIT_EXCEEDED` |
| Departure/Ops | check-ins por estado, fuera de ventana, cambios operacionales emitidos |
| Bus / Outbox | lag de consumidores, antigüedad del mensaje más viejo en Outbox, mensajes en DLQ |
| Webhook Delivery | entregas por status, reintentos, suscripciones desactivadas |

**Alertas candidatas:** reservas en TICKET\_ISSUING o CANCELLATION\_PENDING más de N minutos (Saga atascada); Outbox con mensajes más antiguos que el umbral; DLQ con mensajes; tasa de 409 en holds anómala (posible acaparamiento); discrepancia de reconciliación inventario (retenido + vendido ≠ Σ holds + reservas).

## 20. Reliability and Consistency Strategy

No hay transacciones distribuidas (sin 2PC): cada servicio confirma localmente y publica por Outbox; los procesos multi-servicio son Sagas con compensación. La única Saga con un paso difícil de revertir es la emisión de tickets, y por eso el pago se valida antes de consumir el hold y emitir.

**Mecanismos por operación:**

| Operación | Tx local | Optimistic locking | Idempotencia | Saga | Outbox | Inbox | Retry | Timeout / TTL | Compensación |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Search | — | — | — | — | — | — | Lectura, 1 reintento | Deadline por tramo; TTL de oferta | — |
| Hold | Sí (Inventory) | Sí (capacidad) | Key HTTP + key de dominio | Mini (Pricing orquesta 2 pasos) | Sí | — | No automático en request | TTL de hold | Liberar hold si falla PriceLock |
| Expiración de hold | Sí | Sí | Por estado | — | Sí | Pricing, Webhook | Barrido reintentable | TTL | — |
| Create reservation | Sí (FR) | Sí (reserva) | Key HTTP + unique en FR | Orquestada (FR) | Sí | Ticketing, FR (resultados) | Pasos gRPC idempotentes con backoff; Payment API con circuit breaker | Presupuesto síncrono (Q-006) | Liberar asientos/equipaje, void tickets, notificar refund |
| Emisión de tickets | Sí (Ticketing) | Sí | (bookingId, requestId) | Paso de la Saga | Sí | Sí | Reintentos por cupón | Límite de reintentos (Q-042) | Void de emitidos |
| Equipaje postventa | Sí (Ancillaries) | Sí (entitlement) | Key | — | Sí | — | Payment API | — | Notificar refund si falla tras cobro |
| Date change | Sí | Sí | Key + changeOfferId único | Orquestada (FR) | Sí | Ticketing | Sí | TTL de change offer | Liberar hold nuevo, restaurar itinerario |
| Cancelación | Sí | Sí | Key + quoteId único | Coreografía con agregación en FR | Sí | Ticketing, Inventory, Ancillaries, Departure | Sí | TTL de quote | — (solo liberaciones) |
| Check-in | Sí (Departure) | Sí (asiento) | Por estado (repetir = mismo resultado) | — | Sí | — | Lecturas gRPC | Ventana de check-in | Liberar asiento auto-asignado si falla |
| Webhook | Sí | — | `eventId` | — | — | Sí (consume bus) | Backoff exponencial | Timeout por entrega | DLQ + desactivación |

**Estrategia de Saga:**

- Reserva y cambio de fecha: **orquestación** en Flight Reservation, con estado de Saga persistido en el agregado (fase, pasos completados, compensaciones pendientes), porque el contrato expone estados intermedios y el orden importa (pago antes de emitir).
- Cancelación: **coreografía** (un evento, varios consumidores independientes) con agregación de confirmaciones en FR; los pasos no dependen entre sí.
- Timeouts de Saga: un scheduler en FR revisa Sagas estancadas y aplica reintento o compensación según la fase.

**Mensajería:**

- Entrega at-least-once; consumidores idempotentes por Inbox (`eventId` único).
- Orden garantizado por agregado (clave de partición = `aggregateId`); sin orden global.
- DLQ por consumidor con reproceso manual o automático tras corrección; un mensaje en DLQ genera alerta.
- Esquemas versionados; un consumidor ignora campos desconocidos y rechaza versiones mayores que no conoce (a DLQ).

**Resiliencia síncrona:**

- Deadlines propagados en toda llamada gRPC; reintentos solo en RPCs idempotentes y con presupuesto (máx. 2, backoff con jitter, inicial).
- Circuit breaker hacia Payment API y entre servicios críticos; bulkheads para que la búsqueda no agote conexiones del flujo de reserva.
- Reconciliación periódica: holds HELD vencidos, reservas en estados intermedios, cupones sin reserva, asientos PROVISIONAL huérfanos.

**Kafka vs RabbitMQ (análisis, decisión en ADR-04):** Kafka favorece replay para reconstruir proyecciones, retención larga y orden por partición; RabbitMQ favorece enrutamiento flexible, colas de trabajo con reintentos y menor costo operativo en MVP. Ambos cumplen los requisitos anteriores si se diseña Inbox/Outbox; el diseño no depende de features exclusivas de ninguno salvo el replay, que puede sustituirse con endpoints de backfill.

## 21. Testing Strategy Inputs

Seis categorías de verificación, cada una candidata a quality gate; la matriz indica qué categoría es obligatoria (●) o recomendada (○) por área. Las invariantes (sección 15) y los casos de borde (sección 16) son la fuente de los casos concretos.

| Área | Unit | Contract | Integration | Architecture | Concurrency | E2E |
| --- | --- | --- | --- | --- | --- | --- |
| API Gateway | ○ mapeo de errores | ● OpenAPI (request/response/errores por operación) | ● Gateway ↔ stubs gRPC | ● sin lógica de dominio, sin acceso a DB de servicios | ● idempotencia HTTP | ● |
| Inventory & Schedule | ● INV-INV-\* | ● Protobuf `inventory.v1` | ● DB + Outbox | ● no importa otros contextos | ● último asiento, consumo doble, DELETE vs Consume | ○ |
| Pricing & Fares | ● cálculo de precios, MCT, reglas (property-based) | ● `pricing.v1`, consumer de `inventory.v1` | ● ofertas con TTL, PriceLock | ● | ○ | ● search → hold |
| Flight Reservation | ● validaciones de pasajeros, máquina de estados | ● `reservation.v1`, consumer de inventory/pricing/ancillaries, ACL Payment API | ● Saga con fakes, Outbox/Inbox | ● | ● misma key concurrente, quote/changeOffer único | ● search → hold → book → tickets |
| Ticketing | ● INV-TKT-\*, estados de cupón | ● esquemas de eventos | ● redelivery, emisión parcial | ● sin gRPC saliente | ● evento duplicado concurrente | ● |
| Ancillaries | ● elegibilidad de asiento, límites de equipaje | ● `ancillaries.v1` | ● proyección de reserva | ● | ● mismo asiento por dos pasajeros, compras paralelas | ○ |
| Operations & Departure | ● ventana, elegibilidad, transiciones operacionales | ● `departure.v1`, `flightops.v1` | ● | ● | ○ check-in doble | ● book → check-in → boarding pass |
| Webhook Delivery | ● traducción y firma | ● `WebhookPayload` del OpenAPI (callback) | ● reintentos, DLQ | ● | ○ | ● evento → callback firmado |
| Transversal | — | ● `buf breaking`, compatibilidad de eventos | ● observabilidad (correlationId de punta a punta) | ● reglas de sección 22 | — | ● journeys de sección 6 |

**Journeys E2E mínimos (MVP):**

1. Search → hold → booking (201 síncrono) → tickets → detalle → check-in → boarding pass.
2. Search → hold → booking con emisión lenta (202) → webhook `booking.ticket_issued` y `booking.confirmed`.
3. Hold → expiración → webhook `hold.expired` → booking con 410.
4. Booking con `paymentReference` inválido → 422, hold intacto → reintento con referencia válida.
5. Booking con fallo de ticketing inyectado → FAILED, compensación completa, `booking.failed`.
6. Postventa: baggage-options → baggage (200) → límite (409).
7. Date change: search → confirm con diferencia a pagar → `booking.changed`; tarifa no cambiable → 409; change offer expirado → 410.
8. Cancelación: quote → cancel → CANCELLED → `booking.cancelled`; quote expirado → 410.
9. Operaciones: vuelo cancelado → `flight.cancelled` → check-in NOT\_ELIGIBLE.

**Dobles de prueba necesarios:** Payment API simulada (estados autorizado, pendiente, inválido, monto distinto, timeout); Authorization Server de prueba (JWKS, tokens por scope y por flujo); reloj controlable inyectado en los servicios con TTL; receptor de webhooks de prueba con verificación de firma; feed operacional de prueba para eventos `Flight*`.

## 22. Automatable Architecture Constraints

40 reglas verificables sin juicio humano; las 27 marcadas *blocking* deben fallar el pipeline. La columna "Tipo" indica el mecanismo más barato que la verifica; varias pueden reforzarse con un segundo mecanismo.

| ID | Regla | Tipo de verificación posible | Severidad |
| --- | --- | --- | --- |
| AC-01 | Ningún servicio importa código de dominio, aplicación o persistencia de otro contexto (solo stubs gRPC generados y esquemas de eventos) | Architecture test (reglas de dependencia por paquete/módulo) | blocking |
| AC-02 | Cada servicio usa exclusivamente su propia base/esquema; credenciales de DB distintas por servicio | Config lint + test de integración que intenta acceder a otro esquema | blocking |
| AC-03 | No existen FKs, vistas ni joins hacia esquemas de otro servicio | Linter de migraciones (análisis de DDL) | blocking |
| AC-04 | Solo el API Gateway expone HTTP público; los servicios exponen solo gRPC (más health/metrics internos) | Architecture test + escaneo de manifiestos de despliegue | blocking |
| AC-05 | El grafo de llamadas gRPC coincide con la tabla de la sección 11; una arista nueva requiere ADR | Dependency check (clientes gRPC declarados por servicio vs. allowlist) | blocking |
| AC-06 | El grafo de llamadas gRPC es acíclico | Script sobre la allowlist de AC-05 | blocking |
| AC-07 | Inventory, Ticketing y Webhook Delivery no tienen clientes gRPC salientes hacia otros contextos | Dependency check | blocking |
| AC-08 | Los consumidores externos no acceden al bus, gRPC ni DB (sin ingress público a esos puertos) | Test de infraestructura / política de red | blocking |
| AC-09 | La implementación del Gateway cumple el OpenAPI (paths, métodos, schemas, códigos, `application/problem+json`) | Contract test (validación de requests/responses contra el spec) | blocking |
| AC-10 | El archivo OpenAPI no cambia sin aprobación del API owner | CI gate (CODEOWNERS + diff del spec) | blocking |
| AC-11 | Cambios en `.proto` son retrocompatibles dentro de `v1` | `buf breaking` en CI | blocking |
| AC-12 | Esquemas de eventos retrocompatibles | Schema registry compatibility check | blocking |
| AC-13 | Toda operación con `Idempotency-Key` requerida en el spec lo rechaza si falta (400) | Contract test generado desde el spec | blocking |
| AC-14 | `ownerId`/`customerId` nunca se lee del body ni de query | Contract test + lint (ningún DTO de entrada tiene ese campo) | blocking |
| AC-15 | Toda consulta de repositorio sobre recursos con owner filtra por `owner_id` | Architecture test (convención de repositorio) + test de integración con dos owners | blocking |
| AC-16 | Toda escritura que cambie estado de un agregado con eventos usa Outbox en la misma transacción | Architecture test (publicar al bus solo desde el relay) | blocking |
| AC-17 | Ningún servicio publica al bus directamente desde el código de aplicación | Dependency check (solo el módulo relay depende del cliente del broker) | blocking |
| AC-18 | Todo consumidor de eventos pasa por Inbox (dedupe por `eventId`) | Architecture test | blocking |
| AC-19 | Todo Integration Event tiene envelope completo (sección 13) | Schema lint | blocking |
| AC-20 | Ningún payload de webhook se construye a partir de un evento interno sin traductor | Architecture test en Webhook Delivery | major |
| AC-21 | Toda llamada gRPC saliente tiene deadline | Interceptor obligatorio + test | blocking |
| AC-22 | Metadata `x-correlation-id` y `traceparent` presentes en cada RPC y evento | Interceptor + contract test | major |
| AC-23 | Montos nunca son `float`/`double` | Lint (proto y código) | blocking |
| AC-24 | No hay PII en logs (documento, email, teléfono, fecha de nacimiento) | Test de serializador + escaneo de logs en E2E | blocking |
| AC-25 | Flight Platform no tiene campos de tarjeta (PAN, CVV, expiración) en ningún schema, proto o tabla | Lint por patrones de nombre + revisión de spec | blocking |
| AC-26 | Secretos no están en el repositorio | Secret scanning en CI | blocking |
| AC-27 | El servicio interno de reservas se llama Flight Reservation / CRS; no existe módulo `booking-service` | Lint de nombres de módulos/paquetes | minor |
| AC-28 | Cada servicio tiene reloj inyectable (sin `now()` directo en dominio) | Architecture test | major |
| AC-29 | Cada máquina de estados rechaza transiciones no listadas en la sección 14 | Unit tests generados desde tablas de transición | blocking |
| AC-30 | Cada invariante de la sección 15 tiene al menos un test enlazado por ID | Script de trazabilidad (ID en nombre/tag del test) | major |
| AC-31 | Cada `ProblemDetails.code` usado corresponde al enum del spec | Contract test | blocking |
| AC-32 | La tabla de mapeo gRPC `reason` → HTTP/code es única y cubre todos los reasons emitidos | Script | major |
| AC-33 | Endpoints públicos sin auth tienen rate limit configurado | Config lint del Gateway | major |
| AC-34 | Cada operación protegida exige exactamente el scope del spec | Contract test generado desde `security` | blocking |
| AC-35 | Las lecturas de secreto de webhook nunca lo devuelven | Contract test | major |
| AC-36 | Cada servicio expone health, readiness y métricas RED | Smoke test de despliegue | major |
| AC-37 | Migraciones de base versionadas y reversibles por servicio | CI (aplicar/revertir en contenedor efímero) | major |
| AC-38 | Cada proyección local declara su evento fuente y un mecanismo de rebuild | Architecture test / checklist en código | minor |
| AC-39 | Cada ADR aceptado referencia las reglas que introduce | Script sobre `docs/adr` | minor |
| AC-40 | Cobertura mínima de líneas en dominio (umbral por decidir, Q-043) | Coverage gate | major |

## 23. Implementation Precedence Constraints

El camino crítico es Inventory → Pricing (hold) → Flight Reservation → Ticketing; todo lo demás cuelga de él o es paralelo. Esta sección dice qué debe existir antes de qué, sin convertirlo en tareas.

### 23.1 Precedencia por capa (dentro de cada capacidad)

```text
OpenAPI (congelado para la capacidad)
   ↓
Decisiones bloqueantes de la capacidad resueltas (sección 25)
   ↓
Application use case + mapeo REST ↔ gRPC y tabla de errores
   ↓
Contrato Protobuf (servicio + mensajes) y esquemas de eventos
   ↓
Modelo de dominio (agregados, invariantes, máquina de estados) + unit tests
   ↓
Persistencia (esquema propio, Outbox/Inbox)
   ↓
Adapters (servidor gRPC, clientes gRPC, relay, consumer, ACL externo)
   ↓
Ruta en Gateway + contract test contra OpenAPI
   ↓
Event consumers / proyecciones y webhooks
```

### 23.2 Precedencia transversal (antes de cualquier capacidad)

| Elemento | Debe existir antes de | Motivo |
| --- | --- | --- |
| ADRs fundacionales (ADR-01, 02, 03, 04, 05, 09) | Estructura del repositorio y primer servicio | Fijan comunicación, persistencia, broker e idempotencia |
| Paquete `common.v1` (Money, PassengerMix, enums) | Cualquier otro `.proto` | Tipos compartidos |
| Convenciones de errores gRPC → ProblemDetails (tabla única) | Primera ruta del Gateway | AC-31, AC-32 |
| Librería/plantilla de Outbox, Inbox, interceptores (deadline, correlación, owner) | Primer servicio con eventos | AC-16..AC-22 |
| Authorization Server de prueba y validación JWT en Gateway | Cualquier endpoint protegido | INV-RES-01, AC-34 |
| Reloj inyectable y harness de tiempo | Holds, ofertas, quotes, check-in | Todas las invariantes con TTL |
| Payment API simulada + ACL | Reservas, equipaje postventa, cambio | INV-RES-08 |
| Pipeline de contract tests contra OpenAPI y `buf breaking` | Primera ruta pública | AC-09, AC-11 |

### 23.3 Precedencia entre capacidades

```text
Carga de horarios/capacidad (CAP-13) ──┐
Carga de tarifas/brands (CAP-14) ──────┤
                                       ▼
                              Search (CAP-01)
                                       ▼
                    Hold + PriceLock + expiración (CAP-03, CAP-15)
                                       ▼
            Reservation + PNR + validación de pago (CAP-04) ◄── Seat map / asientos en compra (CAP-02)
                                       ▼
                           Ticketing (CAP-05)
                                       ▼
       ┌──────────────┬───────────────┬──────────────────┬──────────────────┐
       ▼              ▼               ▼                  ▼                  ▼
 Consultas (CAP-06)  Equipaje (CAP-07)  Cambio (CAP-08)  Cancelación (CAP-09)  Check-in (CAP-10)
                                                                            ▲
                                      Estado de vuelo / eventos ops (CAP-11)┘
Webhook Delivery (CAP-12): suscripciones pueden construirse en paralelo desde el inicio;
la entrega de cada tipo de evento depende de que exista su productor.
```

| Capacidad | Requiere antes | Puede empezar en paralelo con |
| --- | --- | --- |
| CAP-13 horarios/capacidad | ADRs, `common.v1` | CAP-14, CAP-12 (suscripciones), Gateway base |
| CAP-14 tarifas | ADRs, `common.v1`, Q-002 (moneda) | CAP-13 |
| CAP-01 search | CAP-13, CAP-14 (contrato de `QueryAvailability` estable), Q-002, Q-003 | CAP-02 (con `ResolveSegment` estable) |
| CAP-03 hold | CAP-01, Q-004 | Seat map |
| CAP-02 seat map | Instancias con layout (CAP-13), `ResolveSegment` | CAP-03 |
| CAP-04 reserva | CAP-03, Payment ACL (Q-005), Q-006, Q-010, Q-011 | Ticketing (con esquema de eventos acordado) |
| CAP-05 ticketing | Esquemas `TicketIssuanceRequested`/resultados, Q-007 | CAP-04 |
| CAP-06 consultas | CAP-04 (lectura de reservas); tickets requieren CAP-05 | CAP-07, CAP-11 |
| CAP-07 equipaje | CAP-04 + proyección de reserva, precio de equipaje en Pricing | CAP-08, CAP-09 |
| CAP-08 cambio | CAP-04, CAP-05 (reemisión), Q-020 | CAP-09 |
| CAP-09 cancelación | CAP-04, CAP-05 (void/refund), Q-015, Q-033 | CAP-08 |
| CAP-11 estado de vuelo | CAP-13 (instancias) | Casi todo; Q-016 para el origen de cambios |
| CAP-10 check-in | CAP-05 (cupones), asignación de asientos, CAP-11, Q-012, Q-013 | CAP-08, CAP-09 |
| CAP-12 webhooks | Suscripciones: Gateway + auth. Entrega: cada productor | Todo |

**Restricción clave:** Flight Reservation y Ticketing pueden desarrollarse en paralelo solo después de congelar los esquemas de eventos entre ambos; Pricing y Ancillaries solo después de congelar `inventory.v1`.

## 24. ADR Candidates

17 decisiones merecen ADR formal; 13 tienen dirección recomendada con la evidencia actual y 4 dependen de preguntas abiertas. Las fundacionales (ADR-01, 02, 03, 04, 05, 09) deben aceptarse antes de crear el repositorio.

| ID | Decision | Context | Why it matters | Alternatives to evaluate | Recommended direction |
| --- | --- | --- | --- | --- | --- |
| ADR-01 | API First: el OpenAPI v1.5.0.0 es la fuente de verdad pública | Mandato del proyecto; contrato ya existe | Evita que el modelo de datos deforme la API | Code-first con generación de spec | Aceptar. Cambios solo vía gap registrado y aprobación del API owner (AC-10) |
| ADR-02 | REST/JSON externo, gRPC interno, eventos para asincronía | Mandato + frontera Booking Platform | Define todos los adapters | GraphQL externo; REST interno; solo eventos | Aceptar tal cual |
| ADR-03 | Database per microservice sin FKs cruzadas | Mandato DDD | Autonomía de despliegue; exige proyecciones | Esquemas por servicio en un mismo motor vs. motores separados | Aceptar; en MVP basta un esquema y credenciales por servicio en un clúster compartido (decisión operativa) |
| ADR-04 | Broker: Kafka vs RabbitMQ | Sección 20 | Afecta replay, orden, operación | Kafka, RabbitMQ, cola gestionada en nube | Pendiente (Q-014). Criterio: si se requiere replay para reconstruir proyecciones, Kafka; si prima simplicidad operativa, RabbitMQ con backfill por gRPC |
| ADR-05 | Idempotencia en dos niveles | Contrato exige `Idempotency-Key` | Duplicados monetarios | Solo en Gateway; solo en dominio | Gateway (replay de respuesta, hash de payload) + clave única en el agregado del servicio |
| ADR-06 | El use case de hold vive en Pricing (Offer Management) | Respuesta combina capacidad y precio | Evita ciclo Inventory ↔ Pricing | Orquestar en Gateway; use case en Inventory | Pricing orquesta; `InventoryHold` sigue en Inventory |
| ADR-07 | Separación InventoryHold (capacidad) / PriceLock (precio) | Dos owners de un mismo "hold" público | Consistencia del precio congelado | Hold con precio dentro de Inventory | Separar; PriceLock expira por evento de Inventory |
| ADR-08 | Estrategia de Sagas | Reserva, cambio, cancelación | Recuperación de fallos parciales | Orquestación total; coreografía total | Orquestación en FR para reserva y cambio; coreografía con agregación para cancelación |
| ADR-09 | Outbox + Inbox obligatorios | Mensajería at-least-once | Evita dual-write y duplicados | CDC sobre log de DB; publicar tras commit | Outbox con relay (o CDC como implementación del relay) + Inbox por consumidor |
| ADR-10 | Detalle de reserva: proyección local vs. composición síncrona | OP-08 incluye tickets y ancillaries | Disponibilidad y latencia de lecturas | Composición en Gateway; composición en FR | Proyección en FR alimentada por eventos |
| ADR-11 | Ticketing como servicio separado desde el MVP | Estados parciales y emisión idempotente | Aislar la parte más riesgosa | Módulo dentro de FR | Separar |
| ADR-12 | Operations & Departure como un solo servicio en MVP | Volumen bajo; datos compartidos | Evitar sobrearquitectura | Dos servicios desde el inicio | Uno solo con paquetes `departure.v1` y `flightops.v1` separados |
| ADR-13 | Naming: Flight Reservation / CRS; recurso REST `/bookings` | Ambigüedad con Booking Platform | Lenguaje ubicuo claro | — | Aceptar; lint AC-27 |
| ADR-14 | Integración con Payment API mediante ACL | Solo `paymentReference` | Aislar cambios del proveedor | Cliente directo | ACL en FR y Ancillaries; contrato pendiente (Q-005) |
| ADR-15 | Semántica de webhooks (firma, reintentos, destinatarios) | Contrato no la define | Seguridad y confiabilidad hacia terceros | HMAC-SHA256 con timestamp; firma asimétrica | Pendiente (Q-018); dirección: HMAC con timestamp, at-least-once, dedupe por `eventId` |
| ADR-16 | Recursos de otro owner responden 404 | Contrato no declara 403 | Evita enumeración | 403 | 404 |
| ADR-17 | Representación de dinero | `MoneyAmount` usa strings | Errores de redondeo | Decimal string; units+nanos; minor units | Pendiente (Q-035); nunca coma flotante |

No se proponen ADRs para decisiones triviales (formato de logs, nombres de métricas): se documentan como convenciones en la guía del repositorio.

## 25. Open Questions

43 preguntas; 24 bloquean la creación de las tareas que dependen de ellas. La columna "Supuesto provisional" solo sirve para avanzar en diseño y debe reemplazarse por la respuesta del decisor, nunca implementarse como definitiva sin confirmación.

| ID | Pregunta | Impacto | Bloquea desarrollo | Quién debería decidir | Supuesto provisional |
| --- | --- | --- | --- | --- | --- |
| Q-001 | ¿Flight Platform es dueña del inventario (PSS propio de una o varias aerolíneas) o agrega inventario de GDS/aerolíneas externas? | High | Sí (todo Inventory y Ticketing) | Product owner + arquitectura | Inventario propio; terceros POST-MVP vía adapter |
| Q-002 | ¿Moneda por defecto y punto de venta de `/search`? ¿Se agrega un campo al request? | High | Sí (Pricing) | Product / API owner | USD por defecto, sin campo nuevo en v1 |
| Q-003 | ¿TTL de una oferta de búsqueda? | High | Sí (Offer) | Product / Revenue | 15 min |
| Q-004 | ¿TTL del hold y si varía por mercado/ruta? | High | Sí (Inventory) | Product / Revenue | Configurable; 20 min por defecto |
| Q-005 | Contrato de Payment API: endpoint, estados, monto, moneda, owner; ¿cómo notifica un pago asíncrono? | High | Sí (reserva, equipaje, cambio) | Dueño de Payment API | Consulta síncrona por referencia; pendiente = reconsulta programada |
| Q-006 | ¿Presupuesto síncrono antes de responder 202 en `POST /bookings`? | High | Sí | Product / API owner | 5 s |
| Q-007 | ¿Numeración de e-ticket (prefijo de aerolínea, rangos)? | Medium | Sí (Ticketing) | Negocio / aerolínea | Prefijo configurable + secuencia propia |
| Q-008 | ¿Se permite overbooking por cabina? | High | No (MVP sin overbooking) | Revenue management | Capacidad vendible = física |
| Q-009 | ¿La selección de asiento es siempre gratuita? ¿Qué significa "gratuito al emitir"? | Medium | Sí (asientos en compra) | Product | Gratuita en MVP |
| Q-010 | Rangos de edad de YOUTH, CHILD, INFANT; franquicia de equipaje de infante | High | Sí (validación de pasajeros) | Product / legal | INFANT < 2, CHILD 2–11, YOUTH 12–15 (a confirmar), ADULT ≥ 16 |
| Q-011 | ¿Máximo de pasajeros por solicitud y por PNR? | Medium | No | Product | 9 con asiento |
| Q-012 | Ventana de check-in (apertura y cierre) por tipo de ruta | High | Sí (check-in) | Operaciones | 48 h a 60 min internacional / 45 min doméstico (referencia S-03) |
| Q-013 | ¿Check-in de todos los pasajeros y segmentos elegibles o selectivo? ¿Cómo se reporta un resultado mixto? | Medium | Sí (check-in) | API owner | Todos los elegibles; COMPLETED con pasajeros FAILED |
| Q-014 | ¿Kafka o RabbitMQ? | Medium | Sí (infraestructura) | Arquitectura / plataforma | Ver ADR-04 |
| Q-015 | ¿Quién ejecuta el reembolso monetario y por qué canal se le notifica? | High | Sí (cancelación, compensaciones) | Dueños de Payment/Refund | Evento consumido por un adaptador hacia el dominio de reembolsos |
| Q-016 | ¿Quién origina schedule changes y cancelaciones operativas? ¿Existe API de administración interna de horarios y tarifas? | High | Sí (CAP-11, CAP-13, CAP-14) | Operaciones / arquitectura | API interna gRPC de administración + carga batch |
| Q-017 | ¿Flight Platform notifica al pasajero final (email/SMS)? | Low | No | Product | No; lo hace Booking Platform vía webhooks |
| Q-018 | Webhooks: alcance por owner, esquema de firma, política de reintentos y desactivación | Medium | Sí (entrega) | API owner / seguridad | Por owner, HMAC-SHA256 con timestamp, 24 h de reintentos |
| Q-019 | ¿Un cliente B2B puede ver reservas creadas por usuarios finales? | Medium | No | Seguridad / product | No |
| Q-020 | Cambio de fecha: ¿nuevo e-ticket o revalidación? ¿cambio parcial de itinerarios? | Medium | Sí (CAP-08) | Negocio | Nuevo e-ticket; cambio por itinerario completo |
| Q-021 | Retención de PII, jurisdicción aplicable y almacenamiento de documentos | High | No (sí antes de producción) | Legal / DPO | Borrado N días tras el viaje |
| Q-022 | ¿Se venden vuelos operados por terceros (codeshare) en el MVP? | Medium | No | Product | Solo se modela el campo |
| Q-023 | Stack tecnológico (lenguaje, motor de DB, orquestación) | Medium | Sí (repositorio) | Equipo de ingeniería | Fuera de este documento |
| Q-024 | SLOs, volumen esperado y picos | Medium | No (sí para load tests) | Product / operaciones | Objetivos iniciales de NFR-PE-02 |
| Q-025 | ¿`GET /bookings?pnr` busca solo dentro del owner? | Low | No | API owner | Sí |
| Q-026 | ¿El seat map antes del hold filtra por la cabina seleccionada? | Low | No | API owner | Devuelve todas las cabinas ofertadas |
| Q-027 | ¿El equipaje extra en `POST /bookings` se suma al monto a validar contra el pago? ¿Con qué precio? | High | Sí (reserva) | Product / API owner | Sí, con `extraCheckedBaggagePrice` del PriceLock |
| Q-028 | ¿El owner del hold debe coincidir con el owner de la reserva? | Medium | Sí | Seguridad | Sí |
| Q-029 | ¿Se permiten varios holds activos sobre la misma oferta? | Low | No | Product | Sí, cada uno retiene capacidad |
| Q-030 | ¿Contra qué monto se evalúa `AMOUNT_MISMATCH`? | High | Sí | Dueño de Payment API | Monto autorizado = total esperado exacto |
| Q-031 | Validar el mapeo `code` → HTTP de la sección 4 | Medium | No | API owner | Tabla de la sección 4 |
| Q-032 | ¿`/search` puede devolver resultados parciales si falla un tramo? | Low | No | Product | No: todos los tramos o 0 resultados |
| Q-033 | Reglas de reembolso involuntario y de tasas en tarifas no reembolsables | High | Sí (cancelación) | Negocio / legal | Involuntario = total; no reembolsable = solo tasas |
| Q-034 | Contenido y firma del barcode del boarding pass | Low | No | Operaciones | Formato BCBP sin firma en MVP |
| Q-035 | Formato de dinero (decimales por moneda, redondeo) | Medium | Sí (Pricing) | API owner | Decimal string con escala ISO 4217 |
| Q-036 | Umbral de retraso que dispara `flight.schedule_changed` | Low | No | Operaciones | 15 min |
| Q-037 | ¿Se puede cancelar durante CHANGE\_PENDING o TICKET\_ISSUING? | Low | No | API owner | No (409) |
| Q-038 | Composición de precios (tasas, cargos) y semántica de `grandTotal` con varias opciones por itinerario | High | Sí (Pricing) | Product / Revenue | `grandTotal` = opción más barata por itinerario |
| Q-039 | Si el precio cambió entre búsqueda y hold, ¿aceptar el nuevo precio o responder 409? | Medium | Sí (hold) | Product | Aceptar y devolverlo en `lockedPrice` |
| Q-040 | Retención de registros de `Idempotency-Key` | Low | No | Arquitectura | 24 h |
| Q-041 | Máximo de holds activos por owner | Medium | No | Product / seguridad | 5 |
| Q-042 | Reintentos máximos de emisión antes de fallar | Medium | No | Operaciones | 3 con backoff, máximo 10 min |
| Q-043 | Umbral de cobertura para el quality gate | Low | No | Equipo | 80 % en dominio |

## 26. Risk Register

16 riesgos iniciales; los 7 de impacto alto y probabilidad media o alta (R-01, R-02, R-03, R-04, R-05, R-10, R-13) deben condicionar el orden de implementación (sección 29, I).

| ID | Risk | Likelihood | Impact | Affected component | Mitigation |
| --- | --- | --- | --- | --- | --- |
| R-01 | Race conditions en el último asiento producen overbooking | High | High | Inventory | Decremento atómico condicional, optimistic locking, concurrency tests como gate, reconciliación periódica |
| R-02 | Emisión parcial de tickets deja reservas pagadas sin ticket completo | Medium | High | Ticketing, FR | Reintento por cupón, void total al agotar reintentos, alerta de Saga atascada, INV-TKT-04 |
| R-03 | Fallo de transacción distribuida (pago acreditado, reserva fallida) sin reembolso | Medium | High | FR, dominio de reembolsos | Validar pago antes de emitir; evento `requiresRefund`; reconciliación diaria con Payment API; Q-015 |
| R-04 | Comandos duplicados (reintentos, doble clic, redelivery) generan doble cobro o doble reserva | High | High | Gateway, FR, Ancillaries, Ticketing | ADR-05 (dos niveles), Inbox, unique constraints, concurrency tests |
| R-05 | Ambigüedades del OpenAPI (31 gaps) llevan a implementaciones inconsistentes entre agentes | High | High | Todos | Resolver gaps bloqueantes antes de crear tareas; contract tests generados desde el spec; tabla única de errores |
| R-06 | Ofertas obsoletas (precio o disponibilidad cambian) generan fricción o precio incorrecto | High | Medium | Pricing | TTL de oferta, revalidación en hold, `lockedPrice` como único precio vinculante |
| R-07 | Acoplamiento excesivo entre microservicios (llamadas en cadena, latencia acumulada) | Medium | Medium | FR, Departure | Grafo acíclico con allowlist (AC-05), proyecciones locales, deadlines |
| R-08 | Snapshots inconsistentes (reserva guarda un itinerario distinto del real tras schedule change) | Medium | Medium | FR, Ancillaries, Departure | Eventos operacionales aplicados por versión; `ReservationAffectedByOperation`; reconciliación |
| R-09 | Orden de eventos (resultado de ticketing antes que confirmación de pago en proyecciones) | Medium | Medium | Consumers | Orden por agregado, `aggregateVersion`, consumidores que toleran desorden entre agregados |
| R-10 | Contrato de Payment API desconocido bloquea el camino crítico | High | High | FR, Ancillaries | Diseñar ACL contra un contrato simulado; priorizar Q-005 |
| R-11 | Holds acaparados por abuso agotan inventario | Medium | Medium | Inventory, Gateway | Máximo de holds por owner (Q-041), rate limit en `/offers/hold`, TTL corto |
| R-12 | Explosión combinatoria en búsqueda multidestino degrada latencia | Medium | Medium | Pricing | Límite de combinaciones por tramo, cache de disponibilidad, timeouts |
| R-13 | Fuga de PII en logs, eventos o webhooks | Medium | High | Todos | AC-24, PII mínima en eventos, cifrado de campo, auditoría |
| R-14 | Webhooks no entregados o duplicados causan estados divergentes en Booking Platform | Medium | Medium | Webhook Delivery | At-least-once + `eventId`, DLQ, el cliente puede releer `GET /bookings/{id}` |
| R-15 | Sobrearquitectura (demasiados servicios para el equipo) retrasa el MVP | Medium | Medium | Todos | 6 servicios + 2 soporte; fusiones documentadas (ADR-12); plantilla común de servicio |
| R-16 | Desfase de reloj entre servicios afecta TTLs | Low | Medium | Inventory, Pricing, Departure | El servicio dueño decide con su reloj; NTP; reloj inyectable en tests |

## 27. MVP Scope

El MVP implementa las 23 operaciones del OpenAPI sin agregar funcionalidades observadas en aerolíneas que el contrato no pide. Todo lo POST-MVP puede añadirse sin romper el contrato actual.

**MVP REQUIRED** (necesario para implementar correctamente el OpenAPI actual):

- CAP-01 a CAP-12 completas (sección 5), con los 23 endpoints y los 12 tipos de webhook.
- Holds con TTL y expiración automática; precio congelado; `Idempotency-Key` en todas las mutaciones que lo exigen.
- Saga de reserva con estados PENDING, PENDING\_PAYMENT, TICKET\_ISSUING, CONFIRMED, FAILED y compensaciones.
- Emisión por pasajero y cupón por segmento con estados parciales, void y refund de tickets.
- Validación de pasajeros (infantes, tipos, documentos) y de asientos (cabina, infante, disponibilidad).
- Cambio de fecha con cotización y reemisión; cancelación con cotización.
- Check-in con ventana, boarding pass con barcode, estado de vuelo y eventos `flight.cancelled` / `flight.schedule_changed`.
- Todos los códigos `ProblemDetails` del enum emitidos en las situaciones de la sección 4.

**MVP SUPPORTING** (infraestructura para que el MVP sea confiable):

- API Gateway con JWT, scopes, idempotencia HTTP, rate limiting, correlación.
- Carga interna de horarios, capacidad, tarifas y brands (sin API pública; Q-016).
- Outbox, Inbox, relay, DLQ, reconciliaciones (holds, Sagas, asientos provisionales).
- ACL hacia Payment API; Payment API simulada para pruebas.
- Webhook Delivery con firma, reintentos y desactivación.
- Observabilidad (trazas, logs estructurados, métricas, alertas de Saga y Outbox).
- Harness de pruebas: contract tests desde OpenAPI, `buf breaking`, architecture tests (sección 22), reloj controlable.

**POST-MVP** (razonables, no necesarias ahora):

| Capacidad | Evidencia | Por qué esperar |
| --- | --- | --- |
| Reacomodo automático ante cancelación o schedule change | S-13 | El contrato solo exige notificar |
| Check-in automático | S-12 | No está en el contrato |
| Hold extendido con señal pagada | S-05 | Requiere pago dentro del hold |
| Venta de inventario de terceros (codeshare/interline) | S-04, S-12 | Depende de Q-001, Q-022 |
| Selección de asiento pagada y precios en seat map | S-10 | El contrato define seat map sin precios |
| EMD para servicios adicionales | Práctica de la industria (INFERIDO) | El contrato no expone documentos de servicio |
| Menor no acompañado y SSR (asistencia, mascotas) | S-04, S-08 | Sin campos en el contrato |
| Cancelación parcial (por pasajero o tramo) | — | El contrato solo cancela la reserva completa |
| Notificaciones directas al pasajero | — | Q-017 |
| APIS / datos migratorios hacia gobiernos | Regulatorio | Fuera del contrato |
| Separar Flight Operations y Departure Control | ADR-12 | Volumen bajo en MVP |
| Overbooking controlado | Q-008 | Requiere revenue management |

**Fuera de alcance permanente de Flight Platform:** procesamiento de tarjetas, 3DS, captura, emisión de reembolsos monetarios, facturación, gestión de clientes, carrito multiproducto de Booking Platform.

## 28. OpenAPI Gaps

31 gaps; 12 bloquean al menos una capacidad hasta que el API owner decida. Ninguno se asume corregido: la implementación sigue el contrato actual y el "cambio recomendado" es solo una propuesta.

| ID | Contrato actual | Gap detectado | Cambio recomendado | Bloquea |
| --- | --- | --- | --- | --- |
| GAP-001 | Título "GDS Flight Core API", "microservicio centralizado", host `api.booking-hub.com`, versión `1.5.0.0` | Mezcla la identidad de Flight Platform con Booking Platform y con un GDS; versión no semver | Renombrar a Flight Platform API; host propio o documentar que es solo DNS; semver `1.5.0` | No |
| GAP-002 | `SearchRequest` sin moneda ni punto de venta | No se sabe en qué moneda se cotiza | Añadir `currency` / `pointOfSale` opcionales | Sí (Q-002) |
| GAP-003 | `X-Device-Fingerprint` obligatorio; sin filtros, orden ni paginación | Propósito y formato del fingerprint no definidos; `totalOffers` sin paginación | Documentar formato y uso; añadir `cabinClass`, `maxStops`, `sort`, `limit` | No |
| GAP-004 | `FlightOffer.airline` único; `grandTotal` por oferta | Itinerarios con varios carriers; con varias cabinas/brands por itinerario el total no es unívoco | Definir `grandTotal` como mínimo o por combinación; `airline` = validating carrier | Sí (Q-038) |
| GAP-005 | `FlightOffer` sin `expiresAt` | El cliente no sabe cuándo la oferta deja de ser retenible | Añadir `expiresAt` | No |
| GAP-006 | `PassengerBreakdown` sin máximos ni relación infantes ≤ adultos | Validación no expresada en el schema | `maximum` total y regla documentada | No |
| GAP-007 | Seat map público por `offerId`; descripción "gratuito al emitir" y "cabina adquirida"; sin `required`; sin 400 | Contradicción: antes de comprar no hay cabina adquirida; significado de "gratuito al emitir" ambiguo | Aclarar semántica; `cabinClass` opcional; `required` en schema; 400/410 | Sí (Q-009, Q-026) |
| GAP-008 | `itinerarySelections.cabinClass` es string libre; `passengersBreakdown` repetido | Puede no coincidir con el enum ni con la búsqueda | Usar el enum de `CabinPricing`; validar contra la oferta | No |
| GAP-009 | Hold: 201, 400, 409, 422 | Sin 404/410 para oferta inexistente o expirada; frontera 409/422 no documentada; sin 401/403 | Documentar códigos por causa | No |
| GAP-010 | `HoldStatusResponse` sin `holdId`, `offerId` | Respuesta no autocontenida | Añadir ids | No |
| GAP-011 | DELETE hold: 204, 404 | Sin respuesta para hold CONSUMED; sin `Idempotency-Key` | 409 si CONSUMED; 204 si ya liberado/expirado | No |
| GAP-012 | `POST /bookings` 201 = "ticket emitido", 202 = "pago o emisión asíncrona"; estados PENDING y PENDING\_PAYMENT | Diferencia entre PENDING y PENDING\_PAYMENT no definida; no hay mecanismo para que Payment API notifique un pago asíncrono | Documentar estados; definir notificación de pago (fuera de este contrato) | Sí (Q-005, Q-006) |
| GAP-013 | `PassengerItem` con `passengerId` del cliente, `contact` obligatorio para todos, `documentExpiryDate` opcional | No se exige que coincida con el breakdown del hold; infantes con contacto obligatorio; pasaporte sin vencimiento | Documentar reglas; `documentExpiryDate` requerido si PASSPORT | Sí (Q-010) |
| GAP-014 | `extraBaggage` en reserva; `AMOUNT_MISMATCH` sin monto en request | No se sabe si el equipaje se suma al pago ni con qué precio; la comparación depende de Payment API | Documentar total esperado y fuente del monto | Sí (Q-027, Q-030) |
| GAP-015 | `fareRules{isRefundable, isChangeable}` | Sin penalidades, ventanas ni reembolso de tasas (S-02, S-10, S-11) | Añadir `changeFee`, `refundPenalty`, condiciones | No |
| GAP-016 | `GET /bookings?status` string libre; `BookingListResponse` sin `required` ni enum | Filtros y respuesta no validables | Usar enum de `BookingDetail.status`; `required`; 400 | No |
| GAP-017 | `BookingDetail` sin asientos/equipaje agregados más allá de `passengers` | Postventa no visible en un solo lugar; `changes` mínimo | Añadir resumen de ancillaries | No |
| GAP-018 | Sin 401 en ninguna operación; `ProblemDetails403` sin uso; sin 500/503 | Clientes no pueden depender de respuestas estándar | Declarar 401, 403 (o 404 por política), 503 con `Retry-After` | No |
| GAP-019 | Operaciones bajo `/bookings/{id}` sin 404 (baggage-options, baggage, date-change, cancellation-quote, cancel, check-in) | Inconsistencia con otras operaciones | Declarar 404 en todas | No |
| GAP-020 | 202 sin cuerpo en baggage, date-change y cancel; 200 sin cuerpo en cancel | No hay forma de seguimiento salvo releer la reserva | Devolver `BookingDetail` o un recurso de operación | No |
| GAP-021 | 202 de baggage: "Procesando con el GDS" | Sugiere sistema externo no modelado | Redactar sin "GDS" o resolver Q-001 | Sí (Q-001) |
| GAP-022 | Baggage: sin 400/404/422; `quantity` sin máximo; opciones sin moneda explícita en contexto | Errores de pago (`PAYMENT_*`) no declarados en esta operación | Declarar 422 y límites | No |
| GAP-023 | Date change: `assignedSeats` sin `passengerId`; `payment` opcional sin regla; sin 404/422 | Asientos no asignables a pasajero; no se sabe cuándo el pago es obligatorio | Añadir `passengerId`; `payment` requerido si `totalToPay > 0` | Sí (Q-020) |
| GAP-024 | `GET cancellation-quote` crea recurso con TTL; `cancel` sin 410 `QUOTE_EXPIRED` declarado; sin cancelación parcial | Efecto lateral en GET; código usado pero no declarado | POST para crear quote o documentar; declarar 410 | Sí (Q-033) |
| GAP-025 | Webhooks: `secret` legible en GET; sin GET por id ni PATCH; firma y reintentos no definidos; `WebhookPayload.data` solo booking | Fuga de secreto; `hold.expired` y `flight.*` sin `holdId`/`flightNumber`; alcance por owner no definido | `secret` writeOnly; definir firma; ampliar `data` | Sí (Q-018) |
| GAP-026 | `ticketId` string no uuid; VOIDED/REFUNDED sin operación que los produzca | Transiciones no trazables desde la API | Documentar qué operación produce cada estado | No |
| GAP-027 | `POST check-in` sin cuerpo ni `Idempotency-Key`; scope `flights:book` | No se eligen pasajeros/segmentos ni asiento; reintentos sin garantía | Cuerpo opcional con alcance; `Idempotency-Key` | Sí (Q-013) |
| GAP-028 | Boarding passes: solo 404 | `BOARDING_PASS_NOT_AVAILABLE` sin status asociado claro | Documentar 404 o 409 | No |
| GAP-029 | Flight status: formato de `flightNumber` y zona de `date` no definidos; sin 429 | Codeshare y ambigüedad de fecha | Patrón `^[A-Z0-9]{2}[0-9]{1,4}$`; fecha local de salida; 429 | No |
| GAP-030 | `MoneyAmount` con strings sin patrón; `baseFare`/`taxes` opcionales; `priceDifference` y quote sin moneda en el mismo objeto | Formatos inconsistentes | Patrón decimal; `currency` en cada monto | Sí (Q-035) |
| GAP-031 | `ProblemDetails` con `additionalProperties: false` y enum cerrado | Faltan códigos (hold expirado/consumido, key reutilizada, no encontrado, dependencia no disponible); no admite `traceId` | Añadir códigos y permitir extensiones RFC 7807 | No |

# INPUTS PARA EL PLAN DE EJECUCIÓN

Esta sección extrae lo que el siguiente agente necesita para producir workflow, estructura de repositorio, AGENTS.md, ADRs, `feature_list.json`, harness de verificación, orden de tareas y estrategia multi-agente, sin reinterpretar la arquitectura. No es el plan: cada ítem remite a la sección que lo justifica.

## A. Building blocks identificados

| Building block | Tipo | Sección |
| --- | --- | --- |
| API Gateway | Edge (REST → gRPC, auth, idempotencia, rate limit) | 2, 18 |
| Inventory & Schedule Service | Dominio | 8, 9.1 |
| Pricing & Fares Service (Offer Management) | Dominio | 8, 9.2 |
| Flight Reservation / CRS Service | Dominio + orquestador de Sagas | 8, 9.3 |
| Ticketing Service | Dominio | 8, 9.4 |
| Ancillaries Service | Dominio | 8, 9.5 |
| Operations & Departure Service | Dominio | 8, 9.6 |
| Webhook Delivery Service | Soporte | 8, 9.7 |
| Librería de plataforma: Outbox, Inbox, relay, interceptores (deadline, correlación, owner), mapeo de errores, reloj | Transversal | 19, 20 |
| Payment API ACL + Payment API simulada | Integración externa | 2, 21 |
| Authorization Server de prueba | Test double | 21 |
| Bus de eventos + DLQ | Infraestructura | 20, ADR-04 |
| Una base de datos/esquema por servicio | Infraestructura | 10, ADR-03 |
| Herramientas internas de carga de horarios y tarifas | Soporte | 5 (CAP-13, CAP-14), Q-016 |

## B. Contratos a crear o mantener

- **Mantener:** OpenAPI v1.5.0.0 (solo cambios aprobados; gaps en sección 28).
- **Crear Protobuf:** `common.v1`, `inventory.v1`, `pricing.v1`, `reservation.v1`, `ticketing.v1`, `ancillaries.v1`, `departure.v1`, `flightops.v1`, `webhooks.v1` (sección 12).
- **Crear esquemas de eventos:** `<context>.events.v1` con el envelope de la sección 13 y los eventos de su tabla.
- **Crear tabla única:** gRPC `reason` → HTTP status → `ProblemDetails.code` (sección 4).
- **Crear contrato ACL:** Payment API (pendiente Q-005).
- **Crear especificación de firma de webhooks** (pendiente Q-018).

## C. Dependencias de precedencia

Ver sección 23: capa (23.1), transversal (23.2) y entre capacidades (23.3). Camino crítico: ADRs fundacionales → `common.v1` + librería de plataforma → Inventory → Pricing (search, hold) → Flight Reservation (reserva + Payment ACL) → Ticketing → postventa, check-in.

## D. Capacidades funcionales identificadas

CAP-01 a CAP-17 (sección 5), con operaciones asociadas OP-01 a OP-23 (secciones 4 y 7) y journeys E2E 1 a 9 (sección 21).

## E. Reglas arquitectónicas verificables

AC-01 a AC-40 (sección 22); 27 blocking. Fuente de las reglas de ownership: sección 10. Fuente de la allowlist de dependencias: sección 11.

## F. Requisitos verificables

- 45 invariantes INV-\* (sección 15), cada una con owner y forma de prueba.
- 33 casos de borde EC-\* (sección 16) con comportamiento esperado.
- Transiciones válidas e inválidas de 9 máquinas de estado (sección 14).
- NFR-\* (sección 17) y reglas de seguridad (sección 18).
- Respuestas por operación (secciones 4 y 7).

## G. Categorías de pruebas

Unit, Contract, Integration, Architecture, Concurrency, E2E con la matriz por área de la sección 21. Gates candidatos: contract tests OpenAPI, `buf breaking`, compatibilidad de eventos, architecture tests AC-\*, concurrency tests de hold/asiento/idempotencia, journeys E2E 1–9, secret scanning, cobertura (Q-043).

## H. Decisiones pendientes

Antes de crear tareas de la capacidad indicada:

| Decisión | Bloquea |
| --- | --- |
| Q-001 | Todo Inventory y Ticketing |
| Q-002, Q-003, Q-035, Q-038, Q-039 | Search, ofertas, hold |
| Q-004 | Hold |
| Q-005, Q-006, Q-010, Q-027, Q-028, Q-030 | Reserva |
| Q-007 | Ticketing |
| Q-009 | Asientos en compra |
| Q-012, Q-013 | Check-in |
| Q-014 | Infraestructura de eventos |
| Q-015, Q-033 | Cancelación y compensaciones |
| Q-016 | Carga de horarios, tarifas y cambios operacionales |
| Q-018 | Entrega de webhooks |
| Q-020 | Cambio de fecha |
| Q-023 | Estructura del repositorio |
| GAP bloqueantes (sección 28) | Capacidades correspondientes |

## I. Riesgos que deberán afectar el orden de implementación

- R-01 y R-04: concurrency tests de hold, asiento e idempotencia antes de exponer rutas públicas de hold y reserva.
- R-02 y R-03: Saga de reserva con fault injection y compensaciones antes de postventa.
- R-05: resolver gaps bloqueantes y generar contract tests antes de paralelizar agentes.
- R-10: Payment ACL contra contrato simulado desde el inicio del camino crítico.
- R-13: serializador sin PII y AC-24 antes del primer endpoint con pasajeros.

## J. Áreas que admiten trabajo paralelo

| Áreas | Condición |
| --- | --- |
| Inventory y Pricing | `inventory.v1` congelado |
| Pricing y Ancillaries (seat map) | `ResolveSegment` y eventos de layout congelados |
| Flight Reservation y Ticketing | Esquemas de eventos de emisión/resultado congelados |
| Operations (estado de vuelo) y casi todo lo demás | Eventos de instancias de Inventory congelados |
| Webhook Delivery (suscripciones) y cualquier dominio | Gateway con auth disponible |
| Librería de plataforma y ADRs | Desde el inicio |
| Cambio de fecha y cancelación | Reserva y Ticketing completos |

## K. Áreas que NO admiten trabajo paralelo

- Inventory antes de Q-001 resuelta.
- Cualquier servicio antes de ADR-01, 02, 03, 04, 05, 09 y de la librería de Outbox/Inbox.
- Flight Reservation antes de que hold (Inventory + Pricing) sea estable y exista la Payment ACL.
- Check-in antes de Ticketing (cupones) y asignación de asientos.
- Cambio de fecha antes de la reemisión en Ticketing y de Q-020.
- Rutas del Gateway antes de la tabla única de errores y de los contract tests.

## Criterio de finalización (sección 27 del mandato)

Las preguntas 1 a 19 del criterio tienen respuesta en este documento (secciones 1–28). La pregunta 20 queda en **sí, con condiciones**: hay información suficiente para construir el plan de ejecución, siempre que las decisiones de H se resuelvan antes de generar las tareas que bloquean. Esas tareas se crean como bloqueadas, sin supuestos implícitos.

### OP-03 · POST /offers/hold

- **Endpoint:** `POST` `/offers/hold` · OAuth2 · Scope `flights:hold` · Idempotency: `Idempotency-Key` uuid obligatorio.
- **Objetivo funcional:** retener capacidad para las selecciones de una oferta y congelar el precio durante un TTL.
- **Actor externo:** Booking Platform (usualmente al entrar al checkout), clientes B2B.
- **Request:** `offerId`, `itinerarySelections[{itineraryId, cabinClass, fareBrand}]`, `passengersBreakdown`.
- **Response:** 201 `HoldResponse{holdId, status=HELD, expiresAt, ttlMinutes, lockedPrice}`; 400 validación; 409 `OFFER_NO_LONGER_AVAILABLE` (inventario agotado o precio ya no disponible); 422 selección incoherente (brand/cabina no ofrecidos, breakdown distinto).
- **Application Use Case:** `HoldOfferUseCase` (Pricing) que invoca `CreateInventoryHoldUseCase` (Inventory).
- **Propietario:** agregado `InventoryHold` en Inventory; `PriceLock` en Pricing; entrada por Pricing (ADR-06).
- **Colaboradores:** Inventory.
- **Flujo interno:** Gateway (authN, scope, registro de idempotencia) → `OfferService.HoldOffer` → valida `Offer` vigente → `InventoryCommandService.CreateHold` (transacción local con decremento condicional por `FlightInstance`×`BookingClass`) → `PriceLock` → Outbox `OfferHeld` → respuesta.
- **gRPC:** `OfferService.HoldOffer(HoldOfferRequest{offer_id; repeated ItinerarySelection selections; PassengerMix pax; string owner_id; string idempotency_key}) returns (HoldOfferResponse{hold_id; HoldStatus status; Timestamp expires_at; int32 ttl_minutes; Money locked_price})`; `InventoryCommandService.CreateHold(CreateHoldRequest{repeated SegmentHoldLine lines{flight_instance_id, cabin, booking_class, int32 seats}; owner_id; Duration ttl; string idempotency_key}) returns (HoldView)`.
- **Modelo de dominio:** `InventoryHold` (holdId, ownerId, `HoldLine` por instancia/cabina/clase, `seatsHeld`, `status`, `expiresAt`); `SeatInventory`/`CabinInventory` por `FlightInstance` (capacidad, vendidos, retenidos). En Pricing: `PriceLock` (holdId, offerId, selecciones, `lockedPrice`, `expiresAt`, desglose por pasajero). Invariantes: INV-INV-01..05, INV-PRC-04.
- **Persistencia:** Inventory: holds y contadores de capacidad. Pricing: price locks.
- **Eventos:** `InventoryHoldCreated` (Inventory, interno); `OfferHeld` (Pricing, interno, para analítica). Ningún webhook al crear.
- **Consistencia:** fuerte y local en Inventory (optimistic locking con versión por fila de capacidad o `UPDATE … WHERE available >= n`); idempotencia por (`owner`, `Idempotency-Key`) con hash del payload; TTL con barrido programado; compensación local si falla el `PriceLock`.
- **Failure modes:** último asiento disputado → uno obtiene 201 y otro 409; reintento tras timeout → mismo `holdId` desde el registro de idempotencia; misma key con distinto payload → 422 (sin código propio, GAP-031); Inventory caído → 503 no declarado.
- **OpenAPI gaps:** GAP-008 (`cabinClass` libre, breakdown duplicado), GAP-009 (sin 404/410 por oferta expirada, 409 vs 422 ambiguos), GAP-031.

### OP-04 · GET /offers/hold/{holdId}

- **Endpoint:** `GET` `/offers/hold/{holdId}` · Scope `flights:read` · Idempotente.
- **Objetivo funcional:** consultar estado, tiempo restante y precio congelado de un hold.
- **Actor externo:** Booking Platform (temporizador del checkout).
- **Request:** `holdId` uuid.
- **Response:** 200 `HoldStatusResponse{status HELD|RELEASED|EXPIRED|CONSUMED, expiresAt, remainingSeconds, lockedPrice}`; 404 si no existe o no pertenece al `sub` (PROPUESTO: 404 para no filtrar existencia).
- **Application Use Case:** `GetOfferHoldStatusUseCase`.
- **Propietario:** Inventory (estado); Pricing (precio). Entrada por Pricing.
- **Flujo interno:** Gateway → `OfferService.GetOfferHold` → `InventoryQueryService.GetHold` + `PriceLock` local → `remainingSeconds = max(0, expiresAt − now)`.
- **gRPC:** `InventoryQueryService.GetHold(GetHoldRequest{hold_id; owner_id}) returns (HoldView{hold_id; status; expires_at; repeated HoldLine lines})`.
- **Modelo de dominio / persistencia:** lectura de `InventoryHold` y `PriceLock`.
- **Eventos:** ninguno.
- **Consistencia:** la expiración se evalúa por reloj al leer (un hold con `expiresAt` pasado se reporta EXPIRED aunque el barrido no haya corrido; INV-INV-03).
- **Failure modes:** desfase de reloj entre servicios → usar reloj del servicio dueño; Pricing sin `PriceLock` (falló la compensación) → inconsistencia a reconciliar.
- **OpenAPI gaps:** GAP-010 (respuesta sin `holdId`/`offerId`; sin 403).

### OP-05 · DELETE /offers/hold/{holdId}

- **Endpoint:** `DELETE` `/offers/hold/{holdId}` · Scope `flights:hold` · Sin `Idempotency-Key` (DELETE idempotente por semántica).
- **Objetivo funcional:** liberar anticipadamente la capacidad retenida.
- **Actor externo:** Booking Platform (abandono de checkout, cambio de selección).
- **Response:** 204; 404.
- **Application Use Case:** `ReleaseOfferHoldUseCase` → `ReleaseInventoryHoldUseCase`.
- **Propietario:** Inventory. Entrada por Pricing.
- **Flujo interno:** Gateway → `OfferService.ReleaseOfferHold` → `InventoryCommandService.ReleaseHold` (transacción local: status RELEASED, devuelve asientos) → Outbox `InventoryHoldReleased` → Pricing marca `PriceLock` RELEASED.
- **gRPC:** `InventoryCommandService.ReleaseHold(ReleaseHoldRequest{hold_id; owner_id; ReleaseReason reason}) returns (HoldView)`.
- **Eventos:** `InventoryHoldReleased{holdId, lines, reason}` → Pricing, analítica. Sin webhook (el catálogo solo tiene `hold.expired`).
- **Consistencia:** transacción local; DELETE repetido sobre RELEASED/EXPIRED → 204 (PROPUESTO); sobre CONSUMED → conflicto sin código (GAP-011).
- **Failure modes:** carrera DELETE vs. `ConsumeHold` → optimistic locking; gana el primero que confirma y el otro recibe conflicto.
- **OpenAPI gaps:** GAP-011.

### OP-07 · POST /bookings

- **Endpoint:** `POST` `/bookings` · Scope `flights:book` · Idempotency: `Idempotency-Key` obligatorio.
- **Objetivo funcional:** convertir un hold en reserva aérea con PNR, acreditar el pago mediante referencia y emitir tickets (síncrono o asíncrono).
- **Actor externo:** Booking Platform (en su propio checkout multiproducto), web/mobile, B2B.
- **Request:** `holdId`; `passengers[]` (passengerId del cliente, tipo, nombre, documento, nacionalidad, nacimiento, género, contacto, `associatedAdultId`, `assignedSeats[]`, `extraBaggage[]`); `payment.paymentReference`. `ownerId` = `sub`.
- **Response:** 201 `BookingDetail` (CONFIRMED con tickets ISSUED); 202 `BookingDetail` (PENDING\_PAYMENT o TICKET\_ISSUING); 400; 409 (`SEAT_TAKEN`, `OFFER_NO_LONGER_AVAILABLE`, `TICKET_ALREADY_ISSUED`); 410 (hold expirado); 422 (`INFANT_SEAT_NOT_ALLOWED`, `SEAT_CABIN_MISMATCH`, `PAYMENT_REFERENCE_INVALID`, `PAYMENT_NOT_AUTHORIZED`, `AMOUNT_MISMATCH`).
- **Application Use Case:** `CreateFlightReservationUseCase` (inicia `ReservationSaga`), más `IssueTicketsUseCase` en Ticketing.
- **Propietario:** Flight Reservation / CRS.
- **Colaboradores síncronos:** Inventory (`GetHold`, `ConsumeHold`), Pricing (`GetPriceLock`, precio de extras), Ancillaries (`ReserveSeats`, `ReserveBaggage`). Externo: Payment API (REST). Asíncrono: Ticketing.
- **Flujo interno:** ver 6.3. Orden: validar hold y owner → validar pasajeros vs breakdown e infantes → calcular total esperado (lockedPrice + extras) → crear `FlightReservation` PENDING con PNR (transacción local + Outbox) → reservar asientos/equipaje → validar pago → `ConsumeHold` → `TicketIssuanceRequested` → esperar hasta presupuesto síncrono (Q-006) → 201 o 202.
- **gRPC:** `ReservationService.CreateReservation(CreateReservationRequest{hold_id; repeated PassengerInput passengers; string payment_reference; owner_id; idempotency_key}) returns (ReservationView)`; `InventoryCommandService.ConsumeHold(ConsumeHoldRequest{hold_id; reservation_id; owner_id}) returns (HoldView)`; `PriceLockService.GetPriceLock(GetPriceLockRequest{hold_id}) returns (PriceLockView{locked_price; repeated PassengerPrice; Money extra_bag_unit_price_per_itinerary})`; `SeatService.ReserveSeats(ReserveSeatsRequest{reservation_id; repeated SeatRequest{passenger_ref, flight_instance_id, seat_number, cabin, passenger_type}}) returns (SeatReservationResult)`.
- **Modelo de dominio:** Aggregate `FlightReservation` (bookingId, `Pnr`, ownerId, status, `ReservationItinerary` snapshot, `ReservationPassenger` entities, `PaymentRecord`, `ChangeLog`); VOs `Pnr`, `TravelDocument`, `PersonName`, `ContactInfo`, `PassengerType`, `Money`. Invariantes INV-RES-01..10.
- **Persistencia:** Flight Reservation: reserva, pasajeros (PII), snapshot de itinerario, referencias de pago, estado Saga, Outbox, registro de idempotencia propio.
- **Eventos:** `FlightReservationCreated`, `ReservationPaymentValidated`, `TicketIssuanceRequested` (FR → Ticketing), `FlightReservationConfirmed`, `FlightReservationFailed`. Webhooks: `booking.ticket_issuing`, `booking.ticket_issued`, `booking.ticket_failed`, `booking.confirmed`, `booking.failed`.
- **Consistencia:** Saga orquestada con estado persistido; Outbox para cada comando/evento; Inbox en Ticketing; idempotencia a nivel Gateway y a nivel de aggregate (unique key `idempotency_key` + `owner`); compensaciones: liberar asientos, liberar/retener hold según fase, void de tickets emitidos parcialmente, notificar reembolso si el pago ya estaba capturado.
- **Failure modes:** hold expira entre validación y consumo → 410 y liberar asientos; pago válido pero ticketing falla → FAILED + compensación + `booking.ticket_failed`/`booking.failed`; emisión parcial → Ticketing reintenta segmentos FAILED; si agota reintentos, void de todo (INV-TKT-04); PNR duplicado → reintento con nuevo código (colisión de 6 caracteres).
- **OpenAPI gaps:** GAP-012, GAP-013, GAP-014, GAP-031.

### OP-06 · GET /bookings

- **Endpoint:** `GET` `/bookings` · Scope `flights:read` · Idempotente · Paginación por cursor (`limit` ≤ 50, default 10).
- **Objetivo funcional:** listar reservas del owner con filtros por PNR, estado y rango de creación.
- **Actor externo:** portal "Mis viajes", Booking Platform.
- **Response:** 200 `BookingListResponse{nextCursor, items[bookingId, pnr, status, origin, destination, departureDate, grandTotal]}`.
- **Application Use Case:** `ListOwnerReservationsUseCase`.
- **Propietario:** Flight Reservation. Sin colaboradores.
- **gRPC:** `ReservationQueryService.ListReservations(ListReservationsRequest{owner_id; optional string pnr; optional ReservationStatus status; Date created_from; Date created_to; int32 limit; string cursor}) returns (ReservationPage)`.
- **Persistencia:** índice por `(owner_id, created_at, id)` para cursor estable; `origin/destination/departureDate` derivados del primer y último segmento del snapshot.
- **Consistencia:** lectura local; puede mostrar estado ligeramente atrasado respecto a Ticketing (eventual).
- **Failure modes:** cursor manipulado → 400 (no declarado); filtro `status` fuera de enum → 400 no declarado.
- **OpenAPI gaps:** GAP-016.

### OP-08 · GET /bookings/{bookingId}

- **Endpoint:** `GET` `/bookings/{bookingId}` · Scope `flights:read`.
- **Objetivo funcional:** detalle completo: itinerarios, pasajeros, tickets e historial de cambios.
- **Response:** 200 `BookingDetail`; 404 (inexistente o de otro owner).
- **Application Use Case:** `GetReservationDetailUseCase`.
- **Propietario:** Flight Reservation. **Colaboradores:** Ticketing (`ListTickets`) y Ancillaries (asientos y equipaje vigentes) — o proyección local alimentada por eventos (PROPUESTO para evitar fan-out síncrono en lecturas, ADR-10).
- **gRPC:** `ReservationQueryService.GetReservation(GetReservationRequest{booking_id; owner_id}) returns (ReservationDetailView)`.
- **Consistencia:** eventual para tickets/ancillaries si se usa proyección; `updatedAt` refleja el último evento aplicado.
- **Failure modes:** Ticketing caído con composición síncrona → degradar devolviendo `tickets` vacío no es aceptable; por eso se prefiere proyección.
- **OpenAPI gaps:** GAP-017.

### OP-18 · GET /bookings/{bookingId}/tickets y OP-19 · GET /bookings/{bookingId}/tickets/{ticketId}

- **Endpoint:** `GET` · Scope `flights:read`.
- **Objetivo funcional:** consultar tickets (e-ticket, estado global, estado y cupón por segmento, motivo de fallo).
- **Response:** 200 `TicketListResponse` / `Ticket`; 404.
- **Application Use Cases:** `ListReservationTicketsUseCase`, `GetTicketUseCase`.
- **Propietario:** Ticketing. **Colaboradores:** Flight Reservation (`AuthorizeReservationAccess(bookingId, owner)`) o copia local de `ownerId` recibida en `TicketIssuanceRequested` (PROPUESTO: copia local, evita llamada síncrona).
- **gRPC:** `TicketQueryService.ListTickets(ListTicketsRequest{booking_id; owner_id}) returns (TicketList)`; `TicketQueryService.GetTicket(GetTicketRequest{booking_id; ticket_id; owner_id}) returns (TicketView)`.
- **Modelo de dominio:** Aggregate `Ticket` (ticketId, bookingId, passengerId, `ETicketNumber`, status, `TicketCoupon` por segmento con `CouponNumber` y status).
- **Persistencia:** Ticketing: tickets, cupones, secuencia de numeración, ownerId copiado.
- **Consistencia:** lectura local.
- **Failure modes:** reserva sin tickets aún (TICKET\_ISSUING) → lista vacía con 200, no 404 (PROPUESTO).
- **OpenAPI gaps:** GAP-026.

### OP-09 · GET /bookings/{bookingId}/baggage-options

- **Endpoint:** `GET` · Scope `flights:read`.
- **Objetivo funcional:** precio y límite de maletas adicionales por pasajero e itinerario tras la emisión.
- **Response:** 200 array `{passengerId, itineraryId, price, maxAllowed, alreadyPurchased}`. Sin 404 ni 409 declarados.
- **Application Use Case:** `GetPostSaleBaggageOptionsUseCase`.
- **Propietario:** Ancillaries. **Colaboradores:** proyección local ReservationProjection alimentada por eventos de FR (estado, pasajeros, itinerarios, brand, owner; evita el ciclo síncrono FR ↔ Ancillaries), Pricing (`GetBaggagePrice` por brand/ruta/moneda).
- **gRPC:** `BaggageService.GetOptions(GetBaggageOptionsRequest{booking_id; owner_id}) returns (BaggageOptionList)`; `lectura local de ReservationProjection`; `AncillaryPricingService.GetBaggagePrice(route, brand, currency)` (en Pricing).
- **Modelo:** `BaggageEntitlement` por pasajero×itinerario (incluido por brand + comprado); `maxAllowed` = límite de política − ya incluidos − comprados. Infante: política propia (Q-010).
- **Consistencia:** lectura; precio orientativo, se recalcula al comprar.
- **Failure modes:** reserva no CONFIRMED → debería ser 409 `BOOKING_NOT_CONFIRMED` (no declarado); itinerario ya volado → excluido.
- **OpenAPI gaps:** GAP-019, GAP-022.

### OP-10 · POST /bookings/{bookingId}/baggage

- **Endpoint:** `POST` · Scope `flights:book` · Idempotency-Key obligatorio.
- **Objetivo funcional:** comprar maletas adicionales postventa con referencia de pago.
- **Request:** `{passengerId, itineraryId, quantity ≥ 1, payment.paymentReference}`.
- **Response:** 200 `BaggageAddedResponse{passengerId, itineraryId, totalBaggage}`; 202 sin cuerpo ("Procesando con el GDS"); 409 `BAGGAGE_LIMIT_EXCEEDED` / `BOOKING_NOT_CONFIRMED` / `CUTOFF_PASSED`.
- **Application Use Case:** `PurchasePostSaleBaggageUseCase`.
- **Propietario:** Ancillaries. **Colaboradores:** ReservationProjection local (no gRPC a FR), Pricing (precio), Payment API (validación), Ticketing (EMD — documento de servicios misceláneos — POST-MVP).
- **Flujo:** validar límite y cutoff → calcular monto → validar `paymentReference` (monto y moneda) → crear `BaggagePurchase` CONFIRMED (transacción local + Outbox) → `BaggagePurchased` ⇒ FR (historial `changes`) ⇒ webhook `booking.baggage_added`.
- **gRPC:** `BaggageService.Purchase(PurchaseBaggageRequest{booking_id; passenger_id; itinerary_id; int32 quantity; payment_reference; owner_id; idempotency_key}) returns (BaggagePurchaseView)`.
- **Modelo:** Aggregate `BaggageEntitlement` (por reserva×pasajero×itinerario) con `BaggagePurchase` entities; invariante INV-ANC-04.
- **Eventos:** `BaggagePurchased{bookingId, passengerId, itineraryId, quantity, total}` → FR, Webhook Delivery.
- **Consistencia:** transacción local con optimistic locking sobre el entitlement (dos compras simultáneas no superan `maxAllowed`); idempotencia por key.
- **Failure modes:** pago no autorizado → 422 (no declarado aquí, GAP-022); Payment API timeout → 202 y reintento; pago válido y fallo posterior → compensación con notificación de refund (Q-015).
- **OpenAPI gaps:** GAP-020, GAP-021, GAP-022.

### OP-11 · POST /bookings/{bookingId}/date-change/search

- **Endpoint:** `POST` · Scope `flights:read` (lectura con efecto: crea change offers con TTL).
- **Objetivo funcional:** buscar alternativas para nuevas fechas en uno o más itinerarios y cotizar diferencia de tarifa, impuestos y penalidad.
- **Request:** `changes[{itineraryId, newDepartureDate}]`.
- **Response:** 200 array `{changeOfferId, expiresAt, segments[], priceDifference{fareDifference, taxDifference, changeFee, totalToPay}}`; 409 `FARE_NOT_CHANGEABLE`, `FLIGHT_ALREADY_DEPARTED`, `BOOKING_NOT_CONFIRMED`.
- **Application Use Case:** `SearchDateChangeOptionsUseCase`.
- **Propietario:** Flight Reservation (orquesta y valida elegibilidad). **Colaboradores:** Pricing (`QuoteChange`: reglas del brand, diferencia, fee; crea `ChangeOffer`), Inventory (disponibilidad vía Pricing).
- **gRPC:** `ChangePricingService.QuoteChange(QuoteChangeRequest{booking_id; ReservationSnapshot current; repeated ItineraryDateChange changes; PassengerMix pax}) returns (ChangeOfferList)`.
- **Modelo:** `ChangeOffer` (Pricing): changeOfferId, bookingId, itinerarios reemplazados, nuevos segmentos, `PriceDifference`, `expiresAt`. Regla FARE-CHG-01 (INV-PRC-05).
- **Consistencia:** lectura eventual; sin retención de inventario en la búsqueda.
- **Failure modes:** sin disponibilidad → 200 con lista vacía; reserva con ticket no ISSUED → 409.
- **OpenAPI gaps:** GAP-023.

### OP-12 · POST /bookings/{bookingId}/date-change

- **Endpoint:** `POST` · Scope `flights:book` · Idempotency-Key obligatorio.
- **Objetivo funcional:** confirmar un change offer, pagar la diferencia y reemitir.
- **Request:** `{changeOfferId, payment?, assignedSeats[{segmentId, seatNumber}]}`.
- **Response:** 200 `BookingDetail` (confirmado); 202 sin cuerpo (CHANGE\_PENDING); 409; 410 `CHANGE_OFFER_EXPIRED`.
- **Application Use Case:** `ConfirmDateChangeUseCase` (inicia `DateChangeSaga`).
- **Propietario:** Flight Reservation. **Colaboradores:** Pricing (`GetChangeOffer`), Inventory (`CreateHold` nuevo, `ConsumeHold`, `ReleaseInventory` antiguo), Payment API, Ticketing (`ReissueTickets`), Ancillaries (reasignar asientos, trasladar equipaje comprado).
- **Flujo:** CHANGE\_PENDING → hold nuevo → validar pago si `totalToPay > 0` → consumir hold → `TicketReissueRequested` ⇒ Ticketing reemite (nuevo e-ticket o revalidación, Q-020) → liberar inventario antiguo → reasignar asientos → CONFIRMED ⇒ `booking.changed`. Compensación: si falla la reemisión, liberar hold nuevo y conservar itinerario original.
- **gRPC:** `ReservationService.ConfirmDateChange(ConfirmDateChangeRequest{booking_id; change_offer_id; optional payment_reference; repeated SeatRequest seats; owner_id; idempotency_key}) returns (ReservationView)`; `TicketCommandService` es asíncrono (evento).
- **Modelo:** en FR, `DateChange` entity dentro de `FlightReservation` (changeId, estado, itinerario anterior/nuevo); en Ticketing, `Ticket` pasa a EXCHANGED/VOIDED según Q-020 (no existe en enum público: se mapea a VOIDED + ticket nuevo).
- **Eventos:** `DateChangeRequested`, `DateChangeConfirmed`, `DateChangeFailed`; webhook `booking.changed`.
- **Consistencia:** Saga con estado persistido; pivot = consumo del hold nuevo; idempotencia por key y por `changeOfferId` (un change offer se usa una sola vez, INV-RES-11).
- **Failure modes:** asiento pedido tomado → 409 `SEAT_TAKEN` (se puede confirmar el cambio sin asiento, PROPUESTO); pago faltante cuando `totalToPay > 0` → 422 (no declarado).
- **OpenAPI gaps:** GAP-020, GAP-023.

### OP-13 · GET /bookings/{bookingId}/cancellation-quote

- **Endpoint:** `GET` · Scope `flights:read` (crea cotización con TTL; efecto lateral en GET).
- **Objetivo funcional:** cotizar reembolso y penalidad por cancelación total.
- **Response:** 200 `{quoteId, isRefundable, refundAmount, penaltyAmount, currency, expiresAt}`. Sin 404/409 declarados.
- **Application Use Case:** `QuoteReservationCancellationUseCase`.
- **Propietario:** Flight Reservation (persiste `CancellationQuote` asociado a la reserva). **Colaborador:** Pricing (`QuoteCancellation`: reglas del brand, cupones volados, tasas reembolsables), Ticketing (estado de cupones).
- **gRPC:** `ChangePricingService.QuoteCancellation(QuoteCancellationRequest{ReservationSnapshot; repeated CouponStatus coupons}) returns (CancellationQuoteView)`.
- **Consistencia:** lectura con escritura local idempotente (dentro del TTL se puede devolver la misma cotización vigente, PROPUESTO).
- **Failure modes:** reserva ya cancelada → 409 `ALREADY_CANCELLED` (no declarado); vuelo cancelado por la aerolínea → reembolso total involuntario (regla distinta, Q-033).
- **OpenAPI gaps:** GAP-019, GAP-024.

### OP-14 · POST /bookings/{bookingId}/cancel

- **Endpoint:** `POST` · Scope `flights:cancel` · Idempotency-Key obligatorio.
- **Objetivo funcional:** cancelar la reserva completa según una cotización vigente.
- **Request:** `{quoteId, reason?}`.
- **Response:** 200 sin cuerpo (cancelada); 202 sin cuerpo (CANCELLATION\_PENDING); 409 `ALREADY_CANCELLED`, `FLIGHT_ALREADY_DEPARTED`. 410 `QUOTE_EXPIRED` no está declarado en esta operación (GAP-024).
- **Application Use Case:** `CancelFlightReservationUseCase` (inicia `CancellationSaga`).
- **Propietario:** Flight Reservation. **Colaboradores:** Ticketing (void si mismo día / refund status), Inventory (`ReleaseReservedInventory`), Ancillaries (liberar asientos), Operations & Departure (anular check-in).
- **Flujo:** CANCELLATION\_PENDING ⇒ `ReservationCancellationRequested` ⇒ Ticketing (VOIDED o REFUNDED), Inventory (devuelve asientos a la venta), Ancillaries (libera) → FR agrega confirmaciones → CANCELLED ⇒ webhook `booking.cancelled{refundAmount}` ⇒ dominio de reembolsos (externo).
- **Eventos:** `ReservationCancellationRequested`, `FlightReservationCancelled{bookingId, quoteId, refundAmount, currency}`.
- **Consistencia:** Saga por coreografía con agregación en FR (todos los pasos son "liberar", sin pivot riesgoso); idempotente por key y por estado (cancelar CANCELLED → 409 `ALREADY_CANCELLED`, o 200 si es la misma key).
- **Failure modes:** Ticketing no confirma void → reintentos + DLQ + alerta; la reserva queda CANCELLATION\_PENDING hasta reconciliar.
- **OpenAPI gaps:** GAP-020, GAP-024.

### OP-20 · POST /bookings/{bookingId}/check-in

- **Endpoint:** `POST` · Scope `flights:book` · Sin `Idempotency-Key` y sin cuerpo.
- **Objetivo funcional:** registrar el check-in de la reserva (todos los pasajeros elegibles en los segmentos dentro de ventana, PROPUESTO por falta de cuerpo) y habilitar boarding passes.
- **Actor externo:** web/mobile, Booking Platform.
- **Response:** 200 `CheckInResponse{bookingId, status NOT_ELIGIBLE|AVAILABLE|IN_PROGRESS|COMPLETED|FAILED, checkedInPassengers[passengerId, status, segments[segmentId, seat, status]]}`; 409 `CHECK_IN_NOT_AVAILABLE`, `CUTOFF_PASSED`, `FLIGHT_ALREADY_DEPARTED`, `BOOKING_NOT_CONFIRMED`; 422 `CHECK_IN_FAILED`, `INFANT_SEAT_NOT_ALLOWED`, `SEAT_CABIN_MISMATCH`.
- **Application Use Case:** `CheckInReservationUseCase`.
- **Propietario:** Operations & Departure (subdominio Departure Control).
- **Colaboradores:** Flight Reservation (snapshot + owner), Ticketing (cupones ISSUED por segmento), Ancillaries (asignar asiento automático si falta), Operations (ventana y estado de vuelo; mismo contexto en MVP).
- **Flujo:** ver 6.7. Por cada pasajero×segmento: validar cupón ISSUED, vuelo no salido/cancelado, ventana abierta, documento vigente (`documentExpiryDate` ≥ fecha de vuelo si PASSPORT) → asiento → `CheckInRecord` CHECKED\_IN → `BoardingPass`.
- **gRPC:** `DepartureService.CheckIn(CheckInRequest{booking_id; owner_id; optional repeated PassengerSegmentRef scope}) returns (CheckInView)`; `SeatService.AssignSeatAtCheckIn(AssignSeatRequest{flight_instance_id; passenger_ref; cabin; passenger_type; optional preferred_seat}) returns (SeatAssignmentView)`; `TicketQueryService.GetCouponsForBooking(booking_id)`.
- **Modelo:** Aggregate `CheckIn` (por reserva×segmento) con `PassengerCheckIn` entities; `BoardingPass` entity (barcode, tipo, grupo, posición). Invariantes INV-DEP-01..05.
- **Persistencia:** Departure: registros de check-in, boarding passes, secuencia de boarding.
- **Eventos:** `PassengerCheckedIn`, `CheckInFailed`; webhook `booking.checked_in`.
- **Consistencia:** transacción local por segmento; operación idempotente por estado (reintentar sobre CHECKED\_IN devuelve el mismo resultado, PROPUESTO); resultado parcial posible (un pasajero FAILED).
- **Failure modes:** asignación automática sin asientos en la cabina → FAILED con `SEAT_CABIN_MISMATCH`/`CHECK_IN_FAILED`; vuelo operado por otra aerolínea → NOT\_ELIGIBLE (S-04, S-12).
- **OpenAPI gaps:** GAP-027.

### OP-21 · GET /bookings/{bookingId}/boarding-passes

- **Endpoint:** `GET` · Scope `flights:read`.
- **Objetivo funcional:** obtener pases de abordar (asiento, grupo, posición, barcode AZTEC/PDF417/QR).
- **Response:** 200 `BoardingPassListResponse`; 404 (`BOARDING_PASS_NOT_AVAILABLE` si no hay check-in).
- **Application Use Case:** `GetBoardingPassesUseCase`.
- **Propietario:** Operations & Departure. Sin colaboradores (ownerId copiado desde el snapshot usado en el check-in).
- **gRPC:** `DepartureQueryService.ListBoardingPasses(ListBoardingPassesRequest{booking_id; owner_id}) returns (BoardingPassList)`.
- **Modelo:** `BoardingPass`; el barcode se genera con formato BCBP de IATA (PROPUESTO; contenido y firma por decidir, Q-034).
- **Consistencia:** lectura local; un cambio de asiento o de vuelo posterior invalida el pase (evento `BoardingPassInvalidated`).
- **Failure modes:** check-in parcial → solo pases de los CHECKED\_IN.
- **OpenAPI gaps:** GAP-028.

### OP-22 · GET /flights/{flightNumber}/status

- **Endpoint:** `GET` `/flights/{flightNumber}/status?date=` · Pública.
- **Objetivo funcional:** estado operativo (programado/estimado/real de salida y llegada, terminal, aeronave, estado).
- **Actor externo:** público, Booking Platform, apps.
- **Response:** 200 `FlightStatus`; 404 (`FLIGHT_STATUS_NOT_AVAILABLE`).
- **Application Use Case:** `GetFlightStatusUseCase`.
- **Propietario:** Operations & Departure (subdominio Flight Operations). **Colaborador:** Inventory & Schedule solo para resolver `flightNumber`+`date` → `FlightInstance` programada (o copia local por evento `FlightInstanceScheduled`, PROPUESTO).
- **gRPC:** `FlightOpsQueryService.GetFlightStatus(GetFlightStatusRequest{flight_number; Date local_departure_date}) returns (FlightStatusView)`.
- **Modelo:** Aggregate `OperationalFlight` (flightInstanceId, `OperationalTimes`, status, aircraft, gate/terminal).
- **Persistencia:** Operations: estado operacional e historial de cambios.
- **Eventos:** produce `FlightDelayed`, `FlightCancelled`, `FlightDiverted`, `FlightDeparted`, `FlightArrived`, `FlightScheduleChanged`; webhooks `flight.schedule_changed`, `flight.cancelled`.
- **Consistencia:** eventual; respuesta cacheable 30–60 s (PROPUESTO, Q-024).
- **Failure modes:** vuelo codeshare consultado por número de marketing → resolver al operating flight (Q-022); fecha ambigua (UTC vs local) → usar fecha local de salida (PROPUESTO).
- **OpenAPI gaps:** GAP-029.

### OP-15 · GET /webhooks, OP-16 · POST /webhooks, OP-17 · DELETE /webhooks/{id}

- **Endpoint:** Scope `flights:webhooks`. POST sin `Idempotency-Key`.
- **Objetivo funcional:** gestionar suscripciones de un consumidor (URL, eventos, secreto) para recibir notificaciones asíncronas.
- **Actor externo:** Booking Platform, integraciones B2B.
- **Request (POST):** `{url, events[12 tipos], secret}`.
- **Response:** GET 200 array; POST 201 `WebhookSubscription`; DELETE 204.
- **Application Use Cases:** `ListWebhookSubscriptionsUseCase`, `RegisterWebhookSubscriptionUseCase`, `DeleteWebhookSubscriptionUseCase`.
- **Propietario:** Webhook Delivery.
- **gRPC:** `WebhookSubscriptionService.Register/List/Delete(… owner_id …)`.
- **Modelo:** Aggregate `WebhookSubscription` (id, ownerId = `sub`/`client_id`, url, eventTypes, secreto cifrado, status ACTIVE/DISABLED); `DeliveryAttempt` en Delivery.
- **Persistencia:** Webhook Delivery: suscripciones (secreto cifrado en reposo), intentos, DLQ.
- **Consistencia:** local. Validación de URL (HTTPS, no IPs privadas, prevención SSRF).
- **Failure modes:** URL interna o no HTTPS → 400; secreto devuelto en GET → fuga (GAP-025).
- **OpenAPI gaps:** GAP-025.

### OP-23 · Callback flightEvent (POST a `{$request.body#/url}`)

- **Objetivo funcional:** entregar `WebhookPayload{eventId, eventType, occurredAt, apiVersion, data{bookingId, pnr, status, refundAmount}}`.
- **Productor:** Webhook Delivery, consumiendo Integration Events del bus y traduciéndolos (anti-corruption: el payload público nunca es el evento interno).
- **Entrega:** at-least-once, `eventId` estable para deduplicación del receptor, firma HMAC del cuerpo con `secret` (PROPUESTO; esquema no documentado), reintentos con backoff exponencial y DLQ; éxito = 2xx (el contrato solo menciona 200).
- **Filtro de destinatarios:** solo suscripciones cuyo owner sea dueño de la reserva afectada (PROPUESTO, Q-018); para `flight.*`, los owners con reservas en el vuelo.
- **OpenAPI gaps:** GAP-025.
