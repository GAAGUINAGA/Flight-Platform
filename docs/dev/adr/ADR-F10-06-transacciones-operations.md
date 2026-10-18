# ADR-F10-06 — Transacciones y errores de Operations con PgBouncer
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / DCS-03
## Contexto
El pool transaccional de Supabase requiere transacciones breves y esperas explícitas; el diagnóstico no debe registrar valores privados.
## Decisión
Las transacciones de Operations usan `OPERATIONS_TX_MAX_WAIT_MS` y `OPERATIONS_TX_TIMEOUT_MS`, ambas 4000 ms por defecto e inicialmente enteros positivos. Los errores internos registran su código P2xxx cuando está disponible, sin mensaje ni valores. Las llamadas gRPC ocurren fuera de transacciones.
## Consecuencias
La suma de espera y ejecución puede exceder el deadline gRPC y debe ajustarse según la carga. La política no elimina los límites del pool ni garantiza éxito bajo saturación.
