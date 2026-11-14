import { screen, within } from '@testing-library/react';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { boardingPassQr } from '@flight-platform/format';
import { passes, signedIn, booking } from '../../test/purchase-fixtures';
import { expectAccessible, renderApp } from '../../test/utils';

const SCALE = 6;
/** Rasteriza el SVG tal como lo dibuja el navegador (rectángulos del trazado `M x y h w v1 h-w z` sobre fondo blanco) para decodificarlo con un lector real. */
function rasterize(svg: Element): { data: Uint8ClampedArray; width: number; height: number } {
  const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  const width = w * SCALE; const height = h * SCALE; const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const d = svg.querySelector('path')?.getAttribute('d') ?? '';
  for (const match of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, len] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let py = y * SCALE; py < (y + 1) * SCALE; py += 1) for (let px = x * SCALE; px < (x + len) * SCALE; px += 1) { const i = (py * width + px) * 4; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255; }
  }
  return { data, width, height };
}

describe('código QR del pase de abordar (PLAN §6 W4-02)', () => {
  it('QR-01 cada pase muestra un QR que, decodificado, es EXACTAMENTE el valor del pase; su texto alternativo incluye el código en texto', async () => {
    renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { Booking: () => ({ booking: booking() }), BoardingPasses: () => passes() } });
    const articles = await screen.findAllByRole('article'); expect(articles).toHaveLength(2);
    for (const [index, pass] of passes().boardingPasses.entries()) {
      const qr = within(articles[index]).getByRole('img', { name: new RegExp(`^Código QR del pase de abordar de .+\\. Código del pase: ${pass.barcode.replace(/[/]/g, '\\/')}$`) });
      const image = rasterize(qr); const decoded = jsQR(image.data, image.width, image.height);
      expect(decoded?.data).toBe(pass.barcode);
      expect(articles[index]).toHaveTextContent(pass.barcode); // el valor sigue visible en texto
    }
  });

  it('QR-02 se dibuja en el navegador y respeta la CSP: sin imágenes remotas, sin estilos en línea y sin scripts', async () => {
    const view = renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { Booking: () => ({ booking: booking() }), BoardingPasses: () => passes() } });
    const [qr] = await screen.findAllByTestId('boarding-qr');
    expect(qr.tagName.toLowerCase()).toBe('svg'); expect(qr.querySelector('script, image, foreignObject, [style]')).toBeNull(); expect(qr.hasAttribute('style')).toBe(false);
    expect(view.container.querySelector('img[src^="http"]')).toBeNull();
    await expectAccessible(view.container);
  });

  it('QR-03 boardingPassQr (sin DOM): valores vacíos o desmedidos no generan QR; los demás se decodifican idénticos', () => {
    expect(boardingPassQr('')).toBeNull(); expect(boardingPassQr('x'.repeat(1001))).toBeNull();
    const value = 'M1PÉREZ/ANA ABC123 UIOGPS FP103 0345 8A'; const matrix = boardingPassQr(value);
    expect(matrix).not.toBeNull(); expect(matrix!.modules).toHaveLength(matrix!.size * matrix!.size);
    const side = matrix!.size + 8; const data = new Uint8ClampedArray(side * side * 4 * SCALE * SCALE).fill(255); const width = side * SCALE;
    matrix!.modules.forEach((dark, i) => { if (!dark) return; const row = Math.floor(i / matrix!.size) + 4; const column = (i % matrix!.size) + 4; for (let py = row * SCALE; py < (row + 1) * SCALE; py += 1) for (let px = column * SCALE; px < (column + 1) * SCALE; px += 1) { const at = (py * width + px) * 4; data[at] = 0; data[at + 1] = 0; data[at + 2] = 0; } });
    expect(jsQR(data, width, side * SCALE)?.data).toBe(value);
  });
});
