/**
 * Tabla ÚNICA de zonas horarias de aeropuertos (NFR-TI-01, ADR-F12b1fix-02). Sin importaciones: la usan los servicios
 * (a través de `airport-time.ts`) y el front (a través de `@flight-platform/format`, que la importa por esta subruta).
 */

/** IATA → zona IANA. Agregar un aeropuerto es un cambio de código aquí. */
export const AIRPORT_ZONES: Readonly<Record<string, string>> = Object.freeze({
  UIO: 'America/Guayaquil', GYE: 'America/Guayaquil', CUE: 'America/Guayaquil', LTX: 'America/Guayaquil', MEC: 'America/Guayaquil',
  ESM: 'America/Guayaquil', TUA: 'America/Guayaquil', LOH: 'America/Guayaquil', PVO: 'America/Guayaquil', OCC: 'America/Guayaquil',
  TPC: 'America/Guayaquil', XMS: 'America/Guayaquil', GPS: 'Pacific/Galapagos', SCY: 'Pacific/Galapagos',
  BOG: 'America/Bogota', MDE: 'America/Bogota', LIM: 'America/Lima', MAD: 'Europe/Madrid', MIA: 'America/New_York'
});

export function zoneOf(iata: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(AIRPORT_ZONES, iata) ? AIRPORT_ZONES[iata] : undefined;
}
