// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, cspDirectives, PUBLIC_ENV, REQUIRED_PUBLIC_ENV, securityHeaders } from '../security-headers';

/** Publicación (diseño F12c-0 §9): la configuración de Render del repositorio y las cabeceras de seguridad son coherentes entre sí. */
const repo = join(__dirname, '..', '..', '..');
const render = readFileSync(join(repo, 'render.yaml'), 'utf8');
const unquote = (value: string): string => value.trim().replace(/^"(.*)"$/, '$1');
const field = (key: string): string => unquote(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(render)?.[1] ?? '');
const envValue = (key: string): string | undefined => { const match = new RegExp(`- key: ${key}\\s*\\n\\s*(value|sync):\\s*(.+)`).exec(render); return match ? (match[1] === 'sync' ? `sync:${match[2].trim()}` : unquote(match[2])) : undefined; };
const header = (name: string, path = '/\\*'): string | undefined => { const match = new RegExp(`- path: ${path}\\s*\\n\\s*name: ${name}\\s*\\n\\s*value:\\s*(.+)`).exec(render); return match ? unquote(match[1]) : undefined; };
const urls = { graphqlUrl: envValue('VITE_GRAPHQL_URL') ?? '', supabaseUrl: envValue('VITE_SUPABASE_URL') ?? '' };

describe('publicación · sitio estático de Render', () => {
  it('DEP-01 es un sitio estático con el comando de construcción del workspace, la carpeta publicada y despliegue manual desde main', () => {
    expect(field('runtime')).toBe('static');
    expect(field('buildCommand')).toBe('npm ci && npm run build -w @flight-platform/web');
    expect(field('staticPublishPath')).toBe('platform/web/dist');
    expect(field('branch')).toBe('main');
    expect(field('autoDeploy')).toBe('false');
    expect(render.match(/^\s*- type: web$/gm)).toHaveLength(1); // solo la web: el Gateway no se administra desde este archivo
  });

  it('DEP-02 todas las rutas se reescriben a index.html (enrutado del lado del cliente)', () => {
    expect(render).toMatch(/routes:\s*\n\s*- type: rewrite\s*\n\s*source: \/\*\s*\n\s*destination: \/index\.html/);
  });

  it('DEP-03 las cabeceras de Render son EXACTAMENTE las que define security-headers.ts para las URLs declaradas', () => {
    for (const [name, value] of Object.entries(securityHeaders(urls))) expect(header(name), name).toBe(value);
  });

  it('DEP-04 CSP: connect-src solo admite el origen de GraphQL y el de Supabase; sin comodines, sin inline ni eval; frame-ancestors none', () => {
    const csp = header('Content-Security-Policy') ?? '';
    const directives = Object.fromEntries(csp.split('; ').map((directive) => { const [name, ...values] = directive.split(' '); return [name, values]; }));
    expect(directives['connect-src']).toEqual([new URL(urls.graphqlUrl).origin, new URL(urls.supabaseUrl).origin]);
    expect(directives['connect-src'].every((origin) => origin.startsWith('https://'))).toBe(true);
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['style-src']).toEqual(["'self'"]);
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|onrender\.com/); // la web nunca habla con el Gateway
    expect(header('Strict-Transport-Security')).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('DEP-05 la CSP del index.html construido (meta) es la misma política sin frame-ancestors, y rechaza URLs que no lo son', () => {
    expect(cspDirectives(urls, 'meta')).toEqual(cspDirectives(urls, 'header').filter((directive) => !directive.startsWith('frame-ancestors')));
    expect(contentSecurityPolicy({ graphqlUrl: 'http://127.0.0.1:4000/graphql', supabaseUrl: 'http://127.0.0.1:54329' }, 'meta')).toContain('connect-src http://127.0.0.1:4000 http://127.0.0.1:54329;');
    expect(() => contentSecurityPolicy({ graphqlUrl: 'graphql', supabaseUrl: urls.supabaseUrl }, 'header')).toThrow('VITE_GRAPHQL_URL');
    expect(() => contentSecurityPolicy({ graphqlUrl: 'javascript:alert(1)', supabaseUrl: urls.supabaseUrl }, 'header')).toThrow();
  });

  it('DEP-06 variables públicas: las obligatorias están en render.yaml, sin secretos; la llave anon no se versiona', () => {
    for (const name of REQUIRED_PUBLIC_ENV) expect(envValue(name), name).toBeDefined();
    expect(envValue('VITE_SUPABASE_ANON_KEY')).toBe('sync:false');
    expect(urls.graphqlUrl).toMatch(/^https:\/\/.+\/graphql$/);
    expect(urls.supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    const keys = [...render.matchAll(/- key: ([A-Z0-9_]+)/g)].map((match) => match[1]);
    expect(keys.filter((key) => key !== 'NODE_VERSION').every((key) => key.startsWith('VITE_'))).toBe(true);
    expect(render).not.toMatch(/service_role|SECRET|PASSWORD|eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('DEP-07 cada variable pública está documentada en .env.example y en la guía de despliegue', () => {
    const example = readFileSync(join(repo, 'platform', 'web', '.env.example'), 'utf8');
    const guide = readFileSync(join(repo, 'docs', 'dev', 'f12c2a-web-despliegue.md'), 'utf8');
    for (const name of PUBLIC_ENV) {
      expect(example, name).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
      expect(guide, name).toContain(name);
    }
    expect(example).not.toMatch(/=\s*(ey|sb_|https?:)/); // sin valores reales
    for (const step of ['CORS_ORIGINS', 'Redirect URLs', 'render.yaml', '/acceso/retorno']) expect(guide).toContain(step);
  });
});
