# Rutas administrativas `/flights/v1/admin/*` (PLT-H1)

No forman parte de `contracts/openapi/vuelos-openapi.yaml`; el Gateway las excluye de la validación OpenAPI
(`ignorePaths` en `platform/api-gateway/src/app.ts`) y cada servicio valida la entrada con Zod.

## Acceso

- Cabecera `Authorization: Bearer <JWT>` con `app_role = admin` **y** scope `flights:admin` (PLAN §2.3).
- Sin token ⇒ 401. Rol distinto de `admin` (customer, partner) o sin el scope ⇒ 403.
- Cada servicio vuelve a exigir el rol `admin` con la identidad propagada por el Gateway.
- Cada cuerpo, query y parámetro se valida en el Gateway con un esquema Zod estricto (`src/admin.schemas.ts`) antes de llamar al servicio: campo desconocido o tipo inválido ⇒ 400 `VALIDATION_FAILED`. El `detail` nombra los campos, nunca los valores. Los servicios vuelven a validar.
- Errores: `application/problem+json` con el formato `ProblemDetails` y los códigos del catálogo
  (`VALIDATION_FAILED` ⇒ 400, `FLIGHT_STATUS_NOT_AVAILABLE` ⇒ 404, etc.). Un 503 usa `RATE_LIMIT_EXCEEDED` con `Retry-After`.
- Producción (Render): solo existe el emisor de Supabase; el emisor partner de desarrollo se rechaza (`publicKeyFile`).
  Por tanto las rutas admin y los webhooks los usa un admin de Supabase; los tokens partner de desarrollo solo valen fuera de producción.

## Vuelos (inventory)

| Método y ruta | Cuerpo / query | Éxito | Errores |
|---|---|---|---|
| `POST /flights/v1/admin/flights` | `{ flightInstanceId?, flightNumber, departureIata, arrivalIata, departureAt, arrivalAt, cabins: [{ cabinClass, capacity }], aircraft? }` | 200 `{ flightInstanceId, segment, cabins, closed }`. La misma clave natural (número + salida) actualiza, no duplica. | 400 datos inválidos o incoherentes (llegada ≤ salida, mismo origen y destino) |
| `GET /flights/v1/admin/flights` | query `date?` (AAAA-MM-DD), `limit?` (0–200), `cursor?` (uuid) | 200 `{ items: [...], page: { nextCursor? } }` | 400 |
| `POST /flights/v1/admin/flights/{flightInstanceId}/close` | — | 200 con `closed: true` (venta cerrada) | 400 id no UUID, 404 vuelo inexistente |

## Tarifas (pricing)

| Método y ruta | Cuerpo / query | Éxito | Errores |
|---|---|---|---|
| `PUT /flights/v1/admin/fares` | `{ flightInstanceId, cabinClass, fareBrand, price: { currency: "USD", baseFare?, taxes?, total }, fareRules: { isRefundable, isChangeable }, baggageAllowance, extraCheckedBaggagePrice: { currency, total } }` (`fareId` opcional) | 200 `{ fare: {...} }`. Misma clave natural (vuelo, cabina, marca) actualiza la tarifa y conserva su `fareId`. | 400 |
| `GET /flights/v1/admin/fares` | query `flightInstanceId?` | 200 `{ fares: [{ fare }], page }` | 400 id no UUID |

## Actualizaciones operacionales (operations)

| Método y ruta | Cuerpo | Éxito | Errores |
|---|---|---|---|
| `POST /flights/v1/admin/flights/{flightInstanceId}/operational-updates` | `{ status: SCHEDULED\|BOARDING\|DELAYED\|DEPARTED\|ARRIVED\|CANCELLED\|DIVERTED, estimatedDepartureAt?, actualDepartureAt?, estimatedArrivalAt?, actualArrivalAt?, departureTerminal?, arrivalTerminal? }` (fechas ISO-8601) | 200 con el esquema `FlightStatus` | 400 estado o campo inválido; 404 solo si el vuelo no existe en Inventory (si existe y no tenía estado operativo, se crea desde Inventory) |

Efectos: un retraso que alcanza el umbral publica `flight.schedule_changed` por cada reserva afectada (todas las páginas); `CANCELLED`
cierra la venta del vuelo y publica `flight.cancelled`. Si Reservation no responde, el cambio y el cierre se mantienen, se registra la dependencia y el código, y repetir la misma actualización reintenta la notificación (ADR-F11-15).

## Webhooks (OP-15 a OP-17) en Render

`/flights/v1/webhooks` admite los roles `partner` y `admin` con scope `flights:webhooks`; el secreto sale siempre
enmascarado (`****` + últimos 4). En producción, por lo anterior, solo los gestiona un admin de Supabase.
