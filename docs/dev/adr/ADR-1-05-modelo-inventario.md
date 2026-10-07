# ADR-1-05 ? Modelo de inventario y convenciones
- Estado: Aceptado ? Fecha: 2026-10-06 ? Fase/Tarea: F1 / INV-02, INV-03, INV-05, INV-06

## Contexto
El plan define las tablas pero no ids de segmento, zona horaria de la fecha de salida ni el efecto de `Upsert` sobre cabinas no listadas.

## Decisi?n
- `segment_id` = `flight_instance_id`. `departure_date` de `FindFlightInstance`/`QueryAvailability` es la fecha UTC de `departure_at`.
- Invariantes en la base: `CHECK (held + sold <= sellable)`, estados de hold y 1?9 asientos por l?nea.
- `UpsertFlightInstance` identifica por `flight_instance_id` o por (`flight_number`, `departure_at`); solo cambia `sellable` de las cabinas listadas (nunca por debajo de `held + sold`) y deja intactas las no listadas.
- El seed usa UUID deterministas (SHA-1) y `skipDuplicates`: es idempotente y no reinicia held/sold. Rutas ida y vuelta, 60 d?as, aeronaves E190/A320/B787; el c?digo de aerol?nea sale de `AIRLINE_CODE` (`FP`).
- `QueryAvailability` exige 1?9 pasajeros con asiento (Q-011) y no m?s infantes que adultos; devuelve una entrada por vuelo y cabina con asientos suficientes.

## Consecuencias
Capacidad y reglas de cabina quedan en datos, no en c?digo. El estado operacional del segmento (`status`) lo aporta Operations, no Inventory.
