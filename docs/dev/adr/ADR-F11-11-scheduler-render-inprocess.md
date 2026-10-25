# ADR-F11-11 — Scheduler interno del Gateway en Render
- Estado: Aceptado · Fecha: 2026-10-23 · Fase/Tarea: F11c-1 / PLT-H2
## Contexto
PLT-H2 requiere tareas periódicas y Render suspende el Gateway tras inactividad. La plataforma opera por ventanas de prueba y el humano descartó Cloud Scheduler y tokens OIDC de Google.
## Decisión
El Gateway ejecuta el scheduler en proceso: una ronda inmediata al iniciar y después cada minuto para mantenimiento de negocio, con purga de idempotencia cada hora. Las tareas usan rol `system`, lotes acotados y bloqueo compatible con PgBouncer; sus intervalos, lote y activación son configurables, y se desactiva en pruebas unitarias. Las pruebas invocan funciones con reloj inyectable.
## Consecuencias
Mientras Render esté suspendido no se ejecutan tareas; los holds siguen venciendo en lectura conforme D-04. Un fallo se registra sin PII y no detiene las demás tareas ni el Gateway.
