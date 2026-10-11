# ADR-F6-01 — Modelo de estado operacional
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F6 / OPS-02
## Contexto
El plan define las tablas de vuelos y actualizaciones operacionales, pero no detalla el snapshot mínimo requerido para responder el estado público sin consultar el esquema de Inventory.
## Decisión
`operational_flights` conserva el snapshot inmutable de segmento (carriers, aeropuertos, horarios programados y aeronave) junto a los horarios operacionales opcionales. `operational_updates` conserva cada cambio como JSON y su estado. Los IDs de Inventory quedan como referencias opacas y no hay claves foráneas entre servicios.
## Consecuencias
La lectura de estado no depende de Inventory una vez creada la proyección; la creación perezosa captura el segmento vigente. Los cambios se auditan sin exponer entidades Prisma por gRPC.
