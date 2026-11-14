import { useRef, useState } from 'react';
import { usePurchase } from '../app/services';
import { toAppError, type AppError } from '../data/errors';
import { runIntent, type Intent } from '../purchase/intent';

/**
 * Ejecuta UNA acción de postventa con su intención: nueva Idempotency-Key y nuevo X-Correlation-Id por acción; un reintento de la
 * misma acción con los mismos datos reutiliza ambos. Un doble clic mientras se ejecuta no la repite.
 */
export function useAction(): { busy: boolean; error: AppError | null; intent: Intent | null; clearError: () => void; run: <T>(action: string, signature: string, execute: (intent: Intent) => Promise<T>) => Promise<T | undefined> } {
  const { store } = usePurchase();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<AppError | null>(null); const [intent, setIntent] = useState<Intent | null>(null); const lock = useRef(false);
  const run = async <T,>(action: string, signature: string, execute: (intent: Intent) => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true); setError(null);
    try { return await runIntent(store.intents, action, signature, (current) => { setIntent(current); return execute(current); }); }
    catch (failure) { setError(toAppError(failure)); return undefined; }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, intent, clearError: () => setError(null), run };
}
