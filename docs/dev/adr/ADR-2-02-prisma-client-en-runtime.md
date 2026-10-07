# ADR-2-02 — Cliente Prisma generado en el artefacto runtime
- Estado: Aceptado · Fecha: 2026-10-07 · Fase/Tarea: F2 / TKT-09
## Contexto
Ticketing genera su cliente Prisma en `src/infrastructure/persistence/prisma-client` para aislarlo de otros servicios. TypeScript no copia ese JavaScript generado a `dist`, por lo que Cloud Run no podía resolverlo al arrancar.
## Decisión
Después de `prisma generate` y `tsc`, el script de build copia el cliente generado bajo la ruta relativa equivalente dentro de `dist`.
## Consecuencias
El CMD sigue siendo `node dist/main.js`; el cliente Prisma se genera en cada build y permanece ignorado por Git.
