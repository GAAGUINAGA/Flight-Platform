# ADR-0-03 — Health check gRPC estándar
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: 0 / F0-08

## Contexto
El plan pide un health check gRPC reutilizable y el pipeline comprobará `grpc.health.v1.Health/Check`.

## Decisión
Usar `grpc-health-check`, la implementación del protocolo estándar para `@grpc/grpc-js`, y exponer un helper que añade el servicio a un servidor gRPC.

## Consecuencias
Los servicios pueden registrar el health check sin mantener una copia propia del contrato de salud. La prueba de F0-08 llama el RPC real en un servidor local.
