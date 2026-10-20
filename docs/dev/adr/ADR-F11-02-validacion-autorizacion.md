# ADR-F11-02 — Autorización y validación de respuestas
- Estado: Aceptado · Fecha: 2026-10-20 · Fase/Tarea: F11 / PLT-A y PLT-B
## Contexto
El contrato omite 401 y 403 en las operaciones individuales, aunque la seguridad de la plataforma los exige. El validador OpenAPI también activa por defecto una implementación de seguridad sin los verificadores JWT del Gateway.
## Decisión
La autenticación y autorización corresponden a los guards del Gateway. El middleware OpenAPI valida peticiones y respuestas declaradas; cuando está activa la validación de respuestas, tolera exclusivamente la ausencia de esquema para los estados 401 y 403. Los demás errores de validación siguen propagándose.
## Consecuencias
Las rutas protegidas conservan sus respuestas de seguridad con validación de contrato activa. El cuerpo de estos dos estados debe verificarse por separado contra ProblemDetails en las pruebas de seguridad.
