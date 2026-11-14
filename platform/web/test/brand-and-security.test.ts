// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brand } from '@flight-platform/brand';

/**
 * Marca (diseño F12c-0 §2.3 y §10.2): en `platform/web/src` no hay colores literales, rutas de imagen ni la cadena de marca;
 * todo sale de `packages/design-tokens` y `packages/brand`. Y reglas de seguridad del código de la web.
 */
const root = join(__dirname, '..');
const list = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? list(path) : [path]; });
const rel = (file: string): string => relative(root, file).split(sep).join('/');
const all = list(join(root, 'src'));
const sources = all.filter((file) => /\.(ts|tsx|css)$/.test(file) && !/\.test\.tsx?$/.test(file));
const read = (file: string): string => readFileSync(file, 'utf8');
/** El único archivo que resuelve los archivos de la marca (por carpeta y extensión, sin nombrar ninguno). */
const ASSET_RESOLVER = 'src/brand/assets.ts';

describe('marca · la web no contiene valores de marca escritos a mano', () => {
  it('MRC-01 ningún color literal (hex, rgb, hsl) en el código ni en los estilos: solo variables de los tokens', () => {
    const offenders = sources.flatMap((file) => {
      const found = read(file).match(/#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgb|rgba|hsl|hsla)\s*\(/g) ?? [];
      // `#id` de un selector o de un enlace interno no es un color: un color hex tiene 3, 4, 6 u 8 dígitos hexadecimales exactos.
      const colors = found.filter((value) => !value.startsWith('#') || [4, 5, 7, 9].includes(value.length));
      return colors.length > 0 ? [`${rel(file)}: ${colors.join(', ')}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('MRC-02 ninguna ruta de imagen o de fuente fuera del resolvedor único de la marca', () => {
    const offenders = sources.filter((file) => rel(file) !== ASSET_RESOLVER && /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)\b/i.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
    const resolver = read(join(root, ASSET_RESOLVER));
    expect(resolver).toContain('packages/brand/assets/');
    for (const photo of Object.values(brand.photos)) expect(resolver).not.toContain(photo.file.replace('photos/', ''));
    expect(all.filter((file) => /\.(png|jpe?g|gif|webp|svg|woff2?)$/i.test(file)).map(rel)).toEqual([]); // ningún archivo de imagen dentro de la web
  });

  it('MRC-03 la cadena de marca no aparece en la web (ni en index.html): sale de brand.config.ts', () => {
    const pattern = new RegExp(brand.name, 'i');
    expect([...sources, join(root, 'index.html')].filter((file) => pattern.test(read(file))).map(rel)).toEqual([]);
    expect([...sources, join(root, 'index.html')].filter((file) => /latam/i.test(read(file))).map(rel)).toEqual([]);
  });

  it('MRC-04 los estilos usan los tokens: ningún tamaño de letra fijo y nada por debajo de 12 px', () => {
    const css = sources.filter((file) => file.endsWith('.css'));
    expect(css.length).toBeGreaterThan(3);
    for (const file of css) {
      const sizes = read(file).match(/font-size:\s*[^;]+;/g) ?? [];
      for (const size of sizes) expect(size, rel(file)).toMatch(/font-size:\s*var\(--font-size-[a-z]+\);/);
      expect(read(file), rel(file)).not.toMatch(/font-family:(?!\s*var\()/);
    }
  });
});

describe('seguridad del código de la web', () => {
  const code = sources.filter((file) => !file.endsWith('.css'));

  it('SEG-01 sin dangerouslySetInnerHTML, innerHTML, eval ni document.write', () => {
    const offenders = code.filter((file) => /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|\beval\s*\(|new Function\s*\(|document\.write/.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('SEG-02 la app solo habla con el servicio GraphQL (un único fetch, en la capa de datos) y nunca con el Gateway', () => {
    const withFetch = code.filter((file) => /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(read(file))).map(rel);
    expect(withFetch).toEqual(['src/data/graphql-client.ts']);
    expect(code.filter((file) => /api\/v2\/vuelos|flights\/v1|api\/admin|onrender\.com|GATEWAY_BASE_URL|VITE_GATEWAY|gatewayUrl/.test(read(file))).map(rel)).toEqual([]);
  });

  it('SEG-03 el almacenamiento del navegador se usa solo desde un módulo y nunca para datos personales', () => {
    const withStorage = code.filter((file) => /localStorage|sessionStorage|indexedDB|document\.cookie/.test(read(file))).map(rel);
    expect(withStorage).toEqual(['src/data/identity.ts']);
    const identity = read(join(root, 'src/data/identity.ts'));
    expect(identity.match(/setItem\(/g)?.length).toBe(3); // la sonda, el identificador de dispositivo y la implementación en memoria
    expect(identity).not.toMatch(/document(Number)?|passport|email|password/i);
  });

  it('SEG-04 solo variables públicas VITE_* conocidas; ninguna clave ni secreto en el código', () => {
    const used = new Set(code.flatMap((file) => read(file).match(/VITE_[A-Z0-9_]+/g) ?? []));
    expect([...used].sort()).toEqual(['VITE_ENV_NAME', 'VITE_GRAPHQL_URL', 'VITE_LOADING_SLOW_MS', 'VITE_LOADING_VERY_SLOW_MS', 'VITE_REQUEST_TIMEOUT_MS', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
    for (const file of code) {
      expect(read(file), rel(file)).not.toMatch(/service_role|SERVICE_ROLE|BEGIN (RSA |EC )?PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
      expect(read(file), rel(file)).not.toMatch(/console\.(log|debug|info)\(/);
    }
  });

  it('SEG-05 los enlaces externos abren sin dar acceso a la ventana de origen', () => {
    for (const file of code) {
      for (const anchor of read(file).match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) expect(anchor, rel(file)).toMatch(/rel="[^"]*noopener[^"]*"/);
    }
  });
});
