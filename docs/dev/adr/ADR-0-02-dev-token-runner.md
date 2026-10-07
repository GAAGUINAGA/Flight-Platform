# ADR-0-02 — Ejecución del token de desarrollo
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: 0 / F0-SEC-07

## Contexto
Node 20 no ejecuta archivos TypeScript directamente. El script de tokens debe poder invocarse durante desarrollo sin compilar el repositorio.

## Decisión
Usar `tsx` como dependencia de desarrollo para `npm run dev:token`. Firmar y verificar RS256 con `node:crypto`, sin librería JWT adicional. El usuario proporciona la ruta de una llave privada PEM local; la llave pública se usa para verificar el token.

## Consecuencias
No se generan ni almacenan llaves en el repositorio. El comando exige `sub`, `app_role` y `scope` y se niega a firmar en producción.
