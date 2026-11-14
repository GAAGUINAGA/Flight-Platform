import { render, type RenderResult } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { expect } from 'vitest';
import type { TypedOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { ItineraryFieldsFragment, SearchFlightsQuery } from '@flight-platform/graphql-schema/generated/types';
import type { AuthResult, SessionClient, SessionState, SessionUser } from '@flight-platform/session';
import { AppRoutes } from '../src/app/App';
import { ServicesProvider, type Services } from '../src/app/services';
import type { AppConfig } from '../src/config';
import type { ExecuteOptions, GraphqlClient } from '../src/data/graphql-client';

export const testConfig: AppConfig = {
  graphqlUrl: 'https://graphql.test/graphql', supabaseUrl: 'https://supabase.test', supabaseAnonKey: 'anon-test', envName: 'pruebas',
  loading: { slowMs: 1500, verySlowMs: 8000, timeoutMs: 25_000 }, retry: { max: 3, baseDelayMs: 500 }
};

export interface ClientCall { name: string; kind: string; variables: unknown; correlationId?: string }
export type Handler = (call: ClientCall) => unknown | Promise<unknown>;
/** Capa de datos simulada: responde por nombre de operación. `PlatformHealth` (precalentamiento) responde sola. */
export function fakeClient(handlers: Record<string, Handler> = {}): GraphqlClient & { calls: ClientCall[] } {
  const calls: ClientCall[] = [];
  return {
    calls,
    async execute<TData, TVariables>(operation: TypedOperation<TData, TVariables>, variables: TVariables, options?: ExecuteOptions): Promise<TData> {
      const call = { name: operation.name, kind: operation.kind, variables, correlationId: options?.correlationId };
      if (operation.name !== 'PlatformHealth') calls.push(call);
      const handler = handlers[operation.name];
      if (!handler) { if (operation.name === 'PlatformHealth') return {} as TData; throw new Error(`sin respuesta simulada para ${operation.name}`); }
      return await handler(call) as TData;
    }
  };
}

export const customer: SessionUser = { id: 'u-1', email: 'ana@example.test', name: 'Ana Pérez', role: 'customer', emailVerified: true };
export interface FakeSession extends SessionClient { set(state: SessionState): void; calls: Array<{ method: string; args: unknown[] }>; results: Partial<Record<'signIn' | 'signUp' | 'requestPasswordReset' | 'updatePassword' | 'exchangeCode', AuthResult<Record<string, unknown>>>> }
/** Sesión simulada con el mismo contrato que `@flight-platform/session`. */
export function fakeSession(initial: SessionState = { status: 'anonymous', expired: false }): FakeSession {
  let state = initial; const listeners = new Set<(state: SessionState) => void>();
  const calls: FakeSession['calls'] = []; const results: FakeSession['results'] = {};
  const set = (next: SessionState): void => { state = next; for (const listener of listeners) listener(next); };
  const record = <T,>(method: string, args: unknown[], value: T): Promise<T> => { calls.push({ method, args }); return Promise.resolve(value); };
  const signedIn = (): void => set({ status: 'authenticated', user: customer, expiresAt: null });
  return {
    set, calls, results,
    start: () => Promise.resolve(state), stop: () => Promise.resolve(), getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: (...args) => { const result = (results.signIn ?? { ok: true }) as AuthResult; if (result.ok) signedIn(); return record('signIn', args, result); },
    signUp: (...args) => { const result = (results.signUp ?? { ok: true, needsEmailConfirmation: true }) as AuthResult<{ needsEmailConfirmation: boolean }>; if (result.ok && !result.needsEmailConfirmation) signedIn(); return record('signUp', args, result); },
    signOut: () => { set({ status: 'anonymous', expired: false }); return record('signOut', [], undefined); },
    requestPasswordReset: (...args) => record('requestPasswordReset', args, (results.requestPasswordReset ?? { ok: true }) as AuthResult),
    updatePassword: (...args) => record('updatePassword', args, (results.updatePassword ?? { ok: true }) as AuthResult),
    exchangeCode: (...args) => { const result = (results.exchangeCode ?? { ok: true, recovery: false }) as AuthResult<{ recovery: boolean }>; if (result.ok) signedIn(); return record('exchangeCode', args, result); },
    getAccessToken: () => Promise.resolve(state.status === 'authenticated' ? 'token' : null)
  };
}

export interface AppHarness extends RenderResult { client: ReturnType<typeof fakeClient>; session: FakeSession }
/** Monta la app completa (rutas reales) en una ruta, con datos y sesión simulados. */
export function renderApp(route: string | { pathname: string; search?: string; state?: unknown }, options: { handlers?: Record<string, Handler>; session?: FakeSession; config?: Partial<AppConfig> } = {}): AppHarness {
  const client = fakeClient(options.handlers); const session = options.session ?? fakeSession();
  const services: Services = { config: { ...testConfig, ...options.config }, client, session };
  const view = render(<ServicesProvider services={services}><MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter></ServicesProvider>);
  return { ...view, client, session };
}

/** axe sobre el documento montado: sin infracciones. El contraste no se evalúa aquí (jsdom no calcula estilos): lo cubren las pruebas de tokens y el e2e. */
export async function expectAccessible(container: HTMLElement = document.body): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`)).toEqual([]);
}

// ───────── Datos de ejemplo ─────────
const money = (total: string) => ({ currency: 'USD', total, baseFare: null, taxes: '12.00' });
export function itinerary(options: { id: string; flight: string; from: string; to: string; departure: string; arrival: string; minutes: number; stops?: string[]; cabins?: Array<[cabin: 'ECONOMY' | 'BUSINESS', brand: string, price: string, seats?: number]> }): ItineraryFieldsFragment {
  const points = [options.from, ...(options.stops ?? []), options.to];
  return {
    itineraryId: options.id, totalDurationMinutes: options.minutes, stopsCount: (options.stops ?? []).length,
    segments: points.slice(0, -1).map((from, index) => ({
      segmentId: `${options.id}-s${index}`, flightNumber: index === 0 ? options.flight : `${options.flight}${index}`, layoverMinutes: null, marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'A320', durationMinutes: options.minutes, status: 'SCHEDULED',
      departure: { iataCode: from, at: options.departure, terminal: null }, arrival: { iataCode: points[index + 1], at: options.arrival, terminal: null }
    })),
    pricingOptions: (options.cabins ?? [['ECONOMY', 'Light', '127.39']]).map(([cabinClass, fareBrand, price, seats = 9]) => ({
      cabinClass, fareBrand, availableSeats: seats, fareRules: { isRefundable: false, isChangeable: true },
      baggageAllowance: { personalItemIncluded: true, carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: money('35.00'),
      pricePerPassengerType: [{ passengerType: 'ADULT', price: money(price) }]
    }))
  };
}

/** Tres ofertas UIO→GPS del 10-dic-2026: directa barata, directa con Business y con escala (la más cara y la que sale antes). */
export function searchResult(): SearchFlightsQuery {
  const offer = (id: string, total: string, itineraries: ItineraryFieldsFragment[]) => ({ offerId: id, airline: { code: 'FP', name: 'Aerolínea de prueba' }, grandTotal: money(total), itineraries });
  return { searchFlights: { totalOffers: 3, offers: [
    offer('of-1', '254.78', [itinerary({ id: 'it-1', flight: 'FP103', from: 'UIO', to: 'GPS', departure: '2026-12-10T13:35:00Z', arrival: '2026-12-10T16:30:00Z', minutes: 175 })]),
    offer('of-2', '299.80', [itinerary({ id: 'it-2', flight: 'FP105', from: 'UIO', to: 'GPS', departure: '2026-12-10T17:20:00Z', arrival: '2026-12-10T20:15:00Z', minutes: 175, cabins: [['ECONOMY', 'Standard', '149.90'], ['BUSINESS', 'Flex', '420.00', 2]] })]),
    offer('of-3', '330.60', [itinerary({ id: 'it-3', flight: 'FP201', from: 'UIO', to: 'GPS', departure: '2026-12-10T11:10:00Z', arrival: '2026-12-10T16:50:00Z', minutes: 340, stops: ['GYE'], cabins: [['ECONOMY', 'Light', '165.30']] })])
  ] } };
}
