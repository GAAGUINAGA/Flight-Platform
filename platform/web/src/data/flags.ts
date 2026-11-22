/**
 * Banderas como IMAGEN SVG (los emojis de banderas no se ven en Windows). Salen del paquete `flag-icons` (MIT, versión fija en `platform/web/package.json`) y
 * se publican con el propio sitio: la CSP solo admite imágenes propias (`img-src 'self' data:`). Cada archivo es un recurso aparte (no van dentro del JS) y
 * el navegador solo descarga los que muestra (`loading="lazy"`).
 */
const FILES = import.meta.glob('../../../../node_modules/flag-icons/flags/4x3/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const BY_CODE: ReadonlyMap<string, string> = new Map(Object.entries(FILES).map(([path, url]) => [/([a-z]{2})\.svg$/.exec(path)?.[1] ?? '', url]));

/** URL de la bandera del país (código ISO-2, mayúsculas o minúsculas); `undefined` si el paquete no la trae. */
export const flagUrl = (code: string): string | undefined => BY_CODE.get(code.toLowerCase());
