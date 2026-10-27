/* global __dirname */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { parse } from 'yaml';

const root = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
type Item = { name: string; request?: { method: string; url: { raw: string }; body?: { mode: string; raw?: string } }; event?: Array<{ script: { exec: string[] } }>; item?: Item[] };
const collection = JSON.parse(read('docs/dev/postman/gabatair-vuelos-v2.postman_collection.json')) as { item: Item[] };
const environment = JSON.parse(read('docs/dev/postman/gabatair-integracion-local.postman_environment.json')) as { values: Array<{ key: string; value: string; type: string }> };
const spec = parse(read('contracts/openapi/vuelos-openapi-v2.yaml')) as { paths: Record<string, Record<string, unknown>>; components: { schemas: { VuelosEventName: { enum: string[] } } } };
const flatten = (items: Item[]): Item[] => items.flatMap((item) => item.item ? flatten(item.item) : [item]);
const requests = flatten(collection.item).filter((item) => item.request);
// Rutas propias de GabatAIR que el YAML no describe (dev-auth y recepción de eventos de Booking).
const OUTSIDE_CONTRACT = ['/oauth2/token', '/.well-known/jwks.json', '/vuelos/booking-events'];
const pathOf = (raw: string): string => raw.replace('{{baseUrl}}', '').split('?')[0].replace(/^\/api\/v2/, '');
const toRegex = (template: string): RegExp => new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);

describe('F12a · colección Postman de integración local', () => {
  it('PM-01 cada petición existe en vuelos-openapi-v2.yaml (método y ruta), salvo las rutas propias documentadas', () => {
    for (const item of requests) {
      const { method, url } = item.request!; const path = pathOf(url.raw).replace(/\{\{[^}]+\}\}/g, 'x');
      if (OUTSIDE_CONTRACT.includes(path)) continue;
      const match = Object.entries(spec.paths).find(([template]) => toRegex(template).test(path));
      expect({ name: item.name, path, defined: Boolean(match) }).toEqual({ name: item.name, path, defined: true });
      expect({ name: item.name, method, ok: Object.keys(match![1]).includes(method.toLowerCase()) }).toEqual({ name: item.name, method, ok: true });
    }
  });
  it('PM-02 toda URL usa {{baseUrl}}: ningún host, IP ni puerto fijo', () => { for (const item of requests) expect({ name: item.name, ok: item.request!.url.raw.startsWith('{{baseUrl}}/api/v2/') }).toEqual({ name: item.name, ok: true }); });
  it('PM-03 los eventos del webhook son nombres válidos de VuelosEventName', () => {
    const registration = requests.find((item) => item.name === 'Registrar webhook')!; const events = (JSON.parse(registration.request!.body!.raw!) as { events: string[] }).events;
    expect(events.length).toBeGreaterThan(0); for (const name of events) expect(spec.components.schemas.VuelosEventName.enum).toContain(name);
  });
  it('PM-04 los cuerpos JSON son JSON válido (con las variables como texto)', () => {
    for (const item of requests) { const body = item.request!.body; if (!body || body.mode !== 'raw' || body.raw === '{{eventBody}}') continue; expect(() => JSON.parse(body.raw!.replace(/\{\{[^}]+\}\}/g, 'x'))).not.toThrow(); }
  });
  it('PM-05 el entorno trae baseUrl y los secretos vacíos y de tipo secret (nada sensible en el archivo)', () => {
    const values = new Map(environment.values.map((entry) => [entry.key, entry])); expect(values.get('baseUrl')?.value).toMatch(/^http:\/\/100\.x\.x\.x:\d+$/);
    for (const key of ['clientSecret', 'bookingEventsSecret', 'webhookSecret', 'accessToken']) { expect(values.get(key)?.type).toBe('secret'); expect(values.get(key)?.value).toBe(''); }
  });
  it('PM-06 toda variable {{x}} usada existe en el entorno, la fija un script o es dinámica ($guid)', () => {
    const defined = new Set(environment.values.map((entry) => entry.key)); const scripts = flatten(collection.item).flatMap((item) => (item.event ?? []).flatMap((event) => event.script.exec)).join('\n');
    for (const match of scripts.matchAll(/(?:environment|variables)\.set\('([^']+)'/g)) defined.add(match[1]);
    const used = new Set([...JSON.stringify(collection).matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]).filter((name) => !name.startsWith('$')));
    for (const name of used) expect({ name, defined: defined.has(name) }).toEqual({ name, defined: true });
  });
  it('PM-07 las peticiones que crean recursos envían Idempotency-Key', () => {
    for (const item of requests.filter((entry) => ['Crear hold (precio congelado)', 'Crear reserva', 'Comprar equipaje', 'Confirmar cambio de fecha', 'Cambiar asiento', 'Cancelar con cotización'].includes(entry.name))) expect(JSON.stringify(item.request)).toContain('Idempotency-Key');
  });
  it('PM-08 la colección no contiene secretos ni credenciales con forma de valor', () => {
    const text = read('docs/dev/postman/gabatair-vuelos-v2.postman_collection.json') + read('docs/dev/postman/gabatair-integracion-local.postman_environment.json');
    expect(text).not.toMatch(/-----BEGIN|eyJ[A-Za-z0-9_-]{20,}|sha256=[0-9a-f]{64}/);
  });
});
