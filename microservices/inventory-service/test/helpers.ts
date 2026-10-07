import { expect } from '@jest/globals';
/* global __dirname */
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Writable } from 'node:stream';
import { credentials, loadPackageDefinition, Metadata, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { INestMicroservice } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Clock } from '@flight-platform/shared';
import { createInventoryServer, createLogger, findProtoRoot } from '../src/infrastructure/grpc/server';
import { EventPublisher, PublicEvent } from '../src/application/ports';

export class MutableClock implements Clock {
  private offsetMs = 0;
  now(): Date { return new Date(Date.now() + this.offsetMs); }
  advanceMinutes(minutes: number): void { this.offsetMs += minutes * 60_000; }
}

export class RecordingPublisher implements EventPublisher {
  readonly events: PublicEvent[] = [];
  async publish(event: PublicEvent): Promise<void> { this.events.push(event); }
}

export function loadEnv(): void {
  const file = join(__dirname, '..', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export interface Harness {
  prisma: PrismaClient;
  clock: MutableClock;
  events: RecordingPublisher;
  key: string;
  logs: string[];
  call<T = Record<string, unknown>>(method: string, request: unknown, meta?: Record<string, string> | null): Promise<T>;
  close(): Promise<void>;
}

export const INTERNAL_KEY = 'k'.repeat(40);
// Cada archivo de prueba usa sus propios prefijos para poder correr en paralelo sin borrarse datos.
const RUN = randomUUID().slice(0, 8);
const OWNER_PREFIX = `test-owner-${RUN}-`;
const SUITES: [string, string][] = [['flights', 'Z1'], ['holds', 'Z2'], ['concurrency', 'Z3'], ['security', 'Z4']];
const flightPrefix = (): string => {
  const path = expect.getState().testPath ?? '';
  return SUITES.find(([name]) => path.includes(name))?.[1] ?? 'Z9';
};
export const ownerId = (): string => `${OWNER_PREFIX}${randomUUID()}`;

/** Levanta un servidor gRPC real en un puerto libre contra la base local. `meta: null` = sin llave interna. */
export async function startHarness(opts: { prisma?: PrismaClient } = {}): Promise<Harness> {
  loadEnv();
  const prisma = opts.prisma ?? new PrismaClient();
  const clock = new MutableClock();
  const events = new RecordingPublisher();
  const logs: string[] = [];
  const sink = new Writable({ write(chunk, _enc, cb) { logs.push(String(chunk)); cb(); } });
  const logger = createLogger(sink);
  logger.level = 'debug';
  const port = 20000 + Math.floor(Math.random() * 20000);
  const app: INestMicroservice = await createInventoryServer({
    url: `127.0.0.1:${port}`, internalApiKey: INTERNAL_KEY, logger,
    runtime: { prisma, clock, events, config: { holdTtlMinutes: 20, airlineCode: 'FP' } }
  });
  await app.listen();

  const root = findProtoRoot();
  const def = loadSync(join(root, 'flightplatform/inventory/v1/inventory.proto'), {
    includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true
  });
  const pkg = loadPackageDefinition(def) as unknown as {
    flightplatform: { inventory: { v1: { InventoryService: new (a: string, c: unknown) => Record<string, (...args: unknown[]) => void> } } };
  };
  const client = new pkg.flightplatform.inventory.v1.InventoryService(`127.0.0.1:${port}`, credentials.createInsecure());

  return {
    prisma, clock, events, key: INTERNAL_KEY, logs,
    call<T>(method: string, request: unknown, meta: Record<string, string> | null = { 'x-role': 'customer' }): Promise<T> {
      const md = new Metadata();
      if (meta) {
        md.set('x-internal-key', INTERNAL_KEY);
        for (const [k, v] of Object.entries(meta)) md.set(k, v);
      }
      return new Promise((resolve, reject) => {
        client[method](request, md, (err: ServiceError | null, res: T) => (err ? reject(err) : resolve(res)));
      });
    },
    async close() {
      await app.close();
      await prisma.$disconnect();
    }
  };
}

/** Elimina lo creado por esta suite (vuelos con su prefijo y holds de sus owners). */
export async function cleanup(prisma: PrismaClient): Promise<void> {
  await prisma.reservedInventory.deleteMany({ where: { ownerId: { startsWith: OWNER_PREFIX } } });
  await prisma.hold.deleteMany({ where: { ownerId: { startsWith: OWNER_PREFIX } } });
  await prisma.flightInstance.deleteMany({ where: { flightNumber: { startsWith: flightPrefix() } } });
}

export const ADMIN = { 'x-role': 'admin' };
export const SYSTEM = { 'x-role': 'system' };

let counter = 0;
/** Crea un vuelo de prueba (prefijo de la suite + 4 d?gitos) a 30 d?as con la capacidad indicada y devuelve su id. */
export async function createFlight(h: Harness, economy: number, extra: { cabin: string; capacity: number }[] = []): Promise<string> {
  const departureAt = new Date(Date.now() + 30 * 86_400_000 + (counter++) * 60_000);
  const res = await h.call<{ flightInstanceId: string }>('UpsertFlightInstance', {
    flightNumber: `${flightPrefix()}${1000 + Math.floor(Math.random() * 8999)}`,
    departureIata: 'UIO', arrivalIata: 'GYE',
    departureAt: departureAt.toISOString(), arrivalAt: new Date(departureAt.getTime() + 3_300_000).toISOString(),
    cabins: [{ cabinClass: 'ECONOMY', capacity: economy }, ...extra.map((e) => ({ cabinClass: e.cabin, capacity: e.capacity }))],
    aircraft: 'E190'
  }, ADMIN);
  return res.flightInstanceId;
}

export const holdRequest = (owner: string, flightInstanceId: string, seats: number, key = randomUUID(), cabinClass = 'ECONOMY') => ({
  ownerId: owner, idempotencyKey: key, segments: [{ flightInstanceId, cabinClass, seats }]
});

export async function capacity(prisma: PrismaClient, flightInstanceId: string, cabin = 'ECONOMY') {
  return prisma.cabinInventory.findUniqueOrThrow({ where: { flightInstanceId_cabinClass: { flightInstanceId, cabinClass: cabin } } });
}

/** Hold que vence en ~1,2 s reales (evita adelantar relojes y mantiene las suites independientes). */
export const shortHold = (owner: string, flightInstanceId: string, seats: number) => ({
  ...holdRequest(owner, flightInstanceId, seats),
  expiresAt: new Date(Date.now() + 1200).toISOString()
});
export const sleepPastExpiry = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1400));
