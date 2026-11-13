import { randomUUID } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { execute, GraphQLError, NoSchemaIntrospectionCustomRule, parse, specifiedRules, validate, Kind, type DocumentNode, type ExecutionResult, type GraphQLSchema, type ParseOptions, type ValidationRule } from 'graphql';
import { canonicalText } from '@flight-platform/graphql-schema';
import type { GraphqlConfig } from '../config';
import { PublicError, type ErrorCategory } from '../domain/errors';
import { isSafeCorrelationId, isSafeFingerprint } from '../domain/privacy';
import type { GatewayPort, RequestContext, TokenVerifier } from '../application/ports';
import { type AuditLog } from './audit-log';
import { RateLimiter } from './rate-limit';
import { maxAliasesRule, maxComplexityRule, maxDepthRule } from './security';

export interface AppDeps { config: GraphqlConfig; schema: GraphQLSchema; gateway: GatewayPort; verifier: TokenVerifier; known: Map<string, string>; log: AuditLog; limiter?: RateLimiter }

interface ErrorExtensions { code: string; category: ErrorCategory; httpStatus: number; correlationId: string; retryAfterSeconds: number | null; invalidParams?: Array<{ name: string; reason?: string }> }
const publicErrorJson = (message: string, path: ReadonlyArray<string | number> | undefined, ext: ErrorExtensions): Record<string, unknown> => ({ message, ...(path ? { path } : {}), extensions: { ...ext, ...(ext.invalidParams?.length ? {} : { invalidParams: undefined }) } });
const requestError = (code: string, category: ErrorCategory, httpStatus: number, correlationId: string, message?: string): Record<string, unknown> => {
  const error = new PublicError({ code, category, httpStatus }, message); return publicErrorJson(error.message, undefined, { code, category, httpStatus, correlationId, retryAfterSeconds: null });
};
const DID_YOU_MEAN = /\s*Did you mean[^.?]*\??/g;

/** Convierte lo que devuelve graphql-js en errores públicos: solo `PublicError` conserva su código; cualquier otra cosa sale genérica (sin detalles internos ni valores del usuario). */
function toPublicErrors(errors: ReadonlyArray<GraphQLError>, correlationId: string): Array<Record<string, unknown>> {
  return errors.map((error) => {
    const original = error.originalError;
    if (original instanceof PublicError) return publicErrorJson(original.message, error.path, { code: original.code, category: original.category, httpStatus: original.httpStatus, correlationId, retryAfterSeconds: original.retryAfterSeconds, invalidParams: original.invalidParams });
    if (original) return publicErrorJson(new PublicError({ code: 'INTERNAL_ERROR', category: 'INTERNAL', httpStatus: 500 }).message, error.path, { code: 'INTERNAL_ERROR', category: 'INTERNAL', httpStatus: 500, correlationId, retryAfterSeconds: null });
    // Errores de la propia consulta o de la coerción de variables: su texto puede contener el valor enviado, así que se reemplaza.
    return publicErrorJson(new PublicError({ code: 'GRAPHQL_VALIDATION_FAILED', category: 'VALIDATION', httpStatus: 400 }).message, error.path, { code: 'GRAPHQL_VALIDATION_FAILED', category: 'VALIDATION', httpStatus: 400, correlationId, retryAfterSeconds: null });
  });
}

export function createApp(deps: AppDeps): Express {
  const { config, schema, gateway, verifier, known, log } = deps; const limiter = deps.limiter ?? new RateLimiter();
  const rules: ValidationRule[] = [...specifiedRules, maxDepthRule(config.maxDepth), maxComplexityRule(config.maxComplexity), maxAliasesRule(config.maxAliases), ...(config.introspection ? [] : [NoSchemaIntrospectionCustomRule])];
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 1);

  // Identificadores de la petición: el entrante se conserva si es seguro; si no, se crea. Salen en TODA respuesta.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-correlation-id'); const correlationId = isSafeCorrelationId(incoming) ? incoming : randomUUID();
    res.locals.correlationId = correlationId; res.locals.requestId = randomUUID(); res.locals.startedAt = Date.now();
    res.setHeader('X-Correlation-Id', correlationId); res.setHeader('X-Request-Id', res.locals.requestId as string);
    next();
  });
  app.use(helmet({ strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true } }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (config.production && req.header('x-forwarded-proto') === 'http') { res.status(400).json({ errors: [requestError('GRAPHQL_BAD_REQUEST', 'VALIDATION', 400, res.locals.correlationId as string)] }); return; }
    next();
  });
  app.use(cors({
    origin: (origin, callback) => callback(null, origin !== undefined && config.corsOrigins.includes(origin)),
    methods: ['POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id', 'X-Device-Fingerprint'],
    exposedHeaders: ['X-Correlation-Id', 'X-Request-Id', 'Retry-After'], credentials: false, maxAge: 600
  }));

  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

  app.use('/graphql', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') { next(); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ errors: [requestError('GRAPHQL_BAD_REQUEST', 'VALIDATION', 405, res.locals.correlationId as string)] }); return; }
    next();
  });
  // Primer límite: huella + IP real, antes de leer el cuerpo, para las peticiones SIN sesión. Con Authorization el límite se aplica tras verificar el token:
  // por `sub` si es válido (los usuarios que comparten IP no se pisan) y por huella + IP si no lo es (un token falso no evita el límite).
  app.post('/graphql', (req: Request, res: Response, next: NextFunction) => {
    if (req.header('authorization')) { next(); return; }
    const fingerprint = req.header('x-device-fingerprint'); const wait = limiter.hit(`fp:${isSafeFingerprint(fingerprint) ? fingerprint : '-'}|ip:${req.ip ?? '-'}`, config.rateLimitPerMin);
    if (wait > 0) { res.setHeader('Retry-After', String(wait)); res.status(429).json({ errors: [publicErrorJson(new PublicError({ code: 'RATE_LIMIT_EXCEEDED', category: 'RATE_LIMITED', httpStatus: 429 }).message, undefined, { code: 'RATE_LIMIT_EXCEEDED', category: 'RATE_LIMITED', httpStatus: 429, correlationId: res.locals.correlationId as string, retryAfterSeconds: wait })] }); return; }
    next();
  });
  app.post('/graphql', express.json({ limit: config.maxBodyBytes, type: 'application/json', strict: true }));

  app.post('/graphql', async (req: Request, res: Response) => {
    const correlationId = res.locals.correlationId as string; const requestId = res.locals.requestId as string; const started = res.locals.startedAt as number;
    const reject = (status: number, code: string, category: ErrorCategory, operationName?: string, role?: string): void => {
      log.record({ ...(operationName ? { operationName } : {}), correlationId, requestId, ...(role ? { role } : {}), status: 'rejected', category, code, httpStatus: status, latencyMs: Date.now() - started });
      res.status(status).json({ errors: [requestError(code, category, status, correlationId)] });
    };
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) { reject(400, 'GRAPHQL_BAD_REQUEST', 'VALIDATION'); return; } // sin batching: un arreglo se rechaza
    const { query, operationName, variables } = body as { query?: unknown; operationName?: unknown; variables?: unknown };
    if (typeof query !== 'string' || query.length === 0 || (operationName !== undefined && operationName !== null && typeof operationName !== 'string') || (variables !== undefined && variables !== null && (typeof variables !== 'object' || Array.isArray(variables)))) { reject(400, 'GRAPHQL_BAD_REQUEST', 'VALIDATION'); return; }
    if (variables && JSON.stringify(variables).length > config.maxVariablesBytes) { reject(413, 'PAYLOAD_TOO_LARGE', 'VALIDATION'); return; }

    let document: DocumentNode;
    try { document = parse(query, { maxTokens: 20_000 } as ParseOptions); } catch { reject(400, 'GRAPHQL_PARSE_FAILED', 'VALIDATION'); return; }
    const operations = document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION);
    if (operations.length !== 1) { reject(400, 'GRAPHQL_BAD_REQUEST', 'VALIDATION'); return; } // una operación por documento
    const declaredName = operations[0].kind === Kind.OPERATION_DEFINITION ? operations[0].name?.value : undefined;
    if (operationName && operationName !== declaredName) { reject(400, 'GRAPHQL_BAD_REQUEST', 'VALIDATION'); return; }
    const safeName = declaredName && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(declaredName) ? declaredName : undefined;
    // Solo operaciones conocidas en producción (Q6): el documento canónico debe ser idéntico al publicado.
    if (config.knownOperationsOnly && (!declaredName || known.get(declaredName) !== canonicalText(document))) { reject(403, 'GRAPHQL_OPERATION_NOT_ALLOWED', 'FORBIDDEN'); return; }
    const problems = validate(schema, document, rules);
    if (problems.length > 0) {
      log.record({ ...(safeName ? { operationName: safeName } : {}), correlationId, requestId, status: 'rejected', category: 'VALIDATION', code: 'GRAPHQL_VALIDATION_FAILED', httpStatus: 400, latencyMs: Date.now() - started });
      res.status(400).json({ errors: problems.map((problem) => ({ message: config.production ? problem.message.replace(DID_YOU_MEAN, '') : problem.message, extensions: { code: 'GRAPHQL_VALIDATION_FAILED', category: 'VALIDATION', httpStatus: 400, correlationId, retryAfterSeconds: null } })) }); return;
    }

    // Autenticación: solo un token verificado se usa y se reenvía.
    const header = req.header('authorization'); const rawToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const viewer = rawToken ? await verifier.verify(rawToken) : undefined;
    const context: RequestContext = { gateway, ...(viewer ? { token: rawToken, viewer } : {}), invalidToken: Boolean(header) && !viewer, correlationId, requestId, ...(isSafeFingerprint(req.header('x-device-fingerprint')) ? { fingerprint: req.header('x-device-fingerprint') } : {}), gatewayCalls: 0 };
    if (header) {
      const fingerprint = req.header('x-device-fingerprint');
      const wait = viewer ? limiter.hit(`sub:${viewer.userId}`, config.rateLimitAuthPerMin) : limiter.hit(`fp:${isSafeFingerprint(fingerprint) ? fingerprint : '-'}|ip:${req.ip ?? '-'}`, config.rateLimitPerMin);
      if (wait > 0) { res.setHeader('Retry-After', String(wait)); log.record({ ...(safeName ? { operationName: safeName } : {}), correlationId, requestId, ...(viewer ? { role: viewer.role } : {}), status: 'rejected', category: 'RATE_LIMITED', code: 'RATE_LIMIT_EXCEEDED', httpStatus: 429, latencyMs: Date.now() - started }); res.status(429).json({ errors: [publicErrorJson(new PublicError({ code: 'RATE_LIMIT_EXCEEDED', category: 'RATE_LIMITED', httpStatus: 429 }).message, undefined, { code: 'RATE_LIMIT_EXCEEDED', category: 'RATE_LIMITED', httpStatus: 429, correlationId, retryAfterSeconds: wait })] }); return; }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      Promise.resolve(execute({ schema, document, contextValue: context, variableValues: (variables ?? undefined) as Record<string, unknown> | undefined, operationName: declaredName })),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), config.operationTimeoutMs); })
    ]).catch(() => 'failed' as const).finally(() => { if (timer) clearTimeout(timer); });
    if (outcome === 'timeout' || outcome === 'failed') {
      const code = outcome === 'timeout' ? 'GRAPHQL_TIMEOUT' : 'INTERNAL_ERROR'; const category: ErrorCategory = outcome === 'timeout' ? 'UNAVAILABLE' : 'INTERNAL';
      log.record({ ...(safeName ? { operationName: safeName } : {}), correlationId, requestId, ...(viewer ? { role: viewer.role } : {}), status: 'error', category, code, httpStatus: outcome === 'timeout' ? 504 : 500, latencyMs: Date.now() - started, gatewayCalls: context.gatewayCalls });
      res.status(outcome === 'timeout' ? 504 : 500).json({ errors: [requestError(code, category, outcome === 'timeout' ? 504 : 500, correlationId)] }); return;
    }
    const result = outcome as ExecutionResult; const errors = result.errors ? toPublicErrors(result.errors, correlationId) : undefined;
    const first = errors?.[0]?.extensions as ErrorExtensions | undefined;
    log.record({ ...(safeName ? { operationName: safeName } : {}), correlationId, requestId, ...(viewer ? { role: viewer.role } : {}), status: errors ? 'error' : 'ok', ...(first ? { category: first.category, code: first.code, httpStatus: first.httpStatus } : {}), latencyMs: Date.now() - started, gatewayCalls: context.gatewayCalls });
    if (first?.retryAfterSeconds) res.setHeader('Retry-After', String(first.retryAfterSeconds));
    res.status(200).json({ ...(result.data !== undefined ? { data: result.data } : { data: null }), ...(errors ? { errors } : {}) });
  });

  // Errores de la capa HTTP (cuerpo demasiado grande, JSON inválido): respuesta propia, sin detalles internos.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next; const correlationId = res.locals.correlationId as string; const type = (error as { type?: string } | undefined)?.type;
    if (type === 'entity.too.large') { res.status(413).json({ errors: [requestError('PAYLOAD_TOO_LARGE', 'VALIDATION', 413, correlationId)] }); return; }
    if (type === 'entity.parse.failed' || type === 'charset.unsupported' || type === 'encoding.unsupported') { res.status(400).json({ errors: [requestError('GRAPHQL_BAD_REQUEST', 'VALIDATION', 400, correlationId)] }); return; }
    res.status(500).json({ errors: [requestError('INTERNAL_ERROR', 'INTERNAL', 500, correlationId)] });
  });
  app.use((_req: Request, res: Response) => { res.status(404).json({ errors: [requestError('NOT_FOUND', 'NOT_FOUND', 404, res.locals.correlationId as string)] }); });
  return app;
}
