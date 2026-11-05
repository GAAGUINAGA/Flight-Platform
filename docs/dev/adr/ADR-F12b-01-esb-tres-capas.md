# ADR-F12b-01 — ESB propio NestJS en tres capas
- Estado: Aceptado · Fecha: 2026-10-31 · Fase/Tarea: F12b-1 / Bloque 0
## Contexto
La arquitectura del curso exige una capa ESB entre el gateway y los microservicios. Hoy el gateway conoce a los siete servicios y los llama por gRPC desde un único punto (`callGatewayGrpc`). Diseño completo: `docs/dev/f12b1-diseno-esb.md`.
## Decisión
`microservices/esb-service` (NestJS, Cloud Run) con tres capas: conectividad (endpoint HTTP interno de operaciones con nombre `<dominio>.<operación>`), mediación (enrutador; orquestador en F12b-3) e integración externa (Booking, F12b-3). Dominios: vuelos, reservas, postventa, clientes y sistema. En F12b-1 solo hay enrutador y dos operaciones compuestas sin estado propio: `vuelos.mapa-asientos` y `sistema.salud`. Los clientes gRPC se mueven del gateway al ESB, se reutilizan, llevan plazo por llamada y se cierran en `onModuleDestroy`.
## Consecuencias
- **Deuda explícita para F12b-3.** En la arquitectura del curso el MS de respuesta (gateway) no orquesta. Siete composiciones siguen en el gateway, cada paso por el ESB, y se mudan al orquestador junto con su estado:

| Composición | Pasos | Estado del gateway que usa |
|---|---|---|
| Cancelación v2 (`v2/cancellation`) | getReservation → cotización → cancelReservation | V2StateStore, StockSync, ventana de exoneración |
| Creación de reserva v2 (`v2/booking.create`) | getOfferHold → createReservation → getReservation | V2StateStore, StockSync, idempotencia del gateway |
| Emisión v2 (`issueTickets`) | getReservation → resumeReservation | V2StateStore (mapa de pasajeros) |
| Cambio de fecha v2 (`v2/postsale`) | getReservation → confirmDateChange | idempotencia, formas v2 |
| Hold v1/v2 | getOfferHold → releaseOfferHold / holdOffer | reglas de estado/expiración, idempotencia |
| Eventos de Booking (`v2/booking-events`) | getReservation / resumeReservation / failReservation | BD del gateway (dedupe), autenticación de socio |
| Sincronización de stock (`stock-sync`) | getFlightInstance → queryAvailability | outbox del gateway, StockSync |

- Un salto de red más por llamada; se mide en la nube (bloque E).
