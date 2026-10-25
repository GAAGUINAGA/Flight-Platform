import { publishEvent } from '../../src/application/schemas';

// ADR-F11-16: Zod 4 sigue RFC 3339 (segundos obligatorios, desplazamiento con dos puntos).
const publish = (occurredAt: string) => publishEvent.safeParse({ ownerId: 'owner', payload: { eventType: 'hold.expired', occurredAt } });

describe('F11d-1 / ADR-F11-16: occurredAt date-time RFC 3339', () => {
  it.each(['2026-10-24T00:00:00Z', '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00+02:00'])('acepta %s', (value) => {
    expect(publish(value).success).toBe(true);
  });
  it.each(['2026-10-24T00:00Z', '2026-10-24T00:00:00+0200'])('rechaza %s', (value) => {
    expect(publish(value).success).toBe(false);
  });
});
