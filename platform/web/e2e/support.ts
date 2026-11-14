import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

const require_ = createRequire(join(process.cwd(), 'package.json'));
const { knownOperations } = require_('@flight-platform/graphql-schema') as { knownOperations: () => Map<string, string> };
const axeSource = readFileSync(require_.resolve('axe-core/axe.min.js'), 'utf8');

/** Puertos de la plataforma local (los escribe `local:up` en .local/platform-config.json, sin secretos). */
export function platform(): { graphqlUrl: string; authUrl: string } {
  let marker: { graphqlPort?: number; webAuthPort?: number; web?: boolean } = {};
  try { marker = JSON.parse(readFileSync(join(process.cwd(), '..', '..', '.local', 'platform-config.json'), 'utf8')) as typeof marker; } catch { /* valores por omisión */ }
  if (marker.web === false) throw new Error('La plataforma local se levantó sin la web: npm run local:down y npm run local:up -- -SkipDocker -Web');
  return { graphqlUrl: `http://127.0.0.1:${marker.graphqlPort ?? 4000}/graphql`, authUrl: `http://127.0.0.1:${marker.webAuthPort ?? 54329}` };
}

export async function graphql<T>(request: APIRequestContext, name: string, variables: unknown, token?: string): Promise<{ data?: T; errors?: Array<{ extensions?: { code?: string } }> }> {
  const response = await request.post(platform().graphqlUrl, {
    headers: { 'content-type': 'application/json', 'x-device-fingerprint': 'e2e-web-playwright', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    data: { query: knownOperations().get(name), operationName: name, variables }
  });
  return await response.json() as { data?: T; errors?: Array<{ extensions?: { code?: string } }> };
}

export interface FoundFlight { origin: string; destination: string; date: string; flightNumber: string; offers: number }
interface SearchData { searchFlights: { offers: Array<{ itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }> } }

/** Busca en los datos sembrados (`npm run local:seed`) una ruta y fecha con ofertas, por la API pública. */
export async function findFlight(request: APIRequestContext): Promise<FoundFlight> {
  const routes = [['UIO', 'GYE'], ['UIO', 'GPS'], ['GYE', 'UIO'], ['UIO', 'CUE'], ['GYE', 'GPS']];
  for (let offset = 3; offset <= 14; offset += 1) {
    const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    for (const [origin, destination] of routes) {
      const reply = await graphql<SearchData>(request, 'SearchFlights', { input: { itineraries: [{ origin, destination, departureDate: date }], passengers: { adults: 1 } } });
      const offers = reply.data?.searchFlights.offers ?? [];
      if (offers.length > 0) return { origin, destination, date, flightNumber: offers[0].itineraries[0].segments[0].flightNumber, offers: offers.length };
    }
  }
  throw new Error('No hay vuelos sembrados en los próximos 14 días: ejecuta npm run local:seed');
}

interface TimedOffer { offerId: string; itineraries: Array<{ itineraryId: string; segments: Array<{ flightNumber: string; departure: { at: string } }>; pricingOptions: Array<{ cabinClass: string; fareBrand: string }> }> }

/** Un vuelo sembrado que salga dentro de la ventana de check-in (más de 60 min y menos de 48 h desde ahora), o `null` si no hay. */
export async function findCheckInFlight(request: APIRequestContext): Promise<FoundFlight | null> {
  const routes = [['UIO', 'GYE'], ['GYE', 'UIO'], ['UIO', 'CUE'], ['UIO', 'GPS'], ['GYE', 'GPS']];
  const now = Date.now();
  for (let offset = 0; offset <= 2; offset += 1) {
    const date = new Date(now + offset * 86_400_000 - 5 * 3_600_000).toISOString().slice(0, 10); // fecha local aproximada de Ecuador
    for (const [origin, destination] of routes) {
      const reply = await graphql<{ searchFlights: { offers: TimedOffer[] } }>(request, 'SearchFlights', { input: { itineraries: [{ origin, destination, departureDate: date }], passengers: { adults: 1 } } });
      for (const offer of reply.data?.searchFlights.offers ?? []) {
        const at = Date.parse(offer.itineraries[0].segments[0].departure.at);
        if (at - now > 90 * 60_000 && at - now < 47 * 3_600_000) return { origin, destination, date, flightNumber: offer.itineraries[0].segments[0].flightNumber, offers: 1 };
      }
    }
  }
  return null;
}

export interface TestUser { email: string; password: string; token: string }

/** Crea un usuario en el servicio de acceso local (misma API que Supabase Auth) y devuelve su token. */
export async function signUp(request: APIRequestContext, prefix = 'e2e-compra'): Promise<TestUser> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`; const password = 'clave-de-prueba-123';
  const response = await request.post(`${platform().authUrl}/auth/v1/signup`, { data: { email, password }, headers: { apikey: 'local-anon-publica' } });
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('El servicio de acceso local no devolvió un token');
  return { email, password, token: body.access_token };
}

/**
 * Crea un ADMINISTRADOR en el servicio de acceso local (`POST /local/admin-user`, ADR-F12c3-02: solo acepta clientes sin `Origin`, como este) y devuelve su token.
 * Es el «usuario admin del acceso local de pruebas»; el token real de Supabase con rol admin lo prueba el humano.
 */
export async function createAdmin(request: APIRequestContext, prefix = 'e2e-admin'): Promise<TestUser> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`; const password = 'clave-de-prueba-123';
  const created = await request.post(`${platform().authUrl}/local/admin-user`, { data: { email, password } });
  if (created.status() !== 201) throw new Error(`No se pudo crear el administrador local (${created.status()})`);
  const response = await request.post(`${platform().authUrl}/auth/v1/token?grant_type=password`, { data: { email, password }, headers: { apikey: 'local-anon-publica' } });
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('El servicio de acceso local no devolvió un token de administrador');
  return { email, password, token: body.access_token };
}

interface OpsFlight { flightNumber: string; date: string; origin: string; destination: string; departureAt: string; status: string }
export interface TestFlight { flightNumber: string; date: string; origin: string; destination: string; departureAt: string }
const ZONES: Record<string, string> = { UIO: 'America/Guayaquil', GYE: 'America/Guayaquil', CUE: 'America/Guayaquil', GPS: 'Pacific/Galapagos' };
/** Hora local de un instante en la zona del aeropuerto, con el formato de un `datetime-local` (`AAAA-MM-DDTHH:mm`). */
export function localInput(instant: string, origin: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONES[origin] ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Un vuelo sembrado PROGRAMADO (SCHEDULED) y lejano (8 a 14 días): el e2e lo retrasa, y un retraso no se deshace; así no estorba a los vuelos que usan la compra y el check-in.
 * Cada corrida consume uno: `npm run local:seed` repone los datos. `null` si no hay.
 */
export async function findTestFlight(request: APIRequestContext, admin: TestUser): Promise<TestFlight | null> {
  for (let offset = 14; offset >= 8; offset -= 1) {
    const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const reply = await graphql<{ flightOperations: { items: OpsFlight[] } }>(request, 'FlightOperations', { date, first: 50 }, admin.token);
    const found = (reply.data?.flightOperations.items ?? []).filter((item) => item.status === 'SCHEDULED' && ZONES[item.origin] && ZONES[item.destination]).at(-1);
    if (found) return { flightNumber: found.flightNumber, date: found.date, origin: found.origin, destination: found.destination, departureAt: found.departureAt };
  }
  return null;
}

/** Compra por la API (hold + reserva con pago aprobado) de 1 adulto en el primer vuelo que haya. Sirve para preparar situaciones sin recorrer la pantalla. */
export async function bookByApi(request: APIRequestContext, user: TestUser, flight: FoundFlight): Promise<{ bookingId: string; pnr: string; holdId: string }> {
  const search = await graphql<{ searchFlights: { offers: TimedOffer[] } }>(request, 'SearchFlights', { input: { itineraries: [{ origin: flight.origin, destination: flight.destination, departureDate: flight.date }], passengers: { adults: 1 } } });
  const offer = search.data!.searchFlights.offers[0]; const itinerary = offer.itineraries[0];
  const input = { offerId: offer.offerId, selections: [{ itineraryId: itinerary.itineraryId, cabinClass: itinerary.pricingOptions[0].cabinClass, fareBrand: itinerary.pricingOptions[0].fareBrand }], passengers: { adults: 1 } };
  const held = await graphql<{ holdOffer: { holdId: string } }>(request, 'HoldOffer', { input, idempotencyKey: crypto.randomUUID() }, user.token);
  if (!held.data) throw new Error(`HoldOffer falló: ${held.errors?.[0]?.extensions?.code}`);
  const passenger = { passengerId: 'PAX-1', passengerType: 'ADULT', firstName: 'Api', lastName: 'Prueba', documentType: 'NATIONAL_ID', documentNumber: `17${String(Date.now()).slice(-8)}`, nationality: 'EC', birthDate: '1990-01-01', gender: 'F', contact: { email: user.email, phone: '+593987654321' } };
  const booked = await graphql<{ createBooking: { booking: { bookingId: string; pnr: string } } }>(request, 'CreateBooking', { input: { holdId: held.data.holdOffer.holdId, passengers: [passenger], paymentReference: `pay_ok_${crypto.randomUUID()}` }, idempotencyKey: crypto.randomUUID() }, user.token);
  if (!booked.data) throw new Error(`CreateBooking falló: ${booked.errors?.[0]?.extensions?.code}`);
  return { ...booked.data.createBooking.booking, holdId: held.data.holdOffer.holdId };
}

/** Aparta por la API un asiento concreto del primer tramo de la primera oferta (simula a «otro viajero»). */
export async function holdSeatByApi(request: APIRequestContext, user: TestUser, flight: FoundFlight, seat: string): Promise<void> {
  const search = await graphql<{ searchFlights: { offers: Array<TimedOffer & { itineraries: Array<{ segments: Array<{ segmentId: string }> }> }> } }>(request, 'SearchFlights', { input: { itineraries: [{ origin: flight.origin, destination: flight.destination, departureDate: flight.date }], passengers: { adults: 1 } } });
  const offer = search.data!.searchFlights.offers[0]; const itinerary = offer.itineraries[0];
  const held = await graphql(request, 'HoldOffer', { input: { offerId: offer.offerId, selections: [{ itineraryId: itinerary.itineraryId, cabinClass: itinerary.pricingOptions[0].cabinClass, fareBrand: itinerary.pricingOptions[0].fareBrand }], passengers: { adults: 1 }, seats: [{ segmentId: itinerary.segments[0].segmentId, seatNumber: seat }] }, idempotencyKey: crypto.randomUUID() }, user.token);
  if (!('data' in held) || !held.data) throw new Error(`HoldOffer con asiento falló: ${held.errors?.[0]?.extensions?.code}`);
}

/** axe en el navegador real (incluye contraste). Se evalúa por el protocolo de depuración: la CSP del sitio sigue intacta. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  // El puntero sobre un botón (hover con transición de color) falsea el contraste a mitad de la animación: se retira y se espera a que termine.
  await page.mouse.move(0, 0); await page.waitForTimeout(250);
  await page.evaluate(`${axeSource}; undefined`);
  const violations = await page.evaluate(async () => {
    const results = await (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ html: string }> }> }> } }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return results.violations.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.html.slice(0, 120)).join(' | ')}`);
  });
  expect(violations, `accesibilidad de ${label}`).toEqual([]);
}

/** Ningún texto visible por debajo de 12 px y sin desplazamiento horizontal. */
export async function expectLegible(page: Page, label: string): Promise<void> {
  const report = await page.evaluate(() => {
    const small: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement; if (!parent || !node.textContent?.trim()) continue;
      const style = getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (parseFloat(style.fontSize) < 12) small.push(`${parseFloat(style.fontSize)}px: ${node.textContent.trim().slice(0, 40)}`);
    }
    const width = document.documentElement.clientWidth;
    const wide = [...document.body.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > width + 1).slice(0, 4).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`);
    return { small, overflow: document.documentElement.scrollWidth - width, wide };
  });
  expect(report.small, `texto menor de 12 px en ${label}`).toEqual([]);
  expect(report.overflow, `desplazamiento horizontal en ${label} (elementos más anchos que la ventana: ${report.wide.join(', ')})`).toBeLessThanOrEqual(1);
}

/** Registra los errores de consola (incluidas las violaciones de CSP) y las peticiones a orígenes no previstos. */
export function watch(page: Page): { problems: string[]; hosts: Set<string> } {
  const problems: string[] = []; const hosts = new Set<string>();
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => { const url = new URL(request.url()); if (url.protocol.startsWith('http')) hosts.add(url.host); });
  return { problems, hosts };
}
