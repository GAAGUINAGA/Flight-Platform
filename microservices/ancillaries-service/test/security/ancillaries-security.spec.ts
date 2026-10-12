import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { Logger as PinoLogger } from 'pino';
import { createAncillariesServer, createLogger, findProtoRoot } from '../../src/infrastructure/grpc/server';
import { GetSeatMapForOffer } from '../../src/application/seat-map';
import { SeatAssignments } from '../../src/application/seat-assignments';
import { BookingOwnershipStore, ownershipNotFound } from '../../src/application/booking-ownership';

const key = 'a'.repeat(40);
const ids = { offerId: '00000000-0000-4000-8000-000000000001', segmentId: '00000000-0000-4000-8000-000000000002', bookingId: '00000000-0000-4000-8000-000000000003' };
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void> & { close(): void };

describe('ANC-SEC-01/02/03', () => {
  let app: INestMicroservice;
  let client: Client;
  let logger: PinoLogger;
  const logs: string[] = [];
  const call = <T>(method: string, request: unknown, options: { internalKey?: string; ownerId?: string; role?: string } = {}) => new Promise<T>((resolve, reject) => {
    const metadata = new Metadata();
    if (options.internalKey !== '') metadata.set('x-internal-key', options.internalKey ?? key);
    if (options.ownerId !== '') metadata.set('x-owner-id', options.ownerId ?? 'security-owner');
    if (options.role) metadata.set('x-role', options.role);
    client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });
  beforeAll(async () => {
    const port = 36000 + Math.floor(Math.random() * 1000);
    const sink = new Writable({ write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); } });
    logger = createLogger(sink);
    const pricing = { resolveSegment: async () => { throw new Error('private pii@example.test'); }, getBaggagePrice: async () => ({ currency: 'USD', total: '0.00' }) };
    const layouts = { listByAircraft: async () => [] };
    const owners = new Map<string, string>();
    owners.set(ids.bookingId, 'security-owner');
    const ownership: BookingOwnershipStore = { claimOrAssertOwner: async (bookingId, ownerId) => { const saved = owners.get(bookingId); if (saved && saved !== ownerId) ownershipNotFound(); owners.set(bookingId, ownerId); }, assertOwner: async (bookingId, ownerId) => { if (owners.get(bookingId) !== ownerId) ownershipNotFound(); } };
    app = await createAncillariesServer({ url: `127.0.0.1:${port}`, internalApiKey: key, logger, deps: {
      seatMap: new GetSeatMapForOffer(pricing, layouts, { activeSeatNumbers: async () => [] }),
      seats: new SeatAssignments(pricing, layouts, { create: async () => { throw new Error('unused'); }, find: async () => null, list: async () => [], updateStatus: async () => [], activeSeatNumbers: async () => [] }, ownership),
      baggage: { releaseAll: async () => undefined } as never
    } });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/ancillaries/v1/ancillaries.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { ancillaries: { v1: { AncillariesService: new (address: string, credentials: unknown) => Client } } } };
    client = new pkg.flightplatform.ancillaries.v1.AncillariesService(`127.0.0.1:${port}`, credentials.createInsecure());
  });
  afterAll(async () => { try { client?.close(); } finally { await app?.close(); } });
  it('ANC-SEC-03: llave ausente e incorrecta son UNAUTHENTICATED', async () => {
    await expect(call('getSeatMapForOffer', ids, { internalKey: '' })).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' });
    await expect(call('getSeatMapForOffer', ids, { internalKey: 'wrong' })).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' });
  });
  it('ANC-SEC-01: uuid y formato de asiento inválidos son VALIDATION_FAILED', async () => {
    await expect(call('getSeatMapForOffer', { offerId: 'bad', segmentId: 'bad' })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    await expect(call('reserveSeats', { bookingId: ids.bookingId, assignments: [{ passengerId: ids.offerId, segmentId: ids.segmentId, seatNumber: '99Z', passengerType: 'ADULT', cabinClass: 'ECONOMY' }] })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });
  it('ANC-SEC-03: rol customer no puede ejecutar ReleaseAll', async () => {
    await expect(call('releaseAll', { bookingId: ids.bookingId }, { role: 'customer' })).rejects.toMatchObject({ code: 7, details: 'PERMISSION_DENIED' });
  });
  it('ANC-SEC-02: metadata owner prevalece sobre ownerId del cuerpo', async () => {
    await expect(call('getAssignments', { bookingId: ids.bookingId, ownerId: 'other-owner' }, { ownerId: '' })).rejects.toMatchObject({ code: 5, details: 'NOT_FOUND' });
  });
  it('ANC-SEC-03: error interno y logs no exponen PII', async () => {
    await expect(call('getSeatMapForOffer', ids)).rejects.toMatchObject({ code: 13, details: 'INTERNAL_ERROR' });
    logger.info({ email: 'pii@example.test', paymentReference: 'pay_ok_123' }, 'security probe');
    expect(logs.join('')).not.toContain('pii@example.test');
    expect(logs.join('')).not.toContain('pay_ok_123');
  });
});
