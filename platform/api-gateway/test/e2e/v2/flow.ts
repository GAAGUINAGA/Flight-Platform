import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { fetchToken, type TestClient } from './support';
import type { Scenario, Stack } from './stack';

export type Server = Stack['server'];
const tokens = new Map<string, string>();

/** Cabeceras de un partner; el token se pide una vez por cliente y alcance. */
export async function headers(stack: Stack, client: TestClient, user?: string, scope?: string): Promise<Record<string, string>> {
  const key = `${client.clientId}:${scope ?? ''}`; let token = tokens.get(key);
  if (!token) { token = await fetchToken(stack.server, client, scope); tokens.set(key, token); }
  return { Authorization: `Bearer ${token}`, ...(user ? { 'X-User-Id': user } : {}) };
}

export const passenger = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ passengerId: id, passengerType: 'ADULT', firstName: 'Maria', lastName: 'Andrade', documentType: 'PASSPORT', documentNumber: 'TEST12345', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'maria@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [], ...overrides });

export interface Held { holdId: string; lockedPrice: { currency: string; total: string }; offer: Awaited<ReturnType<Scenario['search']>> }
export async function hold(stack: Stack, scenario: Scenario, client: TestClient, user: string, extra: Record<string, unknown> = {}, breakdown: Record<string, number> = { adults: 1 }): Promise<Held> {
  const offer = await scenario.search(breakdown);
  const response = await request(stack.server).post('/api/v2/vuelos/offers/hold').set(await headers(stack, client, user)).set('Idempotency-Key', randomUUID()).send({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: offer.itineraryId, cabinClass: offer.cabinClass, fareBrand: offer.fareBrand }], passengersBreakdown: breakdown, ...extra });
  if (response.status !== 201) throw new Error(`hold failed with ${response.status} ${JSON.stringify(response.body)}`);
  return { holdId: response.body.holdId, lockedPrice: response.body.lockedPrice, offer };
}

export const newReference = (): string => `PAY-BKP-${randomUUID()}`;

export interface BookOptions { reference?: string; key?: string; passengers?: Array<Record<string, unknown>>; body?: Record<string, unknown>; user?: string; client?: TestClient; confirm?: boolean }
/** Hold + pago confirmado en el simulador + reserva. Devuelve la respuesta cruda de POST /bookings. */
export async function book(stack: Stack, scenario: Scenario, client: TestClient, user: string, held: Held, options: BookOptions = {}) {
  const reference = options.reference ?? newReference(); if (options.confirm !== false) stack.payments.confirmed(reference, held.lockedPrice.total, held.lockedPrice.currency);
  const body = { holdId: held.holdId, passengers: options.passengers ?? [passenger('PAX-1')], payment: { paymentReference: reference }, ...(options.body ?? {}) };
  const key = options.key ?? randomUUID();
  const response = await request(stack.server).post('/api/v2/vuelos/bookings').set(await headers(stack, options.client ?? client, options.user ?? user)).set('Idempotency-Key', key).send(body);
  return { response, reference, key, body };
}

export async function getBooking(stack: Stack, client: TestClient, user: string, bookingId: string) {
  return request(stack.server).get(`/api/v2/vuelos/bookings/${bookingId}`).set(await headers(stack, client, user));
}
