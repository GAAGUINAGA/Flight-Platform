# Sesión dev — renovación del seed de Supabase — 2026-11-22 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: bb7921e

## Objetivo de la sesión
Renovar los vuelos y tarifas sembrados en Supabase (B-042 del triaje), que llegaban hasta el 2026-12-23 (438 vuelos futuros).

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Migraciones | npx prisma migrate status con dotenvx y .env.supabase: inventory y pricing al día, con el datasource en aws-0-us-east-1.pooler.supabase.com. | ✓ |
| Seed | npx prisma generate en inventory y pricing (tras npm ci, el seed de inventory fallaba con '@prisma/client did not initialize yet'); luego, en orden, inventory (840 flight instances ensured) y pricing (2520 fares ensured), ambos con código 0. Idempotentes: sin tocar holds, ventas ni vuelos creados a mano. | ✓ |
| Verificación | Búsqueda pública v2 UIO→GYE del 2027-01-15: 2 ofertas, con ECONOMY y BUSINESS; gateway 200. | ✓ |
| Procedimiento | docs/dev/supabase-seed-renewal.md está desactualizado (pide npm run migrate:status, que no existe, y no incluye prisma generate): anotado en el BACKLOG para corregirlo. | Pendiente |

## Pendientes / bloqueos
- Próxima renovación: antes del 2027-01-07 (14 días antes del fin de la ventana); recordatorio mensual en el calendario del humano. Automatizarla con un workflow programado queda para después de decidir sobre las credenciales.