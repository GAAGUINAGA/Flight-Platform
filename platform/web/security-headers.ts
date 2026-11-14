/**
 * Cabeceras de seguridad del sitio estático (diseño F12c-0 §9). ÚNICA definición: la usan
 *   - `vite.config.ts` → `<meta http-equiv="Content-Security-Policy">` del index.html construido (con las URLs reales de las variables VITE_*)
 *     y las cabeceras de `vite preview` (plataforma local);
 *   - `test/deploy-config.test.ts` → comprueba que `render.yaml` (lo que sirve Render) dice exactamente lo mismo.
 * `connect-src` admite SOLO el origen del servicio GraphQL y el de Supabase: la app no habla con nadie más (ni con el Gateway).
 */
export interface PublicUrls { graphqlUrl: string; supabaseUrl: string }

const originOf = (value: string, name: string): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} debe ser una URL absoluta`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} debe ser http(s)`);
  return url.origin;
};

/** Directivas de la CSP. `frame-ancestors` solo vale como cabecera (los navegadores la ignoran en `<meta>`). */
export function cspDirectives(urls: PublicUrls, target: 'header' | 'meta'): string[] {
  const connect = [...new Set([originOf(urls.graphqlUrl, 'VITE_GRAPHQL_URL'), originOf(urls.supabaseUrl, 'VITE_SUPABASE_URL')])];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(target === 'header' ? ["frame-ancestors 'none'"] : [])
  ];
}

export const contentSecurityPolicy = (urls: PublicUrls, target: 'header' | 'meta'): string => cspDirectives(urls, target).join('; ');

/** Cabeceras HTTP que debe enviar el sitio (Render: `render.yaml`; local: `vite preview`). */
export function securityHeaders(urls: PublicUrls): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(urls, 'header'),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  };
}

/** Variables públicas obligatorias para construir (se incrustan en el bundle: ninguna es secreta). */
export const REQUIRED_PUBLIC_ENV = ['VITE_GRAPHQL_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;
/** Todas las variables públicas que la app conoce (documentadas en `.env.example` y en la guía de despliegue). */
export const PUBLIC_ENV = [...REQUIRED_PUBLIC_ENV, 'VITE_ENV_NAME', 'VITE_LOADING_SLOW_MS', 'VITE_LOADING_VERY_SLOW_MS', 'VITE_REQUEST_TIMEOUT_MS'] as const;
