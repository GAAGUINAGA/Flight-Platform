import { PrismaClient } from '../src/infrastructure/persistence/prisma-client/client';

const prisma = new PrismaClient();
const layout = (aircraft: string, rows: number, businessRows = 0) => Array.from({ length: rows }, (_, index) => {
  const rowNumber = index + 1;
  const cabinClass = rowNumber <= businessRows ? 'BUSINESS' : 'ECONOMY';
  const letters = cabinClass === 'BUSINESS' ? ['A', 'C', 'D', 'F'] : ['A', 'B', 'C', 'D', 'E', 'F'];
  return letters.map((letter) => ({ aircraft, cabinClass, seatNumber: `${rowNumber}${letter}`, rowNumber, characteristics: rowNumber === 12 ? ['EXIT_ROW'] : [], isEmergencyExit: rowNumber === 12 }));
}).flat();

async function main(): Promise<void> {
  await prisma.seatLayout.createMany({ data: [...layout('B787', 30, 5), ...layout('E190', 25, 2), ...layout('A320', 30, 3)], skipDuplicates: true });
}

main().finally(() => prisma.$disconnect());
