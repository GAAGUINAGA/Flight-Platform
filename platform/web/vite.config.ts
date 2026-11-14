import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { contentSecurityPolicy, REQUIRED_PUBLIC_ENV, securityHeaders } from './security-headers.ts';

const fromPackages = (path: string): string => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/** En la construcción: exige las variables públicas y escribe la CSP en el index.html con sus URLs reales. */
function publicConfig(env: Record<string, string>): Plugin {
  return {
    name: 'flight-web:public-config',
    apply: 'build',
    configResolved() {
      const missing = REQUIRED_PUBLIC_ENV.filter((name) => !env[name]);
      if (missing.length > 0) throw new Error(`Faltan variables públicas para construir la web: ${missing.join(', ')} (ver platform/web/.env.example)`);
    },
    transformIndexHtml(html) {
      const csp = contentSecurityPolicy({ graphqlUrl: env.VITE_GRAPHQL_URL, supabaseUrl: env.VITE_SUPABASE_URL }, 'meta');
      return { html, tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }] };
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key.startsWith('VITE_') && value !== undefined)) } as Record<string, string>;
  const urls = env.VITE_GRAPHQL_URL && env.VITE_SUPABASE_URL ? { graphqlUrl: env.VITE_GRAPHQL_URL, supabaseUrl: env.VITE_SUPABASE_URL } : undefined;
  return {
    // Los paquetes compartidos se consumen desde su código fuente (no hace falta construirlos antes de la web).
    resolve: {
      alias: [
        { find: '@flight-platform/shared/dist/src/airport-zones', replacement: fromPackages('shared/src/airport-zones.ts') },
        { find: /^@flight-platform\/(brand|design-tokens|format|session)$/, replacement: fromPackages('$1/src/index.ts') }
      ]
    },
    plugins: [publicConfig(env)],
    build: { outDir: 'dist', target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    // `vite preview` sirve el sitio construido en la plataforma local con las MISMAS cabeceras que Render (todas las rutas caen en index.html).
    preview: { host: '127.0.0.1', port: 5173, strictPort: true, ...(urls ? { headers: securityHeaders(urls) } : {}) },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
      setupFiles: ['test/setup.ts'],
      restoreMocks: true,
      env: { DEBUG_PRINT_LIMIT: '600', VITE_GRAPHQL_URL: 'https://graphql.test/graphql', VITE_SUPABASE_URL: 'https://supabase.test', VITE_SUPABASE_ANON_KEY: 'anon-test', VITE_ENV_NAME: 'pruebas' }
    }
  };
});
