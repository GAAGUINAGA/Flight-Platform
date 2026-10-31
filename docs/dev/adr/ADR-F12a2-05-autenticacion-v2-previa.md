# ADR-F12a2-05 — Autenticación v2 antes de validar
- Estado: Aceptado · Fecha: 2026-10-28 · Fase/Tarea: F12a-2 / F3

## Contexto
El middleware de validación OpenAPI atendía cuerpos inválidos antes de los guards de NestJS y devolvía 400 a clientes sin token.

## Decisión
El Gateway deriva las rutas protegidas y sus scopes de las operaciones del contrato OpenAPI v2 cargado en memoria. Un middleware anterior a la validación autentica y comprueba scopes en esas rutas. Los guards de NestJS siguen protegiendo el controlador. Las rutas públicas conservan la validación previa. El caso de operaciones permite `flights:admin` además de `flights:ops`, como su controlador.

## Consecuencias
Una solicitud a una ruta protegida sin token responde 401, o 403 con scope insuficiente, antes de revisar el cuerpo o los parámetros. El contrato OpenAPI no cambia; v1 tampoco.
