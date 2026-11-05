# ADR-F12b-09 — Autenticación entre servicios sin cambios
- Estado: Aceptado · Fecha: 2026-10-31 · Fase/Tarea: F12b-1 / Bloque 0
## Contexto
F12 mantiene la llave interna + identidad en metadatos.
## Decisión
Gateway→ESB usa la llave interna actual (comparación en tiempo constante). El ESB confía en la identidad (`ownerId`, `role`) que envía el gateway autenticado, como hoy los microservicios, y la reenvía sin transformarla. D-4 (corregida): defensa en profundidad, el ESB verifica el rol en las operaciones administrativas y de sistema con esa identidad (PERMISSION_DENIED igual que el microservicio; detalle en ADR-F12b-02). Ninguna petición sin llave interna llega a la mediación: 401, con prueba. ESB→servicios sigue con la llave interna (TLS en nube).
## Consecuencias
Render llega al ESB por internet: el ingreso en Cloud Run es público protegido solo por la llave interna. La identidad de servicio de Google queda para después de F12.
