import { Logger } from '@nestjs/common';
import { DomainError } from '@flight-platform/shared';

/**
 * Un paso de compensación que falla no debe reemplazar el error original (la causa): se registra aparte, solo con el paso y un código acotado
 * (sin datos personales), y se sigue con los demás pasos.
 */
export async function compensate(scope: string, step: string, operation: () => Promise<unknown>): Promise<void> {
  try { await operation(); } catch (failure) {
    const code = typeof failure === 'object' && failure !== null ? (failure as { code?: unknown; details?: unknown }) : {};
    const detail = failure instanceof DomainError ? failure.code : typeof code.details === 'string' && /^[A-Z_]{3,64}$/.test(code.details) ? code.details : 'UNKNOWN';
    new Logger(scope).error(`compensation step=${step} failed code=${typeof code.code === 'number' ? code.code : 'n/a'} details=${detail}`);
  }
}
