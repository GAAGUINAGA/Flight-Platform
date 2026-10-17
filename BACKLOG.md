# Backlog

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

## Observaciones de docs/audit/audits/F9/audit-2.md
- Quedan selecciones de tarifa por posición: selectOfferForHold (pricing-hold-fixture.ts:14,20; offers[0] y pricingOptions[0]), resume-pending.ts:13 y un fallback en post-sale-smoke.cjs:45. Elegir siempre por fareBrand.
- La exclusión de ConfirmDateChange por changeOfferId es solo en memoria del proceso; entre instancias depende de markChangeOfferUsed en Pricing. Confirmar que ese marcado sea atómico en base de datos.
- El reembolso positivo (FLEX) solo se prueba de forma unitaria; agregar escenario real cuando Pricing ordene pricingOptions.
