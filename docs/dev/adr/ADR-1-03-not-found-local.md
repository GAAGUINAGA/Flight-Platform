# ADR-1-03 ? NOT_FOUND y payload de errores en Inventory
- Estado: Reemplazado en lo relativo a NOT_FOUND por ADR-F0-PATCH-01; vigente en lo relativo al payload ? Fecha: 2026-10-06 ? Fase/Tarea: F1 / INV-SEC-02

## Contexto
La versi?n inicial mapeaba `NOT_FOUND` localmente porque el cat?logo de `packages/shared` no lo inclu?a. ADR-F0-PATCH-01 lo a?adi? como c?digo interno con gRPC `NOT_FOUND`.

## Decisi?n
- Se elimin? el mapeo local: `InventoryExceptionFilter` traduce `InventoryError(code)` con `GRPC_STATUS_BY_CODE` de `shared`, y `safeGrpcError` ya reconoce `NOT_FOUND`.
- Sigue vigente que el servidor gRPC de Nest espera que un filtro lance el payload plano `{ code, details }` (no una `RpcException`); el filtro lo hace y registra solo el nombre del tipo de los errores internos.

## Consecuencias
El Gateway debe mapear `details = NOT_FOUND` ? 404 (F4).
