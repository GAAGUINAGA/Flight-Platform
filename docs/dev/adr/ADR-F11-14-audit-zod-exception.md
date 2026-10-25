# ADR-F11-14 — Excepción temporal de audit para Zod 3

- Estado: Aceptado · Fecha: 2026-10-24 · Fase/Tarea: F11c-1 / cierre de dependencias

## Contexto

El aviso alto `GHSA-mrhx-c7xc-m3w5` afecta Zod 3. El único arreglo publicado
requiere Zod 4, un cambio mayor transversal que no es seguro introducir durante
el cierre de F11c-1.

## Decisión

El CI ejecuta un validador de `npm audit --json`: rechaza cualquier hallazgo
alto o crítico, salvo excepciones versionadas, identificadas por paquete y
advisory, con vencimiento obligatorio. Se admite temporalmente solo Zod 3 para
ese advisory hasta 2026-11-23. El Gateway limita los cuerpos JSON a 100kb antes
de ejecutar validación Zod; una prueba comprueba 413 para 200kB.

## Consecuencias

La excepción vence de forma automática y la migración coordinada a Zod 4 queda
en el backlog como prerequisito para cerrar F11. No se permiten excepciones
para críticos ni para avisos sin ID.
