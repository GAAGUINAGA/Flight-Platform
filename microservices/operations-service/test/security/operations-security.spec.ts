import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import process from 'node:process';
import { Client as GrpcClient, credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { Logger as PinoLogger } from 'pino';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { createLogger, createOperationsServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const key = 's'.repeat(40);
const date = '2026-12-03';
const scheduledDepartureAt = new Date(`${date}T10:00:00.000Z`);
const scheduledArrivalAt = new Date(`${date}T11:00:00.000Z`);
const cancellationId = randomUUID();
const internalErrorId = randomUUID();
const customerId = randomUUID();
type Client = Record<string, (request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void) => void> & { close?: () => void };

describe('OPS-05 / OPS-SEC-01 / OPS-SEC-02', () => {
  let prisma: PrismaClient;
  let app: INestMicroservice;
  let client: Client;
  let logger: PinoLogger;
  const closed: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const call = <T>(method: string, request: unknown, options: { internalKey?: string; role?: string } = {}) => new Promise<T>((resolve, reject) => {
    const metadata = new Metadata();
    if (options.internalKey !== '') metadata.set('x-internal-key', options.internalKey ?? key);
    metadata.set('x-correlation-id', 'operations-security');
    if (options.role) metadata.set('x-role', options.role);
    client[method](request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Operations integration tests');
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.operationalFlight.createMany({ data: [cancellationId, internalErrorId, customerId].map((flightInstanceId, index) => ({
      flightInstanceId, flightNumber: `FP6${index + 2}`, date, marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt, scheduledArrivalAt, status: 'SCHEDULED'
    })) });
    const sink = new Writable({ write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); } });
    const port = 32000 + Math.floor(Math.random() * 1000);
    logger = createLogger(sink);
    app = await createOperationsServer({
      url: `127.0.0.1:${port}`,
      internalApiKey: key,
      logger,
      runtime: {
        prisma,
        inventory: {
          findFlight: async () => { throw new Error('not used'); },
          closeFlightInstance: async (id) => { if (id === internalErrorId) throw new Error('private failure pii@example.test'); closed.push(id); }
        },
        reservations: { listByFlightInstance: async () => [{ bookingId: 'booking-1', ownerId: 'owner-1', pnr: 'ABC123' }] },
        events: { publish: async (event) => { events.push(event); } }
      }
    });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/operations/v1/operations.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { operations: { v1: { OperationsService: new (address: string, channelCredentials: unknown) => Client } } } };
    client = new pkg.flightplatform.operations.v1.OperationsService(`127.0.0.1:${port}`, credentials.createInsecure());
  });

  afterAll(async () => {
    try { await prisma?.operationalFlight.deleteMany({ where: { flightInstanceId: { in: [cancellationId, internalErrorId, customerId] } } }); }
    finally { client?.close?.(); await app?.close(); await prisma?.$disconnect(); }
  });

  it('OPS-05 / I: cancelar cierra la venta y publica flight.cancelled por reserva afectada', async () => {
    await expect(call('recordOperationalUpdate', { flightInstanceId: cancellationId, status: 'CANCELLED' }, { role: 'admin' })).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(closed).toContain(cancellationId);
    expect(events).toEqual([expect.objectContaining({ eventType: 'flight.cancelled', bookingId: 'booking-1', ownerId: 'owner-1', pnr: 'ABC123' })]);
  });

  it('OPS-SEC-02: llave ausente e incorrecta son UNAUTHENTICATED', async () => {
    await expect(call('getFlightStatus', { flightNumber: 'FP62', date }, { internalKey: '' })).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' });
    await expect(call('getFlightStatus', { flightNumber: 'FP62', date }, { internalKey: 'wrong' })).rejects.toMatchObject({ code: 16, details: 'UNAUTHENTICATED' });
  });

  it('OPS-SEC-01: entrada inválida es INVALID_ARGUMENT', async () => {
    await expect(call('getFlightStatus', { flightNumber: 'bad-number', date }, { role: 'customer' })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });

  it('OPS-SEC-02: customer no puede registrar una actualización operacional', async () => {
    await expect(call('recordOperationalUpdate', { flightInstanceId: customerId, status: 'DELAYED', estimatedDepartureAt: `${date}T10:15:00.000Z` }, { role: 'customer' })).rejects.toMatchObject({ code: 7, details: 'PERMISSION_DENIED' });
  });

  it('OPS-05: repetir cancelación por RPC no repite efectos', async () => {
    const id = randomUUID();
    const flightNumber = `FP${1000 + Math.floor(Math.random() * 8000)}`;
    await prisma.operationalFlight.create({ data: { flightInstanceId: id, flightNumber, date: '2099-01-02', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt, scheduledArrivalAt, status: 'SCHEDULED' } });
    const before = events.length;
    try {
      await call('recordOperationalUpdate', { flightInstanceId: id, status: 'CANCELLED' }, { role: 'admin' });
      await call('recordOperationalUpdate', { flightInstanceId: id, status: 'CANCELLED' }, { role: 'admin' });
      expect(closed.filter((value) => value === id)).toHaveLength(1);
      expect(events.slice(before)).toEqual([expect.objectContaining({ eventType: 'flight.cancelled' })]);
    } finally { await prisma.operationalFlight.deleteMany({ where: { flightInstanceId: id } }); }
  });

  it('OPS-05: repetir horario retrasado por RPC no repite evento', async () => {
    const id = randomUUID();
    const flightNumber = `FP${1000 + Math.floor(Math.random() * 8000)}`;
    await prisma.operationalFlight.create({ data: { flightInstanceId: id, flightNumber, date: '2099-01-03', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt, scheduledArrivalAt, status: 'SCHEDULED' } });
    const before = events.length;
    try {
      const request = { flightInstanceId: id, status: 'DELAYED', estimatedDepartureAt: `${date}T10:15:00.000Z` };
      await call('recordOperationalUpdate', request, { role: 'admin' });
      await call('recordOperationalUpdate', request, { role: 'admin' });
      expect(events.slice(before)).toEqual([expect.objectContaining({ eventType: 'flight.schedule_changed' })]);
    } finally { await prisma.operationalFlight.deleteMany({ where: { flightInstanceId: id } }); }
  });

  it('OPS-SEC-01: fecha inválida por RPC devuelve VALIDATION_FAILED', async () => {
    await expect(call('getFlightStatus', { flightNumber: 'FP62', date: '2026-02-30' }, { role: 'customer' })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });

  it('OPS-SEC-01: campo protobuf extra por RPC devuelve VALIDATION_FAILED', async () => {
    const metadata = new Metadata();
    metadata.set('x-internal-key', key);
    metadata.set('x-role', 'customer');
    const raw = Buffer.concat([Buffer.from([10, 4]), Buffer.from('FP62'), Buffer.from([18, 10]), Buffer.from(date), Buffer.from([0x98, 0x06, 0x01])]);
    const result = new Promise((resolve, reject) => (client as unknown as GrpcClient).makeUnaryRequest(
      '/flightplatform.operations.v1.OperationsService/GetFlightStatus', () => raw, (data) => data, {}, metadata,
      (error, response) => error ? reject(error) : resolve(response)
    ));
    await expect(result).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
  });

  it('OPS-SEC-01: transición no permitida por RPC devuelve VALIDATION_FAILED y no altera el vuelo', async () => {
    const id = randomUUID();
    const flightNumber = `FP${1000 + Math.floor(Math.random() * 8000)}`;
    await prisma.operationalFlight.create({ data: { flightInstanceId: id, flightNumber, date: '2099-01-01', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt, scheduledArrivalAt, status: 'SCHEDULED' } });
    try {
      await expect(call('recordOperationalUpdate', { flightInstanceId: id, status: 'ARRIVED' }, { role: 'admin' })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
      expect((await prisma.operationalFlight.findUniqueOrThrow({ where: { flightInstanceId: id } })).status).toBe('SCHEDULED');
    } finally { await prisma.operationalFlight.deleteMany({ where: { flightInstanceId: id } }); }
  });

  it('OPS-SEC-02: error interno forzado no expone detalles ni PII en logs', async () => {
    await expect(call('recordOperationalUpdate', { flightInstanceId: 'not-a-uuid', status: 'CANCELLED' }, { role: 'admin' })).rejects.toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    await expect(call('recordOperationalUpdate', { flightInstanceId: internalErrorId, status: 'CANCELLED' }, { role: 'admin' })).rejects.toMatchObject({ code: 13, details: 'INTERNAL_ERROR' });
    logger.info({ email: 'pii@example.test', documentNumber: 'ABC123456' }, 'security log probe');
    expect(logs.join('')).not.toContain('pii@example.test');
    expect(logs.join('')).not.toContain('ABC123456');
  });
});
