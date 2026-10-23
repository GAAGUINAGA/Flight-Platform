# ADR-F11-06 — Respuesta de reserva con hold inexistente o ajeno
- Estado: Aceptado · Fecha: 2026-10-22 · Fase/Tarea: F11 / tarea 0
## Contexto
El plan requiere 404 para recursos inexistentes o ajenos, pero la operación `POST /bookings` no declara una respuesta 404 en OpenAPI. Con validación de respuestas activada, el middleware convierte ese 404 en 500 por faltar el schema de la operación.
## Decisión
Reservation traduce el `NOT_FOUND` gRPC de la lectura del hold a su error de dominio `NOT_FOUND`. El Gateway conserva el 404 y exceptúa exclusivamente el estado 404 no declarado para `POST /bookings` de la comprobación de presencia del schema por operación. Las pruebas REST validan el cuerpo con el schema `ProblemDetails` y comprueban que los casos ajeno e inexistente sean iguales.
## Consecuencias
No se modifica el contrato ni se revela la existencia de un hold ajeno. La excepción no desactiva la validación de otros errores o rutas; la prueba Ajv cubre la forma del 404 omitido por la operación.
