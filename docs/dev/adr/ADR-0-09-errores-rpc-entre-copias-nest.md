# ADR-0-09 — Errores RPC seguros entre copias de Nest
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: F0 / H1-H2
## Contexto
La auditoría observó que `error instanceof RpcException` puede ser falso en Jest para una excepción originada en `packages/shared`, provocando que hello responda `INTERNAL` ante una llave ausente. Un `instanceof` entre copias de Nest o contextos de módulo no es una garantía fiable.
## Decisión
Declarar `@nestjs/common` y `@nestjs/microservices` como `peerDependencies` de `packages/shared` y como dependencias directas del host hello. Centralizar la extracción del payload RPC en `safeGrpcError`: reconocer estructuralmente `getError()` y conservar solo pares `code`/`details` de una lista conocida; cualquier valor inesperado o excepción al leerlo se convierte en `INTERNAL_ERROR`. Usar ese helper tanto en hello como en el filtro compartido.
## Consecuencias
Un clon `npm ci` resuelve Nest como dependencia del host sin instalar una copia privada para shared. La traducción conserva `UNAUTHENTICATED` aunque la excepción provenga de otra copia de Nest y sigue ocultando detalles internos.
