import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { loadConfig, type GatewayConfig } from '../config';

jest.mock('../grpc-clients', () => ({ callGatewayGrpc: jest.fn(), fetchSeatMap: jest.fn() }));
jest.mock('./events', () => ({ publishV2Event: jest.fn(async () => undefined) }));
import { callGatewayGrpc } from '../grpc-clients';
import { V2HoldController } from './hold.controller';
import { V2ShoppingController } from './shopping.controller';

/** HIDDEN_CABINS: mitigación temporal que oculta cabinas a los clientes en v2 sin tocar tarifas ni vuelos. */
const option = (cabinClass: string, fareBrand: string) => ({ cabinClass, fareBrand, price: { currency: 'USD', total: '100.00' } });
const offer = (id: string, options: Array<ReturnType<typeof option>>) => ({ offerId: id, airlineCode: 'FP', airlineName: 'GabatAIR', itineraries: [{ itineraryId: `it-${id}`, segments: [], pricingOptions: options }], grandTotal: { currency: 'USD', total: '100.00' } });
const OFFERS = [offer('mixed', [option('ECONOMY', 'BASIC'), option('BUSINESS', 'FLEX')]), offer('only-business', [option('BUSINESS', 'FLEX')]), offer('only-economy', [option('ECONOMY', 'BASIC')])];
const req = { auth: { ownerId: 'owner-1' }, header: () => 'idem', res: { getHeader: () => 'corr' } } as unknown as Request;
const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as Response;
const withCabins = (hiddenCabins?: string[]) => ({ v2: { publicBaseUrl: 'https://x.test' }, ...(hiddenCabins ? { hiddenCabins } : {}) }) as unknown as GatewayConfig;
const search = (config: GatewayConfig) => new V2ShoppingController(config).search(req, { itineraries: [], passengers: { adults: 1 } }) as Promise<{ totalOffers: number; offers: Array<{ offerId: string; itineraries: Array<{ pricingOptions: Array<{ cabinClass: string }> }> }> }>;
const holdBody = (cabinClass: string) => ({ offerId: '00000000-0000-4000-8000-0000000000c1', itinerarySelections: [{ itineraryId: '00000000-0000-4000-8000-0000000000d1', cabinClass, fareBrand: 'X' }], passengersBreakdown: { adults: 1 } });
const methods: string[] = [];
beforeEach(() => {
  methods.length = 0;
  jest.mocked(callGatewayGrpc).mockImplementation(async (_c, _s, method) => {
    methods.push(method);
    if (method === 'searchOffers') return { totalOffers: 3, offers: JSON.parse(JSON.stringify(OFFERS)) as unknown[] };
    if (method === 'holdOffer') return { holdId: '00000000-0000-4000-8000-0000000000b1', status: 'HELD', expiresAt: '2026-11-09T10:15:00Z', ttlMinutes: 15, lockedPrice: { currency: 'USD', total: '10.00' } };
    return {};
  });
});

describe('HIDDEN_CABINS (hotfix)', () => {
  it('HC-01: con HIDDEN_CABINS=BUSINESS la búsqueda quita las opciones BUSINESS y descarta las ofertas que se quedan sin opciones', async () => {
    const result = await search(withCabins(['BUSINESS']));
    expect(result.offers.map((o) => o.offerId)).toEqual(['mixed', 'only-economy']); expect(result.totalOffers).toBe(2);
    expect(JSON.stringify(result)).not.toContain('BUSINESS');
    expect(result.offers[0].itineraries[0].pricingOptions.map((o) => o.cabinClass)).toEqual(['ECONOMY']);
  });
  it('HC-02: sin la variable (ausente o vacía) la respuesta no cambia', async () => {
    for (const config of [withCabins(), withCabins([])]) {
      const result = await search(config); expect(result.offers.map((o) => o.offerId)).toEqual(['mixed', 'only-business', 'only-economy']); expect(result.totalOffers).toBe(3);
      expect(result.offers[0].itineraries[0].pricingOptions.map((o) => o.cabinClass)).toEqual(['ECONOMY', 'BUSINESS']);
    }
  });
  it('HC-03: el hold de una opción de una cabina oculta se rechaza con OFFER_NO_LONGER_AVAILABLE (410) sin llamar a Pricing; las demás cabinas siguen funcionando', async () => {
    await expect(new V2HoldController(withCabins(['BUSINESS'])).create(req, res, holdBody('BUSINESS'))).rejects.toMatchObject({ code: 'OFFER_NO_LONGER_AVAILABLE', statusCode: 410 });
    expect(methods).not.toContain('holdOffer');
    await expect(new V2HoldController(withCabins(['BUSINESS'])).create(req, res, holdBody('ECONOMY'))).resolves.toMatchObject({ status: 'HELD' });
    methods.length = 0; await expect(new V2HoldController(withCabins()).create(req, res, holdBody('BUSINESS'))).resolves.toMatchObject({ status: 'HELD' });
  });
  it('HC-04: la configuración lee HIDDEN_CABINS y un valor desconocido impide arrancar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hidden-cabins-')); const pub = join(dir, 'public.pem');
    writeFileSync(pub, generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } }).publicKey);
    const env = { NODE_ENV: 'test', INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: pub }]), GATEWAY_TRANSPORT: 'grpc' };
    expect(loadConfig({ ...env, HIDDEN_CABINS: ' business , FIRST,business' }).hiddenCabins).toEqual(['BUSINESS', 'FIRST']);
    expect(loadConfig({ ...env, HIDDEN_CABINS: '' }).hiddenCabins).toEqual([]); expect(loadConfig({ ...env }).hiddenCabins).toEqual([]);
    for (const bad of ['BUSINES', 'BUSINESS,VIP', 'ALL']) expect(() => loadConfig({ ...env, HIDDEN_CABINS: bad })).toThrow(/HIDDEN_CABINS/);
    rmSync(dir, { recursive: true, force: true });
  });
});
