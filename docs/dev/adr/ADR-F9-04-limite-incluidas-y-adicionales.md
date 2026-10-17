# ADR-F9-04 — Límite conjunto de equipaje
- Estado: Aceptado · Fecha: 2026-10-16 · Fase/Tarea: F9 / PST-02

## Contexto
ADR-F7-05 aplicaba el límite configurable solo al equipaje adicional porque Ancillaries aún no conocía la franquicia. El invariante INV-ANC-04 exige que la suma incluida y comprada no supere la política.

## Decisión
Con la franquicia disponible, Ancillaries aplica `BAGGAGE_MAX_ALLOWED` a la suma de incluidas y compradas, dentro del mismo bloqueo transaccional. `maxAllowed` informa la cantidad adicional disponible; `totalBaggage` incluye franquicia y compras.

## Consecuencias
La interpretación provisional de ADR-F7-05 queda reemplazada para reservas con franquicia registrada. Para reservas anteriores sin franquicia, se mantiene el comportamiento anterior hasta que exista información para reconstruirla.
