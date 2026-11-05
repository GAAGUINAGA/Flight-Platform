export interface DeadlinePolicy { defaultMs: number; orchestratedMs: number; maxMs: number }

/**
 * Plazo total de una operación: el pedido por el Gateway (acotado a `maxMs`) o, si no pidió ninguno, 5 s por defecto
 * y 30 s en las operaciones orquestadas. Un valor no positivo o no finito se ignora.
 */
export function resolveDeadlineMs(requested: number | undefined, orchestrated: boolean, policy: DeadlinePolicy): number {
  const fallback = orchestrated ? policy.orchestratedMs : policy.defaultMs;
  const wanted = requested !== undefined && Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : fallback;
  return Math.min(wanted, policy.maxMs);
}
