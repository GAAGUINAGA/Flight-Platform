# Diseño — Fecha de vuelo en hora local del aeropuerto (Bloque 0)

- Rama: `fix/busqueda-dia-local` · Fecha: 2026-11-07 · Estado: **pendiente de aprobación** (no hay código)
- Requisito: NFR-TI-01 (fechas de vuelo en hora local del aeropuerto, zona IANA) y GAP-029 (la `date` del estado del vuelo es la fecha local de salida).
- Contratos: OpenAPI sin cambios (`departureDate`, `newDepartureDate` y `date` ya son `format: date`; solo cambia su interpretación). Proto: sin cambios. Migraciones de esquema: ninguna.
- ADR asociado: `ADR-F12b1fix-02-busqueda-dia-local.md`.

## 1. Semántica

1. En v1 y v2, `departureDate`, `newDepartureDate` y el `date` de estado de vuelo son **la fecha local del aeropuerto de ORIGEN del tramo**. Un vuelo pertenece al día D si su instante de salida cae en `[inicio local de D, inicio local de D+1)`.
2. Ventana UTC de un día local, `localDayRange(fecha, zona) → [inicio, fin)`:
   - `inicio` es el primer instante en que el reloj de la zona marca `fecha 00:00` (si ese minuto no existe por un salto de horario, el primer instante posterior del mismo día).
   - `fin` es el `inicio` del día calendario siguiente. El día siguiente se calcula con aritmética de calendario sobre `YYYY-MM-DD`, **nunca sumando 24 h**. Un día con cambio de horario dura 23 o 25 h.
   - El intervalo es semiabierto: 00:00:00.000 local pertenece al día D, y el último milisegundo antes de medianoche también.
3. Inverso, `localDay(instante, zona) → 'YYYY-MM-DD'` y `localTime` (`HH:mm`). Siempre tiene una única respuesta, incluso en la hora repetida de otoño.
4. Implementación con `Intl.DateTimeFormat` de Node 20 (ICU completo), sin dependencias nuevas: se calcula el desfase de la zona en un instante y se itera dos veces para converger en el inicio del día. Las reglas de horario van con la versión de Node de la imagen: un cambio de reglas (tzdata) se recoge al reconstruir.
5. `find(flightNumber, fecha)` no recibe origen. Se resuelve igual que `list(fecha)`: la consulta usa **una ventana por zona**, con la forma `OR[(departureIata IN <aeropuertos de la zona> AND departureAt ∈ ventana de la zona)]`. Cada vuelo se compara con la ventana de su propio origen, así que no hace falta conocer el origen de antemano. Los aeropuertos fuera de la tabla forman un último grupo (`NOT IN todos los conocidos`) con ventana UTC (ver §3). `search` con origen conocido usa una sola ventana. El índice `(departure_iata, arrival_iata, departure_at)` sigue sirviendo. Hay menos de 10 zonas.
6. Si dos instancias del mismo `flightNumber` cayeran en un mismo día local (día de 25 h, o error de datos), `find` devuelve la de salida más temprana (orden `departureAt, id`), que es determinista.

## 2. Fuente única de zonas horarias

**Propuesta: `packages/shared/src/airport-time.ts`.** Lo consumen inventory, operations, reservation, pricing (falso de pruebas) y el gateway. Todos ya dependen de `@flight-platform/shared`, que va en todas las imágenes (PLAN §3).

- Exporta `AIRPORT_ZONES` (IATA → zona IANA), `zoneOf(iata)`, `localDay`, `localTime`, `localDayRange` y `dayWindows(fecha)`.
- `dayWindows(fecha)` agrupa los aeropuertos de la tabla por zona y devuelve una ventana por grupo.
- Contenido inicial:
  - Los 14 aeropuertos de Ecuador que hoy trae el gateway (UIO, GYE, CUE, LTX, MEC, ESM, TUA, LOH, PVO, OCC, TPC, XMS en `America/Guayaquil`; GPS y SCY en `Pacific/Galapagos`).
  - Los que usa el seed y hoy **no** están en el mapa del gateway: BOG `America/Bogota`, LIM `America/Lima`, MAD `Europe/Madrid`, MIA `America/New_York`.
  - MDE `America/Bogota`, que usan las pruebas de reservation. Los códigos de prueba aleatorios o ficticios (AAA, ZZZ, QQQ…) no están en la tabla y se leen en UTC con aviso; una prueba (`seed-airport-zones.spec.ts`) recorre los seeds de inventory y pricing y falla si algún origen o destino no tiene zona.

**Por qué en `shared` y no solo en inventory.** La conversión fecha→ventana la hace inventory, que es el dueño de los vuelos. La conversión instante→fecha la necesitan además operations (`date` guardado), reservation (resumen y caducidad de pasaporte), el gateway (stock hacia Booking y panel) y el falso de pricing. Con una sola tabla y una sola implementación esos puntos no pueden discrepar.

**Alternativas descartadas**
- *Tabla `airports` en la base de inventory.* Requiere una migración y que el humano la aplique en local y en Supabase. Además todos los demás servicios tendrían que pedirla por gRPC.
- *Campo aditivo en el proto (`departure.localDate`).* Las reservas guardan itinerarios como JSON ya emitidos, que no lo tendrían, y filtrar el campo hacia las respuestas públicas arriesga el contrato Ajv.

**Convivencia con `AIRPORT_TIMEZONES` del gateway.** El mapa por defecto de `config.ts:81` se elimina y el gateway usa `shared`. La variable `AIRPORT_TIMEZONES` queda **obsoleta**:
- si está definida, se ignora y se registra un aviso al arrancar;
- el comportamiento de lo que hoy depende de ella no cambia, porque `shared` contiene el mismo conjunto de Ecuador;
- así no puede haber dos tablas que diverjan entre servicios.

El humano debe confirmar si Render la tiene definida con aeropuertos que no estén en la tabla inicial, para añadirlos a la tabla.

Agregar un aeropuerto es un cambio de código en `shared` y reconstruir las imágenes. A esta escala es aceptable. La tabla en base de datos queda en BACKLOG.

## 3. Aeropuerto sin zona conocida

Recomendación, según el punto:

| Situación | Comportamiento |
|---|---|
| **Escritura**: `upsertFlightInstance` (admin) con aeropuerto de salida sin zona | Se rechaza con `VALIDATION_FAILED` (código ya existente en el catálogo; sin código nuevo). Evita que entren datos que luego no se puedan buscar por fecha local. |
| **Lectura/búsqueda** de datos ya guardados con aeropuerto sin zona | UTC como respaldo, con `warn` una vez por IATA y proceso (`airport_zone_missing iata=XXX`; es un código IATA, no PII). Nunca falla: un error aquí rompería búsquedas y estados de vuelos que hoy funcionan. |
| Búsqueda con origen desconocido | Cae en el grupo UTC. Como la escritura lo impide, no hay vuelos reales con ese origen y el resultado es la lista vacía de hoy. |

Se añade una prueba de cobertura: todo IATA del seed de inventory y de pricing tiene zona.

## 4. Inventario de puntos afectados

| # | Versión | Punto | Qué cambia | ¿Observable? | Datos guardados con el criterio viejo |
|---|---|---|---|---|---|
| 1 | v1 y v2 | inventory `flight-queries.ts:12` `dayRange` → `find`, `list`, `queryAvailability` (y `occupancy`, que usa `list`); `prisma-inventory.ts:92` `search` | Ventana por zona en lugar de día UTC. Los puertos `FlightReader.find/list/search` reciben ventanas. | Sí, es la corrección: salidas locales después de las 19:00 en Ecuador y vuelos de madrugada local vuelven a aparecer en su fecha. | No hay. `departure_at` ya es un instante UTC correcto. |
| 2 | v1 y v2 | Búsqueda de ofertas y cambio de fecha en pricing (`post-sale-pricing.ts:28`), `grpc-inventory.gateway.ts` | Sin cambio de código: reenvían la fecha a inventory, que la interpreta como local. | Sí, mismo efecto que 1. | No hay. |
| 3 | v1 y v2 | reservation `post-sale-date-change.ts:23` (nueva fecha debe ser futura: `T00:00:00Z <= ahora`) | La fecha debe ser posterior al día local actual del origen del itinerario (`localDay(ahora, zona)`); se mantiene la regla de rechazar hoy y el pasado. | Solo en el borde: durante unas horas el rechazo de «hoy» pasa de UTC a local. | No hay. |
| 4 | v1 y v2 | operations `getFlightStatus` (`flight-status.ts:5`): `findFlight(flightNumber, date)` | Sin cambio de código propio: inventory resuelve la fecha local. | Sí: el estado se encuentra por la fecha local, como pide GAP-029. | Ver 6. |
| 5 | v2 | `PATCH` de estado: gateway `operations.controller.ts:57-58` (`findFlightInstance` + `getFlightStatus` con `body.date`) | Sin cambio de código propio: `body.date` es ahora la fecha local. | Sí, mismo efecto. | Ver 6. |
| 6 | v1 y v2 | operations `flight-status.ts:7` (`forInstance`) y `materialize`: campo `date` de `operational_flights` | `date = localDay(salida programada, zona del origen)` en lugar de `slice(0, 10)` del UTC. | Sí: el `date` mostrado de un vuelo pasa a su día local. | **Sí**: filas con `date` UTC distinto del local. En el seed solo FP500 (LIM→MAD, 01:30Z = 20:30 del día anterior en Lima) y vuelos de prueba. Corrección en §4.1. |
| 7 | v2 | gateway `operations.controller.ts:88` y `:118` (panel de operaciones; `date` por vuelo y llamada a `getFlightStatus`) | `localDay(departure.at, departure.iataCode)`. | Sí, mismo efecto que 6. | No hay. |
| 8 | v1 y v2 | reservation `queries.ts:10`: `departureDate` del resumen de reserva | Se calcula en lectura con `localDay` y la zona del origen del primer segmento. | Sí: para FP500 el resumen pasa del día UTC al día local de Lima. | No se guarda; se calcula al leer. |
| 9 | v2 | operations `check-in.ts:69`: caducidad del pasaporte contra el día de salida | Se compara con `localDay(salida, zona)`. | Solo en el borde de medianoche local. | No hay. |
| 10 | v2 | gateway `stock-sync.ts:112-114`: fecha enviada a `queryAvailability` y `localSlot` hacia Booking | La fecha de `queryAvailability` y la `date`/`time_slot` del envío salen de `shared`. `localSlot` y `config.stock.timezones` desaparecen. | Sí para Booking: hoy BOG, LIM, MIA y MAD **no están** en el mapa del gateway y se envían en UTC. | **Sí**: Booking tiene filas con la fecha/hora UTC de esos orígenes. Ver §4.2. |
| 11 | pruebas | pricing `fake-inventory.gateway.ts:13` | El falso usa `localDay`/zona igual que la regla real. | No. | No hay. |
| 12 | pruebas | gateway `test/e2e/v2/schedule.ts`, `stack.ts`, `e2e-schedule.spec.ts` (`assertUtcDay`) | Pasan a comprobar el día local del origen. Las salidas de prueba son 14:00Z desde UIO (09:00 local) y no cambian de día. | No. | No hay. |
| 13 | seed local y Supabase (`inventory/prisma/seed.ts`, `pricing/prisma/seed.ts`) | **Sin cambio de instantes.** Las horas del seed son UTC; el `stableId` incluye el instante, así que reinterpretarlas como locales crearía vuelos duplicados con el mismo `flightNumber` en el mismo día local. | No. | No hay corrección de datos: los vuelos ya guardados quedan válidos. Se añade solo un comentario y la prueba de cobertura de zonas. Un seed en hora local para entornos nuevos va a BACKLOG. |

**Revisados y sin cambio (con razón)**
- `booking.controller.ts:20` `dayStart`/`dayEnd`: filtran `createdAt`, que es una marca de tiempo UTC (NFR-TI-01), no una fecha de vuelo.
- `reservation passengers.ts:5` (edad al viajar): usa la fecha UTC del instante. Queda en BACKLOG; el impacto es un día en el borde de cumpleaños.
- `admin.schemas.ts:6` y `inventory schemas.ts:15`: solo validan el formato de la fecha.
- Eventos y webhooks históricos con `flightNumber/date`: son historial y no se reescriben.

### 4.1 Corrección de `operational_flights.date` (la aplica el humano)

Script SQL idempotente, sin cambio de esquema, contra el esquema `operations` (primero con un `SELECT` de conteo):

```sql
UPDATE operations.operational_flights
SET date = to_char(scheduled_departure_at AT TIME ZONE
  CASE departure_iata WHEN 'LIM' THEN 'America/Lima' WHEN 'BOG' THEN 'America/Bogota'
    WHEN 'MAD' THEN 'Europe/Madrid' WHEN 'MIA' THEN 'America/New_York'
    WHEN 'GPS' THEN 'Pacific/Galapagos' WHEN 'SCY' THEN 'Pacific/Galapagos'
    ELSE 'America/Guayaquil' END, 'YYYY-MM-DD')
WHERE date <> to_char(scheduled_departure_at AT TIME ZONE <misma expresión>, 'YYYY-MM-DD');
```

La versión final del script se generará a partir de `AIRPORT_ZONES` (para que no diverja) y se entrega en `scripts/` con un modo de solo conteo, como `purge-test-flights.cjs`.
- Orden: aplicar en la misma ventana que el despliegue de operations. Entre ambos pasos, el estado de los pocos vuelos con fecha distinta (FP500) puede no encontrarse por fecha.
- Esa ventana se evita pausando la sincronización de stock durante el cambio (ver §4.2).

**Implementado:** `scripts/local-platform/fix-operational-flight-dates.cjs` (SQL con esquema explícito, zonas de `AIRPORT_ZONES`, destino por `DATABASE_URL` del servicio, sin valores fijos de base ni de host).
- Sin `--yes` solo cuenta y lista cada vuelo con su fecha vieja y nueva (y marca un posible choque con la unicidad `(flight_number, date)`).
- Con `--yes` corrige en una transacción y aborta sin escribir ante un choque. Es idempotente.
- Local: desde `microservices/operations-service`, `node --env-file=.env ../../scripts/local-platform/fix-operational-flight-dates.cjs [--yes]`.
- Supabase: `npx --yes @dotenvx/dotenvx run -f .env.supabase -- node ../../scripts/local-platform/fix-operational-flight-dates.cjs [--yes]`, y confirmar que el destino impreso es `pooler.supabase.com`.

**Cuándo aplicarlo respecto del despliegue.** Primero el conteo (sin `--yes`) antes de desplegar, para ver las filas; la corrección (`--yes`) **inmediatamente después** de desplegar operations con el código nuevo, en la misma ventana.
- Con el código viejo la búsqueda por fecha usa el día UTC, así que corregir antes haría que el estado de esos vuelos no se encontrara por la fecha vieja.
- Con el código nuevo y sin corregir, `getFlightStatus` por la fecha local no encuentra la fila vieja y la materializa de nuevo.
- Una vez corregida, el script no encuentra filas. Se puede repetir sin riesgo.

### 4.2 Stock hacia Booking y orden de despliegue

**Regla (cuando Booking esté configurado):** poner `STOCK_SYNC_ENABLED=false` en el gateway durante el despliegue conjunto (inventory, operations, reservation, pricing y gateway) y reactivarlo al terminar, reencolando los vuelos futuros de BOG, LIM, MIA y MAD. **Hoy no aplica en la nube**, porque el stock está apagado (sin `BOOKING_STOCK_API_KEY`). `AIRPORT_TIMEZONES` quedó obsoleta (se ignora con aviso). La respuesta del humano sobre su valor en Render no llegó en esta ronda (el mensaje traía el marcador sin completar); al ignorarse da igual, pero si estaba definida con aeropuertos fuera de la tabla hay que añadirlos a `AIRPORT_ZONES`.

- Durante la transición, un gateway nuevo con inventory viejo (o al revés) consulta `queryAvailability` con una fecha que el otro interpreta distinto, y para vuelos con día local ≠ UTC el envío saldría con `available_units: 0` (`match` indefinido).
- Mitigación: poner `STOCK_SYNC_ENABLED=false` en Render durante el despliegue conjunto (inventory, operations, reservation, pricing y gateway) y reactivarlo al terminar.
- Al reactivar, hay que reencolar los vuelos futuros de orígenes que antes iban en UTC (BOG, LIM, MIA, MAD) para que Booking reciba la fecha local correcta.
- **Pregunta abierta para el humano:** no puedo verificar desde el repositorio si Booking identifica la fila por `(item_id, date, time_slot)`. Si lo hace, las filas con la fecha/hora UTC antiguas quedarán como ranuras huérfanas hasta que Booking las depure. Hay que decidir si se les envía `available_units: 0` o se deja a Booking.

## 5. Pruebas (reloj simulado; ninguna depende de la hora real)

| ID | Prueba | Dónde |
|---|---|---|
| LD-01 | `localDayRange` por zona: UIO (UTC−5), LIM, MAD, Kiritimati (UTC+14), MIA. Verifica inicio y fin en UTC. | `packages/shared` |
| LD-02 | Bordes exactos: `00:00:00.000` local pertenece al día D y `23:59:59.999` también. `00:00:00.000` del día siguiente no. Una salida 1 ms antes del inicio cae en el día anterior. | `shared` + inventory |
| LD-03 | Cambio de horario: MIA 2026-03-08 (23 h) y 2026-11-01 (25 h); MAD 2026-03-29 y 2026-10-25; zona que se salta la medianoche (`America/Havana`). Rangos contiguos sin huecos ni solapes entre días consecutivos. | `shared` |
| LD-04 | Nocturnos Ecuador: UIO→GYE con salida local 19:00, 22:00 y 23:59 (= 00:00Z–04:59Z del día UTC siguiente) se encuentra buscando su fecha local y no la UTC. | inventory (integración con Postgres) |
| LD-05 | Caso Lima: LIM→MAD con salida el 10 a las 22:30 locales (= 11 a las 03:30Z) aparece al buscar el 10 y no el 11. También FP500 del seed (01:30Z = 20:30 del día anterior). | inventory + pricing |
| LD-06 | Madrugada: salida local 00:05 y 03:00 en UIO (= 05:05Z y 08:00Z, mismo día) y en MAD (UTC+1/+2) aparece en su día local. | inventory |
| LD-07 | `find` y `list` (admin) sin origen: con vuelos en zonas distintas el mismo día calendario cada uno sale con su propia ventana. Día de 25 h con dos salidas del mismo número devuelve la más temprana. | inventory |
| LD-08 | Aeropuerto sin zona: la escritura devuelve `VALIDATION_FAILED`; la lectura usa UTC con un único `warn`; cobertura de zonas del seed. | inventory + `shared` |
| LD-09 | operations: `date` materializado es el local; check-in compara pasaporte con el día local. reservation: resumen con día local; fecha futura contra el día local del origen. | operations, reservation |
| LD-10 | Gateway: stock envía `date`/`time_slot` locales también para BOG/LIM/MIA/MAD; la consulta de disponibilidad usa la fecha local; `AIRPORT_TIMEZONES` definida se ignora con aviso. | gateway |
| LD-11 | Contratos: las respuestas de búsqueda v1 y v2, estado de vuelo, reservas y cambio de fecha siguen validando con Ajv contra `vuelos-openapi.yaml` (sin modificarlo), incluidas las pruebas reales del gateway con `GATEWAY_TRANSPORT=esb`. | gateway |

Las pruebas de integración contra Postgres (LD-04 a LD-07) se ejecutan en el checkout principal. En el clon limpio y en CI solo van las unitarias, según las reglas del repositorio.

## 6. Tareas propuestas (tras la aprobación)

| Tarea | Contenido | Prueba |
|---|---|---|
| LD-T1 | `shared/airport-time.ts` + export + pruebas | LD-01..03, LD-08 (parte `shared`) |
| LD-T2 | inventory: ventanas en puertos y consultas; rechazo de zona desconocida en `upsert` | LD-02, 04..08 |
| LD-T3 | operations y reservation: `localDay` en los puntos 3, 6, 8 y 9 | LD-09 |
| LD-T4 | gateway: puntos 7 y 10, retiro de `timezones`, aviso por `AIRPORT_TIMEZONES` | LD-10 |
| LD-T5 | pricing falso y ayudantes de pruebas e2e (puntos 11 y 12) | pruebas existentes en verde |
| LD-T6 | script de corrección de `operational_flights.date` (solo conteo por defecto) | prueba contra la base local |
| LD-T7 | Verificación de contratos y cierre: lint, `tsc` por workspace, CI en clon limpio, imágenes Docker con salud gRPC `SERVING`, suite real del gateway | LD-11 + checklist |

Sin migraciones de esquema, sin cambios en OpenAPI ni en `.proto`.
