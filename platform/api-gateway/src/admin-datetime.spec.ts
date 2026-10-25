import { adminOperationalUpdateBody, parseAdmin } from './admin.schemas';

// ADR-F11-16: Zod 4 sigue RFC 3339 (segundos obligatorios, desplazamiento con dos puntos).
const parse = (actualDepartureAt: string) => parseAdmin(adminOperationalUpdateBody, { status: 'DEPARTED', actualDepartureAt });

describe('F11d-1 / ADR-F11-16: fechas de rutas admin date-time RFC 3339', () => {
  it.each(['2026-10-24T00:00:00Z', '2026-10-24T00:00:00+02:00'])('acepta %s', (value) => {
    expect(parse(value)).toMatchObject({ actualDepartureAt: value });
  });
  it.each(['2026-10-24T00:00Z', '2026-10-24T00:00:00+0200'])('rechaza %s con VALIDATION_FAILED', (value) => {
    expect(() => parse(value)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', statusCode: 400, safeDetail: 'Invalid fields: actualDepartureAt' }));
  });
});
