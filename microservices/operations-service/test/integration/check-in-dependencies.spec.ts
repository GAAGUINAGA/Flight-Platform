import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from '@jest/globals';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { credentials, loadPackageDefinition, Metadata, Server, ServerCredentials, ServiceDefinition, ServerUnaryCall, ServiceError, sendUnaryData, status } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { createOperationsRuntime } from '../../src/main';
import { createOperationsServer, findProtoRoot } from '../../src/infrastructure/grpc/server';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';

const key = 'dcs01-test-internal-key-at-least-32-bytes';
const owner = `owner-${randomUUID()}`;
const bookingId = randomUUID();
const segmentId = randomUUID();
const passengerId = randomUUID();
const checkInBooking = randomUUID();
const checkInSegment = randomUUID();
const checkInPassenger = randomUUID();
const checkInFlight = randomUUID();
type Request = Record<string, string>;
type Response = Record<string, unknown>;
type Service = { service: ServiceDefinition };

describe('DCS-01: composición y puertos por gRPC', () => {
  let prisma: PrismaClient;
  let server: Server;
  let composition: ReturnType<typeof createOperationsRuntime>;
  const oldEnv = { reservation: process.env.RESERVATION_GRPC_URL, ticketing: process.env.TICKETING_GRPC_URL, ancillaries: process.env.ANCILLARIES_GRPC_URL, webhooks: process.env.WEBHOOKS_GRPC_URL, tls: process.env.GRPC_TLS };
  const seen: Array<{ owner: string; bookingId: string }> = [];
  const published: Array<Record<string, unknown>> = [];
  const assignedBookings: string[] = [];
  const fixtures = new Map<string, { owner: string; passenger: string; segment: string; flight: string }>();
  const capture = (call: ServerUnaryCall<Request, Response>) => {
    seen.push({ owner: String(call.metadata.get('x-owner-id')[0]), bookingId: call.request.bookingId });
    expect(call.metadata.get('x-internal-key')).toEqual([key]);
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Operations integration tests');
    prisma = new PrismaClient();
    await prisma.$connect();
    const root = findProtoRoot();
    server = new Server();
    const loadService = (name: string, pkg: string, service: string): Service => {
      const definition = loadSync(join(root, 'flightplatform', name, 'v1', `${name}.proto`), { includeDirs: [root], enums: String, defaults: true, arrays: true, objects: true });
      const loaded = loadPackageDefinition(definition) as unknown as { flightplatform: Record<string, { v1: Record<string, Service> }> };
      return loaded.flightplatform[pkg].v1[service];
    };
    server.addService(loadService('reservation', 'reservation', 'ReservationService').service, {
      GetReservationSnapshot: (call: ServerUnaryCall<Request, Response>, callback: sendUnaryData<Response>) => {
        capture(call);
        const fixture = fixtures.get(call.request.bookingId);
        if (fixture && call.metadata.get('x-owner-id')[0] !== fixture.owner) return callback({ code: status.NOT_FOUND, details: 'NOT_FOUND' } as ServiceError, null);
        if (fixture) return callback(null, { bookingId: call.request.bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId: fixture.passenger, passengerType: 'ADULT', documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: randomUUID(), segments: [{ segmentId: fixture.segment, flightInstanceId: fixture.flight, flightNumber: 'FP101', departure: { iataCode: 'UIO', at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] });
        if (call.request.bookingId === checkInBooking) callback(null, { bookingId: checkInBooking, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId: checkInPassenger, passengerType: 'ADULT', documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: randomUUID(), segments: [{ segmentId: checkInSegment, flightInstanceId: checkInFlight, flightNumber: 'FP101', departure: { iataCode: 'UIO', at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] });
        else callback(null, { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [], itineraries: [] });
      }
    });
    server.addService(loadService('ticketing', 'ticketing', 'TicketingService').service, {
      GetCouponsForBooking: (call: ServerUnaryCall<Request, Response>, callback: sendUnaryData<Response>) => { capture(call); const fixture = fixtures.get(call.request.bookingId); callback(null, { coupons: [fixture ? { passengerId: fixture.passenger, segmentId: fixture.segment, status: 'ISSUED' } : call.request.bookingId === checkInBooking ? { passengerId: checkInPassenger, segmentId: checkInSegment, status: 'ISSUED' } : { passengerId, segmentId, status: 'ISSUED' }] }); }
    });
    server.addService(loadService('ancillaries', 'ancillaries', 'AncillariesService').service, {
      AssignSeatAtCheckIn: (call: ServerUnaryCall<Request, Response>, callback: sendUnaryData<Response>) => { capture(call); assignedBookings.push(call.request.bookingId); callback(null, { bookingId: call.request.bookingId, passengerId: call.request.passengerId, segmentId: call.request.segmentId, seatNumber: '12A', status: 'CHECKED_IN' }); }
    });
    server.addService(loadService('webhooks', 'webhooks', 'WebhooksService').service, { PublishEvent: (call: ServerUnaryCall<Request, Response>, callback: sendUnaryData<Response>) => { published.push(call.request); callback(null, { eventId: randomUUID() }); } });
    const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => error ? reject(error) : resolve(bound)));
    process.env.RESERVATION_GRPC_URL = `127.0.0.1:${port}`;
    process.env.TICKETING_GRPC_URL = `127.0.0.1:${port}`;
    process.env.ANCILLARIES_GRPC_URL = `127.0.0.1:${port}`;
    process.env.WEBHOOKS_GRPC_URL = `127.0.0.1:${port}`;
    process.env.GRPC_TLS = 'false';
    composition = createOperationsRuntime(key, prisma);
  });

  afterAll(async () => {
    try { await prisma?.checkIn.deleteMany({ where: { bookingId, ownerId: owner } }); }
    finally {
      composition?.close();
      if (server) await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
      await prisma?.$disconnect();
      for (const [name, value] of Object.entries({ RESERVATION_GRPC_URL: oldEnv.reservation, TICKETING_GRPC_URL: oldEnv.ticketing, ANCILLARIES_GRPC_URL: oldEnv.ancillaries, WEBHOOKS_GRPC_URL: oldEnv.webhooks, GRPC_TLS: oldEnv.tls })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  it('DCS-01: reserva, cupones y asiento atraviesan los adaptadores reales y se conserva un pase propio', async () => {
    const snapshot = await composition.runtime.checkInReservation.getSnapshot(owner, bookingId);
    const coupons = await composition.runtime.checkInTicketing.getCoupons(owner, bookingId);
    const seat = await composition.runtime.checkInSeats.assign({ ownerId: owner, bookingId, passengerId, segmentId, passengerType: 'ADULT', cabinClass: 'ECONOMY' });
    expect(snapshot).toMatchObject({ bookingId, status: 'CONFIRMED' });
    expect(coupons).toEqual([expect.objectContaining({ passengerId, segmentId, status: 'ISSUED' })]);
    expect(seat).toMatchObject({ seatNumber: '12A', status: 'CHECKED_IN' });
    expect(seen).toEqual([{ owner, bookingId }, { owner, bookingId }, { owner, bookingId }]);
    const checkIn = await prisma.checkIn.create({ data: { bookingId, ownerId: owner, status: 'COMPLETED', result: { bookingId, status: 'COMPLETED' } } });
    await prisma.boardingPass.create({ data: { checkInId: checkIn.id, bookingId, ownerId: owner, passengerId, segmentId, seat: seat.seatNumber, barcode: 'opaque', barcodeType: 'QR' } });
    expect(await prisma.boardingPass.findMany({ where: { bookingId, ownerId: owner } })).toEqual([expect.objectContaining({ passengerId, segmentId, seat: '12A', valid: true })]);
    expect(await prisma.boardingPass.count({ where: { bookingId, ownerId: 'another-owner' } })).toBe(0);
  });

  it('DCS-03 / DCS-05: check-in por gRPC persiste pase y repetir no asigna ni publica otra vez', async () => {
    const port = 32000 + Math.floor(Math.random() * 1000);
    const app = await createOperationsServer({ url: `127.0.0.1:${port}`, internalApiKey: key, runtime: composition.runtime });
    let client: { checkIn(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void } | undefined;
    try {
      await app.listen();
      const root = findProtoRoot();
      const definition = loadSync(join(root, 'flightplatform/operations/v1/operations.proto'), { includeDirs: [root], enums: String, defaults: true, arrays: true, objects: true });
      const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { operations: { v1: { OperationsService: new (address: string, channelCredentials: unknown) => NonNullable<typeof client> } } } };
      client = new pkg.flightplatform.operations.v1.OperationsService(`127.0.0.1:${port}`, credentials.createInsecure());
      const call = () => new Promise<unknown>((resolve, reject) => { const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', owner); client!.checkIn({ bookingId: checkInBooking, ownerId: owner }, metadata, (error, response) => error ? reject(error) : resolve(response)); });
      const first = await call();
      expect(first).toMatchObject({ bookingId: checkInBooking, status: 'COMPLETED', checkedInPassengers: [expect.objectContaining({ passengerId: checkInPassenger, status: 'CHECKED_IN' })] });
      const document = parse(readFileSync(join(root, '..', 'openapi', 'vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };
      const ajv = new Ajv({ strict: false, formats: { uuid: /^[0-9a-f-]{36}$/i } });
      expect(ajv.compile({ ...document.components.schemas.CheckInResponse, components: document.components })(first)).toBe(true);
      expect(await call()).toEqual(first);
      expect(await prisma.boardingPass.findMany({ where: { ownerId: owner, bookingId: checkInBooking } })).toEqual([expect.objectContaining({ passengerId: checkInPassenger, segmentId: checkInSegment, seat: '12A', barcodeType: 'QR' })]);
      expect(assignedBookings.filter((value) => value === checkInBooking)).toHaveLength(1);
      expect(published).toEqual([expect.objectContaining({ ownerId: owner, payload: expect.objectContaining({ eventType: 'booking.checked_in' }) })]);
    } finally { client?.close(); await app.close(); await prisma.checkIn.deleteMany({ where: { bookingId: checkInBooking, ownerId: owner } }); }
  });

  it('DCS-04: lista por gRPC los pases válidos del owner y cumple OpenAPI', async () => {
    const booking = randomUUID();
    const fixture = { owner: `owner-${randomUUID()}`, passenger: randomUUID(), segment: randomUUID(), flight: randomUUID() };
    fixtures.set(booking, fixture);
    const port = 33000 + Math.floor(Math.random() * 1000);
    const app = await createOperationsServer({ url: `127.0.0.1:${port}`, internalApiKey: key, runtime: composition.runtime });
    type Client = { checkIn(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; listBoardingPasses(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void };
    let client: Client | undefined;
    try {
      await app.listen();
      const root = findProtoRoot();
      const definition = loadSync(join(root, 'flightplatform/operations/v1/operations.proto'), { includeDirs: [root], enums: String, defaults: true, arrays: true, objects: true });
      const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { operations: { v1: { OperationsService: new (address: string, creds: unknown) => Client } } } };
      client = new pkg.flightplatform.operations.v1.OperationsService(`127.0.0.1:${port}`, credentials.createInsecure());
      const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', fixture.owner);
      const invoke = (method: 'checkIn' | 'listBoardingPasses') => new Promise<unknown>((resolve, reject) => client![method]({ bookingId: booking }, metadata, (error, response) => error ? reject(error) : resolve(response)));
      await invoke('checkIn');
      const response = await invoke('listBoardingPasses');
      expect(response).toEqual({ bookingId: booking, boardingPasses: [expect.objectContaining({ passengerId: fixture.passenger, segmentId: fixture.segment, seat: '12A', barcodeType: 'QR', barcode: expect.stringMatching(/^M1\//) })] });
      const document = parse(readFileSync(join(root, '..', 'openapi', 'vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };
      const ajv = new Ajv({ strict: false, formats: { uuid: /^[0-9a-f-]{36}$/i } });
      expect(ajv.compile({ ...document.components.schemas.BoardingPassListResponse, components: document.components })(response)).toBe(true);
      await prisma.boardingPass.updateMany({ where: { bookingId: booking, ownerId: fixture.owner }, data: { valid: false } });
      await expect(invoke('listBoardingPasses')).rejects.toMatchObject({ details: 'BOARDING_PASS_NOT_AVAILABLE' });
    } finally { client?.close(); await app.close(); await prisma.checkIn.deleteMany({ where: { bookingId: booking, ownerId: fixture.owner } }); fixtures.delete(booking); }
  });

  it('DCS-SEC-01: check-in y pases de reserva ajena devuelven NOT_FOUND por gRPC sin efectos', async () => {
    const booking = randomUUID();
    const fixture = { owner: `owner-${randomUUID()}`, passenger: randomUUID(), segment: randomUUID(), flight: randomUUID() };
    fixtures.set(booking, fixture);
    const port = 34000 + Math.floor(Math.random() * 1000);
    const app = await createOperationsServer({ url: `127.0.0.1:${port}`, internalApiKey: key, runtime: composition.runtime });
    type Client = { checkIn(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; listBoardingPasses(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close(): void };
    let client: Client | undefined;
    try {
      await app.listen();
      const root = findProtoRoot();
      const definition = loadSync(join(root, 'flightplatform/operations/v1/operations.proto'), { includeDirs: [root], enums: String, defaults: true, arrays: true, objects: true });
      const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { operations: { v1: { OperationsService: new (address: string, creds: unknown) => Client } } } };
      client = new pkg.flightplatform.operations.v1.OperationsService(`127.0.0.1:${port}`, credentials.createInsecure());
      const metadata = new Metadata(); metadata.set('x-internal-key', key); metadata.set('x-owner-id', `other-${randomUUID()}`);
      const invoke = (method: 'checkIn' | 'listBoardingPasses') => new Promise<unknown>((resolve, reject) => client![method]({ bookingId: booking, ownerId: fixture.owner }, metadata, (error, response) => error ? reject(error) : resolve(response)));
      await expect(invoke('checkIn')).rejects.toMatchObject({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
      await expect(invoke('listBoardingPasses')).rejects.toMatchObject({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
      expect(assignedBookings.filter((value) => value === booking)).toHaveLength(0);
      expect(published.filter((value) => (value.payload as { bookingId?: string })?.bookingId === booking)).toHaveLength(0);
      expect(await prisma.checkIn.count({ where: { bookingId: booking } })).toBe(0);
      expect(await prisma.boardingPass.count({ where: { bookingId: booking } })).toBe(0);
    } finally { client?.close(); await app.close(); await prisma.checkIn.deleteMany({ where: { bookingId: booking, ownerId: fixture.owner } }); fixtures.delete(booking); }
  });
});
