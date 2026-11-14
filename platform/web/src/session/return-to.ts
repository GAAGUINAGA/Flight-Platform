/**
 * `returnTo`: a dónde volver tras iniciar sesión (diseño F12c-0 §3.4). Solo rutas INTERNAS: un enlace manipulado
 * (`//otro-sitio`, `https://…`, `/\otro`) nunca saca al usuario de la app.
 */
const AUTH_PATHS = ['/acceso', '/registro', '/recuperar', '/nueva-contrasena', '/sesion-expirada'];

/** Caracteres de control (tabulador, salto de línea…): un navegador los quita al resolver la URL, así que se rechazan. */
const hasControl = (value: string): boolean => [...value].some((char) => char.charCodeAt(0) < 32);

export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControl(value)) return fallback;
  try {
    const base = 'https://app.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    // No tiene sentido volver a una pantalla de acceso.
    if (AUTH_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

/** Ruta de inicio de sesión que conserva el regreso. */
export function loginPath(returnTo?: string | null): string {
  const target = safeReturnTo(returnTo, '');
  return target && target !== '/' ? `/acceso?returnTo=${encodeURIComponent(target)}` : '/acceso';
}
