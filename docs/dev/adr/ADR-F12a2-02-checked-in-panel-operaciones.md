# ADR-F12a2-02 — CHECKED_IN en el panel de operaciones
- Estado: Aceptado · Fecha: 2026-10-27 · Fase/Tarea: F12a-2 / bloque D
## Contexto
`GET /vuelos/operaciones/vuelos` mostraba `CHECKED_IN` en 0. Operations guarda los pases de abordar (`boarding_passes`) con vuelo y asiento, pero no la cabina.
## Decisión
- **Cabina al hacer el check-in:** `boarding_passes.cabin_class` (nullable) se escribe en `CheckInUseCase` con la cabina que ya se obtiene de la reserva para ese segmento (la misma que se usa para asignar el asiento), nunca supuesta. Migración aditiva de operations `20261027220000_boarding_pass_cabin` (columna + índice por `segment_id`). `listPasses` no la devuelve: las respuestas de pases no cambian.
- **RPC aditivo de solo lectura** `OperationsService/CountCheckedIn` (rol `admin`): cuenta asientos únicos por reserva, vuelo y cabina, no pases ni pasajeros. El infante sin asiento propio comparte el asiento del adulto y no incrementa CHECKED_IN. Repetir el check-in o reemitir un pase tampoco cambia el conteo.
- **Panel:** `CHECKED_IN` = asientos con check-in de la cabina; `TICKETED` = vendidos − `CHECKED_IN` (un asiento con check-in deja de contar como solo emitido), de modo que AVAILABLE + HELD + TICKETED + CHECKED_IN = vendible. `BOOKED` y `BOARDED` siguen en 0 hasta F12b.
- **Check-ins anteriores a esta migración** quedan con `cabin_class` nulo y **se excluyen** de los conteos por cabina (siguen contando como TICKETED); no se atribuyen a ninguna cabina. El RPC los devuelve aparte en `withoutCabin` y el panel no los muestra. No se incluye relleno automático: se puede completar con un script puntual que lea la cabina de cada reserva, fuera de la migración, si algún entorno tiene check-ins reales previos.
## Consecuencias
- Redespliegue: operations (migración + RPC) y gateway. Se agrega al conteo de migraciones de Supabase (ocho: las siete de F12a y esta).
- `.proto` solo con líneas añadidas.

