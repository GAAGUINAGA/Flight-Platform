# Sesión dev — verificación de pagos de Booking (deploy) — 2026-11-09 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: ed8836c

## Objetivo de la sesión
Desplegar la verificación de pagos de Booking en la nube (el pago debe cubrir la tarifa; CAPTURED confirmado; ADR-F12c-01) y validarla con compras reales de Booking.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Clave de Booking | Secreto booking-payments-auth en Secret Manager (versión 2; la 1, con texto equivocado, desactivada), con acceso de reservation-service-runtime. Probada contra GET /api/v2/pagos/{paymentReference}: 200. | Hecho |
| Configuración manual previa | BOOKING_PAYMENTS_BASE_URL, BOOKING_PAYMENTS_AUTH_HEADER y el secreto, con gcloud --update-*; un intento de BOOKING_PAYMENTS_STATUS_MAP falló por las comillas de PowerShell 5.1 (la revisión no arrancó; el tráfico siguió en la anterior) y se retiró. | Hecho |
| Merge y deploy | fix/pago-cubre-tarifa (audit-13 APROBADO) fusionada con --squash desde main; antes, se comprobó que deploy-reservation.yml declara toda la configuración de Reservation; tras el despliegue, las tres variables de pagos siguen presentes (vienen del workflow). | Hecho |
| Compras reales | Booking compró GHCK84 y 2WKNM9 con éxito; el verificador aceptó pagos que cubren la tarifa (incluyen el servicio de Booking). | ✓ |
| Asientos | El mapa v2 marca los vendidos como BOOKED con isAvailable false (pedido 2b de Booking cubierto, salvo distinguir TICKETED/CHECKED_IN); un intento de comprar un asiento ya vendido responde 409 SEAT_TAKEN sin crear la reserva (pedido 2a). | Ver evidencia |
| Observaciones | Latencia de la reserva exitosa: 6 a 7,7 s (unos 2,5 s en la consulta a la API de pagos de Booking); v1 con passengerId que no es UUID responde 500 en lugar de 400 (en BACKLOG); reserva de prueba LMD49C (9D del FP102 2026-11-10) pendiente de cancelar. | Anotado |

## Evidencia

# Evidencias: primera compra de Booking en la nube (PNR GHCK84) - 2026-11-08 21:48

## ESB: operaciones de la compra (correlationId corr-vuelo-86ef90a6-754a-4d5b-9c7c-b5e3ea5a37cc)
2026-11-09T02:45:08.047441Z	reservas.obtener	ok	0	645
2026-11-09T02:45:07.328940Z	reservas.crear	ok	0	6275
2026-11-09T02:45:01.015356Z	vuelos.consultar-hold	ok	0	251
2026-11-09T02:44:59.236467Z	vuelos.consultar-hold	ok	0	278
2026-11-09T02:44:51.314095Z	vuelos.mapa-asientos	ok	0	387
2026-11-09T02:44:45.028380Z	clientes.publicar-evento	ok	0	233
2026-11-09T02:44:44.741128Z	vuelos.crear-hold	ok	0	485
2026-11-09T02:44:33.152708Z	reservas.crear	error	9	4227
2026-11-09T02:44:28.888982Z	vuelos.consultar-hold	ok	0	251
2026-11-09T02:44:27.002341Z	vuelos.consultar-hold	ok	0	289


## Reservation: reserva creada y pago verificado (02:44-02:47 UTC)

2026-11-09T02:45:07.315203Z		createReservation	rpc ok		6248	
2026-11-09T02:44:33.148881Z		createReservation	rpc error		4211	
2026-11-09T02:44:32.150394Z						[31m[Nest] 1  - [39m11/09/2026, 2:44:32 AM 
[31m  ERROR[39m [38;5;3m[ReservationDependencies] 
[39m[31mdependency=ancillaries operation=reserveSeats code=9[39m




## Ancillaries: asientos y equipaje (02:44-02:47 UTC)

2026-11-09T02:45:06.624145Z	confirmSeats	rpc ok	243
2026-11-09T02:45:04.349109Z	reserveSeats	rpc ok	401
2026-11-09T02:45:03.896598Z	registerBaggageAllowance	rpc ok	253
2026-11-09T02:44:32.140655Z	reserveSeats	rpc error	322
2026-11-09T02:44:31.766262Z	registerBaggageAllowance	rpc ok	273




## Ticketing: boletos emitidos (02:44-02:47 UTC)

2026-11-09T02:45:07.750673Z	listTickets	rpc ok	107
2026-11-09T02:45:06.068384Z	issueTickets	rpc ok	1049




## Webhooks: eventos publicados y entregas (02:44-02:50 UTC)

2026-11-09T02:48:07.742996Z	dispatchPending	rpc ok	
2026-11-09T02:47:07.732167Z	dispatchPending	rpc ok	
2026-11-09T02:46:08.936935Z	dispatchPending	rpc ok	
2026-11-09T02:45:08.957373Z	dispatchPending	rpc ok	
2026-11-09T02:45:07.309990Z	publishEvent	rpc ok	
2026-11-09T02:45:06.976514Z	publishEvent	rpc ok	
2026-11-09T02:44:45.023477Z	publishEvent	rpc ok	
2026-11-09T02:44:33.143776Z	publishEvent	rpc ok	
2026-11-09T02:44:07.737614Z	dispatchPending	rpc ok	




## Compras de Booking en la nube (09-11-2026)
- GHCK84 (FP102 UIO-GYE 2026-11-10): tarifa 225,00 + servicio de Booking 22,50 = 247,50; reservas.crear ok (6,3 s); reserveSeats, issueTickets y confirmSeats ok; eventos publicados y despachados. Un intento previo con el mismo correlationId falló por un asiento de otra cabina enviado por Booking (SEAT_CABIN_MISMATCH, error de Booking, con compensación).
- 2WKNM9: tarifa 450,00 + servicio 45,00 = 495,00; confirmada.
- Antes de la corrección: 503 (pagos sin configurar) y 422 PAYMENT_NOT_AUTHORIZED (status CAPTURED no reconocido); los pagos de Booking incluyen su servicio, por eso la regla de monto igual también habría fallado.

## Mapa de asientos v2 del FP102 2026-11-10
- 9C (vendido por Booking) y 9D (vendido por nuestro canal v1, PNR LMD49C): isAvailable false, status BOOKED; el resto, 144 asientos, AVAILABLE. Booking confirmó que los ve en gris (al principio miraba otra fecha).

## SEAT_TAKEN (pedido 2a de Booking)
OK   b+â-¦squeda
Oferta del FP102: salida 2026-11-10T22:00:00.000Z, ECONOMY/BASIC, 93 asientos disponibles
OK   mapa de asientos
Asientos en el mapa por cabina y estado: {"BUSINESS libre":8,"ECONOMY libre":135,"ECONOMY ocupado":3}
OK   hold
node : FALLA: reserva con asiento: status 409, code SEAT_TAKEN, detalle 
En línea: 14 Carácter: 1
+ node C:\Proyectos\comprar-asiento.cjs 2>&1 | Tee-Object -Variable sal ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (FALLA: reserva ...TAKEN, detalle :String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 




## ADRs creados
Ninguno en esta sesión (ADR-F12c-01 en la rama).

## Pendientes / bloqueos
- Pedido 3 de Booking (retrasos con booking.changed por reserva): después de F12b-2.
- Retomar F12b-2 (bus de eventos), con el conflicto conocido en deploy-reservation.yml.

## Cierre
- Estado: listo para auditoría (despliegue).