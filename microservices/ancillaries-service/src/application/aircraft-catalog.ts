/** Catálogo de aviones con los asientos de cada cabina de su mapa (F12c-4c, ADR-F12c4-01): solo lectura, sin dueño; el controlador exige rol admin. */
export interface AircraftLayoutReader { countSeatsByAircraftAndCabin(): Promise<Array<{ aircraft: string; cabinClass: string; seats: number }>> }

export interface AircraftLayoutView { code: string; cabins: Array<{ cabinClass: string; seats: number }> }

const CABIN_ORDER = ['FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'];

export class AircraftCatalog {
  constructor(private readonly reader: AircraftLayoutReader) {}

  async list(): Promise<{ aircraft: AircraftLayoutView[] }> {
    const byAircraft = new Map<string, Array<{ cabinClass: string; seats: number }>>();
    for (const row of await this.reader.countSeatsByAircraftAndCabin()) {
      if (row.seats < 1) continue;
      byAircraft.set(row.aircraft, [...(byAircraft.get(row.aircraft) ?? []), { cabinClass: row.cabinClass, seats: row.seats }]);
    }
    const rank = (cabin: string): number => { const index = CABIN_ORDER.indexOf(cabin); return index < 0 ? CABIN_ORDER.length : index; };
    return {
      aircraft: [...byAircraft].sort(([a], [b]) => a.localeCompare(b)).map(([code, cabins]) => ({ code, cabins: [...cabins].sort((a, b) => rank(a.cabinClass) - rank(b.cabinClass) || a.cabinClass.localeCompare(b.cabinClass)) }))
    };
  }
}
