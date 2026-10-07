# Verificaciones humanas — recursos externos

Este documento conserva evidencia no reproducible en un clon de auditoría
porque requiere credenciales reales que deliberadamente no se incluyen en Git.
Los secretos nunca se copian aquí ni en las bitácoras.

## F0-12 — conexiones Supabase

- Fecha: 2026-10-06.
- Fuente de configuración: los siete archivos ignorados
  `microservices/<servicio>-service/.env.supabase`.
- Comprobación realizada: para cada uno de `inventory`, `pricing`,
  `ancillaries`, `reservation`, `ticketing`, `operations` y `webhooks`, se
  ejecutó `psql` con `DATABASE_URL` (Transaction pooler, 6543) y `DIRECT_URL`
  (Session pooler, 5432), consultando `SELECT current_user`.
- Resultado: 14/14 conexiones exitosas; cada una devolvió el rol
  `svc_<servicio>` correspondiente.

Un auditor sin esas credenciales debe revisar la estructura de las plantillas,
la bitácora developer F0 #6 y esta evidencia; no debe solicitar ni registrar
contraseñas para repetir la prueba.

## F0-SEC-04 — Data API

- Fecha: 2026-10-06, corregido después de `audit-1`.
- Comprobación humana por `curl` con la publishable key mantenida fuera de Git:
  una solicitud REST con `Accept-Profile` para cada esquema `inventory`,
  `pricing`, `ancillaries`, `reservation`, `ticketing`, `operations`,
  `webhooks` y `gateway` devolvió `PGRST106`.
- Resultado: los ocho esquemas internos no están expuestos. Los únicos
  esquemas expuestos son `public` y `graphql_public`.

Esta comprobación sustituye la declaración previa, incorrecta, registrada en
la bitácora developer F0 #6 antes de que se corrigiera Data API.
