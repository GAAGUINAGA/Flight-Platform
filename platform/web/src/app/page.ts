import { useEffect } from 'react';
import { brand } from '@flight-platform/brand';

/** Título del documento: «<pantalla> · <marca>» (el nombre sale de la configuración de marca). */
export function usePageTitle(title: string): void {
  useEffect(() => { document.title = title ? `${title} · ${brand.name}` : brand.name; }, [title]);
}
