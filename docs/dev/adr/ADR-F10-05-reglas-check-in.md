# ADR-F10-05 — Ventana, código y reintento de check-in
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / DCS-03, DCS-05
## Contexto
El plan fija la ventana, un código QR tipo BCBP y que los infantes no ocupan asiento propio; no concreta la igualdad en los límites ni el tratamiento de fallos parciales de infraestructura.
## Decisión
La ventana abre exactamente al alcanzar CHECKIN_OPEN_HOURS y cierra al alcanzar CHECKIN_CLOSE_MINUTES. Un infante con cupón válido usa en su pase el asiento del adulto asociado ya registrado, sin pedir asiento propio. El contenido QR es una referencia opaca con prefijo M1 y asiento; excluye documentos y contacto. Ante un error conocido de infraestructura se eliminan los registros locales incompletos para permitir un reintento, que reutiliza la asignación idempotente en Ancillaries.
## Consecuencias
Los códigos no son un BCBP IATA certificado. Si el proceso termina inesperadamente durante IN_PROGRESS, se requiere recuperación adicional. Una confirmación remota perdida puede causar publicación duplicada sin idempotencia en Webhooks.
