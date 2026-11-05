import process from 'node:process';
import type { OperationLogEntry, OperationLogger } from '../../application/ports';

/**
 * Una línea JSON por operación (formato que Cloud Run entiende: `severity`, `message`). Solo nombre, resultado, código y latencia:
 * nunca `input`, identidad, llave ni mensajes del servicio. Preparado para la telemetría de F12d.
 */
export class JsonOperationLogger implements OperationLogger {
  constructor(private readonly write: (line: string) => void = (line) => { process.stdout.write(line); }) {}
  record(entry: OperationLogEntry): void {
    this.write(`${JSON.stringify({ severity: entry.outcome === 'ok' ? 'INFO' : 'WARNING', message: 'esb operation', ...entry })}\n`);
  }
}
