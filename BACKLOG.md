# Backlog

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
- FECHA L�MITE 2026-11-23: vence la excepci�n de zod en scripts/audit-policy.cjs; desde ese d�a el CI falla y no se puede desplegar. Migrar a zod 4 en todos los servicios antes de esa fecha.
- FECHA L�MITE inicios de diciembre de 2026: el seed de vuelos en Supabase deja de tener vuelos futuros; regenerarlo antes.
- webhooks: payloadData pas� de .strict() a .passthrough() para aceptar holdId; restringirlo a los campos conocidos del contrato m�s holdId.
- PLAN �1.3 (GAP-025) describe hold.expired como { status: "EXPIRED" }; actualizarlo con holdId (ADR-F11-13).
- Faltan pruebas: PrismaSchedulerStore contra Postgres, y la rama de reversi�n de RecoverCheckIns (markBlocked) con almac�n real.
- SCHEDULER_BATCH_SIZE solo acota resumePending y recoverCheckIns; expireHolds y dispatchPending usan lotes fijos de 500 y 100.

- operations: al retrasar o cancelar un vuelo, tambi�n se notifica a las reservas ya canceladas; filtrar por estado. La notificaci�n fallida solo se reintenta si un admin repite la actualizaci�n; considerar reintento desde el scheduler.
- webhooks: webhook-security.spec.ts est� en test/security y no corre en CI (el workflow solo ejecuta test/unit); moverla o ampliar el comando de CI.

- Seed de Supabase renovado el 2026-10-25 (inventory y luego pricing, ambos idempotentes con skipDuplicates). Cubre 60 d�as desde esa fecha; renovarlo antes de que se agoten los vuelos futuros. Documentar el procedimiento en F11d-1.

- deploy-hello.yml fallar�a si un push a main toca platform/hello: deploy-service.yml ejecuta prisma:generate y hello no define ese script. Corregirlo o retirar hello del despliegue.

- gateway-ci.yml no incluye packages/contracts/** en sus paths (hoy no afecta: el gateway no importa contracts).

## Observaciones de docs/audit/audits/F11/audit-14.md
- render-journeys.cjs solo comprueba CORS con origen permitido si existe SMOKE_CORS_ALLOWED_ORIGIN; hacerlo obligatorio o tomarlo de la configuraci�n.
- Matriz PLT-SEC-03: las celdas de �xito de OP-05, OP-10, OP-12, OP-14 y OP-17 no releen el estado guardado, y las celdas 401 y 403 no comprueban ausencia de efectos (la prueba de recurso ajeno s�).
- La negativa de ticketing a arrancar con TICKETING_FAIL_MODE depende de que NODE_ENV sea exactamente "production" (lo fija el Dockerfile).

## Observaciones de docs/audit/audits/F11/audit-15.md
- render-journeys.cjs acepta hold.expired comprobando eventType, data.holdId y la firma, pero no valida el cuerpo completo contra WebhookPayload (eventId, occurredAt, apiVersion).
- La firma real del despachador de webhooks solo se verifica contra Render; en local la calcula la propia prueba.

## Observaciones de F12a (para revisar en F12b)
- pricing-service: en `pricePerPassengerType` aparecen `TOTAL` y `CHILDRE`. `TOTAL` no es un tipo de pasajero sino una fila de resumen que Pricing incluye en el desglose por tipo (el hold la usa para el precio bloqueado); `CHILDRE` es el niño escrito de forma abreviada. El contrato v2 solo admite ADULT, YOUTH, CHILD e INFANT. Hoy el Gateway v2 filtra `TOTAL` y normaliza `CHILDRE` a `CHILD` (platform/api-gateway/src/v2/shapes.ts); en F12b separar el total del desglose por tipo y corregir el nombre en Pricing.
- F12b: aceptar con 202 el pago pendiente en equipaje (`addBaggage`) y cambio de fecha (`confirmDateChange`), que el contrato v2 admite; hoy responden 422 PAYMENT_NOT_AUTHORIZED (ADR-F12-04).
- F12b (panel de operaciones, P6): `CHECKED_IN` puede calcularse con los check-ins de operations por vuelo (hoy sale 0); junto con `HELD` por asiento y `BOARDED` (sin proceso de abordaje todavía). `BOOKED` sigue en 0 mientras la emisión v2 sea inmediata (ADR-F12-10).
