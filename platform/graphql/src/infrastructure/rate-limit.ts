/**
 * Límite propio en memoria (por instancia): combina X-Device-Fingerprint con la IP real (la que fija el balanceador; `trust proxy` = 1) y, ya autenticado, el `sub`.
 * RIESGO CONOCIDO (diseño §7): la huella la genera el cliente y puede cambiarse; quien comparte IP comparte cupo; el límite no es global entre instancias.
 * Es contención de abuso, no una barrera de seguridad: la barrera sigue siendo el Gateway (límite por `sub`) y los topes por usuario.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  /** `retryAfterSeconds` > 0 si se excedió; `0` si pasa. */
  hit(key: string, limit: number): number {
    const now = this.now(); const current = this.windows.get(key);
    const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
    state.count += 1; this.windows.set(key, state);
    if (this.windows.size > 10_000) for (const [name, value] of this.windows) if (value.resetAt <= now) this.windows.delete(name);
    return state.count > limit ? Math.max(1, Math.ceil((state.resetAt - now) / 1000)) : 0;
  }
}
