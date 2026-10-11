# ADR-4-02 — Cliente Prisma aislado del Gateway
- Estado: Aceptado · Fecha: 2026-10-10 · Fase/Tarea: F4 / GW-01, GW-04

## Contexto
La generación predeterminada de Prisma escribe en `node_modules/.prisma/client`, compartido por todos los workspaces. Durante pruebas simultáneas, Windows impide reemplazar el motor abierto por otro servicio.

## Decisión
El schema del Gateway genera su cliente en `platform/api-gateway/generated/prisma-client`, fuera del árbol fuente y sin seguimiento de Git.

## Consecuencias
El build del workspace puede generar Prisma sin modificar el cliente de otro servicio. El build copia el cliente a `dist/generated` para que los adaptadores del runtime lo resuelvan dentro de la imagen.
