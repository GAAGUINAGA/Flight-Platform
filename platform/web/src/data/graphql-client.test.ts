import { describe, expect, it, vi } from 'vitest';
import { knownOperations } from '@flight-platform/graphql-schema';
import { FlightStatusOperation, HoldOfferOperation, SearchFlightsOperation } from '@flight-platform/graphql-schema/generated/operations';
import { AppError } from './errors';
import { createGraphqlClient, type GraphqlClientOptions } from './graphql-client';
import { deviceIdProvider, memoryStore } from './identity';

const URL_ = 'https://graphql.test/graphql';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface Sent { url: string; headers: Record<string, string>; body: { query: string; operationName: string; variables: unknown }; credentials?: string }
type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string } | 'network' | 'hang';

function harness(replies: Reply[], overrides: Partial<GraphqlClientOptions> = {}) {
  const sent: Sent[] = []; const sleeps: number[] = [];
  const fetchFake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) as Sent['body'], credentials: init?.credentials });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (reply === 'network') throw new TypeError('Failed to fetch');
    if (reply === 'hang') return new Promise<Response>((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
    return new Response(reply.raw ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } });
  });
  const client = createGraphqlClient({
    url: URL_, getAccessToken: async () => null, deviceId: deviceIdProvider(memoryStore()), timeoutMs: 25_000, retry: { max: 3, baseDelayMs: 500 },
    fetch: fetchFake as unknown as typeof fetch, sleep: async (ms) => { sleeps.push(ms); }, ...overrides
  });
  return { client, sent, sleeps };
}
const gqlError = (extensions: Record<string, unknown>, status = 200): Reply => ({ status, body: { data: null, errors: [{ message: 'texto del servidor', extensions }] } });
const searchVars = { input: { itineraries: [{ origin: 'UIO', destination: 'GPS', departureDate: '2026-12-10' }], passengers: { adults: 1 } } };
const holdVars = { input: { offerId: 'of-1', selections: [], passengers: { adults: 1 } }, idempotencyKey: 'k-1' };
const caught = async (promise: Promise<unknown>): Promise<AppError> => { try { await promise; } catch (error) { return error as AppError; } throw new Error('se esperaba un error'); };

describe('capa de acceso a datos · cliente GraphQL', () => {
  it('DAT-01 envía la operación publicada con su texto canónico, POST JSON, sin cookies, a la URL de GraphQL', async () => {
    const { client, sent } = harness([{ body: { data: { searchFlights: { totalOffers: 0, offers: [] } } } }]);
    const data = await client.execute(SearchFlightsOperation, searchVars);
    expect(data.searchFlights.totalOffers).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(URL_);
    expect(sent[0].body.operationName).toBe('SearchFlights');
    expect(sent[0].body.query).toBe(knownOperations().get('SearchFlights'));
    expect(sent[0].body.variables).toEqual(searchVars);
    expect(sent[0].headers['content-type']).toBe('application/json');
    expect(sent[0].credentials).toBe('omit');
  });

  it('DAT-02 X-Device-Fingerprint: un UUID aleatorio, estable entre peticiones y guardado en el dispositivo', async () => {
    const store = memoryStore();
    const first = harness([{ body: { data: {} } }], { deviceId: deviceIdProvider(store) });
    await first.client.execute(SearchFlightsOperation, searchVars); await first.client.execute(SearchFlightsOperation, searchVars);
    const id = first.sent[0].headers['x-device-fingerprint'];
    expect(id).toMatch(UUID);
    expect(first.sent[1].headers['x-device-fingerprint']).toBe(id);
    expect(store.getItem('fp.device')).toBe(id);
    // Otra visita con el mismo almacenamiento conserva el identificador; un valor manipulado se reemplaza.
    const again = harness([{ body: { data: {} } }], { deviceId: deviceIdProvider(store) });
    await again.client.execute(SearchFlightsOperation, searchVars);
    expect(again.sent[0].headers['x-device-fingerprint']).toBe(id);
    store.setItem('fp.device', '<script>');
    expect(deviceIdProvider(store)()).toMatch(UUID);
  });

  it('DAT-03 X-Correlation-Id por intención: el indicado viaja tal cual; sin indicarlo, cada operación genera el suyo', async () => {
    const { client, sent } = harness([{ body: { data: {} } }]);
    await client.execute(SearchFlightsOperation, searchVars, { correlationId: 'compra-123' });
    await client.execute(HoldOfferOperation, holdVars, { correlationId: 'compra-123' });
    await client.execute(SearchFlightsOperation, searchVars);
    await client.execute(SearchFlightsOperation, searchVars);
    expect(sent[0].headers['x-correlation-id']).toBe('compra-123');
    expect(sent[1].headers['x-correlation-id']).toBe('compra-123');
    expect(sent[2].headers['x-correlation-id']).toMatch(UUID);
    expect(sent[3].headers['x-correlation-id']).not.toBe(sent[2].headers['x-correlation-id']);
  });

  it('DAT-04 con sesión envía Authorization: Bearer; sin sesión no envía la cabecera', async () => {
    const anonymous = harness([{ body: { data: {} } }]);
    await anonymous.client.execute(SearchFlightsOperation, searchVars);
    expect(anonymous.sent[0].headers.authorization).toBeUndefined();
    const signed = harness([{ body: { data: {} } }], { getAccessToken: async () => 'jwt-de-prueba' });
    await signed.client.execute(SearchFlightsOperation, searchVars);
    expect(signed.sent[0].headers.authorization).toBe('Bearer jwt-de-prueba');
  });

  it('DAT-05 un error del servicio llega con category, code, correlationId, Retry-After e invalidParams; el mensaje sale del catálogo propio', async () => {
    const { client } = harness([gqlError({ code: 'RATE_LIMIT_EXCEEDED', category: 'RATE_LIMITED', httpStatus: 429, correlationId: 'corr-9', retryAfterSeconds: 17, invalidParams: [{ name: 'input.itineraries[0].origin', reason: 'formato' }, { name: '<b>malo</b>' }] })]);
    const error = await caught(client.execute(SearchFlightsOperation, searchVars));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ category: 'RATE_LIMITED', code: 'RATE_LIMIT_EXCEEDED', correlationId: 'corr-9', retryAfterSeconds: 17, httpStatus: 429 });
    expect(error.invalidParams).toEqual([{ name: 'input.itineraries[0].origin', reason: 'formato' }]);
    expect(error.message).toBe('Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.');
    expect(error.message).not.toContain('texto del servidor');
  });

  it('DAT-06 respuestas sin extensiones: la categoría sale del HTTP y el Retry-After de la cabecera; cuerpo ilegible → error controlado', async () => {
    const limited = await caught(harness([{ status: 429, body: {}, headers: { 'Retry-After': '30', 'X-Correlation-Id': 'eco-1' } }]).client.execute(HoldOfferOperation, holdVars));
    expect(limited).toMatchObject({ category: 'RATE_LIMITED', code: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: 30, correlationId: 'eco-1' });
    const html = await caught(harness([{ status: 502, raw: '<html>Bad gateway</html>' }]).client.execute(HoldOfferOperation, holdVars));
    expect(html).toMatchObject({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE' });
    const weird = await caught(harness([{ status: 200, raw: 'no-json' }]).client.execute(HoldOfferOperation, holdVars));
    expect(weird).toMatchObject({ category: 'INTERNAL', code: 'BAD_RESPONSE' });
    const empty = await caught(harness([{ body: { data: null } }]).client.execute(HoldOfferOperation, holdVars));
    expect(empty).toMatchObject({ category: 'INTERNAL', code: 'BAD_RESPONSE' });
    const unknown = await caught(harness([gqlError({ code: 'ALGO_NUEVO', category: 'CONFLICT' })]).client.execute(HoldOfferOperation, holdVars));
    expect(unknown).toMatchObject({ category: 'CONFLICT', code: 'ALGO_NUEVO', message: 'No pudimos completar la operación en el estado actual.' });
  });

  it('DAT-07 las LECTURAS se reintentan ante indisponibilidad (máx. 3, retroceso exponencial) con el mismo X-Correlation-Id', async () => {
    const unavailable = gqlError({ code: 'PROVIDER_UNAVAILABLE', category: 'UNAVAILABLE', httpStatus: 503 });
    const recovered = harness([unavailable, 'network', { body: { data: { flightStatus: { flightNumber: 'FP103' } } } }]);
    const data = await recovered.client.execute(FlightStatusOperation, { flightNumber: 'FP103', date: '2026-12-10' });
    expect(data.flightStatus.flightNumber).toBe('FP103');
    expect(recovered.sent).toHaveLength(3);
    expect(recovered.sleeps).toEqual([500, 1000]);
    expect(new Set(recovered.sent.map((entry) => entry.headers['x-correlation-id'])).size).toBe(1);

    const down = harness([unavailable]);
    const error = await caught(down.client.execute(FlightStatusOperation, { flightNumber: 'FP103', date: '2026-12-10' }));
    expect(error.category).toBe('UNAVAILABLE');
    expect(down.sent).toHaveLength(4);
    expect(down.sleeps).toEqual([500, 1000, 2000]);
  });

  it('DAT-08 las MUTACIONES nunca se reintentan solas, y los errores que no son de indisponibilidad tampoco', async () => {
    const mutation = harness([gqlError({ code: 'PROVIDER_UNAVAILABLE', category: 'UNAVAILABLE', httpStatus: 503 })]);
    expect((await caught(mutation.client.execute(HoldOfferOperation, holdVars))).category).toBe('UNAVAILABLE');
    expect(mutation.sent).toHaveLength(1);
    const network = harness(['network']);
    expect(await caught(network.client.execute(HoldOfferOperation, holdVars))).toMatchObject({ category: 'UNAVAILABLE', code: 'NETWORK_ERROR' });
    expect(network.sent).toHaveLength(1);
    for (const [category, code] of [['VALIDATION', 'VALIDATION_FAILED'], ['RATE_LIMITED', 'RATE_LIMIT_EXCEEDED'], ['NOT_FOUND', 'FLIGHT_STATUS_NOT_AVAILABLE'], ['INTERNAL', 'INTERNAL_ERROR']]) {
      const query = harness([gqlError({ code, category })]);
      await caught(query.client.execute(SearchFlightsOperation, searchVars));
      expect(query.sent).toHaveLength(1);
    }
  });

  it('DAT-09 tiempo máximo total (25 s por omisión): la operación termina como indisponible, también si estaba reintentando', async () => {
    vi.useFakeTimers();
    try {
      const { client, sent } = harness(['hang']);
      const pending = caught(client.execute(SearchFlightsOperation, searchVars));
      await vi.advanceTimersByTimeAsync(24_999);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toMatchObject({ category: 'UNAVAILABLE', code: 'CLIENT_TIMEOUT' });
      expect(sent).toHaveLength(1); // vencido el plazo no hay más intentos
    } finally { vi.useRealTimers(); }
  });

  it('DAT-10 UNAUTHENTICATED con token enviado avisa que la sesión ya no vale; sin token no', async () => {
    const onSessionRejected = vi.fn();
    const signed = harness([gqlError({ code: 'UNAUTHENTICATED', category: 'UNAUTHENTICATED', httpStatus: 401 })], { getAccessToken: async () => 'jwt', onSessionRejected });
    expect((await caught(signed.client.execute(SearchFlightsOperation, searchVars))).message).toBe('Inicia sesión para continuar.');
    expect(onSessionRejected).toHaveBeenCalledTimes(1);
    const anonymous = harness([gqlError({ code: 'UNAUTHENTICATED', category: 'UNAUTHENTICATED' })], { onSessionRejected });
    await caught(anonymous.client.execute(SearchFlightsOperation, searchVars));
    expect(onSessionRejected).toHaveBeenCalledTimes(1);
  });

  it('DAT-11 cancelar desde la pantalla (cambio de ruta) aborta la petición y no reintenta', async () => {
    const { client, sent } = harness(['hang']);
    const controller = new AbortController();
    const pending = caught(client.execute(SearchFlightsOperation, searchVars, { signal: controller.signal }));
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    expect((await pending).category).toBe('UNAVAILABLE');
    expect(sent).toHaveLength(1);
  });
});
