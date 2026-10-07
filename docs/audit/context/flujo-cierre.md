# Flujo de cierre de fase (reemplaza el orden de PLAN §4.2 para el despliegue)
- Auditoría de código: en la rama de la fase, antes del merge. Las tareas de despliegue (migración en Supabase, deploy a Cloud Run/Render, smoke remoto) NO bloquean esta auditoría.
- Tras el merge, el despliegue se hace desde main (WIF solo acepta main).
- Auditoría de despliegue: corta; verifica solo las tareas de despliegue usando las salidas registradas en la bitácora y un health check propio contra la URL pública.
- Ambas auditorías cuentan para el límite de rechazos por separado.