# F12c-4 — Panel de administrador ampliado: diseño (bloque 0)

- Estado: **aprobado con las decisiones P1–P10 del humano (2026-11-15)**; se divide en F12c-4a → 4b → 4c (§7). Cambios respecto del borrador: la orquestación de la creación vive en el **ESB**, no en el Gateway (§1.2); **sin piso de tiempo de respuesta** en la búsqueda (§2.4); límites 30 búsquedas y 60 check-ins por hora; el rol del Gateway solo inserta y lee el registro (§4.1); los vuelos cerrados se ven y se abren desde el panel, sin eliminar vuelos. Aceptación: `J4R8GZ` (4b) y `FP210` (4c). · Fecha: 2026-11-15 · Rama: `feat/F12c-4-admin-ampliado`
- Antecedentes: `f12c0-diseno-front.md` §3.13, ADR-F12c-02 (API interna `/api/admin/v1`), ADR-F12c3-01/02 (panel), ADR-F12b2fix-01 (asientos apartados), ADR-F12b1fix-04 (holds concurrentes), ADR-F12b1fix-02 (día local), ADR-F12b-09 (identidad entre servicios).
- Decisiones: `adr/ADR-F12c4-01-creacion-atomica-registro-de-accesos-y-duenio.md`.
- Alcance de este documento: solo diseño. No hay código de producto, `.proto`, OpenAPI ni migraciones todavía.

**Reglas que atraviesan las tres funciones**
1. Todo es solo rol `admin` con `flights:admin`; la autorización ocurre **antes** de validar el cuerpo (como hoy en `mountAdminApiHttp`).
2. Todo cambio al contrato es aditivo: el contrato v2 con Booking y `vuelos-openapi*.yaml` no cambian; la API interna (`admin-v1.yaml`, con su registro de cambios) y los `.proto` solo ganan operaciones y mensajes.
3. Las operaciones nuevas de servicios exigen rol `admin` en el servicio dueño (defensa en profundidad con `roles: ['admin']` en el catálogo del ESB, ADR-F12b-09). Ninguna recibe el dueño de la reserva desde el panel.
4. Sin PII en logs ni en el registro de accesos; los errores no incluyen valores.
5. Hechos **por verificar en el bloque 1** (los marco con ⚠ porque los infiero de la lectura y no los he ejecutado): ver §6.

> Nota de contexto: el FP210 (UIO→GPS, 15-11-2026, E190) y el check-in de J4R8GZ hechos a mano el 14-11-2026 **no constan** en el BACKLOG ni en las bitácoras del repositorio (búsqueda por `FP210` y `J4R8GZ` en `docs/` y en `BACKLOG.md`: sin resultados). Este diseño parte de lo que describe el encargo; conviene que el humano los registre en el BACKLOG para que la prueba de aceptación de cada función pueda reproducirlos.

---

## 1. Función 1 — Crear vuelos con su tarifa

### 1.1 Qué existe hoy
- `POST /flights/v1/admin/flights` (v1, deprecado) → `inventory.upsertFlightInstance`: crea o actualiza una instancia **abierta a la venta desde el primer instante**, sin cuidar tarifas, avión ni zona horaria (recibe `departureAt`/`arrivalAt` con desplazamiento).
- `PUT /api/admin/v1/fares` → `pricing.upsertFare` (una tarifa por llamada, clave natural vuelo+cabina+marca).
- Inventory: `closed` existe y **un vuelo cerrado no aparece en la búsqueda** (`prisma-inventory.ts:103`, `closed: false`) ni admite holds (`flight-instance.ts:31`); `upsert` conserva el `closed` existente (`flight-admin.ts:44`) y **no hay operación para reabrir**. Único: `@@unique([flightNumber, departureAt])` (instante UTC exacto, no «número por día local»).
- Pricing arma las ofertas desde sus tarifas; Ancillaries guarda el mapa de asientos por avión (`seat_layouts`: `aircraft`, `cabinClass`, `seatNumber`).
- Zonas: `packages/shared/src/airport-zones.ts` (tabla única, 19 aeropuertos) y `airport-time.ts` (conversión local↔UTC sobre `Intl`).

### 1.2 Atomicidad: el vuelo nace cerrado y se abre solo con sus tarifas guardadas
Elegida la opción «nace cerrado, se abre al final». **Decisión del humano: la orquestación vive en el ESB** (capa de integración y orquestación; lo pendiente de F12b-3), no en el Gateway como proponía el borrador. Hoy las operaciones `composite` del ESB solo encadenan pasos sin verificar entre ellos, así que 4c le agrega una operación orquestada (`vuelos.crear-vuelo-con-tarifas`) con verificación intermedia; su diseño detallado va al inicio de 4c. El Gateway conserva la validación previa, la conversión local→UTC y la autorización. (Texto de los pasos abajo: «Gateway» = quien ejecuta la secuencia, que será el ESB.)

```
validar todo (sin escribir nada)
 → 1. Inventory.CreateFlightInstance(closed = true, id = UUIDv5(Idempotency-Key))
 → 2. Pricing.UpsertFare × N (idempotente por clave natural)
 → 3. Pricing.ListFares(flightInstanceId): cada cabina con capacidad > 0 tiene ≥ 1 tarifa, y lo leído coincide con lo enviado
 → 4. solo si openForSale = true: Inventory.OpenFlightInstance
```
- **Un fallo en 2–3 no necesita deshacer nada:** el vuelo sigue cerrado (invisible en búsquedas y holds). La respuesta es 502/503 con el `flightInstanceId` y el estado `CLOSED_INCOMPLETE`; **reintentar con la misma `Idempotency-Key` retoma** (el id sale de la clave, el paso 1 reconoce «mismos datos → devuelve el existente», el paso 2 es idempotente).
- **Abrir exige releer las tarifas** (paso 3 se repite en `POST …/open`): quien abre desde el panel después de revisar no puede abrir un vuelo sin tarifas aunque la creación se haya interrumpido.
- **Por defecto `openForSale = false`:** el panel muestra el vuelo creado como «Cerrado — pendiente de revisión», con su resumen (horas locales, capacidades, tarifas), y un botón «Abrir a la venta» (confirmación de dos pasos, ADR-F12c3-01 #3). Al abrirse, el vuelo aparece de inmediato en la web y en las búsquedas de Booking (la búsqueda de Booking lee Inventory/Pricing; no hay que avisar a nadie): la confirmación lo dice.
- Borradores abandonados: quedan cerrados y listados por `adminFlights` con `closed = true`. Eliminarlos queda fuera (pregunta P8).

### 1.3 Recorrido de punta a punta
Panel (formulario → revisión → confirmar) → GraphQL `createFlight(input, idempotencyKey)` → Gateway `POST /api/admin/v1/flights` (valida con Zod + OpenAPI interno, convierte horas, orquesta) → ESB (`vuelos.catalogo-aviones`, `vuelos.crear-instancia`, `vuelos.guardar-tarifa`, `vuelos.listar-tarifas`, `vuelos.abrir-instancia`) → Ancillaries / Inventory / Pricing. El panel envía horas **locales** de cada aeropuerto (`"2026-11-15T14:30"`, sin desplazamiento); la conversión a UTC la hace el Gateway con `airport-time.ts` (nunca el cliente), y la respuesta devuelve ambas formas.

### 1.4 Operaciones nuevas por capa
| Capa | Operación | Notas |
|---|---|---|
| API interna | `GET /api/admin/v1/aircraft` | catálogo: avión → capacidad por cabina del mapa de asientos |
| | `POST /api/admin/v1/flights` (201; `Idempotency-Key` obligatoria) | crea con tarifas; `openForSale` opcional (false) |
| | `POST /api/admin/v1/flights/{flightInstanceId}/open` (`Idempotency-Key`) | abre tras releer tarifas |
| ESB (catálogo) | `vuelos.catalogo-aviones` → ancillaries `listAircraftLayouts` (`roles: ['admin']`) | nueva |
| | `vuelos.crear-instancia` → inventory `createFlightInstance` (`roles: ['admin']`) | nueva |
| | `vuelos.abrir-instancia` → inventory `openFlightInstance` (`roles: ['admin']`) | nueva |
| | `vuelos.guardar-tarifa`, `vuelos.listar-tarifas` | existen, sin cambio |
| RPC (.proto aditivo) | `ancillaries.ListAircraftLayouts(Empty) → { aircraft[{ code, cabins[{ cabinClass, seats }] }] }` | cuenta filas de `seat_layouts` por avión y cabina |
| | `inventory.CreateFlightInstance(UpsertFlightInstanceRequest + closed) → FlightInstanceResponse` | creación **estricta**: duplicado del mismo número y día local → `FLIGHT_ALREADY_EXISTS`; mismos datos con el mismo id → devuelve el existente (reintento); mismo id con otros datos → `IDEMPOTENCY_KEY_REUSED`. `UpsertFlightInstance` no cambia |
| | `inventory.OpenFlightInstance(GetFlightInstanceRequest) → FlightInstanceResponse` | idempotente; no reabre un vuelo ya salido |
| GraphQL | `Query.adminAircraftCatalog: [AdminAircraft!]! @admin` | |
| | `Mutation.createFlight(input: CreateFlightInput!, idempotencyKey: ID!): CreatedFlight! @admin` | `openForSale` en el input |
| | `Mutation.openFlightForSale(flightInstanceId: ID!, idempotencyKey: ID!): AdminFlight! @admin` | |

### 1.5 Validación previa (todo antes del primer paso de escritura; error por campo en `invalidParams`, sin valores)
1. **Número de vuelo:** formato actual `^[A-Z0-9]{2}[0-9]{1,4}$`; prefijo de aerolínea restringido por configuración (P6). Único para ese **día local de salida**: el Gateway consulta antes (`listFlightInstances` por fecha) para dar un error claro, pero la garantía es de Inventory (§1.6).
2. **Aeropuertos:** ambos en `AIRPORT_ZONES`, distintos entre sí. Se rechaza lo que la tabla no conoce (la tabla es la fuente única; no se aceptan zonas enviadas por el cliente).
3. **Horas:** entran como hora civil local de cada aeropuerto; se convierten a UTC con su zona. Se **rechazan las horas locales inexistentes** (salto de horario de verano) **y las ambiguas** (repetidas al retroceder el reloj), con mensaje que pide elegir otra (hoy solo Madrid y Miami tienen horario de verano). Reglas sobre los instantes UTC resultantes: `llegada > salida`; salida a más de `ADMIN_FLIGHT_MIN_LEAD_MINUTES` en el futuro (propuesta: 60) y a menos de `ADMIN_FLIGHT_MAX_DAYS_AHEAD` (propuesta: 400); duración entre `ADMIN_FLIGHT_MIN_MINUTES` (propuesta: 20) y `ADMIN_FLIGHT_MAX_MINUTES` (propuesta: 1200). Sin coordenadas en la tabla de zonas no se valida la duración contra la distancia (P6).
4. **Avión:** debe estar en el catálogo de Ancillaries (hoy E190, A320, B787); un avión sin mapa es **requerido** (obligatorio al crear; el campo hoy es opcional en el upsert v1). Sin catálogo disponible → 503, nunca se crea.
5. **Cabinas:** 1–4, sin repetir clase; cada una debe existir en el mapa del avión y su `capacity` (≥ 1) no puede exceder los asientos de esa cabina en el mapa (`CABIN_CAPACITY…` como `VALIDATION_FAILED` con `type`).
6. **Tarifas:** por cabina con capacidad, ≥ 1 y ≤ 4 marcas, marca única en la cabina (`fareBrand` 1–32). Cada una con `price` (moneda `ADMIN_FARE_CURRENCIES`, propuesta: `USD`; base y tasas `^\d+\.\d{2}$`; **total = base + tasas calculado en centavos y rechazado si no coincide** —no el descarte silencioso que el BACKLOG registra en Pricing—; tasas ≤ total; total > 0), `fareRules` (reembolsable, cambiable), `baggageAllowance` y `extraCheckedBaggagePrice` (misma moneda).
7. **Idempotency-Key:** obligatoria (UUID); el cuerpo cambia con la misma clave → 409 `IDEMPOTENCY_KEY_REUSED`; un doble clic devuelve la misma respuesta y no crea dos vuelos (reutiliza `PrismaIdempotencyStore`, ámbito = admin + clave).

### 1.6 Unicidad por día local (migración aditiva propuesta)
`@@unique([flightNumber, departureAt])` solo detecta el mismo instante. Para «único para esa fecha» con garantía de base de datos, propongo en Inventory una columna `departure_local_date` (nulable, aditiva) con índice único parcial `(flight_number, departure_local_date) WHERE departure_local_date IS NOT NULL`; `CreateFlightInstance` la llena con `flightLocalDay` (ADR-F12b1fix-02). Los vuelos existentes (sin valor) quedan fuera del índice; un script de relleno lo ejecuta el humano, y mientras tanto la verificación por rango dentro de la transacción de creación cubre el resto. SQL con esquema explícito (ADR-F12b1fix-01/03); sin `CREATE SCHEMA` ni permisos. Alternativa sin migración: solo la verificación por rango (queda una ventana de carrera entre dos administradores casi simultáneos). Ver P7.

### 1.7 Migraciones
Inventory: columna e índice de §1.6 (si se aprueba). Ninguna en Pricing, Ancillaries, Gateway ni Operations para esta función.

### 1.8 Errores
Del catálogo interno (`admin-v1.yaml`) y de v2: `VALIDATION_FAILED` (400/422 con `invalidParams`), `FORBIDDEN`, `UNAUTHORIZED`, `IDEMPOTENCY_KEY_REUSED` (409; se **agrega al enum interno**, ya existe en v2), `PROVIDER_UNAVAILABLE` (503 con `Retry-After`; incluye el fallo parcial, con `flightInstanceId`), `INTERNAL_ERROR`. **Nuevos (solo en el enum interno y en el catálogo compartido de errores de dominio):** `FLIGHT_ALREADY_EXISTS` (409), `FLIGHT_NOT_READY` (409, abrir sin tarifas completas). Los demás rechazos usan `VALIDATION_FAILED` con un `type` propio (`aircraft-not-supported`, `cabin-capacity-exceeded`, `local-time-nonexistent`, `local-time-ambiguous`…), precedente de ADR-F12c-02 #6.

### 1.9 Seguridad y registro
Autorización antes de validar. Cada creación, apertura y rechazo por validación queda en el registro de acciones del administrador (§4.1: acción `CREATE_FLIGHT` / `OPEN_FLIGHT`, vuelo, resultado, actor, correlación), sin tarifas ni datos. Zod estricto (`.strict()`) en el Gateway y en cada RPC; Inventory vuelve a validar (no confía en el Gateway). No se crea un vuelo pasado ni sin mapa aunque se llame directo a Inventory con rol admin.

### 1.10 Pruebas (identificadores `ADM4-F-*`)
Unit: conversión local→UTC con zonas con y sin horario de verano, hora inexistente y ambigua (Madrid, Miami, Galápagos); esquemas Zod (cada regla de §1.5, campo extra, total ≠ base + tasas); capacidad contra el catálogo; plan de pasos (orden, reanudación). Servicios (Postgres local): Inventory crea cerrado y no aparece en `find`/`queryAvailability`/hold; duplicado por día local; carrera de dos creaciones simultáneas; reintento idempotente; abrir; Ancillaries `listAircraftLayouts`. Gateway: matriz de roles (cliente, socio, admin sin scope, anónimo ⇒ 403/401 antes de validar); doble clic con la misma clave = un vuelo; fallo inyectado en el paso 2 y en el 3 ⇒ vuelo cerrado + reintento lo completa; `open` rechaza sin tarifas completas; respuesta contra el OpenAPI interno (Ajv). GraphQL: `@admin` y privacidad. Web: formulario, revisión, doble clic, errores. E2E local: crear → verificar que **no** aparece en búsqueda → abrir → aparece. Verificación del humano con Supabase real: reproducir un FP-equivalente al FP210.

---

## 2. Función 2 — Buscar una reserva por PNR (solo lectura)

### 2.1 Recorrido
Panel → GraphQL `adminBookingByPnr(pnr)` → Gateway `POST /api/admin/v1/bookings/search` (`{ "pnr": "J4R8GZ" }`; **POST con cuerpo para que el PNR no viaje en URL ni en registros de proxy**) → ESB `reservas.buscar-por-pnr` → Reservation `AdminGetReservationByPnr`; el Gateway compone con `ancillaries.AdminGetBookingAncillaries` (asientos y equipaje) y `operations.AdminListCheckInStatus` (estado de check-in) por `bookingId`, sin enviar nunca dueño. Reservation ya tiene `findByPnr` (único global, cualquier canal); hoy ninguna RPC lo expone sin dueño.

> **Ajuste al implementar 4a (§6, hecho 2):** no se crea `ancillaries.AdminGetBookingAncillaries` ni `reservas.admin-asientos-equipaje`. La vista completa (asientos, equipaje, boletos) la arma la propia RPC de Reservation reutilizando `ReservationQueries.get` con el dueño que ella misma resuelve; solo Operations agrega una RPC (`AdminGetCheckInStatus`). Implementado: `reservas.buscar-por-pnr` y `postventa.admin-estado-check-in`.

### 2.2 Operaciones nuevas
| Capa | Operación |
|---|---|
| API interna | `POST /api/admin/v1/bookings/search` |
| ESB | `reservas.buscar-por-pnr` → reservation `adminGetReservationByPnr` (`roles: ['admin']`); `reservas.admin-asientos-equipaje` → ancillaries `adminGetBookingAncillaries` (`['admin']`); `postventa.admin-estado-check-in` → operations `adminGetCheckInStatus` (`['admin']`) |
| RPC (aditivos) | `reservation.AdminGetReservationByPnr({ pnr }) → AdminBookingView` (ya **sin PII**: la reducción se hace en el servicio dueño, no solo en el Gateway); `ancillaries.AdminGetBookingAncillaries({ booking_id })`; `operations.AdminGetCheckInStatus({ booking_id })` |
| GraphQL | `Query.adminBookingByPnr(pnr: String!): AdminBookingLookup @admin` — devuelve `null` si no existe |

### 2.3 Qué muestra y qué no (lista blanca en tres lugares: servicio, Gateway y GraphQL, como `domain/privacy.ts`)
**Muestra:** `bookingId` (para las acciones siguientes), `pnr`, `status`, canal (`WEB` | `PARTNER`) y `partnerRef` (hash opaco de 12 hex del cliente del dueño, igual que el `owner` de `adminWebBookings`; nunca el `clientId`), creación; por tramo: vuelo, origen/destino, salida y llegada **en la hora local de cada aeropuerto** (y el UTC), estado del vuelo; por pasajero: **nombre y apellido**, tipo, asiento por tramo, equipaje incluido/comprado; boletos con su estado de cupón; estado del check-in por pasajero/tramo; total y moneda.
**No muestra (y una prueba lo comprueba recorriendo la respuesta):** documento y su tipo/vencimiento, fecha de nacimiento, correo, teléfono, referencias de pago (`paymentReference`), `ownerId`/`sub`/`X-User-Id`, huella de dispositivo, números de boleto completos (se muestran los últimos 4 si hace falta; ver P10), ni códigos de barras en la búsqueda.

### 2.4 No distinguir «no existe» de «existe»
- Mismo cuerpo y mismo estado para no encontrada (404 `NOT_FOUND`, «Reserva no encontrada») y **para un PNR mal formado** (`^[A-Z0-9]{6}$` tras `trim` y mayúsculas; ⚠ verificar el alfabeto real de `createPnr`): un formato inválido no revela nada porque el diccionario es el mismo; se registra como `INVALID_FORMAT` **sin guardar el texto**.
- **Tiempos (P4, decidido):** **sin piso de tiempo de respuesta.** Quien consulta es un administrador identificado, cada consulta queda registrada y hay límite por hora; basta con la misma respuesta «no encontrada» para un PNR inexistente, ajeno o inválido.
- GraphQL responde `null` en ambos casos sin error distinto.

### 2.5 Límite por administrador
`ADMIN_PNR_SEARCH_LIMIT_PER_HOUR` (propuesta: 30) por `sub` del administrador, ventana deslizante de 1 h, contado **desde la propia tabla de registro** (§4.1), de modo que vale entre instancias del Gateway y no necesita un almacén nuevo. Cuenta todos los intentos (encontrados, no encontrados e inválidos). Superarlo → 429 `RATE_LIMIT_EXCEEDED` con `Retry-After`, tipo `admin-pnr-search-limit`. Falla **cerrada**: si el registro no se puede escribir, no se devuelve la reserva (503).

### 2.6 Migraciones
Solo la tabla de registro del Gateway (§4.1). Ninguna en Reservation (`pnr` ya es único).

### 2.7 Errores
`VALIDATION_FAILED` (cuerpo mal formado: campos extra, tipos), `NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `FORBIDDEN`, `UNAUTHORIZED`, `PROVIDER_UNAVAILABLE`. Sin códigos nuevos.

### 2.8 Pruebas (`ADM4-P-*`)
Unit: normalización del PNR; la reducción a lista blanca; recorrido de la respuesta contra una lista de campos prohibidos (documento, correo, teléfono, pago, owner). Servicio: Reservation por PNR de reserva web y de socio, cancelada/fallida, inexistente (mismo error); rol distinto de admin ⇒ rechazo; Ancillaries/Operations sin dueño de entrada (esquema estricto rechaza `ownerId`). Gateway: matriz de roles; **no encontrada ≡ encontrada** en forma de error y tiempo ≥ piso; PNR inválido ≡ no encontrada; límite (31.ª búsqueda ⇒ 429, otro admin no afectado); cada búsqueda deja una fila con resultado y **sin datos de la reserva**; fallo al escribir el registro ⇒ no hay datos en la respuesta. GraphQL: `@admin`, `null`, privacidad. Web: pantalla (estados cargando/vacío/límite/error), sin campos prohibidos en el DOM. E2E local con una reserva web y una de socio.

---

## 3. Función 3 — Check-in hecho por la aerolínea

### 3.1 Recorrido
Panel (reserva encontrada por PNR) → GraphQL `adminCheckIn(bookingId, idempotencyKey)` → Gateway `POST /api/admin/v1/bookings/{bookingId}/check-in` → ESB `postventa.check-in-aerolinea` → Operations `AdminCheckIn`. Después `GET /api/admin/v1/bookings/{bookingId}/boarding-passes` → ESB `postventa.listar-pases-aerolinea` → Operations `AdminListBoardingPasses`. **El panel y la API solo envían `bookingId`**: ni dueño, ni PNR de otro, ni socio.

### 3.2 Cómo se resuelve el dueño (detalle en el ADR)
Operations es quien ejecuta, y quien resuelve el dueño: `AdminCheckIn` exige rol `admin` en el contexto de la llamada, pide a Reservation el snapshot por `bookingId` **sin dueño** (RPC nueva `reservation.AdminGetReservationSnapshot`, rol `admin` o `system` —Operations la invoca con su identidad de servicio—) y ejecuta **el mismo `CheckInUseCase`** con el `ownerId` real de la reserva. Así valen exactamente las mismas reglas que el cliente (ventana, estado `CONFIRMED`, cupones `ISSUED`, vuelo no cancelado ni salido, pasaporte vigente, infantes con adulto) **sin duplicarlas**, y `booking.checked_in` se publica con el dueño real, por lo que llega al socio como siempre. El esquema Zod de `AdminCheckInRequest` es estricto y **no tiene campo de dueño**; el actor sale del contexto autenticado, no del cuerpo.
El administrador **no puede saltarse la ventana** (P5).

### 3.3 Quién lo hizo
- Operations: columnas aditivas nulables en la tabla de check-ins `performed_by_role` (`customer`|`admin`) y `performed_by` (sub del admin; nulo para el cliente) — ⚠ nombre de tabla por confirmar. La repetición idempotente no sobrescribe al primer actor.
- Gateway: fila `CHECK_IN` / `BOARDING_PASSES` en el registro de acciones (§4.1) con el actor, `bookingId` y resultado.
- **El evento `booking.checked_in` no incluye al administrador:** el socio no debe recibir identidades del personal (el contrato no cambia).

### 3.4 Sustitución de la llamada manual
Hoy la llamada directa al ESB con la llave interna (J4R8GZ, 14-11-2026) salta el Gateway: sin autenticación de personas, sin registro del actor. La ruta nueva la reemplaza con identidad individual y registro; la llave interna queda para los servicios y el scheduler. Documentarlo en la guía de despliegue (el humano retira ese procedimiento).

### 3.5 Operaciones nuevas
| Capa | Operación |
|---|---|
| API interna | `POST /api/admin/v1/bookings/{bookingId}/check-in` (`Idempotency-Key`); `GET /api/admin/v1/bookings/{bookingId}/boarding-passes` |
| ESB | `postventa.check-in-aerolinea` → operations `adminCheckIn` (`['admin']`); `postventa.listar-pases-aerolinea` → operations `adminListBoardingPasses` (`['admin']`); `reservas.admin-snapshot` → reservation `adminGetReservationSnapshot` (`['admin','system']`) |
| RPC (aditivos) | `operations.AdminCheckIn({ booking_id }) → common.CheckInResponse`; `operations.AdminListBoardingPasses({ booking_id }) → BoardingPassListResponse`; `reservation.AdminGetReservationSnapshot({ booking_id }) → BookingDetail` (+ `owner_id` en un mensaje aditivo, solo para el servicio llamador) |
| GraphQL | `Mutation.adminCheckIn(bookingId: ID!, idempotencyKey: ID!): AdminCheckInResult! @admin`; `Query.adminBoardingPasses(bookingId: ID!): [AdminBoardingPass!]! @admin` |

### 3.6 Validaciones y errores
`bookingId` UUID; los pases solo se devuelven de reservas con check-in; las reglas del caso de uso devuelven los códigos de siempre: `BOOKING_NOT_CONFIRMED` (409), `CHECK_IN_NOT_AVAILABLE`, `CHECK_IN_FAILED`, `FLIGHT_ALREADY_DEPARTED`, `NOT_FOUND`, más `FORBIDDEN`, `UNAUTHORIZED`, `IDEMPOTENCY_KEY_REUSED`, `PROVIDER_UNAVAILABLE`. Se agregan al enum interno los que hoy solo existen en v2. Sin códigos nuevos. El panel traduce cada uno a español (como `INVALID_STATUS_TRANSITION`).

### 3.7 Seguridad
Dos pasos con confirmación («esto avisa al socio y emite pases a nombre de …»); intención con `Idempotency-Key` (ADR-F12c2b-01); un `bookingId` inexistente responde `NOT_FOUND`; límite de check-ins por administrador y hora (`ADMIN_CHECKIN_LIMIT_PER_HOUR`, propuesta 60) contado también desde el registro. Los pases contienen el código de barras: su consulta queda registrada y solo se pide bajo demanda (no en la búsqueda).

### 3.8 Pruebas (`ADM4-C-*`)
Unit/servicio: Operations rechaza sin rol admin; el esquema rechaza `ownerId`/`owner`; resuelve el dueño real (reserva de socio y de web) y publica `booking.checked_in` **con el dueño real** (evento falso); mismas reglas que el cliente (matriz: fuera de ventana antes/después, cancelada, no `CONFIRMED`, cupón no emitido, vuelo salido, pasaporte vencido, infante); idempotencia (repetir no duplica pases ni eventos); actor guardado y no sobrescrito; recuperación de `IN_PROGRESS` (BACKLOG F10) sigue funcionando para check-ins de administrador. Gateway: matriz de roles; el cliente no puede invocar la ruta; fila de registro con actor. Contrato: el evento del socio no contiene al administrador. E2E local y verificación del humano: reproducir el caso J4R8GZ por el panel.

---

## 4. Registro de acciones del administrador (transversal)

### 4.1 Dónde vive y cuánto dura (propuesta; ADR §2)
Tabla `gateway.admin_access_log` en el esquema `gateway` (el Gateway ya tiene Prisma, esquema propio e idempotencia; el panel es su API; la tabla permite también el límite de §2.5 sin almacén nuevo). Migración aditiva con esquema explícito. Columnas: `id` uuid, `at` timestamptz, `actor_sub` (el sub del administrador; personal de la empresa, no cliente), `action` (`SEARCH_PNR` | `CHECK_IN` | `BOARDING_PASSES` | `CREATE_FLIGHT` | `OPEN_FLIGHT`), `subject` (PNR validado de 6 caracteres, `bookingId` o `flightInstanceId`; **nulo** si el PNR era inválido), `result` (`FOUND` | `NOT_FOUND` | `INVALID_FORMAT` | `OK` | `REJECTED` | `ERROR` | `RATE_LIMITED`), `error_code`, `correlation_id`. **Nunca** datos de la reserva, ni nombres, ni el cuerpo, ni IPs. Índices `(actor_sub, at)` y `(at)`. Solo se inserta y se lee; el depurado lo hace una tarea programada del Gateway (`SchedulerLock` ya existe). Retención **12 meses** (decidido): el rol del Gateway **solo inserta y lee** (sin UPDATE ni DELETE; los permisos los administra el humano en `infra/db/roles.sql`, la migración no los toca); el depurado de lo vencido es una **tarea manual** que ejecuta el humano con un rol propietario (consulta en `docs/dev/f12c4a-pnr-despliegue.md`). Los límites por hora (30 búsquedas, 60 check-ins) cuentan filas con `SELECT`, sin necesitar UPDATE.
Escribir la fila ocurre **antes** de devolver datos (falla cerrada). Los logs de aplicación siguen sin PII; este registro es de auditoría y no se confunde con ellos. Consulta: por ahora SQL del humano; un listado en el panel queda fuera (P9).

---

## 5. Contratos y migraciones (resumen)
- **OpenAPI interno `admin-v1.yaml`:** seis operaciones nuevas (aircraft, crear vuelo, abrir, buscar por PNR, check-in, pases) y los esquemas de §1–§3; enum de `code` ampliado con `IDEMPOTENCY_KEY_REUSED`, `FLIGHT_ALREADY_EXISTS`, `FLIGHT_NOT_READY`, `BOOKING_NOT_CONFIRMED`, `CHECK_IN_NOT_AVAILABLE`, `CHECK_IN_FAILED`, `FLIGHT_ALREADY_DEPARTED`; entrada en su registro de cambios (se mantiene `v1`, como en la adenda de ADR-F12c-02). `vuelos-openapi.yaml` y `vuelos-openapi-v2.yaml` **no cambian**.
- **`.proto` (solo agregados, cada uno con su ADR corto en el bloque que lo implemente):** inventory (`CreateFlightInstance`, `OpenFlightInstance`), ancillaries (`ListAircraftLayouts`, `AdminGetBookingAncillaries`), reservation (`AdminGetReservationByPnr`, `AdminGetReservationSnapshot`), operations (`AdminCheckIn`, `AdminListBoardingPasses`, `AdminGetCheckInStatus`). Ningún campo ni número existente cambia; clientes desplegados siguen compatibles.
- **GraphQL (`schema.graphql`):** agregados con `@admin`; tras tocar el SDL, `npm run codegen -w @flight-platform/graphql-schema`.
- **Migraciones (todas aditivas, esquema explícito, aplica el humano):** Gateway `admin_access_log`; Operations dos columnas nulables en check-ins; Inventory `departure_local_date` + índice parcial (si P7 = sí).
- **ESB:** ocho operaciones en `catalog.ts` con `roles: ['admin']` (y `['admin','system']` la del snapshot); desplegar ESB, Gateway y servicios afectados juntos (precedente ADR-F12b2fix-01).

## 6. Hechos verificados al empezar 4a (2026-11-15)
1. **Verificado:** Operations toma el dueño del contexto (`ctx(m).ownerId`) en `checkIn` y `listBoardingPasses`; la tabla `check_ins` tiene `bookingId` único (`upsert where bookingId`), así que el estado de check-in por reserva se lee sin dueño. (La identidad con la que Operations llama a Reservation se verifica en 4b.)
2. **Verificado:** `ReservationQueries.get` ya compone asientos, equipaje y boletos (Ancillaries y Ticketing con el dueño de la reserva). **Cambio de diseño:** no hace falta `ancillaries.AdminGetBookingAncillaries`; la RPC nueva de Reservation arma la vista completa y reducida ella sola. Solo Operations agrega `AdminGetCheckInStatus`.
3. **Verificado:** alfabeto de `createPnr` = `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin I, O, 0, 1), 6 caracteres: ese es el formato válido del PNR. El código de `assertCheckInWindow` se verifica en 4b.
4. Nombres de tablas para las migraciones de 4b/4c se confirman al empezar cada una; la de 4a (`gateway.admin_access_log`) es propia.
5–6. Se verifican en 4c (vuelo cerrado vs. `operational_flights`/`stock-sync`; `closed` en `adminFlights`).

## 7. Tamaño y división
| Parte | Contenido | Servicios que cambian | Tamaño |
|---|---|---|---|
| **F12c-4a** | Registro de acciones + buscar por PNR (función 2) | Reservation, Ancillaries, Operations (lectura), Gateway, GraphQL, ESB, web | M (≈ 3 RPC de lectura, 1 tabla, pantalla) |
| **F12c-4b** | Check-in por la aerolínea (función 3) | Operations, Reservation (snapshot), Gateway, GraphQL, ESB, web | M (reutiliza el caso de uso; el riesgo es el dueño y las pruebas de reglas) |
| **F12c-4c** | Crear vuelos con tarifa y abrirlos (función 1) | Inventory (+ migración), Ancillaries (catálogo), Gateway (orquestación), GraphQL, ESB, web (formulario grande) | L (más validación, orquestación y la pantalla más compleja) |

**Recomiendo dividir en tres fases con auditoría y despliegue propios, en el orden 4a → 4b → 4c:** 4b depende de la búsqueda y del registro de 4a (el panel de check-in parte de una reserva encontrada); 4c es independiente y la de mayor riesgo, así que se beneficia de ir sola. Si el humano prioriza crear vuelos, 4c puede ir primero (solo necesita el registro de acciones, que pasaría a esa fase). Cada parte toca servicios desplegados: los despliegues siguen el orden servicios → ESB → Gateway → GraphQL → web.

## 8. Preguntas — resueltas por el humano (2026-11-15)
P1 tres fases 4a→4b→4c; P2 12 meses, rol solo inserta/lee, depurado manual; P3 30 búsquedas y 60 check-ins por hora; P4 sin piso de tiempo; P5 sin forzar la ventana; P6 prefijo FP, solo USD, 60 min–400 días, 20 min–20 h, rechazar horas ambiguas/inexistentes; P7 migración con índice único parcial, **con consulta previa de duplicados (si hay, detenerse y avisar)**; P8 el panel muestra y abre vuelos cerrados, sin eliminar; P9 sin listado del registro en el panel (BACKLOG); P10 hash opaco + «Socio», últimos 4 dígitos del boleto. Cancelar reservas ajenas: fuera (BACKLOG).

## 9. Alcance de F12c-4a (se construye ahora)
Registro de accesos (`gateway.admin_access_log` + migración + almacén + límite) y búsqueda por PNR: Reservation `AdminGetReservationByPnr`, Operations `AdminGetCheckInStatus`, ESB `reservas.buscar-por-pnr` y `postventa.admin-estado-check-in`, API interna `POST /api/admin/v1/bookings/search`, GraphQL `adminBookingByPnr`, pantalla «Reservas» del panel y sus pruebas. Fuera: check-in, pases de abordar y crear vuelos.
