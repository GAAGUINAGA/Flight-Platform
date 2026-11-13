# Backlog

## PRIORIDAD ALTA
- **[IMPLEMENTADO en fix/busqueda-dia-local; pendiente de auditoría y despliegue. Ver docs/dev/diseno-busqueda-dia-local.md. Quedan: el humano aplica el script de operational_flights.date; seed en hora local para entornos nuevos; tabla de aeropuertos en base de datos; edad del pasajero con fecha local (passengers.ts).]** Búsqueda de vuelos por día LOCAL del aeropuerto de salida (NFR-TI-01; ADR: docs/dev/adr/ADR-F12b1fix-02-busqueda-dia-local.md). Hoy el "día" de la búsqueda es el día UTC: `dayRange` de inventory-service (`flight-queries.ts`: `find`, `list`, `queryAvailability`) usa `[date T00:00Z, +24 h)`. Un vuelo que sale a las 22:00 en Lima (UTC-5, 03:00Z del día siguiente) no aparece al buscar su fecha local. Caso LIM→MAD: sale 2026-11-10 22:30 hora de Lima = 2026-11-11T03:30Z; la búsqueda "2026-11-10" no lo encuentra y "2026-11-11" lo devuelve con la fecha equivocada. Puntos afectados, v1 y v2: (1) inventory `dayRange` y los tres consumidores; (2) v2 `stock-sync.ts:112` (`utcDate` hacia `queryAvailability`); (3) v2 `operations.controller.ts:88` y operations `flight-status.ts:7` (`departure.at.slice(0, 10)` como fecha de `getFlightStatus` y de `operational_flights.date`); (4) reservation `queries.ts:10` (`departureDate` del resumen con `slice(0, 10)`); (5) validación de pasaporte en operations `check-in.ts:69`; (6) pricing `fake-inventory.gateway.ts:13` (el falso debe imitar la regla real). Requiere zona IANA por aeropuerto y un cambio coordinado auditado; las pruebas del gateway ya no dependen de la hora (reloj simulado en `e2e-schedule.spec.ts`).

- F12b-1: los demas servicios (y el Gateway, que usa --env-file) no toleran un BOM UTF-8 al inicio del .env (Set-Content -Encoding utf8 de Windows PowerShell 5.1 lo agrega y la primera variable no se lee). El ESB ya lo tolera (src/load-env.ts, ESB-ENV-01..04) y su error distingue "archivo cargado pero falta la variable". Replicar en los servicios con el mismo helper en una entrega propia.
- Antes del cierre de F11: migrar coordinadamente todos los servicios, Gateway y `packages/shared` de Zod 3 a Zod 4; retirar la excepción temporal `GHSA-mrhx-c7xc-m3w5` de `security/npm-audit-exceptions.json`.

- Cada servicio y `packages/shared` debe exponer su propio script `test`, ejecutar sus pruebas de manera aislada y cargar Ãºnicamente su `.env`, para que un `DATABASE_URL` de otro workspace no contamine la ejecuciÃ³n global de Jest.
- Aislar el cliente Prisma de inventory-service con la misma convenciÃ³n que el resto (requiere correcciÃ³n auditada y redespliegue).
- ticketing-service: la integraciÃ³n tarda ~30â€“40 s; su `afterAll` puede exceder el timeout bajo carga.

## Para resolver al inicio de F10 (operations-service), observaciones de docs/audit/audits/F6/audit-1.md
- OPS-05: idempotencia de RecordOperationalUpdate. Repetir una cancelación no debe volver a cerrar el vuelo ni publicar flight.cancelled; un retraso repetido no debe republicar flight.schedule_changed si el horario no cambió.
- OPS-04: distinguir un vuelo inexistente (FLIGHT_STATUS_NOT_AVAILABLE) de Inventory no disponible (UNAVAILABLE ? 503), con una prueba propia para cada caso.
- OPS-SEC-01: pruebas de fecha inválida, campo extra y transición no permitida por RPC.

- operations-service/scripts/smoke.cjs: aceptar el target como argumento (como inventory, ticketing y pricing), documentar en su cabecera las variables requeridas e imprimir una línea OK/FAIL por paso.

- ancillaries-service compila a dist/main.js en la RAÍZ del repo (riesgo de colisión con otros servicios); debe emitir en su propia carpeta, como el resto.

- ancillaries-service no carga su .env en local (requiere node --env-file=.env); unificar el arranque local con el resto de servicios.

- F7: audit-1.md (RECHAZADO por ANC-SEC-02: owner-B podía comprar equipaje sobre la reserva de owner-A y las lecturas devolvían [] en vez de NOT_FOUND) se perdió al recrear el clon del auditor; su resolución consta en docs/audit/audits/F7/audit-2.md.

- webhooks-service: documentar en .env.example WEBHOOK_SECRET_ENCRYPTION_KEY (32 bytes en base64) como obligatoria también en local.

- npx dotenv dejó de resolverse tras el merge de F8; usar node --env-file=.env.supabase con prisma/build/index.js, o volver a declarar dotenv-cli como devDependency en la raíz.

## Primera tarea de F9 ? franquicia y owner en Ancillaries

- Registrar al crear una reserva la franquicia incluida de cada pasajero con asiento por itinerario, incluso cuando sea cero, separada del equipaje extra comprado; permitir despu?s consultar y vender equipaje con ownership correcto. Evaluar una extensi?n aditiva del contrato gRPC con ADR y la compatibilidad de los servicios desplegados.
- An?lisis: ADR-F7-06 fija el owner en la primera escritura. ReserveBaggage exige cantidad 1?3, no transporta passengerId y persiste passengerId nulo; GetBaggageOptions excluye esas filas. BASIC incluye cero maletas facturadas. Por tanto la interfaz actual no representa fielmente la franquicia ni registra todas las reservas. En F8 ADR-F8-06 acepta temporalmente NOT_FOUND como vac?o solo despu?s de validar owner en Reservation; F9 debe sustituir esa limitaci?n con pruebas de creaci?n, postventa, cero incluido, pasajeros, itinerarios y aislamiento por owner.

- reservation-service: la repetición idempotente de CreateReservation por gRPC devuelve la vista persistida sin tickets (ADR-F8-05). El Gateway repite la respuesta original a nivel HTTP, pero conviene que gRPC también incluya los tickets.

- pricing-service: ordenar `pricingOptions` de forma determinista, por ejemplo por precio y marca; los consumidores no deben depender de su orden actual.
- OP-02: ResolveSegment debe devolver el offerId del segmento, mediante un cambio aditivo en pricing.proto, para validar la pertenencia y expiracion de la oferta; contemplar segmentos compartidos por varias ofertas (ver docs/dev/adr/ADR-F11-03-seatmap-segmento.md).

## Observaciones de docs/audit/audits/F9/audit-2.md
- Quedan selecciones de tarifa por posición: selectOfferForHold (pricing-hold-fixture.ts:14,20; offers[0] y pricingOptions[0]), resume-pending.ts:13 y un fallback en post-sale-smoke.cjs:45. Elegir siempre por fareBrand.
- La exclusión de ConfirmDateChange por changeOfferId es solo en memoria del proceso; entre instancias depende de markChangeOfferUsed en Pricing. Confirmar que ese marcado sea atómico en base de datos.
- El reembolso positivo (FLEX) solo se prueba de forma unitaria; agregar escenario real cuando Pricing ordene pricingOptions.

## Observaciones de docs/audit/audits/F9/audit-3.md
- ancillaries: maxWait + timeout de transacción por defecto (4 s + 4 s) pueden superar el deadline gRPC de 5 s de reservation. Ajustar los valores por defecto (p. ej. 1,5 s + 3 s) o subir el deadline, y documentarlo.
- Los errores internos que no son de Prisma ya no registran el nombre de la excepción; recuperarlo sin exponer mensajes ni valores.
- Confirmar con los logs de Cloud Run el código real del fallo de producción (P2028 fue la reproducción local).

## Observaciones de docs/audit/audits/F9/audit-5.md
- La prueba opt-in del smoke de postventa usa un puerto fijo (29661); usar un puerto libre asignado dinámicamente.
- En los clones del auditor aparecen archivos generados de packages/contracts como modificados tras la instalación; revisar que la regla LF de .gitattributes y el paso de generación no ensucien el árbol.

- El seed de inventory en Supabase cubre 60 días desde el 7 de octubre de 2026; regenerarlo (o hacerlo rodante) antes de inicios de diciembre, o los smokes de compra, postventa y check-in dejarán de encontrar vuelos.

## Observaciones de docs/audit/audits/F10/audit-1.md
- PRIORIDAD F11: si operations muere con un check-in en IN_PROGRESS, toda llamada posterior responde CHECK_IN_NOT_AVAILABLE sin recuperación (ADR-F10-02/05). Resolver con el scheduler de F11: reanudar o revertir check-ins IN_PROGRESS vencidos.
- Si operations muere entre complete y publish, booking.checked_in no se publica nunca. Considerar publicar desde el estado persistido (reintento en el scheduler de F11).
- Faltan pruebas de check-in con vuelo salido o cancelado, y con cupón distinto de ISSUED (el código lo implementa).
- Faltan pruebas de ConfirmSeats, ReleaseSeats y del índice único sobre un asiento CHECKED_IN; ANC-SEC-02 de AssignSeatAtCheckIn no ejercita markCheckedIn con una asignación existente de otro owner.
- Un asiento RELEASED aborta todo el check-in en lugar de marcar solo a ese pasajero como FAILED.

## Observaciones de docs/audit/audits/F10/audit-2.md
- El smoke de check-in no muestra el vuelo ni la ventana usados: imprimir número de vuelo, fecha y minutos hasta la salida (sin datos personales).
- La evidencia de despliegue debería incluir el describe de todos los servicios redesplegados o afectados, no solo de los modificados.

- Seed rodante: Inventory y Pricing generan 60 días desde la fecha de ejecución con createMany + skipDuplicates (no tocan held/sold). Para extenderlo en Supabase, ejecutar primero el seed de inventory y luego el de pricing, cargando .env.supabase en la sesión sin imprimirlo. Repetir antes de que el último vuelo quede a menos de 3 días.

## Observaciones de docs/audit/audits/F11/audit-1.md (tarea 0 de F11b)
- CI del gateway: el workflow solo ejecuta platform/api-gateway/src/gateway.spec.ts; ampliarlo a todas las pruebas unitarias del gateway (excluyendo integration y e2e), incluidas partner-issuer.spec.ts y openapi-path.spec.ts.
- Faltan pruebas: OP-05 (liberar hold), reserva con un hold de otro sub (404) y que el listado de reservas no muestre reservas ajenas.
- OP-02 (ADR-F11-03): el alcance real es mayor que el segmento compartido. Ancillaries no usa offerId, así que un offerId inexistente o expirado con un segmento presente en alguna oferta activa devuelve 200. Actualizar el ADR; la solución sigue siendo que ResolveSegment devuelva el offerId (cambio aditivo en pricing.proto).
- Sin prueba con token partner contra rutas REST; los webhooks llegan en F11c.
- El smoke de Supabase (supabase-auth-smoke.cjs) espera 403 en una ruta admin que llega en F11c; la prueba S completa de PLT-SEC-01 se cierra en F11c.

## Tarea 0 de F11b: latencia y errores en frío (despliegue de F11a)
- createReservation tarda de 6 a 7 s en Cloud Run con dependencias recién arrancadas; el gateway agota su espera y responde 503 aunque la reserva pueda haberse creado. Ajustar el deadline del gateway para OP-07 (y documentarlo), y confirmar que el reintento con la misma Idempotency-Key devuelve la reserva creada.
- Se observó createReservation con INTERNAL_ERROR tras 6953 ms (ver bitácora de despliegue de F11a): identificar la dependencia o el código Prisma con los logs.
- El limitador de búsqueda responde 503 RATE_LIMIT_EXCEEDED cuando no puede consultar su almacén: documentar la decisión (fallar cerrado), usar un código coherente (503 SERVICE_UNAVAILABLE con Retry-After, no RATE_LIMIT_EXCEEDED) y probarlo.
- Evaluar min-instances=1 en reservation (y sus dependencias críticas) en Cloud Run frente a su costo.

## Observaciones de docs/audit/audits/F11/audit-3.md y audit-4.md
- Las pruebas reales opt-in (RUN_*_REAL) usan el plazo por defecto de Jest (5 s); PST-03/04 lo superó una vez con 6,2 s bajo carga. Darles un plazo propio y holgado (p. ej. 30 s) por archivo o por it.
- Los nombres de los tres it nuevos de F11b (OP-05 / S y PLT-I5 / E) muestran ? en lugar de ?, ú y ó: corregir la codificación del archivo (UTF-8).
- El gateway tolera estados no declarados en app.ts:83; revisar.
- Sigue sin prueba con token partner contra rutas REST (F11c).

- Arranques en frío de Cloud Run: la primera llamada de cada flujo (createReservation en F11a, checkIn en F11b) puede responder 503 por plazo agotado. Antes de PLT-J3, decidir entre min-instances=1 en los servicios críticos (con su costo) o un precalentamiento de los servicios antes de ejecutar los recorridos.

## Observaciones de docs/audit/audits/F11/audit-6.md
- FECHA L MITE 2026-11-23: vence la excepci n de zod en scripts/audit-policy.cjs; desde ese d a el CI falla y no se puede desplegar. Migrar a zod 4 en todos los servicios antes de esa fecha.
- FECHA L MITE inicios de diciembre de 2026: el seed de vuelos en Supabase deja de tener vuelos futuros; regenerarlo antes.
- webhooks: payloadData pas  de .strict() a .passthrough() para aceptar holdId; restringirlo a los campos conocidos del contrato m s holdId.
- PLAN  1.3 (GAP-025) describe hold.expired como { status: "EXPIRED" }; actualizarlo con holdId (ADR-F11-13).
- Faltan pruebas: PrismaSchedulerStore contra Postgres, y la rama de reversi n de RecoverCheckIns (markBlocked) con almac n real.
- SCHEDULER_BATCH_SIZE solo acota resumePending y recoverCheckIns; expireHolds y dispatchPending usan lotes fijos de 500 y 100.

- operations: al retrasar o cancelar un vuelo, tambi n se notifica a las reservas ya canceladas; filtrar por estado. La notificaci n fallida solo se reintenta si un admin repite la actualizaci n; considerar reintento desde el scheduler.
- webhooks: webhook-security.spec.ts est  en test/security y no corre en CI (el workflow solo ejecuta test/unit); moverla o ampliar el comando de CI.

- Seed de Supabase renovado el 2026-10-25 (inventory y luego pricing, ambos idempotentes con skipDuplicates). Cubre 60 d as desde esa fecha; renovarlo antes de que se agoten los vuelos futuros. Documentar el procedimiento en F11d-1.

- deploy-hello.yml fallar a si un push a main toca platform/hello: deploy-service.yml ejecuta prisma:generate y hello no define ese script. Corregirlo o retirar hello del despliegue. RESUELTO: hello retirado (rama fix/busqueda-dia-local).

- gateway-ci.yml no incluye packages/contracts/** en sus paths (hoy no afecta: el gateway no importa contracts).

## Observaciones de docs/audit/audits/F11/audit-14.md
- render-journeys.cjs solo comprueba CORS con origen permitido si existe SMOKE_CORS_ALLOWED_ORIGIN; hacerlo obligatorio o tomarlo de la configuraci n.
- Matriz PLT-SEC-03: las celdas de  xito de OP-05, OP-10, OP-12, OP-14 y OP-17 no releen el estado guardado, y las celdas 401 y 403 no comprueban ausencia de efectos (la prueba de recurso ajeno s ).
- La negativa de ticketing a arrancar con TICKETING_FAIL_MODE depende de que NODE_ENV sea exactamente "production" (lo fija el Dockerfile).

## Observaciones de docs/audit/audits/F11/audit-15.md
- render-journeys.cjs acepta hold.expired comprobando eventType, data.holdId y la firma, pero no valida el cuerpo completo contra WebhookPayload (eventId, occurredAt, apiVersion).
- La firma real del despachador de webhooks solo se verifica contra Render; en local la calcula la propia prueba.

## Observaciones de F12a (para revisar en F12b)
- pricing-service: en `pricePerPassengerType` aparecen `TOTAL` y `CHILDRE`. `TOTAL` no es un tipo de pasajero sino una fila de resumen que Pricing incluye en el desglose por tipo (el hold la usa para el precio bloqueado); `CHILDRE` es el niño escrito de forma abreviada. El contrato v2 solo admite ADULT, YOUTH, CHILD e INFANT. Hoy el Gateway v2 filtra `TOTAL` y normaliza `CHILDRE` a `CHILD` (platform/api-gateway/src/v2/shapes.ts); en F12b separar el total del desglose por tipo y corregir el nombre en Pricing.
- F12b: aceptar con 202 el pago pendiente en equipaje (`addBaggage`) y cambio de fecha (`confirmDateChange`), que el contrato v2 admite; hoy responden 422 PAYMENT_NOT_AUTHORIZED (ADR-F12-04).
- F12b (panel de operaciones, P6): `CHECKED_IN` puede calcularse con los check-ins de operations por vuelo (hoy sale 0); junto con `HELD` por asiento y `BOARDED` (sin proceso de abordaje todavía). `BOOKED` sigue en 0 mientras la emisión v2 sea inmediata (ADR-F12-10).

## Observaciones de docs/audit/audits/F12/audit-1.md (antes del despliegue en la nube)
- La redacci n de logs no incluye las cabeceras x-webhook-signature, x-api-key, x-user-id ni x-device-fingerprint; agregarlas y una prueba de logs v2.
- booking-events sin BOOKING_EVENTS_CLIENT_ID permite apuntar a reservas de cualquier cliente: hacerlo obligatorio (negarse a arrancar sin  l cuando booking-events est  habilitado).
- (F12a-2) Rotar la contraseña de svc_gateway que estuvo en platform/api-gateway/.env.supabase.example (commit 00a0a30).
- (F12a-2) Relleno opcional de boarding_passes.cabin_class para check-ins anteriores a la migración 20261027220000 (ADR-F12a2-02).

- PRC-12 (pricing-service, inventory-real.spec.ts): al ejecutarla sola con -t, Jest no termina el proceso (queda un recurso abierto, probablemente el cliente gRPC hacia inventory). Cerrar el recurso en el teardown.

- PRC-12 (pricing-service, inventory-real.spec.ts): al ejecutarla sola con -t, Jest no termina el proceso (queda un recurso abierto, probablemente el cliente gRPC hacia inventory). Cerrar el recurso en el teardown.

## Observaciones de docs/audit/audits/F12/audit-2.md
- PRIORIDAD: la b squeda aplica SEARCH_MAX_OFFERS por tramo antes de combinar; en multidestino el mismo d a con un l mite bajo puede devolver cero ofertas aunque exista una combinaci n v lida. Aplicar el l mite despu s de combinar (o combinar con un tope por tramo mayor que el l mite final).
- CHECKED_IN del panel: excluir a los infantes sin asiento propio.
- Una prueba del gateway fall  una vez en el clon limpio (no identificada; no se repiti  en cuatro corridas). Vigilar.



## Observaciones de docs/audit/audits/F12/audit-3.md
- Rutas v2 protegidas con barra final (/offers/hold/) o con mayúsculas (/Offers/hold), sin token y con cuerpo inválido, responden 400 en lugar de 401: el validador OpenAPI reconoce esas variantes y la autenticación previa no. Unificar la normalización de rutas (o rechazar las variantes con 404).
- PLT-A/B e I5/I6 (real-stack.e2e.spec.ts) falló una vez en una corrida completa del gateway y no se reprodujo. Si reaparece, capturar el mensaje de error completo.
- Las pruebas de la excepción NODE_ENV=test de BOOKING_EVENTS_CLIENT_ID no fijan explícitamente el caso test.

- infra/scripts/gcp-setup.sh no incluye el ESB en el bucle de cuentas de servicio (la cuenta esb-service-runtime y sus permisos se crearon a mano en F12b-1). Agregar esb al bucle para que el script pueda recrear el proyecto completo.

## Observaciones de F12b-2 (bus de eventos)
- `booking.ticket_issuing` está en la lista permitida y en los contratos v1/v2 (el v2 lo conserva "por compatibilidad con v1", no exige emitirlo), pero ningún servicio lo emite desde antes de F12b-2. No se resuelve en esta entrega; decidir en F12b-3 (emisión como paso separado, `BOOKED` frente a `TICKETED`).
- Herramienta de reproceso de la cola de fallidos `q.webhooks.entrega.fallidos` (hoy manual desde la consola de RabbitMQ), con alarma por tamaño de la cola (ADR-F12b-05).
## Observaciones de la verificación de pagos de Booking (audit-13)
- La segunda corrida completa del Gateway tuvo 1 fallo intermitente en `p1-security.e2e.spec.ts`, sin `ENOBUFS`; el archivo pasó aislado (49/49) y las dos corridas completas siguientes pasaron (868/868, 1 `todo`).
- ~~Conviene renombrar `ADR-F12c-01-pago-booking-cubre-tarifa.md`~~ Hecho en F12c-0: ahora es `ADR-F12b2fix-02-pago-booking-cubre-tarifa.md` (el prefijo F12c queda para GraphQL/UI: `ADR-F12c-01-front-graphql-react.md`). Los informes de auditoría y bitácoras anteriores conservan el nombre antiguo (historial). Las citas vivas (comentarios de `booking-payments.ts` y su prueba, `docs/dev/f12a-despliegue.md`) se corrigieron en la entrega de backend previo al front.

## Pendientes que el front necesita (F12c-0, 2026-11-11; ver `docs/dev/f12c0-diseno-front.md` §14)
- **Prioridad alta (pequeño):** la puerta de embarque. Operations ya la guarda (`departure_gate`, ADR-F12-10) pero `GET /vuelos/flights/{n}/status` y los pases de abordar v2 no la devuelven (el contrato v2 ya declara `gate` en `FlightStatusEndpoint` y `BoardingPass`). Exponerla.
- **Prioridad alta (pequeño):** salud del bus de eventos en el panel. El ESB ya informa el bus en `/health/deps`; `GET /api/v2/vuelos/health` solo reporta los siete servicios. Incluir el estado del bus (y, si es posible, eventos pendientes/fallidos) en la salud o en un endpoint de administración.
- Catálogo de aeropuertos/rutas y de vuelos por origen (hoy configuración estática en el front).

- v1 POST /bookings con un passengerId que no es UUID (por ejemplo, PAX-1234) responde 500 (Reservation, prisma P2023) en lugar de 400 VALIDATION_FAILED: falta validar el formato en la entrada. Detectado el 09-11-2026 en producción con un script de prueba.

## Observaciones de audit-17 (migraciones sin esquema)
- Las migraciones historicas de prisma/migrations (anteriores a 20261109000000) usan SQL sin calificar con el esquema del servicio. Quedan asi por compatibilidad: ya estan aplicadas en Supabase y cambiarlas rompe su suma de verificacion. El verificador de scripts/check-raw-sql.cjs solo exige esquema en las nuevas (ADR-F12b1fix-03).

## Observaciones de audit-20 (backend previo al front)
- Intermitente en Reservation: la primera corrida real falló PST-07 / C (esperaba QUOTE_EXPIRED, recibió BOOKING_NOT_CONFIRMED); la repetición pasó 19/19. Revisar si la prueba depende del tiempo de vencimiento de la cotización.
- Intermitente en el gateway: la primera corrida completa falló V2-P1-43 (esperaba 200, recibió 503); las dos siguientes pasaron. Revisar si es un arranque lento de un servicio en la suite.

- La paginación de GET /api/v2/vuelos/bookings no funciona en la nube: el gateway pasa page { limit, cursor } a Reservation (booking.controller.ts:35), pero la respuesta ignora ambos (limit=5 devolvió 20; con el cursor devolvió la misma página). Probable desajuste de nombres con el .proto, que el cliente gRPC descarta en silencio. Detectado el 12-11-2026; se corrige como primer punto de F12c-1.
