# ADR-0-07 — Identidades de despliegue GCP
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: F0 / F0-13, F0-SEC-05
## Contexto
El plan requiere Artifact Registry, Workload Identity Federation y cuentas separadas de despliegue/runtime, pero no fija nombres ni alcance preciso de las vinculaciones IAM.
## Decisión
Usar `flight-platform` como repositorio Docker, `github-actions/flight-platform` como pool/proveedor WIF, `flight-platform-deployer` como cuenta de despliegue y una cuenta runtime por cada microservicio de Cloud Run, incluida hello. El proveedor admite solo tokens del repositorio `GAAGUINAGA/Flight-Platform` en `refs/heads/main`. La cuenta de despliegue puede escribir imágenes en ese repositorio, administrar Cloud Run y actuar como cada cuenta runtime. Cada cuenta runtime solo recibe acceso al secreto compartido `internal-api-key`.
## Consecuencias
La automatización queda restringida a la rama principal y al repositorio indicado. El script evita rotar un secreto existente al repetirse. Si se agregan secretos exclusivos por servicio, deberán concederse solo a la cuenta runtime correspondiente.
