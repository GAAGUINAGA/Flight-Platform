export const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const createPnr = (random: () => number = Math.random): string => Array.from({ length: 6 }, () => PNR_ALPHABET[Math.floor(random() * PNR_ALPHABET.length)]).join('');
export async function generatePnr(exists: (pnr: string) => Promise<boolean>, random: () => number = Math.random, attempts = 10): Promise<string> {
  for (let index = 0; index < attempts; index += 1) { const pnr = createPnr(random); if (!await exists(pnr)) return pnr; }
  throw new Error('PNR_CREATION_FAILED');
}
