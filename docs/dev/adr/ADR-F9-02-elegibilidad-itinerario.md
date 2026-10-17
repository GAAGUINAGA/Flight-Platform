# ADR-F9-02 — Elegibilidad postventa de un itinerario iniciado
- Estado: Aceptado · Fecha: 2026-10-16 · Fase/Tarea: F9 / PST-01

## Contexto
La regla común impide operar sobre un itinerario volado, pero la reserva puede contener varios itinerarios y segmentos, y el snapshot contiene sus horarios de salida.

## Decisión
La operación postventa de la reserva completa exige que ningún segmento haya alcanzado su salida programada. Se compara con el reloj inyectado; una salida igual al instante actual cuenta como iniciada. Un snapshot sin segmentos o con fecha inválida no se trata como elegible.

## Consecuencias
Las operaciones no modifican reservas que ya iniciaron viaje. La misma regla sirve para equipaje, cambio y cancelación; el cutoff de equipaje se comprueba además sobre el itinerario correspondiente.
