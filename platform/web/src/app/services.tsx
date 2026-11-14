import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TypedOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { SessionClient, SessionState } from '@flight-platform/session';
import type { AppConfig } from '../config';
import { AppError, toAppError } from '../data/errors';
import type { GraphqlClient } from '../data/graphql-client';
import { newCorrelationId } from '../data/identity';

/** Servicios de la app (configuración, capa de datos y sesión) entregados por contexto: las pantallas no crean clientes. */
export interface Services { config: AppConfig; client: GraphqlClient; session: SessionClient }

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider ausente');
  return services;
}

export function useSession(): SessionState {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

/** Fase del estado de carga amable (diseño §9.1): normal → lenta (>1,5 s) → muy lenta (>8 s). */
export type LoadingPhase = 'normal' | 'slow' | 'very-slow';
export type QueryState<TData> =
  | { status: 'idle' }
  | { status: 'loading'; phase: LoadingPhase }
  | { status: 'error'; error: AppError }
  | { status: 'success'; data: TData };

/**
 * Ejecuta una LECTURA publicada cuando cambia `key` (o al llamar a `reload`). `variables = null` la deja en reposo.
 * Cada `key` es una intención: sus reintentos (automáticos o con «Reintentar») comparten el X-Correlation-Id.
 */
export function useQuery<TData, TVariables>(operation: TypedOperation<TData, TVariables>, variables: TVariables | null, key: string): QueryState<TData> & { reload: () => void } {
  const { client, config } = useServices();
  const [state, setState] = useState<QueryState<TData>>(variables === null ? { status: 'idle' } : { status: 'loading', phase: 'normal' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(variables); latest.current = variables;
  const intent = useRef<{ key: string; correlationId: string } | null>(null);

  useEffect(() => {
    const current = latest.current;
    if (current === null) { setState({ status: 'idle' }); return undefined; }
    if (intent.current?.key !== key) intent.current = { key, correlationId: newCorrelationId() };
    const controller = new AbortController();
    setState({ status: 'loading', phase: 'normal' });
    const slow = setTimeout(() => setState((previous) => (previous.status === 'loading' ? { status: 'loading', phase: 'slow' } : previous)), config.loading.slowMs);
    const verySlow = setTimeout(() => setState((previous) => (previous.status === 'loading' ? { status: 'loading', phase: 'very-slow' } : previous)), config.loading.verySlowMs);
    client.execute(operation, current, { correlationId: intent.current.correlationId, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ status: 'success', data }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: 'error', error: toAppError(error) }); })
      .finally(() => { clearTimeout(slow); clearTimeout(verySlow); });
    return () => { controller.abort(); clearTimeout(slow); clearTimeout(verySlow); };
  }, [client, config.loading.slowMs, config.loading.verySlowMs, operation, key, attempt]);

  return useMemo(() => ({ ...state, reload: () => setAttempt((value) => value + 1) }), [state]);
}
