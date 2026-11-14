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

/** axe en el navegador real (incluye contraste). Se evalúa por el protocolo de depuración: la CSP del sitio sigue intacta. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
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
    return { small, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(report.small, `texto menor de 12 px en ${label}`).toEqual([]);
  expect(report.overflow, `desplazamiento horizontal en ${label}`).toBeLessThanOrEqual(1);
}

/** Registra los errores de consola (incluidas las violaciones de CSP) y las peticiones a orígenes no previstos. */
export function watch(page: Page): { problems: string[]; hosts: Set<string> } {
  const problems: string[] = []; const hosts = new Set<string>();
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => { const url = new URL(request.url()); if (url.protocol.startsWith('http')) hosts.add(url.host); });
  return { problems, hosts };
}
