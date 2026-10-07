# ADR-2-01 — Modelo y numeración de Ticketing
- Estado: Aceptado · Fecha: 2026-10-07 · Fase/Tarea: F2 / TKT-02, TKT-04
## Contexto
El plan define tickets, cupones, una secuencia y la idempotencia de emisión, pero no fija los nombres de cupones ni la granularidad de la secuencia.
## Decisión
Se guarda un contador único por prefijo en `ticket_sequences`; cada asignación incrementa atómicamente el contador y forma `prefijo` (tres dígitos) + secuencia decimal de diez dígitos. Cada cupón recibe el número de su ticket más `-` y el ordinal de segmento, por lo que no altera la numeración pública del e-ticket. `issuance_requests` guarda el resultado de `(booking_id, request_id)`.
## Consecuencias
Los números nunca se reutilizan incluso ante void, refund o fallo. Los cupones son identificables dentro de su ticket y la única clave de deduplicación de emisión permanece en la base.
