# ADR-F5-02 — Snapshot mínimo de reserva en cotizaciones
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F5 / PRC-10, PRC-11
## Contexto
`QuoteChange` y `QuoteCancellation` requieren reglas del brand, importe pagado, pasajeros e itinerarios actuales. El proto congelado solo tenía `booking_id`, `owner_id` y fechas, insuficientes para cotizar sin que Pricing lea el esquema de Reservation.
## Decisión
Se añaden campos protobuf opcionales/aditivos con un snapshot comercial mínimo enviado por Reservation. Pricing no accede a otro esquema ni persiste datos de reserva ajenos.
## Consecuencias
Los clientes previos siguen siendo compatibles a nivel wire; los callers de las cotizaciones deben enviar el snapshot. No se modifica el contrato OpenAPI.
