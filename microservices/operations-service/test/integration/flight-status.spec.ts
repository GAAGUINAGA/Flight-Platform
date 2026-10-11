import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { parse } from 'yaml';
import { INestMicroservice } from '@nestjs/common';
import { PrismaClient } from '../../src/infrastructure/persistence/prisma-client/client';
import { createOperationsServer, findProtoRoot } from '../../src/infrastructure/grpc/server';

const key = 'o'.repeat(40);
const flightInstanceId = randomUUID();
const flightNumber = 'FP601';
const date = '2026-12-01';
const openapi = parse(readFileSync(join(process.cwd(), 'contracts/openapi/vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> } };
const validateFlightStatus = (value: unknown) => {
  const ajv = new Ajv({ strict: false, formats: { date: /^\d{4}-\d{2}-\d{2}$/, 'date-time': /^\d{4}-\d{2}-\d{2}T.+Z$/ } });
  expect(ajv.compile({ ...openapi.components.schemas.FlightStatus, components: openapi.components })(value)).toBe(true);
};
type Client = { getFlightStatus(request: unknown, metadata: Metadata, callback: (error: ServiceError | null, response: unknown) => void): void; close?: () => void };

describe('OPS-04: GetFlightStatus', () => {
  let prisma: PrismaClient;
  let app: INestMicroservice;
  let client: Client;
  const call = <T>(request: unknown) => new Promise<T>((resolve, reject) => {
    const metadata = new Metadata();
    metadata.set('x-internal-key', key);
    metadata.set('x-correlation-id', 'ops-04-integration');
    client.getFlightStatus(request, metadata, (error, response) => error ? reject(error) : resolve(response as T));
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Operations integration tests');
    prisma = new PrismaClient();
    await prisma.$connect();
    const port = 31000 + Math.floor(Math.random() * 1000);
    app = await createOperationsServer({
      url: `127.0.0.1:${port}`,
      internalApiKey: key,
      runtime: {
        prisma,
        inventory: {
          findFlight: async () => ({ flightInstanceId, flightNumber, departure: { iataCode: 'UIO', at: `${date}T10:00:00.000Z` }, arrival: { iataCode: 'BOG', at: `${date}T11:30:00.000Z` }, marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'E190' }),
          closeFlightInstance: async () => undefined
        }
      }
    });
    await app.listen();
    const root = findProtoRoot();
    const definition = loadSync(join(root, 'flightplatform/operations/v1/operations.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { operations: { v1: { OperationsService: new (address: string, channelCredentials: unknown) => Client } } } };
    client = new pkg.flightplatform.operations.v1.OperationsService(`127.0.0.1:${port}`, credentials.createInsecure());
  });

  afterAll(async () => {
    try { await prisma?.operationalFlight.deleteMany({ where: { flightInstanceId } }); }
    finally { client?.close?.(); await app?.close(); await prisma?.$disconnect(); }
  });

  it('OPS-04 / I / K: crea perezosamente y devuelve un FlightStatus conforme al OpenAPI', async () => {
    const response = await call<Record<string, unknown>>({ flightNumber, date });
    expect(response).toMatchObject({ flightNumber, date, status: 'SCHEDULED', departure: { iataCode: 'UIO', scheduledAt: `${date}T10:00:00.000Z` } });
    expect(await prisma.operationalFlight.findUnique({ where: { flightInstanceId } })).toMatchObject({ flightNumber, status: 'SCHEDULED' });
    validateFlightStatus(response);
  });
});
