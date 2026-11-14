import { brand, type PhotoKey } from '@flight-platform/brand';
import '@flight-platform/design-tokens/tokens.css';
import '@flight-platform/brand/assets/fonts/fonts.css';

/**
 * ÚNICO archivo de la web que resuelve los archivos de la marca (logotipo y fotografías) a sus URL publicadas.
 * Las pantallas piden «el logo» o «la foto X»; nunca escriben rutas de imagen (diseño F12c-0 §2.1).
 */
const files = import.meta.glob<string>('../../../../packages/brand/assets/**/*.{svg,jpg}', { eager: true, query: '?url', import: 'default' });
const urlOf = (file: string): string => files[`../../../../packages/brand/assets/${file}`] ?? '';

export const logoUrl = (variant: 'light' | 'dark'): string => urlOf(brand.logo[variant]);
export const photoUrl = (key: PhotoKey): string => urlOf(brand.photos[key].file);
