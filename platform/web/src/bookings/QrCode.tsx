import { useMemo } from 'react';
import { boardingPassQr } from '@flight-platform/format';
import s from '../purchase/purchase.module.css';

/** Zona de silencio obligatoria alrededor del QR (módulos). */
const QUIET = 4;

/**
 * Código QR del pase, dibujado como SVG en el navegador a partir de la matriz que genera `@flight-platform/format` (sin DOM, reutilizable
 * en React Native). Sin scripts, sin estilos en línea y sin servicios externos: cumple la CSP; el SVG se imprime tal cual. Siempre negro (palabras clave de color, no valores de marca)
 * sobre blanco (un QR invertido por el tema oscuro no se lee). El texto alternativo incluye el código en texto.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const matrix = useMemo(() => boardingPassQr(value), [value]);
  const path = useMemo(() => {
    if (!matrix) return '';
    const parts: string[] = [];
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        if (!matrix.modules[row * matrix.size + column]) continue;
        let end = column; while (end + 1 < matrix.size && matrix.modules[row * matrix.size + end + 1]) end += 1; // tramo horizontal de módulos oscuros
        parts.push(`M${column + QUIET} ${row + QUIET}h${end - column + 1}v1h${-(end - column + 1)}z`); column = end;
      }
    }
    return parts.join('');
  }, [matrix]);
  if (!matrix) return null;
  const side = matrix.size + QUIET * 2;
  return (
    <svg className={s.qr} viewBox={`0 0 ${side} ${side}`} role="img" aria-label={`${label}. Código del pase: ${value}`} shapeRendering="crispEdges" data-testid="boarding-qr">
      <rect width={side} height={side} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}
