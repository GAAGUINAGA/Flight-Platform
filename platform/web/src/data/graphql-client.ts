import type { TypedOperation } from '@flight-platform/graphql-schema/generated/operations';
import { AppError, CLIENT_CODES, isCategory, isTransient, type ErrorCategory, type InvalidParam } from './errors';
import { newCorrelationId } from './identity';

/**
 * ÚNICA puerta de la app hacia el backend: todas las pantallas pasan por aquí y solo se llama al servicio GraphQL
 * (nunca al Gateway). Envía las operaciones publicadas en `@flight-platform/graphql-schema` con su texto canónico.
 * Sin React ni DOM más allá de `fetch`: la app móvil puede reutilizarla.
 */
export interface GraphqlClientOptions {
  url: string;
  getAccessToken: () => Promise<string | null>;
  deviceId: () => string;
  /** Tiempo máximo TOTAL de una operación, incluidos sus reintentos. */
  timeoutMs: number;
  retry: { max: number; baseDelayMs: number };
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Se envió un token y el servicio respondió UNAUTHENTICATED: la sesión ya no vale. */
  onSessionRejected?: () => void;
}

export interface ExecuteOptions {
  /** Identificador de la intención de negocio (§6.5). Si falta, la operación es su propia intención. */
  correlationId?: string;
  signal?: AbortSignal;
}

export interface GraphqlClient {
  execute<TData, TVariables>(operation: TypedOperation<TData, TVariables>, variables: TVariables, options?: ExecuteOptions): Promise<TData>;
}

interface ErrorExtensions { category?: unknown; code?: unknown; correlationId?: unknown; retryAfterSeconds?: unknown; invalidParams?: unknown; httpStatus?: unknown }

const SAFE_NAME = /^[A-Za-z0-9_.[\]-]{1,100}$/;
function invalidParams(value: unknown): InvalidParam[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const { name, reason } = (entry ?? {}) as { name?: unknown; reason?: unknown };
    return typeof name === 'string' && SAFE_NAME.test(name) ? [{ name, ...(typeof reason === 'string' ? { reason: reason.slice(0, 160) } : {}) }] : [];
  });
}

const seconds = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
};

function categoryForStatus(status: number): ErrorCategory {
  if (status === 400 || status === 413) return 'VALIDATION';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502 || status === 503 || status === 504) return 'UNAVAILABLE';
  return 'INTERNAL';
}

const DEFAULT_CODE: Readonly<Record<ErrorCategory, string>> = {
  VALIDATION: 'VALIDATION_FAILED', UNAUTHENTICATED: 'UNAUTHENTICATED', FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'UNKNOWN_GATEWAY_ERROR', GONE: 'UNKNOWN_GATEWAY_ERROR',
  UNPROCESSABLE: 'UNKNOWN_GATEWAY_ERROR', RATE_LIMITED: 'RATE_LIMIT_EXCEEDED', UNAVAILABLE: 'PROVIDER_UNAVAILABLE', INTERNAL: 'INTERNAL_ERROR'
};

export function createGraphqlClient(options: GraphqlClientOptions): GraphqlClient {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

  async function attempt<TData>(operation: TypedOperation<TData, unknown>, variables: unknown, correlationId: string, token: string | null, signal: AbortSignal): Promise<TData> {
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
          'X-Device-Fingerprint': options.deviceId(),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ query: operation.text, operationName: operation.name, variables: variables ?? {} }),
        credentials: 'omit', // el token va en la cabecera; nunca cookies
        signal
      });
    } catch {
      throw new AppError({ category: 'UNAVAILABLE', code: signal.aborted ? CLIENT_CODES.timeout : CLIENT_CODES.network, correlationId });
    }
    const echoed = response.headers.get('X-Correlation-Id') ?? correlationId;
    let body: { data?: unknown; errors?: Array<{ extensions?: ErrorExtensions }> } | undefined;
    try { body = await response.json() as typeof body; } catch { body = undefined; }

    const first = body?.errors?.[0];
    if (first || !response.ok || !body || typeof body !== 'object') {
      const extensions = first?.extensions ?? {};
      const category = isCategory(extensions.category) ? extensions.category : response.ok ? 'INTERNAL' : categoryForStatus(response.status);
      const code = typeof extensions.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(extensions.code) ? extensions.code : response.ok && !first ? CLIENT_CODES.badResponse : DEFAULT_CODE[category];
      throw new AppError({
        category, code,
        correlationId: typeof extensions.correlationId === 'string' ? extensions.correlationId : echoed,
        retryAfterSeconds: seconds(extensions.retryAfterSeconds) ?? seconds(response.headers.get('Retry-After')),
        invalidParams: invalidParams(extensions.invalidParams),
        httpStatus: seconds(extensions.httpStatus) ?? response.status
      });
    }
    if (body.data === null || body.data === undefined) throw new AppError({ category: 'INTERNAL', code: CLIENT_CODES.badResponse, correlationId: echoed });
    return body.data as TData;
  }

  return {
    async execute<TData, TVariables>(operation: TypedOperation<TData, TVariables>, variables: TVariables, execute: ExecuteOptions = {}): Promise<TData> {
      const correlationId = execute.correlationId ?? newCorrelationId();
      const controller = new AbortController();
      const cancel = (): void => controller.abort();
      if (execute.signal?.aborted) cancel(); else execute.signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, options.timeoutMs);
      try {
        const token = await options.getAccessToken();
        // Las lecturas se reintentan con retroceso exponencial ante indisponibilidad; las mutaciones NUNCA (se ofrece «Reintentar» con la misma clave).
        const maxRetries = operation.kind === 'query' ? options.retry.max : 0;
        for (let retries = 0; ; retries += 1) {
          try {
            return await attempt(operation as TypedOperation<TData, unknown>, variables, correlationId, token, controller.signal);
          } catch (error) {
            if (execute.signal?.aborted) throw error;
            if (error instanceof AppError && error.category === 'UNAUTHENTICATED' && token) options.onSessionRejected?.();
            if (!isTransient(error) || retries >= maxRetries || controller.signal.aborted) throw error;
            await sleep(options.retry.baseDelayMs * 2 ** retries);
            if (controller.signal.aborted) throw error;
          }
        }
      } finally {
        clearTimeout(timer);
        execute.signal?.removeEventListener('abort', cancel);
      }
    }
  };
}
