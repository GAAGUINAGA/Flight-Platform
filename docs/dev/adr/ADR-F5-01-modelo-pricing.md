# ADR-F5-01 — Modelo persistente de tarifas y snapshots
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F5 / PRC-02
## Contexto
Pricing debe conservar tarifas administrables y snapshots inmutables de ofertas y bloqueos de precio, sin referencias entre esquemas de servicios.
## Decisión
Se usan importes `Int` en unidades menores y columnas JSON para snapshots comerciales. Las entidades se guardan en el esquema PostgreSQL `pricing`; los IDs de Inventory son cadenas opacas sin claves foráneas.
## Consecuencias
Los snapshots permiten recalcular y atender lecturas sin consultar esquemas ajenos. Las consultas de recursos de usuario siempre incluyen `ownerId`.
