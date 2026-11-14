import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TypedOperation } from '@flight-platform/graphql-schema/generated/operations';
import { useServices } from '../app/services';
import { toAppError, type AppError } from '../data/errors';
import { newCorrelationId } from '../data/identity';

export const REFRESH_MS = 30_000;

/** Llama a `refresh` cada `ms` MIENTRAS la pestaña está visible; en segundo plano se pausa y, al volver, refresca de inmediato si pasó el intervalo. */
export function useAutoRefresh(refresh: () => void, ms: number = REFRESH_MS): void {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined; let last = Date.now();
    const tick = (): void => { last = Date.now(); latest.current(); };
    const start = (): void => { if (timer === undefined) timer = setInterval(tick, ms); };
    const stop = (): void => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') { stop(); return; }
      if (Date.now() - last >= ms) tick();
      start();
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [ms]);
}

export interface PageResult<T> { items: T[]; endCursor: string | null; hasNextPage: boolean }
export type Phase = 'loading' | 'ready' | 'error';
export interface PagedList<T> {
  items: T[]; phase: Phase; refreshing: boolean; loadingMore: boolean; error: AppError | null; hasNext: boolean; updatedAt: Date | null;
  loadMore: () => void; reload: () => void;
}

/**
 * Lista con cursor OPACO: cada página se pide con el `endCursor` de la anterior, sin interpretarlo. Con `all` carga todas las páginas (hasta `maxPages`).
 * Al refrescar (misma `key`) conserva lo que ya se ve; al cambiar `key` empieza de cero. Cada carga es una intención con su X-Correlation-Id.
 */
export function usePagedList<T>(fetchPage: (after: string | null, correlationId: string, signal: AbortSignal) => Promise<PageResult<T>>, key: string, options: { all?: boolean; maxPages?: number; enabled?: boolean } = {}): PagedList<T> {
  const { all = false, maxPages = 10, enabled = true } = options;
  const [items, setItems] = useState<T[]>([]); const [phase, setPhase] = useState<Phase>('loading'); const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState<AppError | null>(null); const [hasNext, setHasNext] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null); const [attempt, setAttempt] = useState(0);
  const cursor = useRef<string | null>(null); const generation = useRef(0); const lastKey = useRef(key); const fetcher = useRef(fetchPage); fetcher.current = fetchPage;
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) { setItems([]); setPhase('ready'); setHasNext(false); return undefined; }
    const mine = ++generation.current; const abort = new AbortController(); controller.current = abort;
    const sameKey = lastKey.current === key; lastKey.current = key;
    if (!sameKey) { setItems([]); cursor.current = null; setPhase('loading'); setRefreshing(false); }
    else setRefreshing(true);
    setError(null);
    void (async () => {
      try {
        let collected: T[] = []; let after: string | null = null; let more = false; let next: string | null = null;
        for (let page = 0; page < (all ? maxPages : 1); page += 1) {
          const result = await fetcher.current(after, newCorrelationId(), abort.signal);
          if (mine !== generation.current) return;
          collected = [...collected, ...result.items]; next = result.endCursor; more = result.hasNextPage && Boolean(result.endCursor);
          if (!more) break; after = next;
        }
        if (mine !== generation.current) return;
        cursor.current = next; setItems(collected); setHasNext(more); setPhase('ready'); setUpdatedAt(new Date());
      } catch (failure) {
        if (mine !== generation.current || abort.signal.aborted) return;
        setError(toAppError(failure));
        // Un refresco que falla deja a la vista lo último bueno; una primera carga fallida muestra el error.
        setPhase((previous) => (previous === 'ready' ? 'ready' : 'error'));
      } finally { if (mine === generation.current) setRefreshing(false); }
    })();
    return () => { abort.abort(); };
  }, [key, attempt, all, maxPages, enabled]);

  const loadMore = useCallback((): void => {
    if (!cursor.current || loadingMore) return;
    const mine = ++generation.current; const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setLoadingMore(true); setError(null);
    void (async () => {
      try {
        const result = await fetcher.current(cursor.current, newCorrelationId(), abort.signal);
        if (mine !== generation.current) return;
        cursor.current = result.endCursor; setItems((previous) => [...previous, ...result.items]); setHasNext(result.hasNextPage && Boolean(result.endCursor)); setUpdatedAt(new Date());
      } catch (failure) { if (mine === generation.current && !abort.signal.aborted) setError(toAppError(failure)); }
      finally { if (mine === generation.current) setLoadingMore(false); }
    })();
  }, [loadingMore]);

  const reload = useCallback((): void => setAttempt((value) => value + 1), []);
  return useMemo(() => ({ items, phase, refreshing, loadingMore, error, hasNext, updatedAt, loadMore, reload }), [items, phase, refreshing, loadingMore, error, hasNext, updatedAt, loadMore, reload]);
}

export interface Live<TData> { data: TData | null; loading: boolean; refreshing: boolean; error: AppError | null; reload: () => void }
/** Consulta única que, al refrescar, conserva el último dato bueno (el dashboard no parpadea cada 30 s). */
export function useLiveQuery<TData, TVariables>(operation: TypedOperation<TData, TVariables>, variables: TVariables, key: string, options: { enabled?: boolean } = {}): Live<TData> {
  const { client } = useServices(); const { enabled = true } = options;
  const [data, setData] = useState<TData | null>(null); const [error, setError] = useState<AppError | null>(null); const [loading, setLoading] = useState(enabled); const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0); const latest = useRef(variables); latest.current = variables; const lastKey = useRef(key);
  useEffect(() => {
    if (!enabled) { setData(null); setError(null); setLoading(false); setRefreshing(false); return undefined; }
    const abort = new AbortController(); const sameKey = lastKey.current === key; lastKey.current = key;
    if (!sameKey) { setData(null); setLoading(true); } else setRefreshing(true);
    client.execute(operation, latest.current, { correlationId: newCorrelationId(), signal: abort.signal })
      .then((result) => { if (!abort.signal.aborted) { setData(result); setError(null); } })
      .catch((failure: unknown) => { if (!abort.signal.aborted) setError(toAppError(failure)); })
      .finally(() => { if (!abort.signal.aborted) { setLoading(false); setRefreshing(false); } });
    return () => abort.abort();
  }, [client, operation, key, attempt, enabled]);
  const reload = useCallback((): void => setAttempt((value) => value + 1), []);
  return useMemo(() => ({ data, loading, refreshing, error, reload }), [data, loading, refreshing, error, reload]);
}
