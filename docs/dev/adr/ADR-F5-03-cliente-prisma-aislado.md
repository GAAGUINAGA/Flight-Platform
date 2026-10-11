# ADR-F5-03 — Cliente Prisma aislado de Pricing
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F5 / PRC-12
## Contexto
El cliente Prisma por defecto se genera en la instalación compartida de dependencias. PRC-12 necesita Pricing e Inventory simultáneos y sus esquemas generan clientes incompatibles.
## Decisión
Pricing genera en `src/infrastructure/persistence/prisma-client`, igual que Ticketing (ADR-4-02). Pricing importa únicamente ese cliente; Inventory no se modifica y conserva su cliente por defecto.
## Consecuencias
La generación de Pricing no sobrescribe Inventory. Antes de PRC-12 se genera Inventory desde su directorio y después Pricing; los artefactos permanecen ignorados por Git y el build/Dockerfile de Pricing ejecuta su generación.
