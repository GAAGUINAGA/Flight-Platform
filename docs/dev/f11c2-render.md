# F11c-2: webhooks y administración en Render

## Qué cambia en el despliegue
- Servicios a redesplegar: **api-gateway**, **pricing-service** (UpsertFare y su corrección de equipaje), **webhooks-service** (campo `data` estricto), **reservation-service** (`ListReservationsByFlightInstance` con `ownerId`, `limit` y `cursor`) y **operations-service** (adaptador de Reservation y estado creado desde Inventory). Inventory no cambia.
- Orden recomendado: reservation y pricing → operations y webhooks → api-gateway (los cambios de proto son aditivos y compatibles en el cable).

## Variables
Ninguna variable nueva de servicio. Operations ya necesita `RESERVATION_GRPC_URL` (check-in) y ahora también la usa para notificar vuelos; verifica que esté definida y que apunte a Reservation. `DELAY_THRESHOLD_MINUTES` (por defecto 15) sigue siendo opcional.

Para el smoke (en tu máquina, no en Render):

| Variable | Uso |
|---|---|
| `BASE_URL` | URL pública del Gateway (sin `/flights/v1`) |
| `SMOKE_ADMIN_TOKEN` | JWT de un usuario `admin` de Supabase (`app_metadata.app_role = admin`); el script no lo imprime |
| `SMOKE_WEBHOOK_URL` | opcional; URL HTTPS pública que resuelva por DNS (por defecto `https://example.com/flight-platform-smoke`) |

```powershell
$env:BASE_URL = "https://<gateway>.onrender.com"; $env:SMOKE_ADMIN_TOKEN = "<jwt>"
node platform/api-gateway/scripts/render-f11c2-smoke.cjs
```
El script comprueba 401 sin token, rutas admin con 200, cuerpo con campo desconocido ⇒ 400, alta/listado/baja de un webhook con el secreto enmascarado y 404 al eliminar uno inexistente. Limpia el webhook que crea. Para la parte de customer (reservas propias y `/admin` ⇒ 403) sigue valiendo `supabase-auth-smoke.cjs`.

## Limitación de webhooks en producción
En producción solo existe el emisor de Supabase y el emisor partner de desarrollo se rechaza (`publicKeyFile`). Por eso, en Render los webhooks solo los gestiona un admin de Supabase; los tokens partner se usan fuera de producción (pruebas PLT-SEC-02).
