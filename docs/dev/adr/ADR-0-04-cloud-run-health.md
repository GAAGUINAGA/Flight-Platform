# ADR-0-04 — Acceso al health check de Cloud Run
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: 0 / F0-15

## Contexto
La prueba de cierre exige llamar `grpc.health.v1.Health/Check` mediante `grpcurl` y verificar el rechazo de una llamada sin llave interna.

## Decisión
El servicio hello permite la entrada HTTPS de Cloud Run, pero exige `x-internal-key` en el RPC de health. El workflow configura HTTP/2, la cuenta de runtime y el secreto desde Secret Manager.

## Consecuencias
La plataforma entrega la petición al servidor gRPC para que este devuelva `UNAUTHENTICATED` cuando falta la llave. El despliegue requiere un proyecto GCP, identidad federada y secreto configurados.
