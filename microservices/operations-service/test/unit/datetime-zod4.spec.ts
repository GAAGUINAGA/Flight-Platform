import { updateSchema } from '../../src/application/schemas';

// ADR-F11-16: Zod 4 sigue RFC 3339 (segundos obligatorios, desplazamiento con dos puntos).
const update = (estimatedDepartureAt: string) => updateSchema.safeParse({ flightInstanceId: '11111111-1111-1111-1111-111111111111', status: 'DELAYED', estimatedDepartureAt });

describe('F11d-1 / ADR-F11-16: fechas operacionales date-time RFC 3339', () => {
  it.each(['2026-10-24T00:00:00Z', '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00+02:00'])('acepta %s', (value) => {
    expect(update(value).success).toBe(true);
  });
  it.each(['2026-10-24T00:00Z', '2026-10-24T00:00:00+0200'])('rechaza %s', (value) => {
    expect(update(value).success).toBe(false);
  });
});
