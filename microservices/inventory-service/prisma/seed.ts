import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { Prisma, PrismaClient } from '@prisma/client';

type Cabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

// Tres tipos de aeronave (INV-03).
const AIRCRAFT: Record<string, { cabins: Record<string, number> }> = {
  E190: { cabins: { ECONOMY: 96, BUSINESS: 8 } },
  A320: { cabins: { ECONOMY: 150, BUSINESS: 12 } },
  B787: { cabins: { ECONOMY: 210, PREMIUM_ECONOMY: 28, BUSINESS: 30, FIRST: 8 } }
};

interface Route { from: string; to: string; minutes: number; aircraft: string; departures: string[]; number: number }

// Cada ruta se opera en ambos sentidos; el n?mero de vuelo de regreso es +1.
const ROUTES: Route[] = [
  { from: 'UIO', to: 'GYE', minutes: 55, aircraft: 'E190', departures: ['13:00', '22:00'], number: 100 },
  { from: 'UIO', to: 'BOG', minutes: 90, aircraft: 'A320', departures: ['14:30'], number: 200 },
  { from: 'UIO', to: 'LIM', minutes: 120, aircraft: 'A320', departures: ['15:15'], number: 300 },
  { from: 'BOG', to: 'MIA', minutes: 200, aircraft: 'A320', departures: ['11:00'], number: 400 },
  { from: 'LIM', to: 'MAD', minutes: 700, aircraft: 'B787', departures: ['01:30'], number: 500 },
  { from: 'GYE', to: 'MIA', minutes: 195, aircraft: 'A320', departures: ['12:00'], number: 600 }
];

const DAYS = 60;

/** UUID determinista: el seed es idempotente y no reinicia held/sold. */
function stableId(key: string): string {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function seed(prisma: PrismaClient, airline = process.env.AIRLINE_CODE ?? 'FP', now = new Date()): Promise<number> {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const flights: Prisma.FlightInstanceCreateManyInput[] = [];
  const cabins: { flightInstanceId: string; cabinClass: Cabin; sellable: number }[] = [];
  for (let day = 0; day < DAYS; day++) {
    for (const route of ROUTES) {
      route.departures.forEach((time, i) => {
        const [hh, mm] = time.split(':').map(Number);
        const departureAt = new Date(today + day * 86_400_000 + (hh * 60 + mm) * 60_000);
        if (departureAt <= now) return;
        for (const leg of [{ from: route.from, to: route.to, n: route.number + i * 2 }, { from: route.to, to: route.from, n: route.number + i * 2 + 1 }]) {
          const flightNumber = `${airline}${leg.n}`;
          const id = stableId(`${flightNumber}|${departureAt.toISOString()}`);
          flights.push({
            id, flightNumber, departureIata: leg.from, arrivalIata: leg.to, departureAt,
            arrivalAt: new Date(departureAt.getTime() + route.minutes * 60_000), aircraft: route.aircraft
          });
          for (const [cabinClass, sellable] of Object.entries(AIRCRAFT[route.aircraft].cabins)) {
            cabins.push({ flightInstanceId: id, cabinClass: cabinClass as Cabin, sellable });
          }
        }
      });
    }
  }
  await prisma.flightInstance.createMany({ data: flights, skipDuplicates: true });
  await prisma.cabinInventory.createMany({ data: cabins, skipDuplicates: true });
  return flights.length;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const prisma = new PrismaClient();
  try {
    const count = await seed(prisma);
    process.stdout.write(`seed: ${count} flight instances ensured\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('seed.ts')) void main();
