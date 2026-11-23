# Guía de operación

Procedimientos manuales del operador. Cada sección es independiente. Los comandos contra Supabase y los cambios de variables en Render y Cloud Run los ejecuta únicamente el humano.

- Renovación del seed de vuelos: `docs/dev/supabase-seed-renewal.md`.
- Rutas administrativas: `docs/dev/admin-routes.md`.

## `HIDDEN_CABINS`: ocultar una cabina a los clientes (interruptor de emergencia)

### Qué hace

Variable de entorno del **Gateway** (servicio `flight-gateway` en Render). Es una lista de cabinas, separadas por coma, que los clientes **no ven** en la API pública v2 (la usan la web, por GraphQL, y Booking):

- `POST /api/v2/vuelos/search` quita las opciones de tarifa de esas cabinas y descarta las ofertas que se quedan sin opciones (`totalOffers` se ajusta).
- `POST /api/v2/vuelos/offers/hold` con una opción de una cabina oculta responde `410 OFFER_NO_LONGER_AVAILABLE`, aunque la oferta sea anterior.

No toca tarifas, vuelos, Pricing, Inventory, Reservation, la API de administración ni el panel (el administrador sigue creando y abriendo vuelos de esa cabina). Una reserva ya hecha en esa cabina no se ve afectada. Las ofertas del cambio de fecha (`.../date-change/search`) **no** se filtran.

Valores válidos (`CabinClass`): `ECONOMY`, `PREMIUM_ECONOMY`, `BUSINESS`, `FIRST` (mayúsculas o minúsculas, con espacios y repetidos se normalizan). Un valor desconocido **impide que el Gateway arranque** (`HIDDEN_CABINS must be a comma-separated list of: …`). Vacía o ausente = no se oculta nada. Código: `platform/api-gateway/src/config.ts`, `src/v2/shopping.controller.ts`, `src/v2/hold.controller.ts`; pruebas: `src/v2/hidden-cabins.spec.ts`.

### Cuándo usarlo

Solo en una emergencia: cuando comprar en una cabina falla de forma sostenida y hace falta dejar de ofrecerla mientras se corrige. Ejemplo real: el 2026-11-16 la compra en BUSINESS fallaba en producción y se usó `HIDDEN_CABINS=BUSINESS` hasta que se corrigió (`f750ed9`) y se borró la variable (2026-11-21). Hoy **no está definida** y el mecanismo se conserva como interruptor (decisión del humano, 2026-11-22). No se usa para decisiones comerciales.

Ocultar una cabina cambia lo que ven los clientes y Booking en la búsqueda; avisar a Booking al activarlo y al desactivarlo (como se hizo en noviembre).

### Cómo activarlo y desactivarlo en Render

1. Render → servicio del Gateway (`flight-gateway`) → **Environment**.
2. **Activar:** agregar la variable `HIDDEN_CABINS` con la cabina (por ejemplo `BUSINESS`; varias: `BUSINESS,FIRST`) y guardar. Render reinicia el servicio con el nuevo valor.
3. **Desactivar:** borrar la variable (o dejarla vacía) y guardar; Render vuelve a desplegar.
4. Esperar a que el servicio quede en línea (el Gateway no arranca si el valor es inválido; en ese caso corregirlo o borrarlo).

### Cómo comprobarlo con la búsqueda pública

La búsqueda no requiere token. Con una ruta y fecha sembradas (por ejemplo UIO→GYE en una fecha futura con vuelos), consultar `POST <URL del Gateway>/api/v2/vuelos/search` con el cuerpo de búsqueda del contrato v2 (`docs/booking-integration.md` y la colección Postman de `docs/booking-integration/`):

| Estado | Qué debe verse |
|---|---|
| Variable activa (`BUSINESS`) | En `offers[].itineraries[].pricingOptions[]` **ninguna** opción con `cabinClass: "BUSINESS"`; las ofertas que solo la tenían desaparecen. |
| Variable borrada | Vuelven las opciones `BUSINESS` (comprobado el 2026-11-21 y el 2026-11-22: UIO→GYE ofrece ECONOMY y BUSINESS). |

Para confirmar el hold: intentar `POST /api/v2/vuelos/offers/hold` con una opción de la cabina oculta debe dar `410 OFFER_NO_LONGER_AVAILABLE`.
