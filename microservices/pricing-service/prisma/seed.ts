import { createHash } from 'node:crypto';
import process from 'node:process';
import { PrismaClient } from '../src/infrastructure/persistence/prisma-client/client';

type FareSeed = { flightInstanceId: string; cabinClass: string; brand: string; baseFareMinor: number; taxesMinor: number; rules: object; baggage: object; extraBagMinor: number };
interface Route { from: string; to: string; aircraft: string; departures: string[]; number: number }

// Debe permanecer en paralelo con Inventory: las instancias se identifican con el mismo UUID determinista.
const ROUTES: Route[] = [
  { from: 'UIO', to: 'GYE', aircraft: 'E190', departures: ['13:00', '22:00'], number: 100 },
  { from: 'UIO', to: 'BOG', aircraft: 'A320', departures: ['14:30'], number: 200 },
  { from: 'UIO', to: 'LIM', aircraft: 'A320', departures: ['15:15'], number: 300 },
  { from: 'BOG', to: 'MIA', aircraft: 'A320', departures: ['11:00'], number: 400 },
  { from: 'LIM', to: 'MAD', aircraft: 'B787', departures: ['01:30'], number: 500 },
  { from: 'GYE', to: 'MIA', aircraft: 'A320', departures: ['12:00'], number: 600 }
];
const DAYS = 60;

function stableId(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function rowsForFlight(flightInstanceId: string, route: Route): FareSeed[] {
  const longHaul = route.from === 'LIM' && route.to === 'MAD';
  const economyBase = longHaul ? 80_000 : 18_000;
  const economyTaxes = longHaul ? 18_000 : 4_500;
  return [
    { flightInstanceId, cabinClass: 'ECONOMY', brand: 'BASIC', baseFareMinor: economyBase, taxesMinor: economyTaxes, rules: { changeable: false, refundable: false }, baggage: { checkedBags: 0 }, extraBagMinor: 6_000 },
    { flightInstanceId, cabinClass: 'ECONOMY', brand: 'CLASSIC', baseFareMinor: economyBase + 8_000, taxesMinor: economyTaxes, rules: { changeable: true, refundable: false }, baggage: { checkedBags: 1 }, extraBagMinor: 5_000 },
    { flightInstanceId, cabinClass: 'BUSINESS', brand: 'FLEX', baseFareMinor: economyBase * 3, taxesMinor: economyTaxes * 2, rules: { changeable: true, refundable: true }, baggage: { checkedBags: 2 }, extraBagMinor: 4_000 }
  ];
}

/** PRC-03: tres brands por cada instancia/ruta del seed de Inventory y multiplicadores por pasajero en rules. */
export async function seed(prisma: PrismaClient, airline = process.env.AIRLINE_CODE ?? 'FP', now = new Date()): Promise<number> {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const fares: FareSeed[] = [];
  for (let day = 0; day < DAYS; day++) {
    for (const route of ROUTES) {
      route.departures.forEach((time, index) => {
        const [hour, minute] = time.split(':').map(Number);
        const departureAt = new Date(today + day * 86_400_000 + (hour * 60 + minute) * 60_000);
        if (departureAt <= now) return;
        for (const leg of [{ from: route.from, to: route.to, number: route.number + index * 2 }, { from: route.to, to: route.from, number: route.number + index * 2 + 1 }]) {
          const flightNumber = `${airline}${leg.number}`;
          const flightInstanceId = stableId(`${flightNumber}|${departureAt.toISOString()}`);
          fares.push(...rowsForFlight(flightInstanceId, { ...route, from: leg.from, to: leg.to }));
        }
      });
    }
  }
  // El seed es inmutable: la clave única permite que se ejecute repetidamente sin
  // reiniciar cambios administrativos posteriores ni hacer miles de round-trips.
  await prisma.fare.createMany({ data: fares, skipDuplicates: true });
  return fares.length;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try { process.stdout.write(`seed: ${await seed(prisma)} fares ensured\n`); }
  finally { await prisma.$disconnect(); }
}

if (process.argv[1]?.endsWith('seed.ts')) void main();
