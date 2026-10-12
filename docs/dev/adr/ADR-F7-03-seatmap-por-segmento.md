# ADR-F7-03 — Seat map público por segmento explícito
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F7 / ANC-04

## Contexto
`GET /offers/{offerId}/seatmap` exige el parámetro de query `segmentId` y `SeatMapResponse` contiene un único `segmentId` y sus `cabins`, no una lista de segmentos. El RPC `GetSeatMapForOfferRequest` solo transportaba `offer_id`.

## Decisión
Se añade `segment_id = 2` opcional a `GetSeatMapForOfferRequest`. Ancillaries lo valida como UUID y llama a `Pricing.ResolveSegment(segment_id)` sin modificar Pricing. El `offer_id` permanece para preservar compatibilidad wire y la correlación de la ruta pública.

## Consecuencias
El cambio protobuf es estrictamente aditivo; no se altera OpenAPI. Un caller sin `segment_id` falla con `VALIDATION_FAILED`, igual que la ausencia del parámetro obligatorio REST.
