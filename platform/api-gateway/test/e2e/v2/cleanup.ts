import process from 'node:process';
import type { Stack } from './stack';

/**
 * Limpieza de afterAll que no oculta errores: cada paso se registra en stderr si falla, se sigue con los demás y al final
 * `verify()` lanza un único error (la suite falla) si algún borrado falló o si quedaron vuelos, tarifas o vuelos operativos de la prueba.
 */
export class Cleanup {
  readonly failures: string[] = [];

  async step(label: string, run: () => Promise<unknown> | undefined): Promise<void> {
    try { await run(); } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).split('\n').filter(Boolean).pop() ?? 'error desconocido';
      this.failures.push(`${label}: ${reason}`); process.stderr.write(`LIMPIEZA FALLÓ ${label}: ${reason}\n`);
    }
  }

  /** Cuenta lo que la prueba creó y debió borrar; cualquier resto cuenta como fallo. */
  async leftovers(stack: Stack | undefined, flightIds: string[]): Promise<void> {
    if (!stack || flightIds.length === 0) return;
    await this.step('comprobación de restos', async () => {
      const counts = {
        vuelos: await stack.db.inventory.flightInstance.count({ where: { id: { in: flightIds } } }),
        tarifas: await stack.db.pricing.fare.count({ where: { flightInstanceId: { in: flightIds } } }),
        'vuelos operativos': await stack.db.operations.operationalFlight.count({ where: { flightInstanceId: { in: flightIds } } })
      };
      const left = Object.entries(counts).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`);
      if (left.length > 0) throw new Error(`quedaron datos de la prueba: ${left.join(', ')}`);
    });
  }

  verify(): void {
    if (this.failures.length > 0) throw new Error(`La limpieza de la prueba falló (${this.failures.length}):\n- ${this.failures.join('\n- ')}`);
  }
}
