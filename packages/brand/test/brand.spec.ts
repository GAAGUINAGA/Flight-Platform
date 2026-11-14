/* global __dirname */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AIRPORT_ZONES } from '@flight-platform/shared/dist/src/airport-zones';
import { brand, featuredOrigins } from '../src';

const assets = join(__dirname, '..', 'assets');

describe('brand · marca provisional (F12c-2a)', () => {
  it('BRD-01 logotipo claro y oscuro: SVG de texto con el mismo viewBox y sin recursos externos', () => {
    const light = readFileSync(join(assets, brand.logo.light), 'utf8'); const dark = readFileSync(join(assets, brand.logo.dark), 'utf8');
    const viewBox = (svg: string): string | undefined => /viewBox="([^"]+)"/.exec(svg)?.[1];
    expect(viewBox(light)).toBe(viewBox(dark));
    for (const svg of [light, dark]) {
      expect(svg).toContain(`<title id="t">${brand.name}</title>`);
      expect(svg).not.toMatch(/<image|<script|href=|url\(/i);
    }
  });

  it('BRD-02 cada fotografía existe, pesa poco y tiene texto alternativo y crédito con licencia libre y fuente', () => {
    const referenced = Object.values(brand.photos).map((photo) => photo.file.replace('photos/', '')).sort();
    expect(readdirSync(join(assets, 'photos')).filter((name) => name.endsWith('.jpg')).sort()).toEqual(referenced);
    const credits = readFileSync(join(assets, 'photos', 'CREDITS.md'), 'utf8');
    for (const photo of Object.values(brand.photos)) {
      expect(statSync(join(assets, photo.file)).size).toBeLessThan(400_000);
      expect(photo.alt.length).toBeGreaterThan(10);
      expect(photo.credit.author.length).toBeGreaterThan(0);
      expect(photo.credit.license).toMatch(/^(CC0|CC BY(-SA)? [234]\.0)$/);
      expect(photo.credit.licenseUrl).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(photo.credit.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(credits).toContain(photo.credit.sourceUrl);
    }
  });

  it('BRD-03 las rutas destacadas usan aeropuertos de la tabla única, fotos existentes y no repiten el origen', () => {
    expect(featuredOrigins()).toEqual(['UIO', 'GYE']);
    for (const [origin, routes] of Object.entries(brand.featuredRoutes)) {
      expect(AIRPORT_ZONES[origin]).toBeDefined();
      expect(routes.length).toBeGreaterThanOrEqual(3);
      expect(new Set(routes.map((route) => route.destination)).size).toBe(routes.length);
      for (const route of routes) {
        expect(AIRPORT_ZONES[route.destination]).toBeDefined();
        expect(route.destination).not.toBe(origin);
        expect(brand.photos[route.photo]).toBeDefined();
      }
    }
    expect(brand.photos[brand.hero.photo]).toBeDefined();
  });

  it('BRD-04 tipografía Inter autoalojada con su licencia; sin recursos remotos', () => {
    const css = readFileSync(join(assets, brand.fontsCss), 'utf8');
    expect(css).toContain("font-family: 'Inter'");
    expect(css).not.toMatch(/https?:\/\//);
    const file = /url\('\.\/([^']+)'\)/.exec(css)?.[1] ?? '';
    expect(existsSync(join(assets, 'fonts', file))).toBe(true);
    expect(readFileSync(join(assets, 'fonts', 'OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });

  it('BRD-05 ningún recurso ni texto de la plantilla o de marcas de terceros', () => {
    const text = [JSON.stringify(brand), readFileSync(join(assets, brand.logo.light), 'utf8'), readFileSync(join(assets, brand.logo.dark), 'utf8')].join('\n');
    expect(text).not.toMatch(/latam/i);
    expect(readdirSync(assets).sort()).toEqual(['favicon.svg', 'fonts', 'logo-dark.svg', 'logo.svg', 'photos']);
    expect(readFileSync(join(assets, 'favicon.svg'), 'utf8')).not.toMatch(/<image|<script|href=|url\(/i);
    expect(brand.name).toBe('GabatAIR');
    for (const column of brand.footer) for (const link of column.links) expect(link.to.startsWith('/')).toBe(true);
  });
});
