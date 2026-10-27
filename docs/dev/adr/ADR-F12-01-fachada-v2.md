# ADR-F12-01 — Fachada v2 en el Gateway, aditiva sobre v1
- Estado: Aceptado · Fecha: 2026-10-26 · Fase/Tarea: F12a (P1 en adelante)
## Contexto
`contracts/openapi/vuelos-openapi-v2.yaml` es un superconjunto aditivo de v1 (propiedades nuevas opcionales, enums que solo crecen). Booking prueba contra GabatAIR (`NODE_VUE_GABATAIR`) el martes a las 19h30; la emisión y las sagas seguirán dentro de Reservation hasta F12b (orquestador ESB).
## Decisión
- v2 vive en `/api/v2/**`, dentro del Gateway (`platform/api-gateway/src/v2/`), con su propia instancia de `express-openapi-validator` sobre el YAML v2 (el archivo no se modifica; solo el prefijo de montaje se fija en memoria). v1 (`/flights/v1/**`) no cambia: mismos guards, mismos errores, mismo interceptor de idempotencia.
- Errores v2: constructor propio de `ProblemDetails` (`type`, `title`, `status`, `code`, `detail`, `instance`, `correlation_id`, `timestamp`, `invalidParams`). El filtro de excepciones elige formato por ruta: `/api/v2/**` → v2; el resto → v1. Los guards de v1 que lanzan `VALIDATION_FAILED` con 401/403 se traducen en v2 a `UNAUTHORIZED`/`FORBIDDEN`. `detail` nunca lleva valores del usuario ni datos internos.
- Códigos de estado: el mapa código→HTTP de v2 está en `v2/problem.ts`. Diferencias deliberadas con v1: `BAGGAGE_LIMIT_EXCEEDED` responde **422 solo en v2** (el contrato v2 lo lista así; v1 mantiene 409 sin cambios, decisión Q5 del humano).
- Cabeceras: `X-Request-Id` se genera si falta y se devuelve siempre; `X-Correlation-Id` mayor de 100 caracteres → 400.
- Perfil de integración local (`INTEGRATION_LOCAL=true`): solo por variable explícita, nunca por defecto y rechazado con `NODE_ENV=production`. `PUBLIC_BASE_URL` fija el emisor del dev-auth y la base de los `_links`.
- Salud (`GET /api/v2/vuelos/health`): sonda `grpc.health.v1` a los siete servicios en paralelo, tope por sonda (800 ms) y caché de 5 s. Inventory, Pricing o Reservation caídos → `DOWN` (503, mismo cuerpo); otro servicio caído → `DEGRADED` (200). `circuit_breaker_estado=CLOSED`: no existe breaker propio hasta F12b.
## Consecuencias
Las pruebas fijan lo observable de v2 y sirven de regresión cuando F12b mueva las sagas al orquestador. Los 400 que el validador genera antes de llegar a un controlador cumplen `ProblemDetails`; las reglas de dominio que el contrato manda como 422 se validan en el Gateway (ver ADR de P2).
