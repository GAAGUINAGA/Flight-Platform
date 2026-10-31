# F12a · Lista de pruebas de las suites reales (apéndice de la bitácora 2026-10-26 #1)

Cada suite se ejecutó **tres veces seguidas** sobre el mismo commit (dos con `--verbose` y una con `--json` para obtener esta lista); las tres dieron el mismo resultado. Cada línea es un `it(...)`: `✓` pasó, `○` omitida por su bandera, `✎` pendiente (todo).

## Gateway (v1 + v2)

`RUN_GATEWAY_REAL=true npx jest platform/api-gateway --runInBand --verbose`

- Corrida 1: Test Suites: 23 passed, 23 total · Tests:       1 todo, 621 passed, 622 total
- Corrida 2: Test Suites: 23 passed, 23 total · Tests:       1 todo, 621 passed, 622 total
- Corrida 3 (lista): 23 suites passed de 23 · 621 passed, 0 failed, 1 omitidas/todo de 622

```
PASS platform/api-gateway/src/admin-datetime.spec.ts
  ✓ F11d-1 / ADR-F11-16: fechas de rutas admin date-time RFC 3339 acepta 2026-10-24T00:00:00Z
  ✓ F11d-1 / ADR-F11-16: fechas de rutas admin date-time RFC 3339 acepta 2026-10-24T00:00:00+02:00
  ✓ F11d-1 / ADR-F11-16: fechas de rutas admin date-time RFC 3339 rechaza 2026-10-24T00:00Z con VALIDATION_FAILED
  ✓ F11d-1 / ADR-F11-16: fechas de rutas admin date-time RFC 3339 rechaza 2026-10-24T00:00:00+0200 con VALIDATION_FAILED
PASS platform/api-gateway/src/booking-integration-doc.spec.ts
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-01: el ejemplo TypeScript acepta la firma que emite el despachador real de Webhooks
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-02: el ejemplo rechaza cuerpo alterado, secreto equivocado, marca antigua y cabeceras mal formadas
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-03: la guía incluye el ejemplo tal cual está en el archivo probado
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta VALIDATION_FAILED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta SEAT_TAKEN con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta AMOUNT_MISMATCH con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta BOOKING_NOT_CONFIRMED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta BAGGAGE_LIMIT_EXCEEDED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta CUTOFF_PASSED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta FARE_NOT_CHANGEABLE con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta FLIGHT_ALREADY_DEPARTED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta CHANGE_OFFER_EXPIRED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta OFFER_NO_LONGER_AVAILABLE con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta QUOTE_EXPIRED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta ALREADY_CANCELLED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta RATE_LIMIT_EXCEEDED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta INFANT_SEAT_NOT_ALLOWED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta PAYMENT_REFERENCE_INVALID con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta PAYMENT_NOT_AUTHORIZED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta PNR_CREATION_FAILED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta TICKET_ISSUANCE_FAILED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta TICKET_ALREADY_ISSUED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta CHECK_IN_NOT_AVAILABLE con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta CHECK_IN_FAILED con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta BOARDING_PASS_NOT_AVAILABLE con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta SEAT_CABIN_MISMATCH con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-04: la guía documenta FLIGHT_STATUS_NOT_AVAILABLE con su estado HTTP
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-05: la guía documenta el 503 con RATE_LIMIT_EXCEEDED y Retry-After, y las referencias de pago simuladas
  ✓ PLT-J1: la guía de integración coincide con el sistema J1-06: la guía lista las 22 operaciones REST del contrato y el callback
  ✓ PLT-J1: la colección de Postman cubre el contrato y no lleva secretos J1-07: la colección tiene una petición por cada operación del contrato (método y ruta)
  ✓ PLT-J1: la colección de Postman cubre el contrato y no lleva secretos J1-08: las operaciones con Idempotency-Key del contrato la envían y las protegidas usan el token del entorno
  ✓ PLT-J1: la colección de Postman cubre el contrato y no lleva secretos J1-09: ni la colección ni el entorno contienen tokens, claves o secretos
PASS platform/api-gateway/src/config.spec.ts
  ✓ PLT-J2: configuración final del Gateway J2-01: producción sin variable ⇒ validateResponses={ NODE_ENV: 'production' }
  ✓ PLT-J2: configuración final del Gateway J2-01: producción con VALIDATE_RESPONSES=false ⇒ validateResponses={ NODE_ENV: 'production', VALIDATE_RESPONSES: 'false' }
  ✓ PLT-J2: configuración final del Gateway J2-01: producción con un valor que no es "true" ⇒ validateResponses={ NODE_ENV: 'production', VALIDATE_RESPONSES: '1' }
  ✓ PLT-J2: configuración final del Gateway J2-01: entorno de pruebas (NODE_ENV=test) ⇒ validateResponses={ NODE_ENV: 'test' }
  ✓ PLT-J2: configuración final del Gateway J2-01: desarrollo ⇒ validateResponses={ NODE_ENV: 'development' }
  ✓ PLT-J2: configuración final del Gateway J2-01: entorno de pruebas desplegado con VALIDATE_RESPONSES=true ⇒ validateResponses={ NODE_ENV: 'production', VALIDATE_RESPONSES: 'true' }
  ✓ PLT-J2: configuración final del Gateway J2-01: sin NODE_ENV ni variable ⇒ validateResponses={}
  ✓ PLT-J2: configuración final del Gateway J2-02: el scheduler solo se activa con SCHEDULER_ENABLED=true y sus intervalos por defecto son los del ADR-F11-11
  ✓ PLT-J2: configuración final del Gateway J2-03: los límites, la idempotencia y CORS toman los valores del plan y se pueden sobrescribir
PASS platform/api-gateway/src/gateway.spec.ts
  ✓ F4 Gateway base GW-SEC-01: sin token ⇒ 401
  ✓ F4 Gateway base GW-SEC-01: firma inválida ⇒ 401
  ✓ F4 Gateway base GW-SEC-01: token expirado ⇒ 401
  ✓ F4 Gateway base GW-SEC-01: alg none ⇒ 401
  ✓ F4 Gateway base GW-SEC-01: emisor no listado ⇒ 401
  ✓ F4 Gateway base GW-SEC-01: producción rechaza un emisor publicKeyFile al arrancar
  ✓ F4 Gateway base GW-04/GW-09 traverse guards, idempotency and a real gRPC server, including metadata propagation
  ✓ F4 Gateway base GW-SEC-02/GW-05 deny scopes and limit authenticated callers by sub
  ✓ F4 Gateway base search: fallo del almacén del limitador devuelve 503 y Retry-After
  ✓ F4 Gateway base GW-06: gRPC 14 ⇒ 503 RATE_LIMIT_EXCEEDED y Retry-After 5
  ✓ F4 Gateway base GW-06: gRPC 4 ⇒ 503 RATE_LIMIT_EXCEEDED y Retry-After 5
  ✓ F4 Gateway base GW-06: código VALIDATION_FAILED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código SEAT_TAKEN conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código AMOUNT_MISMATCH conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código BOOKING_NOT_CONFIRMED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código BAGGAGE_LIMIT_EXCEEDED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código CUTOFF_PASSED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código FARE_NOT_CHANGEABLE conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código FLIGHT_ALREADY_DEPARTED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código CHANGE_OFFER_EXPIRED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código OFFER_NO_LONGER_AVAILABLE conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código QUOTE_EXPIRED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código ALREADY_CANCELLED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código RATE_LIMIT_EXCEEDED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código INFANT_SEAT_NOT_ALLOWED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código PAYMENT_REFERENCE_INVALID conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código PAYMENT_NOT_AUTHORIZED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código PNR_CREATION_FAILED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código TICKET_ISSUANCE_FAILED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código TICKET_ALREADY_ISSUED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código CHECK_IN_NOT_AVAILABLE conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código CHECK_IN_FAILED conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código BOARDING_PASS_NOT_AVAILABLE conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código SEAT_CABIN_MISMATCH conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-06: código FLIGHT_STATUS_NOT_AVAILABLE conserva su status HTTP del catálogo
  ✓ F4 Gateway base GW-SEC-04: error inesperado en la app ⇒ 500 genérico sin stack ni mensaje interno
  ✓ F4 Gateway base GW-SEC-04: logger del Gateway redacta documentNumber, email y Authorization
  ✓ F4 Gateway base GW-SEC-03: origen CORS no permitido no recibe Access-Control-Allow-Origin
  ✓ F4 Gateway base GW-SEC-03: cuerpo de 200 kB ⇒ 413
  ✓ F4 Gateway base GW-SEC-03: X-Forwarded-Proto http ⇒ rechazado y HSTS presente
  ✓ F4 Gateway base GW-02/GW-03: petición inválida a /search ⇒ 400 con invalidParams y correlación
  ✓ F4 Gateway base GW-03: X-Correlation-Id está presente en 401 y 404
  ✓ F4 Gateway base GW-01/GW-07/GW-08 keep public middleware and configuration safe
  ✓ F4 Gateway base does not expose test routes in production
PASS platform/api-gateway/src/openapi-formats.spec.ts
  ✓ OpenAPI response formats GW-OPENAPI: rechaza FlightEndpoint.at con date-time mal formado
PASS platform/api-gateway/src/openapi-path.spec.ts
  ✓ OpenAPI specification path resolves the same specification from another working directory
PASS platform/api-gateway/src/partner-issuer.spec.ts
  ✓ F11a partner development issuer verifies a partner token and rejects its local key in production
PASS platform/api-gateway/src/scheduler.spec.ts
  ✓ PLT-H2 scheduler PLT-H2-01: la ronda inicial dispara las cinco tareas con rol system y lotes acotados
  ✓ PLT-H2 scheduler PLT-H2-02: dos ejecuciones simultáneas no procesan una tarea dos veces
  ✓ PLT-H2 scheduler PLT-H2-03: el fallo de una dependencia no impide las demás tareas
  ✓ PLT-H2 scheduler PLT-H2-04: desactivado no programa ronda inicial ni temporizadores
  ✓ PLT-H2 scheduler PLT-H2-05: desactivado permite invocar una tarea manualmente con bloqueo durable
  ✓ PLT-H2 scheduler PLT-H2-06: activado ejecuta la ronda inicial y cancela sus cinco temporizadores al destruirse
PASS platform/api-gateway/src/v2/config-v2.spec.ts
  ✓ F12a client_id del dev-auth V2-CID-01: acepta letras, dígitos, guion y guion bajo de 3 a 40 caracteres
  ✓ F12a client_id del dev-auth V2-CID-02: rechaza ~, espacios, símbolos, vacío, muy corto y muy largo
  ✓ F12a client_id del dev-auth V2-CID-03: rechaza cualquier forma de UUID para no chocar con el sub de Supabase
  ✓ F12a configuración v2 V2-CFG-01 los valores por defecto son los de producción: perfil local apagado, nodo GabatAIR
  ✓ F12a configuración v2 V2-CFG-02 INTEGRATION_LOCAL solo se activa con el valor exacto "true"
  ✓ F12a configuración v2 V2-CFG-03 INTEGRATION_LOCAL se rechaza al arrancar con NODE_ENV=production
  ✓ F12a configuración v2 V2-CFG-04 PUBLIC_BASE_URL fija el emisor y se normaliza sin barra final
  ✓ F12a configuración v2 V2-CFG-05 PUBLIC_BASE_URL con ruta se rechaza y en producción exige https
  ✓ F12a configuración v2 V2-CFG-06 en producción el dev-auth queda apagado sin llave y URL pública explícitas
  ✓ F12a configuración v2 V2-CFG-07 en producción con llave y URL https el dev-auth se habilita y usa la base de datos
  ✓ F12a configuración v2 V2-CFG-08 DEV_AUTH_ENABLED=false lo apaga en cualquier entorno
  ✓ F12a configuración v2 V2-CFG-09 en pruebas el almacén de clientes es en memoria salvo que se pida prisma
PASS platform/api-gateway/src/v2/stock/stock-sync.spec.ts
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-01 sin BOOKING_STOCK_API_KEY el envío queda apagado y nada se encola
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-02 con clave se activa, y STOCK_SYNC_ENABLED=false lo apaga aunque haya clave
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-03 TLS está activo por defecto y BOOKING_STOCK_TLS=false exige INTEGRATION_LOCAL=true
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-04 AIRPORT_TIMEZONES inválido falla al arrancar y uno válido se suma a los de Ecuador
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-05 localSlot da fecha y hora locales del aeropuerto, incluso cuando cambia el día; sin zona usa UTC
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-06 flightsOf lee los vuelos de un hold o de una reserva y no falla con datos vacíos
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-07 los fallos se reintentan con backoff y tras 8 intentos la fila se abandona (FAILED)
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-08 varios cambios del mismo vuelo se juntan en un solo envío con la disponibilidad actual
  ✓ F12a P5 · configuración y utilidades del stock a Booking V2-STK-09 un cambio futuro (vencimiento de hold) no se envía antes de su hora
PASS platform/api-gateway/test/e2e/real-stack.e2e.spec.ts
  ✓ Gateway: composición gRPC real en proceso conecta el cliente real a Pricing y recibe rechazo de entrada inválida
  ✓ Gateway: composición gRPC real en proceso protege las rutas REST de hold y valida las entradas
  ✓ Gateway: composición gRPC real en proceso protege las consultas de reservas y tickets con 401, 403 y 400
  ✓ Gateway: composición gRPC real en proceso limita search por fingerprint con 429 y Retry-After
  ✓ Gateway: composición gRPC real en proceso PLT-F: estado público, check-in y pases con autorización y contrato
  ✓ Gateway: composición gRPC real en proceso PLT-I3 / E: pago pendiente devuelve 202 y resume-pending confirma, emite y publica
  ✓ Gateway: composición gRPC real en proceso PLT-I4 / E: tres fallos de emisión dejan FAILED, revierten capacidad/asiento y publican booking.failed
  ✓ Gateway: composición gRPC real en proceso PLT-I2 / E: hold idempotente se consulta y libera; vencido publica hold.expired y compra devuelve 410
  ✓ Gateway: composición gRPC real en proceso PLT-A/B e I5/I6: compra, postventa y smoke de check-in
  ✓ Gateway: composición gRPC real en proceso OP-05 / S: liberar el hold de otro sub ? 404 y el hold sigue HELD para su due?o
  ✓ Gateway: composición gRPC real en proceso PLT-I5 / E: cambio de fecha anula los tickets anteriores y emite tickets nuevos
  ✓ Gateway: composición gRPC real en proceso PLT-I5 / E: cancelaci?n deja la reserva CANCELLED y los tickets liquidados
  ✓ Gateway: composición gRPC real en proceso OP-02: segmento sin ofertas activas devuelve 404 OFFER_NO_LONGER_AVAILABLE
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / K: partner registra un webhook y la respuesta cumple WebhookSubscription con el secreto enmascarado
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / K: admin registra un webhook con la misma forma
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-16 / K: lista solo las suscripciones del sub con el secreto enmascarado
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-17 / K: elimina la suscripción propia con 204 y desaparece del listado
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-16 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-17 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-16 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-17 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: partner sin el scope flights:webhooks ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-17 / S: eliminar la suscripción de otro sub ⇒ 404 y sigue activa para su dueño
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-17 / S: id que no es UUID ⇒ 400
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: sin secret ⇒ 400
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: evento fuera del catálogo ⇒ 400
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: url inválida ⇒ 400
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: URL de destino privada ⇒ rechazada sin crear la suscripción
  ✓ Gateway: composición gRPC real en proceso PLT-G: webhooks REST (OP-15, OP-16, OP-17) OP-15 / S: el secreto en claro no aparece en los logs del Gateway
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-02 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-05 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: sin token ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-02 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-05 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-02 / S: partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / S: partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-05 / S: partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: admin sin el scope flights:admin ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-02 / S: admin sin el scope flights:admin ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / S: admin sin el scope flights:admin ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: admin sin el scope flights:admin ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-05 / S: admin sin el scope flights:admin ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: admin sin el scope flights:admin ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / K: admin crea un vuelo, lo lista por fecha y repetir la misma clave natural no lo duplica
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / K: admin fija la tarifa; repetir la clave natural la actualiza y el listado muestra el precio vigente
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / K: admin registra un retraso y la respuesta cumple FlightStatus
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / K: admin cierra la venta del vuelo
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: entrada inválida ⇒ 400 (0)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: entrada inválida ⇒ 400 (1)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: entrada inválida ⇒ 400 (2)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-01 / S: entrada inválida ⇒ 400 (3)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-02 / S: entrada inválida ⇒ 400 (4)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-02 / S: entrada inválida ⇒ 400 (5)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / S: entrada inválida ⇒ 400 (6)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: entrada inválida ⇒ 400 (7)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: entrada inválida ⇒ 400 (8)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-04 / S: entrada inválida ⇒ 400 (9)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-05 / S: entrada inválida ⇒ 400 (10)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: entrada inválida ⇒ 400 (11)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: entrada inválida ⇒ 400 (12)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: entrada inválida ⇒ 400 (13)
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* PLT-I6 / J6 admin / E: retraso ⇒ flight.schedule_changed y cancelación ⇒ flight.cancelled por cada reserva afectada, con la venta cerrada
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-03 / S: cerrar un vuelo inexistente ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-H1: rutas /flights/v1/admin/* H1-06 / S: actualización operacional de un vuelo que no existe en Inventory ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer de un emisor JWKS (forma Supabase) lee sus reservas
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer NO accede a post /flights/v1/admin/flights (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer NO accede a get /flights/v1/admin/flights (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer NO accede a post /flights/v1/admin/flights/b07063d2-1a4e-4bb2-9f69-a513c6a2582c/close (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer NO accede a put /flights/v1/admin/fares (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer NO accede a get /flights/v1/admin/fares (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer NO accede a post /flights/v1/admin/flights/4128b585-b1f9-4d80-8dbb-37ff55e05a51/operational-updates (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el admin sí accede a /admin y a los webhooks, pero no ve reservas ajenas (404)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner de un emisor JWKS (forma Supabase) gestiona sus webhooks
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner crea holds y reservas propios (su sub es el dueño) y no ve los ajenos (404)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner NO accede a post /flights/v1/admin/flights (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner NO accede a get /flights/v1/admin/flights (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner NO accede a post /flights/v1/admin/flights/b07063d2-1a4e-4bb2-9f69-a513c6a2582c/close (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner NO accede a put /flights/v1/admin/fares (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner NO accede a get /flights/v1/admin/fares (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-03 / S: el partner NO accede a post /flights/v1/admin/flights/4128b585-b1f9-4d80-8dbb-37ff55e05a51/operational-updates (403), ni con el scope flights:admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: el customer no gestiona webhooks (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-01 / S: firma ajena y emisor desconocido ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner de desarrollo gestiona webhooks (crear, listar, eliminar)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: con el token partner, la reserva de otro sub ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner NO accede a post /flights/v1/admin/flights (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner NO accede a get /flights/v1/admin/flights (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner NO accede a post /flights/v1/admin/flights/b07063d2-1a4e-4bb2-9f69-a513c6a2582c/close (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner NO accede a put /flights/v1/admin/fares (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner NO accede a get /flights/v1/admin/fares (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-01 / PLT-SEC-02: roles y emisores PLT-SEC-02 / S: el token partner NO accede a post /flights/v1/admin/flights/4128b585-b1f9-4d80-8dbb-37ff55e05a51/operational-updates (403)
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real la matriz cubre las 22 operaciones REST del contrato y las rutas admin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-04 GET /offers/hold/{holdId} / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-04 GET /offers/hold/{holdId} / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-04 GET /offers/hold/{holdId} / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-05 DELETE /offers/hold/{holdId} / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-05 DELETE /offers/hold/{holdId} / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-05 DELETE /offers/hold/{holdId} / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-07 POST /bookings con el hold ajeno / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-07 POST /bookings con el hold ajeno / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-07 POST /bookings con el hold ajeno / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-08 GET /bookings/{bookingId} / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-08 GET /bookings/{bookingId} / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-08 GET /bookings/{bookingId} / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-09 GET baggage-options / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-09 GET baggage-options / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-09 GET baggage-options / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-10 POST baggage / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-10 POST baggage / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-10 POST baggage / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-11 POST date-change/search / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-11 POST date-change/search / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-11 POST date-change/search / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-12 POST date-change / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-12 POST date-change / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-12 POST date-change / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-13 GET cancellation-quote / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-13 GET cancellation-quote / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-13 GET cancellation-quote / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-14 POST cancel / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-14 POST cancel / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-14 POST cancel / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-18 GET tickets / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-18 GET tickets / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-18 GET tickets / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-19 GET tickets/{ticketId} / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-19 GET tickets/{ticketId} / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-19 GET tickets/{ticketId} / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-20 POST check-in / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-20 POST check-in / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-20 POST check-in / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-21 GET boarding-passes / customer sobre recurso de partner ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-21 GET boarding-passes / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-21 GET boarding-passes / admin sobre recurso de customer ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: OP-17 DELETE /webhooks/{id} / partner sobre recurso de admin ⇒ 404
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 ajeno: ninguna petición ajena modificó el recurso del dueño
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-01 POST /search / anonymous ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-01 POST /search / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-01 POST /search / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-01 POST /search / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-02 GET /offers/{offerId}/seatmap / anonymous ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-02 GET /offers/{offerId}/seatmap / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-02 GET /offers/{offerId}/seatmap / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-02 GET /offers/{offerId}/seatmap / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-22 GET /flights/{flightNumber}/status / anonymous ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-22 GET /flights/{flightNumber}/status / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-22 GET /flights/{flightNumber}/status / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-22 GET /flights/{flightNumber}/status / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-03 POST /offers/hold / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-03 POST /offers/hold / customer ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-03 POST /offers/hold / partner ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-03 POST /offers/hold / admin ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-04 GET /offers/hold/{holdId} / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-04 GET /offers/hold/{holdId} / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-04 GET /offers/hold/{holdId} / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-04 GET /offers/hold/{holdId} / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-05 DELETE /offers/hold/{holdId} / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-05 DELETE /offers/hold/{holdId} / customer ⇒ 204
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-05 DELETE /offers/hold/{holdId} / partner ⇒ 204
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-05 DELETE /offers/hold/{holdId} / admin ⇒ 204
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-07 POST /bookings / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-07 POST /bookings / customer ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-07 POST /bookings / partner ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-07 POST /bookings / admin ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-06 GET /bookings / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-06 GET /bookings / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-06 GET /bookings / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-06 GET /bookings / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-08 GET /bookings/{bookingId} / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-08 GET /bookings/{bookingId} / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-08 GET /bookings/{bookingId} / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-08 GET /bookings/{bookingId} / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-18 GET /bookings/{bookingId}/tickets / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-18 GET /bookings/{bookingId}/tickets / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-18 GET /bookings/{bookingId}/tickets / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-18 GET /bookings/{bookingId}/tickets / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-19 GET /bookings/{bookingId}/tickets/{ticketId} / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-19 GET /bookings/{bookingId}/tickets/{ticketId} / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-19 GET /bookings/{bookingId}/tickets/{ticketId} / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-19 GET /bookings/{bookingId}/tickets/{ticketId} / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-09 GET /bookings/{bookingId}/baggage-options / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-09 GET /bookings/{bookingId}/baggage-options / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-09 GET /bookings/{bookingId}/baggage-options / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-09 GET /bookings/{bookingId}/baggage-options / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-10 POST /bookings/{bookingId}/baggage / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-10 POST /bookings/{bookingId}/baggage / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-10 POST /bookings/{bookingId}/baggage / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-10 POST /bookings/{bookingId}/baggage / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-11 POST /bookings/{bookingId}/date-change/search / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-11 POST /bookings/{bookingId}/date-change/search / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-11 POST /bookings/{bookingId}/date-change/search / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-11 POST /bookings/{bookingId}/date-change/search / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-12 POST /bookings/{bookingId}/date-change / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-12 POST /bookings/{bookingId}/date-change / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-12 POST /bookings/{bookingId}/date-change / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-12 POST /bookings/{bookingId}/date-change / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-13 GET /bookings/{bookingId}/cancellation-quote / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-13 GET /bookings/{bookingId}/cancellation-quote / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-13 GET /bookings/{bookingId}/cancellation-quote / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-13 GET /bookings/{bookingId}/cancellation-quote / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-14 POST /bookings/{bookingId}/cancel / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-14 POST /bookings/{bookingId}/cancel / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-14 POST /bookings/{bookingId}/cancel / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-14 POST /bookings/{bookingId}/cancel / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-20 POST /bookings/{bookingId}/check-in / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-20 POST /bookings/{bookingId}/check-in / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-20 POST /bookings/{bookingId}/check-in / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-20 POST /bookings/{bookingId}/check-in / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-21 GET /bookings/{bookingId}/boarding-passes / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-21 GET /bookings/{bookingId}/boarding-passes / customer ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-21 GET /bookings/{bookingId}/boarding-passes / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-21 GET /bookings/{bookingId}/boarding-passes / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-16 POST /webhooks / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-16 POST /webhooks / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-16 POST /webhooks / partner ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-16 POST /webhooks / admin ⇒ 201
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-15 GET /webhooks / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-15 GET /webhooks / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-15 GET /webhooks / partner ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-15 GET /webhooks / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-17 DELETE /webhooks/{id} / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-17 DELETE /webhooks/{id} / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-17 DELETE /webhooks/{id} / partner ⇒ 204
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: OP-17 DELETE /webhooks/{id} / admin ⇒ 204
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-01 POST /admin/flights / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-01 POST /admin/flights / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-01 POST /admin/flights / partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-01 POST /admin/flights / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-02 GET /admin/flights / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-02 GET /admin/flights / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-02 GET /admin/flights / partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-02 GET /admin/flights / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-03 PUT /admin/fares / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-03 PUT /admin/fares / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-03 PUT /admin/fares / partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-03 PUT /admin/fares / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-04 GET /admin/fares / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-04 GET /admin/fares / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-04 GET /admin/fares / partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-04 GET /admin/fares / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-05 POST /admin/flights/{id}/operational-updates / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-05 POST /admin/flights/{id}/operational-updates / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-05 POST /admin/flights/{id}/operational-updates / partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-05 POST /admin/flights/{id}/operational-updates / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-06 POST /admin/flights/{id}/close / anonymous ⇒ 401
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-06 POST /admin/flights/{id}/close / customer ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-06 POST /admin/flights/{id}/close / partner ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 matriz: ADM-06 POST /admin/flights/{id}/close / admin ⇒ 200
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: OP-16 POST /webhooks / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: OP-15 GET /webhooks / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: OP-17 DELETE /webhooks/{id} / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-01 POST /admin/flights / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-01 POST /admin/flights / partner con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-02 GET /admin/flights / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-02 GET /admin/flights / partner con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-03 PUT /admin/fares / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-03 PUT /admin/fares / partner con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-04 GET /admin/fares / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-04 GET /admin/fares / partner con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-05 POST /admin/flights/{id}/operational-updates / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-05 POST /admin/flights/{id}/operational-updates / partner con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-06 POST /admin/flights/{id}/close / customer con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-SEC-03 rol: ADM-06 POST /admin/flights/{id}/close / partner con scopes forjados ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-I7 / J7: seguridad PLT-I7 / J7: sin token ⇒ 401 con ProblemDetails
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-I7 / J7: seguridad PLT-I7 / J7: scope insuficiente ⇒ 403
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-I7 / J7: seguridad PLT-I7 / J7: recurso ajeno ⇒ 404 indistinguible de uno inexistente
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-I7 / J7: seguridad PLT-I7 / J7: 429 en /search con Retry-After al superar el límite por huella
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-I7 / J7: seguridad CORS PLT-I7 / J7: origen permitido ⇒ recibe Access-Control-Allow-Origin
  ✓ Gateway: composición gRPC real en proceso PLT-SEC-03 / PLT-I7: autorización rol × operación sobre la composición real PLT-I7 / J7: seguridad CORS PLT-I7 / J7: origen no permitido ⇒ sin cabeceras CORS
  ✎ Gateway: composición gRPC real en proceso OP-02: oferta expirada con segmento compartido por otra oferta activa ⇒ 404 (requiere offerId en ResolveSegment; ver ADR-F11-03 y BACKLOG)
PASS platform/api-gateway/test/e2e/v2/local-platform.e2e.spec.ts
  ✓ F12a · características de asiento del contrato v2 V2-LOC-01 EXIT_ROW del catálogo se publica como EMERGENCY_EXIT y lo desconocido se descarta
  ✓ F12a · características de asiento del contrato v2 V2-LOC-02 sin duplicados y tolera datos vacíos
  ✓ F12a · plataforma real: health y mapa de asientos con fila de salida (contra servicios reales) V2-LOC-03 el health del gateway sondea los siete servicios reales con la llave interna: HEALTHY y siete UP
  ✓ F12a · plataforma real: health y mapa de asientos con fila de salida (contra servicios reales) V2-LOC-04 un asiento de fila de salida (EXIT_ROW) no rompe el mapa de asientos v2
PASS platform/api-gateway/test/e2e/v2/p1-security.e2e.spec.ts
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-01 emite un token con client_id y client_secret en el cuerpo (form)
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-02 emite un token con autenticación HTTP Basic
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-03 emite un token con cuerpo JSON
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-04 limita el token al subconjunto de scopes pedido
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-05 rechaza un scope que el cliente no tiene con invalid_scope
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-06 rechaza un scope inexistente con invalid_scope
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-07 rechaza un secreto incorrecto con invalid_client sin revelar el secreto
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-08 responde igual para un cliente inexistente y para un secreto incorrecto
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-09 con Basic inválido responde 401 con WWW-Authenticate
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-10 rechaza un grant_type distinto de client_credentials
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-11 rechaza la petición sin credenciales
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-12 rechaza un cliente desactivado
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-13 bloquea con 429 tras demasiados intentos fallidos del mismo cliente y no revela si el secreto era válido
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 emisión de tokens (POST /api/v2/oauth2/token) V2-P1-14 el secreto se guarda con scrypt y nunca en claro
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 token y JWKS (GET /api/v2/.well-known/jwks.json) V2-P1-15 el JWKS publica solo la llave pública con kid y alg RS256
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 token y JWKS (GET /api/v2/.well-known/jwks.json) V2-P1-16 un tercero verifica el token solo con el JWKS publicado
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 token y JWKS (GET /api/v2/.well-known/jwks.json) V2-P1-17 el token vence según expires_in
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-18 sin token responde 401 UNAUTHORIZED con ProblemDetails v2
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-19 con un token sin el scope requerido responde 403 FORBIDDEN
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-20 con un token manipulado responde 401
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-21 rechaza un token vencido (más allá de la tolerancia de reloj)
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-22 rechaza un token con otro emisor o audiencia aunque esté bien firmado
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-23 un cliente desactivado pierde el acceso con sus tokens ya emitidos
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-24 un token emitido por la llave del dev-auth no vale con un clientId inexistente
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-25 un token alg=none no se acepta
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 autenticación y autorización en rutas protegidas V2-P1-26 anyScope acepta flights:ops o flights:admin y rechaza el resto
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-27 con token de partner el dueño es <clientId>~<X-User-Id>
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-28 sin X-User-Id el dueño es el propio clientId
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-29 dos clientes con el mismo X-User-Id tienen dueños distintos
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-30 Booking no puede suplantar a un usuario de Supabase: un X-User-Id con ~ o con el sub ajeno nunca produce el sub ajeno
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-31 con un token que no es de partner X-User-Id se ignora y el dueño es el sub
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-32 rechaza un X-User-Id vacío, demasiado largo o con caracteres no permitidos
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 dueño compuesto (D1) y X-User-Id V2-P1-33 el dueño compuesto cabe en el límite de 128 caracteres de los servicios
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-34 devuelve X-Correlation-Id propagado y genera X-Request-Id
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-35 respeta un X-Request-Id válido del cliente
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-36 genera un X-Correlation-Id si no llega
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-37 rechaza un X-Correlation-Id de más de 100 caracteres con 400 ProblemDetails
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-38 una ruta inexistente responde 404 NOT_FOUND con ProblemDetails
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-39 un JSON mal formado responde 400 ProblemDetails sin eco del cuerpo
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 trazabilidad y errores transversales V2-P1-40 el 429 del rate limit lleva Retry-After y ProblemDetails v2
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-41 con los siete servicios SERVING responde 200 HEALTHY y cumple VuelosHealthResponse
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-42 no exige token
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-43 con Webhooks caído responde 200 DEGRADED
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-44 con Inventory caído responde 503 DOWN con el mismo esquema de cuerpo
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-45 con Pricing o Reservation caídos también responde DOWN
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-46 responde en menos de 1 s aunque ningún servicio acepte conexiones
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-47 el resultado se reutiliza dentro de la caché y se refresca al vencer
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 GET /api/v2/vuelos/health V2-P1-48 usa NODE_ID y PROVIDER_NAME configurados
  ✓ F12a P1 · dev-auth, seguridad y trazabilidad v2 V2-P1-49 el cliente de prueba recibe scopes completos si no pide ninguno
PASS platform/api-gateway/test/e2e/v2/p2-booking.e2e.spec.ts
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-35 con el pago confirmado crea la reserva: 201, BookingDetail, boletos emitidos y datos de v2
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-36 publica booking.confirmed y booking.ticket_issued como CloudEvents válidos solo al cliente dueño
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-37 un reintento con la misma Idempotency-Key devuelve 200, Idempotent-Replayed y la misma reserva sin volver a consultar el pago
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-38 la misma clave con otro cuerpo responde 409 IDEMPOTENCY_KEY_REUSED
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-39 con el pago pendiente responde 202 PENDING_PAYMENT y el scheduler lo confirma al aprobarse
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-40 con el pago pendiente POST /tickets responde 422 y, ya confirmado, emite con issued 1
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-41 un pago fallido responde 422 PAYMENT_NOT_AUTHORIZED sin crear reserva y deja el hold vivo
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-42 una referencia que Booking no conoce responde 422 PAYMENT_NOT_AUTHORIZED
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-43 un monto distinto en la API de pagos responde 422 AMOUNT_MISMATCH sin crear reserva
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-44 un payment.amount distinto del precio congelado responde 422 AMOUNT_MISMATCH sin consultar el pago
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-45 con la API de pagos caída responde 503 PROVIDER_UNAVAILABLE con Retry-After y el mismo reintento funciona al volver
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-46 sin respuesta dentro del plazo propio responde 503 y no crea reserva
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-47 una referencia ya usada en otra reserva responde 422 PAYMENT_REFERENCE_INVALID
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-48 la referencia es cualquier texto de 1 a 64 caracteres, sin patrón
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-49 el hold de otro usuario o de otro cliente responde 404
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-50 un hold vencido responde 410 HOLD_EXPIRED
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-51 un hold liberado responde 410 HOLD_EXPIRED
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-52 un hold ya consumido por otra reserva responde 409 HOLD_ALREADY_CONSUMED
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-53 pasajeros que no coinciden con el desglose del hold responden 422 PASSENGER_COUNT_MISMATCH
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-54 un infante sin adulto asociado válido responde 422 INFANT_WITHOUT_ADULT
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-55 un infante con asiento responde 422 INFANT_SEAT_NOT_ALLOWED y con adulto y sin asiento se acepta
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-56 en un vuelo internacional solo se acepta pasaporte; en uno nacional basta el documento de identidad
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-57 un documento que vence antes del viaje responde 422 DOCUMENT_EXPIRED
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-58 passengerId repetido responde 400 y un id que ya es UUID se conserva
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-59 sin token 401, scope insuficiente 403 y cuerpo inválido 400 con invalidParams
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-60 un asiento ya tomado responde 409 SEAT_TAKEN
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-61 el equipaje extra suma al total y el pago debe cubrirlo
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) POST /vuelos/bookings V2-P2-62 sin X-User-Id la huella del dispositivo identifica al usuario anónimo
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings V2-P2-63 lista solo las reservas del usuario, cumple BookingListResponse y trae enlaces
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings V2-P2-64 filtra por estado, pnr y fechas de creación
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings V2-P2-65 pagina con limit y cursor sin repetir ni omitir
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings V2-P2-66 un estado desconocido o un limit fuera de rango responden 400 y sin token 401
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings/{bookingId} y boletos V2-P2-67 el detalle cumple BookingDetail; otro usuario u otro cliente reciben 404; id inválido 400
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings/{bookingId} y boletos V2-P2-68 lista los boletos con nombre del pasajero, vuelo y asiento y devuelve uno por id
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings/{bookingId} y boletos V2-P2-69 un boleto inexistente o de otro usuario responde 404
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings/{bookingId} y boletos V2-P2-70 POST /tickets sobre una reserva ya emitida es idempotente: 200, issued 0 y sin eventos nuevos
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) GET /vuelos/bookings/{bookingId} y boletos V2-P2-71 POST /tickets sobre una reserva fallida responde 409 BOOKING_NOT_CONFIRMED y de otro usuario 404
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) emisión diferida (Ticketing no disponible) V2-P2-72 si Ticketing falla responde 202 TICKET_ISSUING con el bookingId y POST /tickets completa la emisión
  ✓ F12a P2 · reservas, emisión y boletos v2 (contra servicios reales) emisión diferida (Ticketing no disponible) V2-P2-73 tras tres fallos la reserva queda FAILED y se publican booking.ticket_failed y booking.failed
PASS platform/api-gateway/test/e2e/v2/p2-shopping.e2e.spec.ts
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-01 devuelve las ofertas del vuelo, cumple SearchResponse y no expone ids internos
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-02 es público: no pide token
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-03 sin X-Device-Fingerprint responde 400 ProblemDetails
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-04 más infantes que adultos responde 422 INFANT_WITHOUT_ADULT
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-05 más de 9 pasajeros con asiento responde 422
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-06 una ruta sin vuelos responde 200 con cero ofertas
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-07 aplica los valores por defecto del desglose de pasajeros
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-08 un código IATA inválido o una fecha inválida responden 400 con invalidParams
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/search V2-P2-09 rechaza propiedades desconocidas en la solicitud
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/offers/{offerId}/seatmap V2-P2-10 devuelve el mapa con status por asiento y cumple SeatMapResponse
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/offers/{offerId}/seatmap V2-P2-11 un asiento reservado pasa a BOOKED y isAvailable a false
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/offers/{offerId}/seatmap V2-P2-12 un offerId que no es UUID o no existe responde 404 NOT_FOUND
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/offers/{offerId}/seatmap V2-P2-13 sin segmentId responde 400
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/flights/{flightNumber}/status V2-P2-14 devuelve el estado público, delayMinutes y cumple FlightStatus
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/flights/{flightNumber}/status V2-P2-15 un vuelo inexistente responde 404 y una fecha inválida 400
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET /vuelos/flights/{flightNumber}/status V2-P2-16 el estado refleja un retraso operativo como delayMinutes positivo
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-17 crea el hold: 201, HoldResponse, Location y enlaces
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-18 respeta ttlMinutes dentro de 5 a 30
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-19 ttlMinutes fuera de 5 a 30 responde 400
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-20 un reintento con la misma clave y cuerpo devuelve 200, Idempotent-Replayed y el mismo hold
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-21 la misma clave con otro cuerpo responde 409 IDEMPOTENCY_KEY_REUSED
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-22 el orden de las propiedades del cuerpo no cuenta como otro cuerpo
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-23 la Idempotency-Key es obligatoria y debe ser UUID v4
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-24 sin token responde 401 y con un scope que no corresponde 403
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-25 una oferta inexistente o con id que no es UUID responde 410 OFFER_NO_LONGER_AVAILABLE
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-26 más infantes que adultos en el hold responde 422 INFANT_WITHOUT_ADULT
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-27 publica hold.created una sola vez al cliente suscrito y no a otro cliente
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) POST /vuelos/offers/hold V2-P2-28 el hold ocupa un cupo del vuelo y liberarlo lo devuelve
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET y DELETE /vuelos/offers/hold/{holdId} V2-P2-29 consulta el hold con tiempo restante, enlaces y cumple HoldStatusResponse
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET y DELETE /vuelos/offers/hold/{holdId} V2-P2-30 otro usuario del mismo cliente u otro cliente reciben 404
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET y DELETE /vuelos/offers/hold/{holdId} V2-P2-31 libera el hold: 204, queda RELEASED y liberar otra vez también responde 204
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET y DELETE /vuelos/offers/hold/{holdId} V2-P2-32 liberar el hold de otro responde 404 y un hold inexistente 404
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET y DELETE /vuelos/offers/hold/{holdId} V2-P2-33 un hold ya convertido en reserva responde 409 HOLD_ALREADY_CONSUMED al liberarlo
  ✓ F12a P2 · búsqueda, mapa de asientos, estado de vuelo y hold (contra servicios reales) GET y DELETE /vuelos/offers/hold/{holdId} V2-P2-34 holdId que no es UUID responde 400 y sin token 401
PASS platform/api-gateway/test/e2e/v2/p3-booking-events-auth.e2e.spec.ts
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-40 sin secreto configurado el endpoint rechaza todo, incluso una firma calculada con cualquier secreto
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-41 una firma ausente, con otro secreto, de otro cuerpo, sin prefijo o mal formada responde 401
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-42 la firma se calcula sobre los bytes exactos: cambiar un espacio la invalida
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-43 la cabecera y el prefijo de la firma son configurables
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-44 con firma válida un cuerpo que no es CloudEvent responde 400 y un tipo no soportado 422
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-45 una reserva desconocida responde 404 y no deja el id del evento reclamado
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-46 con BOOKING_EVENTS_CLIENT_ID solo se atienden reservas de ese cliente
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-47 el endpoint no pide token de partner y un token no sustituye a la firma
  ✓ F12a P3 · POST /vuelos/booking-events: autenticación por HMAC y validación (sin servicios) V2-P3-48 el secreto no aparece en ninguna respuesta de error
PASS platform/api-gateway/test/e2e/v2/p3-events.e2e.spec.ts
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-01 crea una suscripción: 201, WebhookSubscription sin secreto (writeOnly) y guardado cifrado a nombre del cliente
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-02 la suscripción es del cliente: el X-User-Id no la separa y otro cliente no la ve
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-03 la lista no incluye suscripciones de v1 del mismo dueño
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-04 elimina la suscripción: 204, luego 404 y de otro cliente 404
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-05 valida la solicitud: url inválida, sin eventos, evento desconocido, secreto corto y propiedades de solo lectura
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-06 la política de URL rechaza loopback, redes privadas y 100.64.0.0/10 fuera del perfil local
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-07 exige token y el scope flights:webhooks
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-08 los tres eventos nuevos de v2 se pueden suscribir
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-09 la entrega de una suscripción v2 usa el backoff del contrato: 1, 5, 30, 120 y 360 minutos
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) suscripciones (POST, GET, DELETE /vuelos/webhooks) V2-P3-10 los usuarios de un mismo cliente entregan a la única suscripción del cliente y otro cliente no recibe nada
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) GET /vuelos/eventos (feed de respaldo) V2-P3-11 devuelve los eventos del cliente en orden, como CloudEvents válidos, aunque no haya suscripciones
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) GET /vuelos/eventos (feed de respaldo) V2-P3-12 expone el usuario final en data.ownerId y nunca el dueño compuesto ni el id interno
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) GET /vuelos/eventos (feed de respaldo) V2-P3-13 pagina con limit y after sin repetir ni omitir y cierra con next_after nulo
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) GET /vuelos/eventos (feed de respaldo) V2-P3-14 filtra por tipo y rechaza un after mal formado o un limit fuera de rango
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) GET /vuelos/eventos (feed de respaldo) V2-P3-15 un cliente no ve los eventos de otro y el feed exige token y scope
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) GET /vuelos/eventos (feed de respaldo) V2-P3-16 el correlationid de un evento sin correlación propia es su id de evento y el de la fachada lleva el X-Correlation-Id
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-17 payment.confirmed sobre una reserva ya emitida responde 202 ALREADY_ISSUED sin efectos nuevos
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-18 payment.confirmed con el pago ya confirmado en Booking emite los boletos de una reserva PENDING_PAYMENT
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-19 payment.confirmed mientras la API de pagos aún dice pendiente no emite: PAYMENT_PENDING
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-20 payment.confirmed completa una emisión que quedó en TICKET_ISSUING
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-21 payment.failed sobre una reserva ya emitida la anula: boletos VOIDED, cupo liberado, FAILED y booking.failed al cliente
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-22 payment.failed sobre una reserva con pago pendiente la falla y libera el hold
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-23 un segundo payment.failed con otro id no repite la compensación ni los eventos
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-24 el mismo id de evento repetido devuelve el mismo resultado con Idempotent-Replayed y sin efectos
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-25 un monto distinto al de la reserva responde 422 AMOUNT_MISMATCH y no cambia nada
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-26 una moneda distinta responde 422 AMOUNT_MISMATCH y un evento de pago sin amount 400
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-27 una referencia de pago que no es la de la reserva responde 422 PAYMENT_REFERENCE_INVALID
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-28 sin bookingId localiza la reserva por la referencia de pago y una reserva desconocida responde 404
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-29 acepta application/json y application/cloudevents+json y rechaza otros tipos de contenido
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-30 un payment.failed de un cliente no puede tocar la reserva de otro: el id sale de la reserva, no del evento
  ✓ F12a P3 · webhooks, feed de eventos y booking-events (contra servicios reales) POST /vuelos/booking-events V2-P3-31 los eventos que el feed expone incluyen la compensación (booking.failed)
PASS platform/api-gateway/test/e2e/v2/p4-postsale.e2e.spec.ts
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-01 lista las opciones de equipaje con el id de pasajero de Booking y cumple BaggageOptionsResponse
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-02 compra una maleta con el pago confirmado: 200, total acumulado y booking.baggage_added con importe y referencia
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-03 con el pago pendiente responde 422 PAYMENT_NOT_AUTHORIZED y no agrega ninguna maleta
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-04 con el pago fallido, inexistente o de otro monto no se agrega ninguna maleta
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-05 más de 3 maletas, por compra o acumuladas, responde 422 BAGGAGE_LIMIT_EXCEEDED (v2) y nada se cobra de más
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-06 un reintento con la misma Idempotency-Key devuelve 200 Idempotent-Replayed y no cobra otra vez
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) equipaje V2-P4-07 un pasajero que no es de la reserva responde 400, una reserva ajena 404 y un cuerpo inválido 400
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cambio de fecha V2-P4-10 busca ofertas de cambio: cumple DateChangeSearchResponse, sin ids internos
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cambio de fecha V2-P4-11 confirma el cambio con el pago de la diferencia: 200 BookingDetail con el vuelo nuevo y booking.changed
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cambio de fecha V2-P4-12 sin el pago de la diferencia no cambia la fecha: 422 y la reserva queda igual
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cambio de fecha V2-P4-13 una oferta de cambio desconocida responde 404 o 410 y una tarifa no cambiable 409 FARE_NOT_CHANGEABLE
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-20 cotiza la cancelación: cumple CancellationQuoteResponse; otro usuario 404
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-21 cancela con la cotización: 200 CancelBookingResponse, reembolso informado, boletos anulados, cupo devuelto y booking.cancelled
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-22 sin quoteId solo se admite con SAGA_COMPENSATION o FLIGHT_CANCELLED; con otra causa responde 400
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-23 SAGA_COMPENSATION dentro de la ventana no paga penalidad: reembolso total sin cotización previa
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-24 SAGA_COMPENSATION fuera de la ventana aplica la penalidad de la tarifa
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-25 FLIGHT_CANCELLED sin cotización devuelve el total aunque la causa sea de la aerolínea
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-26 una cotización ajena o inexistente responde 409 QUOTE_EXPIRED y no cancela
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-27 cancelar otra vez responde 409 ALREADY_CANCELLED y repetir la misma clave 200 con la respuesta guardada
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-28 una reserva que aún no está confirmada responde 409 BOOKING_NOT_CANCELLABLE
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-29 exige el scope flights:cancel, rechaza reservas ajenas y la Idempotency-Key
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-30 package.cancelled cancela la parte de vuelo sin penalidad y es idempotente por id de evento
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) cancelación V2-P4-31 package.cancelled sobre una reserva con pago pendiente la falla y libera el hold; sobre una desconocida responde 404
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-40 cambia el asiento de una reserva emitida: 200 SeatChangeResponse con el anterior, estado TICKETED, mapa actualizado y booking.seat_changed
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-41 un asiento ocupado por otra reserva responde 409 SEAT_TAKEN y nada cambia
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-42 el cambio es atómico: si un asiento falla no se cambia ninguno
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-43 dos pasajeros de la reserva pueden intercambiar asientos en una sola llamada
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-44 un asiento que no existe en el avión responde 422 SEAT_CABIN_MISMATCH y un infante 422 INFANT_SEAT_NOT_ALLOWED
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-45 después del check-in no se puede cambiar: 409 CUTOFF_PASSED
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-46 una reserva sin confirmar responde 409 BOOKING_NOT_CONFIRMED; un pasajero o segmento ajenos 400; otro usuario 404; cuerpo inválido 400
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) asientos V2-P4-47 un reintento con la misma clave devuelve 200 Idempotent-Replayed y no cambia de nuevo
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) check-in y pases de abordar V2-P4-50 hace el check-in dentro de la ventana de 48 h: 200 CheckInResponse con el id de Booking, enlaces y booking.checked_in; luego los pases
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) check-in y pases de abordar V2-P4-51 fuera de la ventana responde 409 CHECK_IN_NOT_AVAILABLE y los pases antes del check-in 409 BOARDING_PASS_NOT_AVAILABLE
  ✓ F12a P4 · postventa, asientos y check-in v2 (contra servicios reales) check-in y pases de abordar V2-P4-52 repetir el check-in no se duplica; otro usuario 404; sin token 401; sin scope 403
PASS platform/api-gateway/test/e2e/v2/p5-stock.e2e.spec.ts
  ✓ F12a P5 · stock hacia Booking por gRPC (contra servicios reales) V2-P5-01 un hold baja la disponibilidad enviada: item, fecha local, hora y x-api-key/x-correlation-id
  ✓ F12a P5 · stock hacia Booking por gRPC (contra servicios reales) V2-P5-02 liberar el hold devuelve el asiento a la disponibilidad enviada
  ✓ F12a P5 · stock hacia Booking por gRPC (contra servicios reales) V2-P5-03 una reserva confirmada mantiene el asiento descontado y cancelarla lo devuelve
  ✓ F12a P5 · stock hacia Booking por gRPC (contra servicios reales) V2-P5-04 con Booking caído la operación responde igual, el envío queda en la cola y se reenvía al volver
  ✓ F12a P5 · stock hacia Booking por gRPC (contra servicios reales) V2-P5-05 un vuelo cerrado se informa con 0 unidades
  ✓ F12a P5 · stock hacia Booking por gRPC (contra servicios reales) V2-P5-06 el mensaje enviado trae solo los campos del contrato de Booking
PASS platform/api-gateway/test/e2e/v2/seat-taken.e2e.spec.ts
  ✓ F12a · un asiento ocupado responde 409 SEAT_TAKEN en v1 y v2 (no 500) V2-SEAT-01 v2: el segundo pasajero que pide el mismo asiento recibe 409 SEAT_TAKEN y la primera reserva queda intacta
  ✓ F12a · un asiento ocupado responde 409 SEAT_TAKEN en v1 y v2 (no 500) V2-SEAT-02 v1: el mismo caso responde 409 SEAT_TAKEN con el ProblemDetails de v1
PASS platform/api-gateway/test/e2e/webhook-emitters.e2e.spec.ts
  ✓ PLT-H3 / E: los emisores publican en el receptor gRPC de Webhooks inventory entrega hold.expired al receptor
  ✓ PLT-H3 / E: los emisores publican en el receptor gRPC de Webhooks reservation entrega booking.confirmed al receptor
  ✓ PLT-H3 / E: los emisores publican en el receptor gRPC de Webhooks operations entrega booking.checked_in al receptor
PASS platform/api-gateway/test/integration/prisma-idempotency.integration.spec.ts
  ✓ GW-04 integration: idempotency_keys replays an identical request and permits only one concurrent claimant
  ✓ GW-04 integration: idempotency_keys permite un solo reintento tras un timeout sin aceptar otro cuerpo
PASS platform/api-gateway/test/integration/v2-state.integration.spec.ts
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-01 guarda y lee la reserva v2 con sus ids de pasajero y canal de venta
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-02 guardar dos veces la misma reserva actualiza sin duplicar (repara un reintento)
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-03 busca por referencia de pago solo dentro del cliente
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-04 una reserva inexistente devuelve null
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-05 un evento de Booking se reclama una sola vez, también en concurrencia
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-06 el resultado del evento se guarda y se lee; el mismo id de otro cliente es independiente
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-07 liberar un evento sin resultado permite reclamarlo de nuevo y uno ya resuelto no se libera
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-08 el cliente del dev-auth se guarda con el hash del secreto y se activa o desactiva
  ✓ F12a integración: estado de la fachada v2 y clientes del dev-auth en Postgres V2-STATE-09 no se puede crear dos veces el mismo clientId
```

## reservation-service

`RUN_RSV12_REAL=true RUN_PST_REAL=true RUN_PST_SMOKE_REAL=true npx jest microservices/reservation-service --runInBand --verbose`

- Corrida 1: Test Suites: 32 passed, 32 total · Tests:       213 passed, 213 total
- Corrida 2: Test Suites: 32 passed, 32 total · Tests:       213 passed, 213 total
- Corrida 3 (lista): 32 suites passed de 32 · 213 passed, 0 failed, 0 omitidas/todo de 213

```
PASS microservices/reservation-service/test/dependency-deadline.spec.ts
  ✓ configura plazos de dependencias de Reservation y rechaza valores inválidos
PASS microservices/reservation-service/test/dependency-unavailable.spec.ts
  ✓ propaga indisponibilidad gRPC 14 sin detalles internos
  ✓ propaga indisponibilidad gRPC 4 sin detalles internos
PASS microservices/reservation-service/test/f12a-booking-payments.spec.ts
  ✓ F12a verificador de pagos de Booking (D4) PAY-01: confirmado con monto y moneda iguales autoriza y consulta la URL esperada con la credencial
  ✓ F12a verificador de pagos de Booking (D4) PAY-02: pendiente devuelve PENDING
  ✓ F12a verificador de pagos de Booking (D4) PAY-03: fallido responde PAYMENT_NOT_AUTHORIZED
  ✓ F12a verificador de pagos de Booking (D4) PAY-04: referencia inexistente (404) responde PAYMENT_NOT_AUTHORIZED
  ✓ F12a verificador de pagos de Booking (D4) PAY-05: confirmado con monto distinto responde AMOUNT_MISMATCH
  ✓ F12a verificador de pagos de Booking (D4) PAY-06: confirmado con otra moneda responde AMOUNT_MISMATCH
  ✓ F12a verificador de pagos de Booking (D4) PAY-07: confirmado sin monto no se puede verificar y responde AMOUNT_MISMATCH
  ✓ F12a verificador de pagos de Booking (D4) PAY-08: un estado que no está en el mapa se trata como no autorizado
  ✓ F12a verificador de pagos de Booking (D4) PAY-09: sin moneda en la respuesta se asume la de la operación
  ✓ F12a verificador de pagos de Booking (D4) PAY-10: Booking sin conexión o 5xx es proveedor no disponible (UNAVAILABLE)
  ✓ F12a verificador de pagos de Booking (D4) PAY-11: 401 y 403 (nuestra credencial rechazada) también son proveedor no disponible
  ✓ F12a verificador de pagos de Booking (D4) PAY-12: un cuerpo que no es JSON es proveedor no disponible
  ✓ F12a verificador de pagos de Booking (D4) PAY-13: sin respuesta dentro del plazo propio el verificador falla rápido
  ✓ F12a verificador de pagos de Booking (D4) PAY-14: sin BOOKING_PAYMENTS_BASE_URL nunca autoriza: falla como proveedor no disponible
  ✓ F12a verificador de pagos de Booking (D4) PAY-15: verify=off (solo perfil local) autoriza sin consultar a nadie
  ✓ F12a verificador de pagos de Booking (D4) PAY-16: el mapa de estados y los campos se cambian solo por configuración
  ✓ F12a verificador de pagos de Booking (D4) PAY-17: acepta la respuesta envuelta en data y el monto como número, texto u objeto
  ✓ F12a verificador de pagos de Booking (D4) PAY-18: la referencia se codifica en la ruta y no permite salirse de ella
  ✓ F12a verificador de pagos de Booking (D4) PAY-19: una redirección no se sigue y cuenta como proveedor no disponible
  ✓ F12a verificador de pagos de Booking (D4) PAY-20: ningún error expone la credencial ni la respuesta de Booking
  ✓ F12a verificador de pagos de Booking (D4) PAY-21: void y refund no hacen nada (el reembolso lo ejecuta Booking)
  ✓ F12a verificador de pagos de Booking (D4) PAY-22: classifyStatus ignora mayúsculas, acentos y espacios
  ✓ F12a verificador de pagos de Booking (D4) PAY-23: pickField busca alias y envoltorios y devuelve undefined si no hay
  ✓ F12a verificador de pagos de Booking (D4) PAY-24: la configuración por entorno valida URL, plazo, plantilla y JSON
  ✓ F12a verificador de pagos de Booking (D4) PAY-25: verify=off exige INTEGRATION_LOCAL=true y el perfil local se rechaza en producción
  ✓ F12a verificador de pagos de Booking (D4) PAY-28: verify=off con NODE_ENV=production se rechaza al arrancar
  ✓ F12a verificador de pagos de Booking (D4) PAY-29: con verify=off cada pago autorizado sin verificar deja un aviso sin datos sensibles
  ✓ F12a verificador de pagos de Booking (D4) PAY-30: al arrancar con verify=off se avisa y con verify=on no
  ✓ F12a verificador de pagos de Booking (D4) PAY-26: los valores por defecto son seguros: verificación activa, sin URL, plazo de 2,5 s
  ✓ F12a verificador de pagos de Booking (D4) PAY-27: la URL base se normaliza sin barras finales y la plantilla se puede cambiar
PASS microservices/reservation-service/test/f12a-error-passthrough.spec.ts
  ✓ F12a: un error de negocio de una dependencia no se convierte en 500 (v1 y v2) ERR-01: SEAT_TAKEN de Ancillaries (ABORTED) se devuelve con su código del catálogo
  ✓ F12a: un error de negocio de una dependencia no se convierte en 500 (v1 y v2) ERR-02: los demás códigos del catálogo con su estado gRPC se conservan
  ✓ F12a: un error de negocio de una dependencia no se convierte en 500 (v1 y v2) ERR-03: un código del catálogo con un estado gRPC que no le corresponde sigue siendo INTERNAL_ERROR
  ✓ F12a: un error de negocio de una dependencia no se convierte en 500 (v1 y v2) ERR-04: un texto que no es del catálogo no se refleja al cliente
  ✓ F12a: un error de negocio de una dependencia no se convierte en 500 (v1 y v2) ERR-05: un DomainError propio y la indisponibilidad de una dependencia siguen como antes
PASS microservices/reservation-service/test/f12a-postsale.spec.ts
  ✓ F12a postventa v2 en Reservation (D5) PSV2-01: sin exención la cotización es la de la tarifa (sin cambios para v1)
  ✓ F12a postventa v2 en Reservation (D5) PSV2-02: con waivePenalty el reembolso es el total, la penalidad cero y se guarda esa cotización
  ✓ F12a postventa v2 en Reservation (D5) PSV2-03: storedQuote devuelve la cotización emitida, también usada, y QUOTE_EXPIRED si no existe o es de otra reserva
  ✓ F12a postventa v2 en Reservation (D5) PSV2-04: una reserva v2 publica booking.cancelled con causa, refundId y asientos; la de v1 sale como siempre
  ✓ F12a postventa v2 en Reservation (D5) PSV2-05: sin reasonCode la causa del evento es CUSTOMER_REQUEST
  ✓ F12a postventa v2 en Reservation (D5) PSV2-06: refundIdFor es estable por cotización, con formato REF-VUE-XXXXXXXX y distinto entre cotizaciones
  ✓ F12a postventa v2 en Reservation (D5) PSV2-07: seatsOf no cuenta a los infantes
PASS microservices/reservation-service/test/f12a-v2-saga.spec.ts
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-01: con canal BOOKING y pago aprobado confirma, guarda el canal y publica booking.confirmed y booking.ticket_issued con sus datos
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-02: v1 (sin canal) no cambia: un solo booking.confirmed, sin extra ni ticket_issued, y el verificador de siempre
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-03: Ticketing caído con deferIssuanceFailure deja la reserva en TICKET_ISSUING con el hold consumido y sin eventos
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-04: sin deferIssuanceFailure el fallo de Ticketing se propaga como siempre
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-05: un boleto no emitido también se difiere con deferIssuanceFailure y sin él lanza TICKET_ISSUANCE_FAILED
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-06: ResumePending cierra una emisión diferida y publica confirmed y ticket_issued una sola vez
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-07: tres fallos de emisión terminan en FAILED con ticket_failed y luego booking.failed
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-08: el fallo terminal de una reserva de v1 sigue publicando solo booking.failed
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-09: pago pendiente crea PENDING_PAYMENT sin reservar nada; al aprobarse reserva asientos, consume el hold y confirma
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-10: si el pago pendiente resulta rechazado la reserva falla, libera asientos y hold y publica booking.failed
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-11: monto distinto al reverificar también falla la reserva con AMOUNT_MISMATCH
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-12: Booking sin responder al reverificar no falla la reserva ni aborta el lote
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-13: si al llegar el pago ya no se pueden reservar los asientos la reserva falla con el código del dominio
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-14: si el hold venció mientras el pago estaba pendiente la reserva falla con OFFER_NO_LONGER_AVAILABLE
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-15: un pago pendiente de v1 sigue su camino de siempre (sin reservar asientos ni consumir hold al reanudar)
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-16: FailReservation (D3) anula boletos, libera asientos, capacidad y hold, marca FAILED y publica booking.failed
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-17: FailReservation es idempotente: la segunda llamada no repite compensaciones ni eventos
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-18: FailReservation sobre una reserva en PENDING_PAYMENT no anula boletos inexistentes
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-19: FailReservation de otro dueño o de una reserva inexistente es NOT_FOUND
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-20: FailReservation no pisa un cambio de fecha ni una cancelación en curso
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-21: si anular los boletos falla no cambia el estado ni publica; el reintento completa la compensación
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-22: FailReservation sobre una reserva cancelada la deja cancelada
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-23: resumeOne reanuda solo la reserva indicada del dueño
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-24: resumeOne de otro dueño es NOT_FOUND y sobre una reserva confirmada no hace nada
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-25: la referencia de pago se usa una sola vez aunque cambie el Idempotency-Key
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-26: un rechazo del pago no crea reserva ni consume nada
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-27: con el proveedor de pagos caído no se crea nada
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-28: eventId determinista: estable, distinto por tipo y con forma de UUID
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-29: allocationOf extrae asientos y equipaje de los pasajeros
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-30: RoutingPaymentVerifier usa el verificador de siempre sin canal y rechaza canales desconocidos o heredados
  ✓ F12a v2: pago por canal, emisión diferida y eventos de la reserva RSV-V2-31: el listado filtra por estado y por rango de creación
PASS microservices/reservation-service/test/f9-allowance.spec.ts
  ✓ F9-0 / U: el adaptador conserva la tarifa seleccionada en GetPriceLock
  ✓ F9-0 / U: incluso con pago pendiente se registra la franquicia de la tarifa adquirida
PASS microservices/reservation-service/test/grpc-pricing-gateway.spec.ts
  ✓ CreateReservation: un hold inexistente o ajeno conserva NOT_FOUND gRPC sin detalles internos
  ✓ CreateReservation: no confunde otros fallos de Pricing con un hold inexistente
  ✓ PST-03 / U: conserva FARE_NOT_CHANGEABLE devuelto por Pricing gRPC
PASS microservices/reservation-service/test/integration/pricing-hold-fixture.spec.ts
  ✓ RSV-12 pricing hold fixture RSV-12 / U: reads the camelCase Pricing SearchOffers response used by the gRPC client
PASS microservices/reservation-service/test/integration/reservation-by-flight.spec.ts
  ✓ RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales RSV-FLT-01: recorre todas las páginas de un vuelo con ownerId, sin repetir ni omitir
  ✓ RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales RSV-FLT-02: sin cursor ni limit devuelve la primera página completa y no incluye otros vuelos
  ✓ RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales RSV-FLT-03: límite fuera de 1..50 y cursor inválido ⇒ INVALID_ARGUMENT
  ✓ RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales RSV-FLT-04 / S: el rol customer no puede listar reservas de un vuelo (PERMISSION_DENIED)
  ✓ RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales RSV-FLT-04 / S: el rol partner no puede listar reservas de un vuelo (PERMISSION_DENIED)
  ✓ RSV-FLT: ListReservationsByFlightInstance con Prisma y gRPC reales RSV-FLT-04 / S: el rol admin no puede listar reservas de un vuelo (PERMISSION_DENIED)
PASS microservices/reservation-service/test/integration/reservation-owner-prisma.spec.ts
  ✓ H5 / RSV-SEC-02/04: owner scope through gRPC and Prisma RSV-SEC-02 / S H5: GetReservation of another owner is NOT_FOUND over real gRPC
  ✓ H5 / RSV-SEC-02/04: owner scope through gRPC and Prisma RSV-SEC-04 / S H5: GetReservationSnapshot of another owner is NOT_FOUND over real gRPC
  ✓ H5 / RSV-SEC-02/04: owner scope through gRPC and Prisma RSV-SEC-02 / S H5: ListReservations of another owner is empty over real gRPC
PASS microservices/reservation-service/test/integration/rsv-11-postgres.spec.ts
  ✓ RSV-11: PostgreSQL concurrency RSV-11 / C PostgreSQL: same idempotency_key five times creates one reservation
  ✓ RSV-11: PostgreSQL concurrency RSV-11 / C PostgreSQL: same paymentReference in two reservations creates one
  ✓ RSV-11: PostgreSQL concurrency H3 / RSV-02/06 PostgreSQL: created reservation is read after a new query use case
  ✓ RSV-11: PostgreSQL concurrency H4 / RSV-09/10 PostgreSQL: filters, cursor pagination and flight snapshot use persisted rows
PASS microservices/reservation-service/test/integration/rsv-12-real.spec.ts
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-SMOKE / I: el script real completa sus diez pasos contra servicios reales
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales F9-0 / I: reserva real registra franquicia cero y rechaza otro owner por gRPC
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales F9-0 / I: reserva real registra N maletas incluidas y rechaza otro owner por gRPC
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-02 / I: conserva equipaje extra de compra separado de la franquicia y lo descuenta del límite
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-02 / I: compra postventa real persiste pago, maleta e historial y publica webhook
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-03/04 / I: busca y confirma cambio con Pricing, Inventory, Ancillaries y Ticketing reales
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-03/04 / S: reserva BASIC devuelve FARE_NOT_CHANGEABLE en búsqueda y confirmación sin efectos
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-05/06 / I: cotiza y ejecuta cancelación sobre servicios reales
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-07 / C: el mismo cancellation quote en paralelo solo cancela una vez
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-07 / C: el mismo changeOfferId en paralelo solo se consume una vez
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-SEC-01 / S: cada RPC postventa responde NOT_FOUND para otro owner
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-SEC-02 / S: una paymentReference inicial no se reutiliza para equipaje
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales PST-SEC-01 / S: los RPC rechazan cantidad fuera de 1–3, fecha pasada e ids inválidos
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales RSV-12 / I: ruta feliz emite tickets con los cinco servicios reales
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales RSV-12 / I: pago pendiente pasa por ResumePending hasta CONFIRMED
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales timeout tras emitir tickets deja una compra recuperable por ResumePending
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales RSV-12 / I: TICKETING_FAIL_MODE=always libera recursos
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales RSV-12 / I: hold expirado se rechaza sin crear reserva
  ✓ RSV-12: integración local con Inventory, Pricing, Ancillaries, Ticketing y Webhooks reales RSV-12 / I: CreateReservation por gRPC usa los adaptadores reales como main con owner smoke no UUID
PASS microservices/reservation-service/test/integration/smoke-payload-grpc.spec.ts
  ✓ RSV-13: payload del smoke por gRPC real RSV-13 / K: CreateReservation acepta el payload del smoke y devuelve BookingDetail conforme al contrato
  ✓ RSV-13: payload del smoke por gRPC real RSV-13 / I: GetReservation y ListReservations preservan bookingId y PNR
PASS microservices/reservation-service/test/prisma-diagnostic.spec.ts
  ✓ F9 / diagnóstico: registra código y metadatos permitidos sin mensajes ni valores
PASS microservices/reservation-service/test/pst-01-eligibility.spec.ts
  ✓ PST-01 / U: permite una reserva confirmada con todos sus segmentos futuros
  ✓ PST-01 / U: rechaza una reserva que no está confirmada
  ✓ PST-01 / U: rechaza una salida en el instante actual
  ✓ PST-01 / U: rechaza snapshots incompletos en lugar de tratarlos como elegibles
PASS microservices/reservation-service/test/pst-02-baggage.spec.ts
  ✓ PST-02 / U: el cutoff de cuatro horas es inclusivo
  ✓ PST-02 / I: calcula pago, compra una vez y publica booking.baggage_added
  ✓ PST-02 / K: opciones usan el precio de la tarifa y cumplen OpenAPI
PASS microservices/reservation-service/test/pst-03-date-change-search.spec.ts
  ✓ PST-03 / K: devuelve ofertas de cambio validadas con el schema OpenAPI
  ✓ PST-03 / S: tarifa no cambiable responde FARE_NOT_CHANGEABLE antes de Pricing
  ✓ PST-03 / S: reserva de otro owner no se consulta en Pricing
PASS microservices/reservation-service/test/pst-04-date-change-confirm.spec.ts
  ✓ PST-04 / I: confirma el cambio, consume el nuevo hold, libera el anterior y reemite
  ✓ PST-04 / S: una tarifa BASIC responde FARE_NOT_CHANGEABLE sin efectos
  ✓ PST-04 / S: ChangeOffer vencido devuelve CHANGE_OFFER_EXPIRED sin cambiar la reserva
  ✓ PST-04 / I: fallo parcial deja la reserva en CHANGE_PENDING
  ✓ PST-04 / S: un cambio no usa el offer de otro owner
  ✓ PST-04 / I: ResumePending completa una reemisión que quedó pendiente
  ✓ PST-SEC-02 / S: la reserva reclama referencias de pago de forma atómica y global
PASS microservices/reservation-service/test/pst-05-06-cancellation.spec.ts
  ✓ PST-05 / K: cotiza y persiste CancellationQuote con contrato OpenAPI
  ✓ PST-06 / I: cancela, reembolsa, libera recursos y publica evento
  ✓ PST-06 / I: ResumePending completa una cancelación que falló después de liquidar tickets
  ✓ PST-06 / S: un quote vencido o ya usado no vuelve a ejecutar el pago
  ✓ PST-06 / S: quote vencido devuelve QUOTE_EXPIRED y conserva la reserva CONFIRMED
  ✓ PST-06 / S: una reserva ajena no obtiene cotización
  ✓ PST-06 / K: cancellation parcial expone CANCELLATION_PENDING válido en OpenAPI
PASS microservices/reservation-service/test/rsv-01-server.spec.ts
  ✓ RSV-01: servidor Reservation RSV-01 / M: health responde SERVING con llave interna
  ✓ RSV-01: servidor Reservation RSV-SEC-04 / S: health rechaza una llave ausente
PASS microservices/reservation-service/test/rsv-02-schema.spec.ts
  ✓ RSV-02: modelo y migración RSV-02 / I: persiste tablas, restricciones únicas y no administra esquemas
PASS microservices/reservation-service/test/rsv-03-state.spec.ts
  ✓ RSV-03: state machine RSV-03 / U: PENDING -> PENDING_PAYMENT is valid
  ✓ RSV-03: state machine RSV-03 / U: PENDING -> TICKET_ISSUING is valid
  ✓ RSV-03: state machine RSV-03 / U: PENDING_PAYMENT -> TICKET_ISSUING is valid
  ✓ RSV-03: state machine RSV-03 / U: TICKET_ISSUING -> CONFIRMED records a change
  ✓ RSV-03: state machine RSV-03 / U: CONFIRMED -> CHANGE_PENDING -> CONFIRMED is valid
  ✓ RSV-03: state machine RSV-03 / U: CONFIRMED -> CANCELLATION_PENDING -> CANCELLED is valid
  ✓ RSV-03: state machine RSV-03 / U: invalid transition is rejected
  ✓ RSV-03: state machine RSV-03 / U: CANCELLED is terminal
  ✓ RSV-03: state machine RSV-03 / U: FAILED is terminal
PASS microservices/reservation-service/test/rsv-04-passengers.spec.ts
  ✓ RSV-04: passenger validation RSV-04 / U: rejects count and type different from hold breakdown
  ✓ RSV-04: passenger validation RSV-04 / U: rejects duplicated passengerId
  ✓ RSV-04: passenger validation RSV-04 / U: rejects infant without an associated adult
  ✓ RSV-04: passenger validation RSV-04 / U: rejects two infants associated to one adult
  ✓ RSV-04: passenger validation RSV-04 / U: rejects age inconsistent with passenger type
  ✓ RSV-04: passenger validation RSV-04 / U: rejects an infant with an assigned seat
PASS microservices/reservation-service/test/rsv-05-pnr.spec.ts
  ✓ RSV-05: PNR RSV-05 / U: genera seis caracteres no ambiguos
  ✓ RSV-05: PNR RSV-05 / I: 10 000 PNR no colisionan persistidos
PASS microservices/reservation-service/test/rsv-06-create.spec.ts
  ✓ RSV-06: CreateReservation RSV-06 / I: ruta feliz confirma y devuelve equivalente 201
  ✓ RSV-06: CreateReservation RSV-06 / I: pago pendiente conserva reserva equivalente 202
  ✓ RSV-06: CreateReservation RSV-06 / I: pago inválido no persiste reserva
  ✓ RSV-06: CreateReservation RSV-06 / I: hold expirado se rechaza antes de persistir
  ✓ RSV-06: CreateReservation RSV-06 / I: SEAT_TAKEN compensa ancillaries, pago y reserva
PASS microservices/reservation-service/test/rsv-07-10.spec.ts
  ✓ RSV-07..10: pending and queries RSV-07 / I: pending payment becomes CONFIRMED and publishes booking.confirmed
  ✓ RSV-07..10: pending and queries RSV-07 / I: three real ticketing failures become FAILED and release resources
  ✓ RSV-07..10: pending and queries RSV-07 / I: issued tickets are VOIDED when a later retry exhausts
  ✓ RSV-07..10: pending and queries RSV-08 / K: detail composes Ancillaries and Ticketing and validates BookingDetail
  ✓ RSV-07..10: pending and queries RSV-09 / I: pagination is stable and excludes a different owner
  ✓ RSV-07..10: pending and queries RSV-10 / I: foreign snapshot is NOT_FOUND and flight lookup remains internal
PASS microservices/reservation-service/test/rsv-08-dependency-errors.spec.ts
  ✓ RSV-08: Ancillaries NOT_FOUND en ambas lecturas produce detalle vacío para el owner
  ✓ RSV-08: Ancillaries getAssignments UNAVAILABLE falla y registra dependencia y código sin PII
  ✓ RSV-08: Ancillaries getBaggageOptions UNAVAILABLE falla y registra dependencia y código sin PII
  ✓ RSV-08: Ticketing código 5 falla y registra dependencia y código sin PII
  ✓ RSV-08: Ticketing código 14 falla y registra dependencia y código sin PII
  ✓ RSV-08: inventory createHold falla y registra dependencia y código sin PII
  ✓ RSV-08: inventory releaseReservedInventory falla y registra dependencia y código sin PII
  ✓ RSV-08: ancillaries purchaseBaggage falla y registra dependencia y código sin PII
  ✓ RSV-08: ticketing voidTickets falla y registra dependencia y código sin PII
  ✓ RSV-08: ticketing reissueTickets falla y registra dependencia y código sin PII
  ✓ RSV-08: ticketing refundTickets falla y registra dependencia y código sin PII
  ✓ RSV-08: owner ajeno se rechaza antes de consultar dependencias
PASS microservices/reservation-service/test/rsv-11-concurrency.spec.ts
  ✓ RSV-11: concurrencia RSV-11 / C: misma idempotency_key cinco veces crea una reserva
  ✓ RSV-11: concurrencia RSV-11 / C: paymentReference en dos reservas acredita una
PASS microservices/reservation-service/test/rsv-13-by-flight.spec.ts
  ✓ RSV-FLT-U1: byFlightInstance pagina de forma estable con ownerId y tope de 50
PASS microservices/reservation-service/test/security/reservation-security.spec.ts
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-04 / S: missing internal key is UNAUTHENTICATED
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-04 / S: incorrect internal key is UNAUTHENTICATED
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: invalid CreateReservation input is INVALID_ARGUMENT
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: invalid GetReservation logs only its field name
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: invalid ListReservations logs the field without its value
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: invalid GetReservationSnapshot logs the field without its value
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: invalid ListReservationsByFlightInstance logs the field without its value
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "MALE" is rejected before creating a reservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "FEMALE" is rejected before creating a reservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "OTHER" is rejected before creating a reservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "m" is rejected before creating a reservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "" is rejected before creating a reservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "M" is accepted by CreateReservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "F" is accepted by CreateReservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-01 / S: gender "X" is accepted by CreateReservation
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-02 / S: ownerId comes from metadata rather than the body
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-04 / S: ResumePending denies customer role
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-04 / S: forced internal error hides PII and implementation details
  ✓ RSV-SEC-01..04: gRPC security RSV-SEC-03 / S: request log redacts passenger PII and payment reference
PASS microservices/reservation-service/test/unit/bind-host.spec.ts
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-01 por defecto escucha en 0.0.0.0 (Cloud Run) y en el puerto del servicio
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-02 PORT sustituye al puerto por defecto
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-03 INTEGRATION_LOCAL=true escucha solo en 127.0.0.1
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-04 solo el valor exacto "true" activa el perfil
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-05 INTEGRATION_LOCAL=true con NODE_ENV=production se rechaza
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-06 NODE_ENV=production sin el perfil sigue en 0.0.0.0
  ✓ reservation-service: dirección de escucha gRPC (perfil de integración local) BIND-07 GRPC_BIND_HOST fuerza la dirección
```

## webhooks-service

`npx jest microservices/webhooks-service --runInBand --verbose`

- Corrida 1: Test Suites: 8 passed, 8 total · Tests:       62 passed, 62 total
- Corrida 2: Test Suites: 8 passed, 8 total · Tests:       62 passed, 62 total
- Corrida 3 (lista): 8 suites passed de 8 · 62 passed, 0 failed, 0 omitidas/todo de 62

```
PASS microservices/webhooks-service/test/integration/webhooks-v2.spec.ts
  ✓ WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos WHK-V2-IT-01: la suscripción v2 se guarda con api_version 2 y la v1 con 1
  ✓ WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos WHK-V2-IT-02: D1 — la suscripción del cliente recibe los eventos <clientId>~* y no los de otro cliente
  ✓ WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos WHK-V2-IT-03: el evento queda registrado con seq creciente y un reintento con el mismo eventId conserva el seq
  ✓ WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos WHK-V2-IT-04: ListEvents devuelve solo los eventos del cliente, en orden, con total y paginación por afterSeq
  ✓ WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos WHK-V2-IT-05: un prefijo que es cadena inicial de otro cliente no filtra sus eventos
  ✓ WHK-V2 integración (Postgres): enrutado por cliente y almacén de eventos WHK-V2-IT-06: la entrega del evento a una suscripción v2 sale como CloudEvent con id evt-vue-<seq>
PASS microservices/webhooks-service/test/integration/webhooks.spec.ts
  ✓ WHK integration (WHK-03..06) WHK-03: creates, masks, lists and owner-scopes deletion
  ✓ WHK integration (WHK-03..06) H2 / WHK-04: persists zero deliveries without subscriptions and two with two matching subscriptions
  ✓ WHK integration (WHK-03..06) WHK-04/05/06: posts one OpenAPI-shaped signed event to a real local receiver
  ✓ WHK integration (WHK-03..06) WHK-05: applies the configured retry schedule with a fixed clock
  ✓ WHK integration (WHK-03..06) WHK-05: claims a pending delivery once under concurrent dispatchers
  ✓ WHK integration (WHK-03..06) reclaims PROCESSING deliveries after two request timeouts
  ✓ WHK integration (WHK-03..06) treats a redirect as a failed delivery and never follows its target
PASS microservices/webhooks-service/test/security/grpc-security.spec.ts
  ✓ WHK-SEC-05 gRPC security baseline rejects a missing internal key, customer dispatch and malformed RPC input
  ✓ WHK-SEC-05 gRPC security baseline WHK-VAL-02 / F11d-1: rechaza data adicional, conserva GUID sin variante RFC y rechaza UUID malformado
  ✓ WHK-SEC-05 gRPC security baseline F11d-1 / ADR-F11-16: occurredAt sin segundos o con +0200 es VALIDATION_FAILED; con +02:00 se acepta
  ✓ WHK-SEC-05 gRPC security baseline maps an internal failure to a generic error without the implementation detail
PASS microservices/webhooks-service/test/security/webhook-security.spec.ts
  ✓ webhook security rejects an incorrectly typed holdId with INVALID_ARGUMENT
  ✓ webhook security encrypts secrets with authenticated encryption
  ✓ webhook security rejects invalid subscription input
  ✓ webhook security rejects loopback webhook URLs
  ✓ webhook security redacts subscription secrets from logging
PASS microservices/webhooks-service/test/unit/bind-host.spec.ts
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-01 por defecto escucha en 0.0.0.0 (Cloud Run) y en el puerto del servicio
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-02 PORT sustituye al puerto por defecto
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-03 INTEGRATION_LOCAL=true escucha solo en 127.0.0.1
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-04 solo el valor exacto "true" activa el perfil
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-05 INTEGRATION_LOCAL=true con NODE_ENV=production se rechaza
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-06 NODE_ENV=production sin el perfil sigue en 0.0.0.0
  ✓ webhooks-service: dirección de escucha gRPC (perfil de integración local) BIND-07 GRPC_BIND_HOST fuerza la dirección
PASS microservices/webhooks-service/test/unit/datetime-zod4.spec.ts
  ✓ F11d-1 / ADR-F11-16: occurredAt date-time RFC 3339 acepta 2026-10-24T00:00:00Z
  ✓ F11d-1 / ADR-F11-16: occurredAt date-time RFC 3339 acepta 2026-10-24T00:00:00.000Z
  ✓ F11d-1 / ADR-F11-16: occurredAt date-time RFC 3339 acepta 2026-10-24T00:00:00+02:00
  ✓ F11d-1 / ADR-F11-16: occurredAt date-time RFC 3339 rechaza 2026-10-24T00:00Z
  ✓ F11d-1 / ADR-F11-16: occurredAt date-time RFC 3339 rechaza 2026-10-24T00:00:00+0200
PASS microservices/webhooks-service/test/unit/webhook-use-cases.spec.ts
  ✓ WebhookUseCases WHK-VAL-01: rechaza campos adicionales en data del evento
  ✓ WebhookUseCases F11d-1 / ADR-F11-16: occurredAt con desplazamiento se guarda como el mismo instante en UTC
  ✓ WebhookUseCases masks secrets and scopes deletion to the owner
  ✓ WebhookUseCases creates one delivery for each matching active subscription and signs its stable event
  ✓ WebhookUseCases reschedules a failed delivery using the first configured backoff
PASS microservices/webhooks-service/test/unit/webhook-v2.spec.ts
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-01: una suscripción v2 informa active y la v1 conserva su forma de siempre
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-02: la entrega v2 es un CloudEvent v1.0 firmado con sha256=<HMAC(secret, cuerpo)> y sin cabecera v1
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-03: la entrega v1 no cambia (mismas cinco propiedades y firma t=…,v1=…)
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-04: sin correlación el correlationid es el eventId y el id sale del seq con seis dígitos
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-05: los campos extra viajan en data y no pueden reescribir los campos base
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-06: data.ownerId es solo el usuario final; un dueño sin cliente no se expone
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-07: el subject es el bookingId, el holdId o vuelo/fecha
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-08: los tres eventos nuevos son suscribibles
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-09: D1 — la suscripción del cliente recibe los eventos de <clientId>~* y la de otro cliente no
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-10: D1 — un dueño de v1 (sin ~) solo entrega a su propia suscripción
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-11: subscriberOwners separa en el primer ~
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-12: todo evento se registra aunque no haya suscripciones y un reintento con el mismo eventId conserva el seq
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-13: dataJson inválido (no JSON, arreglo o demasiado largo) se rechaza
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-14: ListEvents filtra por cliente y tipo, pagina con afterSeq y devuelve dataJson
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-15: ListEvents valida limit, tipo y campos desconocidos
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-23: una suscripción v2 reintenta a 1, 5, 30, 120 y 360 minutos y falla al sexto intento; una v1 conserva su propio calendario
  ✓ F12a Webhooks v2: CloudEvents, enrutado al cliente y almacén de eventos WHK-V2-16: v1Body conserva el orden y omite los campos de v2
  ✓ F12a Webhooks: política de URL y perfil de integración local WHK-V2-17: 100.64.0.0/10 se rechaza en producción y fuera del perfil local
  ✓ F12a Webhooks: política de URL y perfil de integración local WHK-V2-18: en el perfil local se admite http y 100.64.0.0/10
  ✓ F12a Webhooks: política de URL y perfil de integración local WHK-V2-19: el perfil local no abre el resto de rangos privados ni las credenciales en la URL
  ✓ F12a Webhooks: política de URL y perfil de integración local WHK-V2-20: las direcciones públicas vecinas de 100.64.0.0/10 siguen permitidas con https
  ✓ F12a Webhooks: política de URL y perfil de integración local WHK-V2-21: producción exige https aunque la IP sea Tailscale y el perfil local
  ✓ F12a Webhooks: política de URL y perfil de integración local WHK-V2-22: el servidor se niega a arrancar con INTEGRATION_LOCAL y producción
```

## ancillaries-service

`npx jest microservices/ancillaries-service --runInBand --verbose`

- Corrida 1: Test Suites: 1 skipped, 15 passed, 15 of 16 total · Tests:       1 skipped, 57 passed, 58 total
- Corrida 2: Test Suites: 1 skipped, 15 passed, 15 of 16 total · Tests:       1 skipped, 57 passed, 58 total
- Corrida 3 (lista): 15 suites passed de 16 · 57 passed, 0 failed, 1 omitidas/todo de 58

```
PASS microservices/ancillaries-service/test/anc-01-server.spec.ts
  ✓ ANC-01: servidor Ancillaries ANC-01 / M: health responde SERVING con llave interna
  ✓ ANC-01: servidor Ancillaries ANC-01 / S: health rechaza una llave ausente
PASS microservices/ancillaries-service/test/anc-02-model.spec.ts
  ✓ ANC-02 / I: la migración contiene el índice único parcial de asientos activos
PASS microservices/ancillaries-service/test/anc-04-seat-map.spec.ts
  ✓ ANC-04 / I / K: GetSeatMapForOffer devuelve SeatMapResponse sin precios
PASS microservices/ancillaries-service/test/anc-05-eligibility.spec.ts
  ✓ ANC-05 / U: un infante no puede ocupar asiento
  ✓ ANC-05 / U: la cabina del asiento debe coincidir con la comprada
  ✓ ANC-05 / U: un menor no puede ocupar una salida de emergencia
PASS microservices/ancillaries-service/test/anc-06-07-seat-assignments.spec.ts
  ✓ ANC-06 / I: una colisión de asiento devuelve SEAT_TAKEN
  ✓ ANC-07 / I: check-in asigna el primer asiento libre de la cabina
  ✓ ANC-07 / DCS-03: repetir check-in conserva el asiento y no altera otro pasajero
PASS microservices/ancillaries-service/test/anc-08-baggage.spec.ts
  ✓ ANC-08 / U: exceder el máximo de equipaje devuelve BAGGAGE_LIMIT_EXCEEDED
PASS microservices/ancillaries-service/test/anc-10-smoke-payload.spec.ts
  ✓ ANC-10: payload del smoke ANC-10 / I: ReserveSeats acepta exactamente el payload que envía smoke.cjs
PASS microservices/ancillaries-service/test/anc-f9-allowance.spec.ts
  ✓ F9-0 / U: registra y devuelve franquicias cero y N por itinerario
  ✓ F9-0 / U: la franquicia fija el owner antes de cualquier asiento o equipaje extra
PASS microservices/ancillaries-service/test/ancillaries-controller.spec.ts
  ✓ ANC-SEC-02 / S: controlador sin contexto u ownerId devuelve NOT_FOUND controlado
SKIPPED microservices/ancillaries-service/test/integration/anc-10-real.spec.ts
  ○ ANC-10 / I: ReserveSeats acepta el mismo payload del smoke contra servicios reales
PASS microservices/ancillaries-service/test/integration/ancillaries-postgres.spec.ts
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-02/03 / I: existen tablas ancillaries y plantilla E190 sembrada
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-06/07 / I: la colisión se rechaza y check-in conserva una asignación existente
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-09 / C: diez reservas simultáneas del mismo asiento producen un solo éxito
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-08/09 / C: compras paralelas de equipaje nunca superan el máximo
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S ReserveSeats: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S ConfirmSeats: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no modifica
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S ReleaseSeats: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no modifica
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S ReleaseAll: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no modifica
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S GetAssignments: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no lee
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S AssignSeatAtCheckIn: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S ReserveBaggage: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S GetBaggageOptions: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no lee
  ✓ ANC-02/03/06/07/09: integración PostgreSQL ANC-SEC-02 / S PurchaseBaggage: owner-B sobre reserva de owner-A devuelve NOT_FOUND y no escribe
PASS microservices/ancillaries-service/test/integration/f12a-change-seats.spec.ts
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-01 mueve el asiento: informa el anterior, conserva el estado y deja libre el viejo
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-02 un cambio a su mismo asiento es válido y no cambia nada
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-03 dos pasajeros intercambian asientos en una sola operación
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-04 un asiento ocupado por otra reserva responde SEAT_TAKEN y no cambia ninguno de los asientos pedidos
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-05 un asiento de otra cabina responde SEAT_CABIN_MISMATCH sin cambios
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-06 un infante no puede tener asiento
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-07 después del check-in no se puede cambiar (CUTOFF_PASSED) y el resto de pasajeros no se toca
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-08 un pasajero sin asiento recibe uno con el estado indicado
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-09 un asiento liberado se reactiva con el nuevo asiento
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-10 otro dueño recibe NOT_FOUND y no modifica nada
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-11 un asiento que no existe en el avión responde SEAT_CABIN_MISMATCH
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-12 la solicitud inválida (duplicados, formato de asiento, sin cambios, de más) responde VALIDATION_FAILED
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-13 dos pasajeros de la misma solicitud al mismo asiento responden SEAT_TAKEN y no cambian nada
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-14 dos reservas que piden a la vez el mismo asiento libre producen un solo éxito
  ✓ F12a CHG: ChangeSeats atómico contra PostgreSQL CHG-15 no deja asientos temporales tras un cambio fallido
PASS microservices/ancillaries-service/test/integration/f9-pool-pressure.spec.ts
  ✓ F9 / integración con pool limitado F9 / C: lecturas, compra y liberación con una conexión ocupada temporalmente
PASS microservices/ancillaries-service/test/prisma-diagnostic.spec.ts
  ✓ F9 / diagnóstico: registra código y metadatos permitidos sin mensajes ni valores
PASS microservices/ancillaries-service/test/security/ancillaries-security.spec.ts
  ✓ ANC-SEC-01/02/03 ANC-SEC-03: llave ausente e incorrecta son UNAUTHENTICATED
  ✓ ANC-SEC-01/02/03 ANC-SEC-01: uuid y formato de asiento inválidos son VALIDATION_FAILED
  ✓ ANC-SEC-01/02/03 ANC-SEC-03: rol customer no puede ejecutar ReleaseAll
  ✓ ANC-SEC-01/02/03 ANC-SEC-02: metadata owner prevalece sobre ownerId del cuerpo
  ✓ ANC-SEC-01/02/03 ANC-SEC-03: error interno y logs no exponen PII
PASS microservices/ancillaries-service/test/unit/bind-host.spec.ts
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-01 por defecto escucha en 0.0.0.0 (Cloud Run) y en el puerto del servicio
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-02 PORT sustituye al puerto por defecto
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-03 INTEGRATION_LOCAL=true escucha solo en 127.0.0.1
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-04 solo el valor exacto "true" activa el perfil
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-05 INTEGRATION_LOCAL=true con NODE_ENV=production se rechaza
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-06 NODE_ENV=production sin el perfil sigue en 0.0.0.0
  ✓ ancillaries-service: dirección de escucha gRPC (perfil de integración local) BIND-07 GRPC_BIND_HOST fuerza la dirección
```

## operations-service

`RUN_DCS_REAL=true npx jest microservices/operations-service --runInBand --verbose`

- Corrida 1: Test Suites: 19 passed, 19 total · Tests:       78 passed, 78 total
- Corrida 2: Test Suites: 19 passed, 19 total · Tests:       78 passed, 78 total
- Corrida 3 (lista): 19 suites passed de 19 · 78 passed, 0 failed, 0 omitidas/todo de 78

```
PASS microservices/operations-service/test/boarding-passes.spec.ts
  ✓ DCS-04: revalidación de pases DCS-04: exige reserva confirmada antes de leer los pases
  ✓ DCS-04: revalidación de pases DCS-04: excluye segmentos cancelados o pasajeros ausentes del snapshot
PASS microservices/operations-service/test/check-in-domain.spec.ts
  ✓ DCS-02: máquinas de estado de check-in DCS-02: permite apertura, inicio, finalización y posterior invalidación
  ✓ DCS-02: máquinas de estado de check-in DCS-02: rechaza transiciones no permitidas del agregado
  ✓ DCS-02: máquinas de estado de check-in DCS-02: pasajero por segmento solo pasa de pendiente a éxito o fallo
  ✓ DCS-02: máquinas de estado de check-in DCS-02: resultado mixto completa; todos fallidos produce FAILED
PASS microservices/operations-service/test/check-in-grpc.spec.ts
  ✓ DCS-01: clientes con owner por llamada DCS-01: snapshot propaga el owner de cada reserva en metadata
  ✓ DCS-01: clientes con owner por llamada DCS-01: cupones preservan el owner y devuelven los estados
  ✓ DCS-01: clientes con owner por llamada DCS-01: asignación envía pasajero y segmento con owner en metadata
PASS microservices/operations-service/test/check-in-offers.spec.ts
  ✓ DCS-SMOKE: elección de vuelos del seed DCS-SMOKE-01: busca el día siguiente si la oferta anterior queda fuera de la ventana y selecciona la tarifa por propiedad
  ✓ DCS-SMOKE: elección de vuelos del seed DCS-SMOKE-02: sin oferta dentro de la ventana informa NO_FLIGHT_IN_CHECKIN_WINDOW
PASS microservices/operations-service/test/check-in-window.spec.ts
  ✓ DCS-03: ventana con reloj fijo DCS-03: antes de la apertura devuelve CHECK_IN_NOT_AVAILABLE
  ✓ DCS-03: ventana con reloj fijo DCS-03: acepta la apertura y una hora dentro de la ventana
  ✓ DCS-03: ventana con reloj fijo DCS-03: en el cierre y después devuelve CUTOFF_PASSED
PASS microservices/operations-service/test/check-in.spec.ts
  ✓ DCS-03 / DCS-05: check-in DCS-SEC-02: el QR no contiene documento, correo ni teléfono
  ✓ DCS-03 / DCS-05: check-in DCS-03: resultado mixto completo, pase QR y evento sin datos de contacto
  ✓ DCS-03 / DCS-05: check-in DCS-SEC-01: owner ajeno no provoca efectos
  ✓ DCS-03 / DCS-05: check-in DCS-03: infante comparte el asiento del adulto sin reservar uno adicional
  ✓ DCS-03 / DCS-05: check-in DCS-05: un fallo de publicación permite reintentar el check-in
  ✓ DCS-03 / DCS-05: check-in DCS-03: solo procesa segmentos que están dentro de su ventana
PASS microservices/operations-service/test/delay-threshold.spec.ts
  ✓ OPS-05: umbral de retraso OPS-05: publica flight.schedule_changed solo desde DELAY_THRESHOLD_MINUTES
PASS microservices/operations-service/test/flight-status-notify.spec.ts
  ✓ OPS-ADM: actualización operacional sobre vuelos sin estado y notificaciones OPS-ADM-01: crea el estado desde Inventory cuando el vuelo aún no lo tiene
  ✓ OPS-ADM: actualización operacional sobre vuelos sin estado y notificaciones OPS-ADM-02: un vuelo que no existe en Inventory devuelve NOT_FOUND
  ✓ OPS-ADM: actualización operacional sobre vuelos sin estado y notificaciones OPS-ADM-03: si Reservation falla, la cancelación y el cierre se mantienen, se registra dependencia y código, y el reintento notifica
  ✓ OPS-ADM: actualización operacional sobre vuelos sin estado y notificaciones OPS-ADM-04: GrpcReservationGateway recorre todas las páginas y conserva ownerId
  ✓ OPS-ADM: actualización operacional sobre vuelos sin estado y notificaciones OPS-ADM-05: GrpcInventoryGateway.getFlight traduce NOT_FOUND y devuelve el segmento con su id
PASS microservices/operations-service/test/flight-status.spec.ts
  ✓ OPS-04/OPS-05 OPS-04: crea el estado perezosamente desde Inventory
  ✓ OPS-04/OPS-05 OPS-05: publica cambios desde quince minutos
  ✓ OPS-04/OPS-05: errores e idempotencia OPS-04: un vuelo inexistente devuelve FLIGHT_STATUS_NOT_AVAILABLE
  ✓ OPS-04/OPS-05: errores e idempotencia OPS-04: Inventory no disponible conserva UNAVAILABLE
  ✓ OPS-04/OPS-05: errores e idempotencia OPS-05: repetir cancelación no vuelve a cerrar ni publicar
  ✓ OPS-04/OPS-05: errores e idempotencia OPS-05: repetir el mismo horario de retraso no vuelve a publicar
  ✓ OPS-04/OPS-05: errores e idempotencia OPS-05: si falla el cierre de Inventory, el reintento vuelve a intentarlo
  ✓ OPS-04/OPS-05: errores e idempotencia OPS-05: si falla la publicación, el reintento no vuelve a cerrar el vuelo
PASS microservices/operations-service/test/grpc-adapters.spec.ts
  ✓ OPS-01: adaptadores gRPC OPS-04: traduce NOT_FOUND de Inventory sin confundirlo con indisponibilidad
  ✓ OPS-01: adaptadores gRPC OPS-04: traduce UNAVAILABLE sin filtrar detalles internos
  ✓ OPS-01: adaptadores gRPC OPS-01: traduce Inventory y cierra la instancia por gRPC
  ✓ OPS-01: adaptadores gRPC OPS-01: publica el evento de vuelo con el payload público
  ✓ OPS-01: adaptadores gRPC DCS-03: envía un identificador UUID en el evento de check-in para Webhooks
PASS microservices/operations-service/test/integration/check-in-dependencies.spec.ts
  ✓ DCS-01: composición y puertos por gRPC DCS-01: reserva, cupones y asiento atraviesan los adaptadores reales y se conserva un pase propio
  ✓ DCS-01: composición y puertos por gRPC DCS-03 / DCS-05: check-in por gRPC persiste pase y repetir no asigna ni publica otra vez
  ✓ DCS-01: composición y puertos por gRPC DCS-04: lista por gRPC los pases válidos del owner y cumple OpenAPI
  ✓ DCS-01: composición y puertos por gRPC DCS-SEC-01: check-in y pases de reserva ajena devuelven NOT_FOUND por gRPC sin efectos
PASS microservices/operations-service/test/integration/dcs-real.spec.ts
  ✓ DCS-REAL: servicios y bases reales en el proceso de prueba DCS-01 / DCS-03 / DCS-05 / DCS-SEC-01: reserva propia, asiento real, pase e idempotencia
  ✓ DCS-REAL: servicios y bases reales en el proceso de prueba DCS-SMOKE: el script completa todos sus pasos contra servicios reales
PASS microservices/operations-service/test/integration/flight-status.spec.ts
  ✓ OPS-04: GetFlightStatus OPS-04 / I / K: crea perezosamente y devuelve un FlightStatus conforme al OpenAPI
  ✓ OPS-04: GetFlightStatus OPS-04: vuelo inexistente por RPC devuelve FLIGHT_STATUS_NOT_AVAILABLE
  ✓ OPS-04: GetFlightStatus OPS-04: Inventory no disponible por RPC devuelve UNAVAILABLE
PASS microservices/operations-service/test/operational-flight.spec.ts
  ✓ OPS-03: máquina operacional OPS-03: permite las transiciones válidas
  ✓ OPS-03: máquina operacional OPS-03: rechaza transiciones inválidas y terminales
PASS microservices/operations-service/test/recover-check-ins.spec.ts
  ✓ F11c-1 / tarea 0: recuperación de check-ins recupera el IN_PROGRESS reclamado y reintenta eventos no publicados con reloj inyectable
  ✓ F11c-1 / tarea 0: recuperación de check-ins no publica dos veces ni detiene el lote cuando la recuperación de un check-in falla
PASS microservices/operations-service/test/security/operations-security.spec.ts
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-05 / I: cancelar cierra la venta y publica flight.cancelled por reserva afectada
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-02: llave ausente e incorrecta son UNAUTHENTICATED
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-01: entrada inválida es INVALID_ARGUMENT
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-02: customer no puede registrar una actualización operacional
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-05: repetir cancelación por RPC no repite efectos
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-05: repetir horario retrasado por RPC no repite evento
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-01: fecha inválida por RPC devuelve VALIDATION_FAILED
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 F11d-1 / ADR-F11-16: fecha sin segundos o con +0200 por RPC es VALIDATION_FAILED
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 F11d-1 / ADR-F11-16: un desplazamiento +02:00 se guarda y se devuelve como el mismo instante en UTC
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-01: campo protobuf extra por RPC devuelve VALIDATION_FAILED
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-01: transición no permitida por RPC devuelve VALIDATION_FAILED y no altera el vuelo
  ✓ OPS-05 / OPS-SEC-01 / OPS-SEC-02 OPS-SEC-02: error interno forzado no expone detalles ni PII en logs
PASS microservices/operations-service/test/strict-wire.spec.ts
  ✓ Operations strict protobuf wire guard accepts the declared varint wire type of RecoverCheckIns.limit
  ✓ Operations strict protobuf wire guard preserves an unknown field for the strict Zod request validator
PASS microservices/operations-service/test/unit/bind-host.spec.ts
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-01 por defecto escucha en 0.0.0.0 (Cloud Run) y en el puerto del servicio
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-02 PORT sustituye al puerto por defecto
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-03 INTEGRATION_LOCAL=true escucha solo en 127.0.0.1
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-04 solo el valor exacto "true" activa el perfil
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-05 INTEGRATION_LOCAL=true con NODE_ENV=production se rechaza
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-06 NODE_ENV=production sin el perfil sigue en 0.0.0.0
  ✓ operations-service: dirección de escucha gRPC (perfil de integración local) BIND-07 GRPC_BIND_HOST fuerza la dirección
PASS microservices/operations-service/test/unit/datetime-zod4.spec.ts
  ✓ F11d-1 / ADR-F11-16: fechas operacionales date-time RFC 3339 acepta 2026-10-24T00:00:00Z
  ✓ F11d-1 / ADR-F11-16: fechas operacionales date-time RFC 3339 acepta 2026-10-24T00:00:00.000Z
  ✓ F11d-1 / ADR-F11-16: fechas operacionales date-time RFC 3339 acepta 2026-10-24T00:00:00+02:00
  ✓ F11d-1 / ADR-F11-16: fechas operacionales date-time RFC 3339 rechaza 2026-10-24T00:00Z
  ✓ F11d-1 / ADR-F11-16: fechas operacionales date-time RFC 3339 rechaza 2026-10-24T00:00:00+0200
```

## pricing-service

`npx jest microservices/pricing-service --runInBand --verbose`

- Corrida 1: Test Suites: 10 passed, 10 total · Tests:       39 passed, 39 total
- Corrida 2: Test Suites: 10 passed, 10 total · Tests:       39 passed, 39 total
- Corrida 3 (lista): 10 suites passed de 10 · 39 passed, 0 failed, 0 omitidas/todo de 39

```
PASS microservices/pricing-service/test/integration/inventory-real.spec.ts
  ✓ PRC-12: integración con Inventory local real PRC-12: search → hold → get → release restituye capacidad real de Inventory
PASS microservices/pricing-service/test/integration/model-and-seed.spec.ts
  ✓ PRC-02/03: modelo y seed de Pricing PRC-02: la migración crea fares, offers, price_locks y change_offers en pricing
  ✓ PRC-02/03: modelo y seed de Pricing PRC-03: el seed conserva las tres brands de cada ruta de Inventory y es idempotente
PASS microservices/pricing-service/test/integration/search.spec.ts
  ✓ PRC-06/07: búsqueda y resolución de oferta PRC-06 / K: persiste una oferta completa mapeable 1:1 a SearchResponse
  ✓ PRC-06/07: búsqueda y resolución de oferta PRC-ADM-02 / I: crea, actualiza e idempotentemente conserva una tarifa usada en búsqueda real
  ✓ PRC-06/07: búsqueda y resolución de oferta PRC-08 / PRC-09 / K: crea, consulta y libera el hold con precio bloqueado
  ✓ PRC-06/07: búsqueda y resolución de oferta PRC-08: oferta expirada devuelve OFFER_NO_LONGER_AVAILABLE
  ✓ PRC-06/07: búsqueda y resolución de oferta PRC-SEC-02: GetOfferHold, ReleaseOfferHold y GetPriceLock de otro owner devuelven NOT_FOUND
  ✓ PRC-06/07: búsqueda y resolución de oferta PRC-07: ResolveSegment devuelve flightInstanceId y una oferta vencida responde NOT_FOUND
PASS microservices/pricing-service/test/integration/server.spec.ts
  ✓ PRC-01: servidor Pricing gRPC PRC-01: health responde SERVING con llave interna
  ✓ PRC-01: servidor Pricing gRPC PRC-01: health rechaza llamadas sin llave interna
PASS microservices/pricing-service/test/security/security.spec.ts
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-SEC-03: RPC sin llave interna es UNAUTHENTICATED
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-SEC-03: llave interna incorrecta es UNAUTHENTICATED
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-SEC-01: entrada inválida es INVALID_ARGUMENT
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-SEC-03: RPC administrativo con customer es PERMISSION_DENIED
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-ADM-01: UpsertFare valida el cuerpo antes de persistir
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-SEC-03: error interno forzado en RPC responde INTERNAL sin stack ni mensaje interno
  ✓ PRC-SEC-01/03: frontera segura de Pricing PRC-SEC-03: log de operación con PII y llave interna redacta campos sensibles
PASS microservices/pricing-service/test/unit/bind-host.spec.ts
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-01 por defecto escucha en 0.0.0.0 (Cloud Run) y en el puerto del servicio
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-02 PORT sustituye al puerto por defecto
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-03 INTEGRATION_LOCAL=true escucha solo en 127.0.0.1
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-04 solo el valor exacto "true" activa el perfil
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-05 INTEGRATION_LOCAL=true con NODE_ENV=production se rechaza
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-06 NODE_ENV=production sin el perfil sigue en 0.0.0.0
  ✓ pricing-service: dirección de escucha gRPC (perfil de integración local) BIND-07 GRPC_BIND_HOST fuerza la dirección
PASS microservices/pricing-service/test/unit/fare-admin.spec.ts
  ✓ PRC-ADM-01 / U: UpsertFare inválido devuelve INVALID_ARGUMENT
  ✓ PRC-ADM-01b / U: role distinto de admin devuelve PERMISSION_DENIED
  ✓ PRC-ADM-01d / U: el equipaje se persiste con la forma que lee la búsqueda (checkedBags) y por defecto 0
  ✓ PRC-ADM-01c / U: tarifa valida se transforma para persistencia
PASS microservices/pricing-service/test/unit/mct-order.spec.ts
  ✓ PRC-05: tramos fuera de orden son rechazados
PASS microservices/pricing-service/test/unit/post-sale-pricing.spec.ts
  ✓ PRC-10/11: cotizaciones postventa PRC-10: tarifa no cambiable ⇒ FARE_NOT_CHANGEABLE
  ✓ PRC-10/11: cotizaciones postventa PRC-10: fecha con tarifa más cara calcula diferencias reales y ChangeOffer es de uso único
  ✓ PRC-10/11: cotizaciones postventa PRC-10: fecha con tarifa más barata cobra solo changeFee y nunca un total negativo
  ✓ PRC-10/11: cotizaciones postventa PRC-10: fecha sin vuelos devuelve OFFER_NO_LONGER_AVAILABLE
  ✓ PRC-10/11: cotizaciones postventa PRC-11: cancelación reembolsable descuenta penalidad y equipaje usa el brand de la oferta
  ✓ PRC-10/11: cotizaciones postventa PRC-11 / Q-033: cancelación no reembolsable devuelve solo las tasas
PASS microservices/pricing-service/test/unit/pricing.spec.ts
  ✓ Pricing domain PRC-04: calcula total por tipo de pasajero y grandTotal en unidades menores
  ✓ Pricing domain PRC-05: descarta conexión menor al MCT de 60 minutos
  ✓ Pricing domain PRC-06: exige adulto, infantes no mayores que adultos y máximo nueve asientos
```
