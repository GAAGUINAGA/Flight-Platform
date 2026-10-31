# ADR-F12a2-01 — Búsqueda con varias ofertas: límite y orden
- Estado: Aceptado · Fecha: 2026-10-27 · Fase/Tarea: F12a-2 / bloque C
## Contexto
Heredado de v1, `SearchOffers` (Pricing) devolvía una sola oferta: el primer vuelo disponible de cada tramo y solo la cabina de esa fila. Inventory ya devuelve una fila por vuelo y cabina con capacidad suficiente para los pasajeros con asiento, así que no cambia. v1 y v2 comparten la lógica (el Gateway solo traduce la forma).
## Decisión
- **Candidatos por tramo:** se agrupan las filas de Inventory por vuelo (todas sus cabinas con cupo) y se cotizan con todas las tarifas (cabina y marca) del vuelo. Un vuelo sin tarifa en ninguna de sus cabinas con cupo no se ofrece. Si un tramo se queda sin candidatos, la respuesta es `totalOffers: 0`.
- **`pricingOptions` de cada itinerario:** de la más barata a la más cara por total del grupo de pasajeros; empate por cabina y marca. La primera es la tarifa de entrada del vuelo, igual que la única opción que devolvía v1 antes.
- **Orden de ofertas (determinista):** precio total (suma de la opción más barata de cada tramo), luego hora de salida del primer tramo y, al final, los ids de vuelo en orden de tramos.
- **Límite:** `SEARCH_MAX_OFFERS` (10 por defecto) se aplica después de combinar. `SEARCH_MAX_CANDIDATES_PER_LEG` (100 por defecto) acota candidatos por tramo y siempre supera el límite final. Si no hay combinación válida, se amplía el tope hasta encontrar alguna o agotar los vuelos.
- **Ida y vuelta y multidestino:** se construyen de atrás hacia delante y se guardan las N mejores continuaciones por vuelo. La conexión exige salida no anterior a la llegada previa.
- **Cada oferta** es un snapshot propio con `offerId` e `itineraryId` nuevos, guardado con su TTL; retener y reservar funciona igual que antes para cualquiera de ellas.
## Consecuencias
- El top-N es exacto entre los candidatos considerados. Un tope interno menor que los vuelos disponibles puede excluir alguna combinación más barata; la ampliación evita cero si existe una combinación válida.
- Rendimiento medido (bitácora F12a-2 #1): 13 vuelos por tramo, 3 tarifas por vuelo, ida y vuelta: máximo 363 ms (primera llamada, en frío) frente al límite de 5 s de Booking.
- Pruebas que suponían una sola oferta se ajustan a elegir por propiedad (vuelo, cabina, marca) sin cambiar lo que comprueban.
- Fuera: filtros de precio o de escalas, paginación de ofertas.

