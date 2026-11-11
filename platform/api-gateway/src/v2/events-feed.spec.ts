import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';
import type { GatewayConfig } from '../config';

jest.mock('../grpc-clients', () => ({ callGatewayGrpc: jest.fn() }));
import { callGatewayGrpc } from '../grpc-clients';
import { V2EventsController } from './webhooks.controller';

// Sin hacer rodar la base: el servicio (aquí simulado como lo hace su almacén: orden por seq ascendente y seq > afterSeq) responde, y se comprueba lo que el feed hace con eso.
const stored = [9, 3, 12, 5].map((seq) => ({ seq, eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, ownerId: 'client-1', eventType: 'hold.expired', occurredAt: '2026-11-09T10:00:00.000Z', dataJson: JSON.stringify({ holdId: `h${seq}` }) }));
const calls: Array<Record<string, unknown>> = [];
const config = { v2: { sourceCode: 'VUE' } } as unknown as GatewayConfig;
const req = { auth: { clientId: 'client-1', ownerId: 'client-1' }, res: { getHeader: () => 'corr' } } as unknown as Request;

describe('EVT-ORDER: GET /vuelos/eventos', () => {
  beforeEach(() => {
    calls.length = 0;
    jest.mocked(callGatewayGrpc).mockImplementation(async (_config, _service, _method, input) => {
      const request = input as { afterSeq?: number; limit: number }; calls.push(request);
      return { items: [...stored].sort((a, b) => a.seq - b.seq).filter((item) => request.afterSeq === undefined || item.seq > request.afterSeq).slice(0, request.limit) };
    });
  });

  it('EVT-ORDER-01: devuelve los eventos en orden ascendente de id', async () => {
    const result = await new V2EventsController(config).list(req, {}) as { events: Array<{ id: string }> };
    expect(result.events.map((event) => event.id)).toEqual(['evt-vue-000003', 'evt-vue-000005', 'evt-vue-000009', 'evt-vue-000012']);
  });
  it('EVT-ORDER-02: after=<id> entrega solo los posteriores (excluye el propio id) y lo traduce a afterSeq', async () => {
    const result = await new V2EventsController(config).list(req, { after: 'evt-vue-000005' }) as { events: Array<{ id: string }> };
    expect(calls[0]).toMatchObject({ afterSeq: 5 });
    expect(result.events.map((event) => event.id)).toEqual(['evt-vue-000009', 'evt-vue-000012']);
  });
  it('EVT-ORDER-03: paginar con limit y after recorre todo una vez, en orden, y cierra con next_after nulo', async () => {
    const controller = new V2EventsController(config); const seen: string[] = []; let after: string | undefined;
    for (let page = 0; page < 6; page += 1) {
      const result = await controller.list(req, { limit: '1', ...(after ? { after } : {}) }) as { events: Array<{ id: string }>; metadata: { next_after: string | null } };
      seen.push(...result.events.map((event) => event.id)); after = result.metadata.next_after ?? undefined; if (!after) break;
    }
    expect(seen).toEqual(['evt-vue-000003', 'evt-vue-000005', 'evt-vue-000009', 'evt-vue-000012']);
  });
  it('EVT-ORDER-04: un after mal formado es 400', async () => {
    await expect(new V2EventsController(config).list(req, { after: 'evt-000005' })).rejects.toMatchObject({ statusCode: 400 });
  });
});
