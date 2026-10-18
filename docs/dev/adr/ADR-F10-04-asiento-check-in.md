# ADR-F10-04 — Estado de asiento al hacer check-in
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / DCS-03
## Contexto
El RPC existente de Ancillaries devolvía asientos PROVISIONAL o CONFIRMED. F10 exige observar CHECKED_IN para el pasajero y segmento procesados.
## Decisión
Extender el estado interno de Ancillaries con CHECKED_IN. Al asignar un asiento nuevo se crea en ese estado; una asignación previa activa se actualiza de manera owner-scoped por pasajero y segmento. Un asiento liberado no se reactiva. ConfirmSeats no degrada un asiento ya registrado en check-in.
## Consecuencias
Ancillaries debe desplegarse con este cambio antes de probar F10 en el entorno real. No cambia el protocolo ni requiere migración: la columna ya admite el valor. La prueba anterior de ANC-07 ahora exige CHECKED_IN.
