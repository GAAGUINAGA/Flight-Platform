import process from 'node:process';
import pino from 'pino';

/**
 * Registro por lista BLANCA de campos (diseño §7): operationName, correlationId, requestId, role, estado/categoría, latencia y código de error.
 * El tipo no admite nada más: nunca `variables`, el texto de la consulta, `Authorization` ni campos personales (documento, correo, teléfono, nombres, referencia de pago).
 */
export interface LogEntry {
  operationName?: string; correlationId: string; requestId: string; role?: string;
  status: 'ok' | 'error' | 'rejected'; category?: string; code?: string; httpStatus?: number; latencyMs: number; gatewayCalls?: number;
}
export interface AuditLog { record(entry: LogEntry): void }

const WHITELIST: Array<keyof LogEntry> = ['operationName', 'correlationId', 'requestId', 'role', 'status', 'category', 'code', 'httpStatus', 'latencyMs', 'gatewayCalls'];
export class PinoAuditLog implements AuditLog {
  constructor(private readonly logger: pino.Logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'graphql' } })) {}
  record(entry: LogEntry): void {
    const safe: Record<string, unknown> = {}; for (const field of WHITELIST) if (entry[field] !== undefined) safe[field] = entry[field];
    this.logger.info(safe, 'graphql');
  }
}
export const silentLog: AuditLog = { record: () => undefined };
