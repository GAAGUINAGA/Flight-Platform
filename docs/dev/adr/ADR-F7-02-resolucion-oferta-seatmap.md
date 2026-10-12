# ADR-F7-02 — Resolución de una oferta para el seat map
- Estado: Reemplazado por ADR-F7-03 · Fecha: 2026-10-11 · Fase/Tarea: F7 / ANC-04

## Contexto
`GetSeatMapForOffer` recibe `offer_id`, mientras que el RPC existente `Pricing.ResolveSegment` tiene un campo llamado `segment_id`. No existe un RPC de resolución de oferta y el contrato gRPC está congelado.

## Decisión
Reemplazada. La revisión del contrato OpenAPI confirmó que la operación pública recibe `segmentId` obligatorio; no se reutiliza `segment_id` para transportar `offer_id`.

## Consecuencias
La modificación inicial a Pricing se revierte por completo. ADR-F7-03 define el campo aditivo que falta en el RPC de Ancillaries.
