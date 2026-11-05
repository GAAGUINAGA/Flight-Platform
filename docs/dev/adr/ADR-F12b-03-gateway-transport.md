# ADR-F12b-03 — Vuelta atrás `GATEWAY_TRANSPORT=esb|grpc`
- Estado: Aceptado · Fecha: 2026-10-31 · Fase/Tarea: F12b-1 / Bloque 0
## Contexto
Hay que poder volver al transporte directo mientras el ESB madura.
## Decisión
`GATEWAY_TRANSPORT` por defecto `esb`; `grpc` conserva el código actual. Un valor distinto de ambos hace fallar el arranque. Con `esb`, el código de producción del gateway no crea ningún cliente gRPC a microservicios (se prueba). Excepciones explícitas a la regla «sin gRPC»: (1) `GatewayTestGrpcClient`, solo en código de pruebas (D-2); (2) **el cliente gRPC del stock externo de Booking** (`v2/stock/stock-sync.ts`, `InventoryStockService`), aprobado como excepción hasta F12b-3 por ser una integración externa y no un microservicio de la plataforma; pasa a la capa de integración del ESB en F12b-3. La prueba `ESBT-17` demuestra que, con `esb`, ese es el único cliente gRPC del gateway (`ESBT-14` demuestra que ningún flujo crea clientes a microservicios). Se retira `grpc` al cerrar F12b-3.
## Consecuencias
Dos caminos de transporte hasta F12b-3; las suites reales corren con `esb` (dos veces) y con `grpc` (una).
