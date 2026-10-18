# ADR-F10-02 — Seguimiento de efectos de actualizaciones operacionales
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / OPS-05
## Contexto
Una cancelación actualiza Operations, cierra Inventory y publica un evento; un fallo después de guardar el estado debe permitir reintentar sin repetir los efectos ya confirmados. Un retraso debe notificarse solo cuando cambia su hora estimada.
## Decisión
Operations persiste en el vuelo si confirmó el cierre y la notificación de cancelación, y la última hora estimada notificada. Cada confirmación se guarda después de la llamada correspondiente, sin llamadas de red dentro de transacciones. Los vuelos históricos se inicializan como ya notificados según su estado y hora existentes.
## Consecuencias
Los reintentos secuenciales reanudan los pasos pendientes. Una respuesta perdida tras un efecto remoto, una publicación parcialmente completada o dos solicitudes concurrentes aún pueden duplicar efectos: el protocolo de Webhooks no admite clave de idempotencia y los marcadores no son una reserva exclusiva. Se requiere coordinación adicional para garantizar entrega exactamente una vez.
