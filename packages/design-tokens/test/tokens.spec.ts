/* global __dirname */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, cssVariables, MIN_FONT_SIZE, tokens, tokensToCss } from '../src';

const AA = 4.5;
const c = tokens.color;

describe('design-tokens (F12c-2a)', () => {
  it('TOK-01 tokens.css está generado desde tokens.ts (sin cambios pendientes)', () => {
    expect(readFileSync(join(__dirname, '..', 'tokens.css'), 'utf8')).toBe(tokensToCss());
  });

  it('TOK-02 las variables siguen la convención --grupo-nombre y llevan unidad donde corresponde', () => {
    const map = new Map(cssVariables());
    expect(map.get('--color-primary')).toBe('#0B2A5B');
    expect(map.get('--color-accent-hover')).toBe('#9A3412');
    expect(map.get('--space-s4')).toBe('16px');
    expect(map.get('--font-size-xs')).toBe('12px');
    expect(map.get('--font-weight-bold')).toBe('700');
    expect(map.get('--font-line-height-normal')).toBe('1.5');
    expect(map.get('--radius-pill')).toBe('999px');
    for (const [name] of map) expect(name).toMatch(/^--[a-z][a-z0-9-]*$/);
  });

  it('TOK-03 contraste AA: texto, primario, acento y enlaces sobre fondos claros, y texto claro sobre primario y acento', () => {
    for (const background of [c.background, c.neutral, c.surfaceSoft]) {
      for (const foreground of [c.text, c.textMuted, c.primary, c.link, c.error]) expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA);
    }
    expect(contrastRatio(c.accent, c.background)).toBeGreaterThanOrEqual(AA);
    for (const background of [c.primary, c.primaryHover, c.primarySoft, c.accent, c.accentHover, c.seatChosen]) expect(contrastRatio(c.onPrimary, background)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(c.onPrimaryMuted, c.primary)).toBeGreaterThanOrEqual(AA);
  });

  it('TOK-04 contraste AA de cada estado sobre su fondo suave y sobre blanco', () => {
    const pairs: Array<[string, string]> = [[c.success, c.successSoft], [c.warning, c.warningSoft], [c.error, c.errorSoft], [c.info, c.infoSoft], [c.seatHeldBorder, c.seatHeld]];
    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(foreground, c.background)).toBeGreaterThanOrEqual(AA);
    }
    expect(contrastRatio(c.text, c.seatFree)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(c.text, c.seatOccupied)).toBeGreaterThanOrEqual(AA);
  });

  it('TOK-05 foco y bordes de control distinguibles (≥ 3:1) sobre los fondos claros', () => {
    for (const background of [c.background, c.neutral, c.surfaceSoft]) {
      expect(contrastRatio(c.focus, background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.lineStrong, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('TOK-06 ningún tamaño de texto por debajo de 12 px y la escala es la del diseño', () => {
    expect(MIN_FONT_SIZE).toBe(12);
    for (const size of Object.values(tokens.font.size)) expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    expect(Object.values(tokens.font.size)).toEqual([12, 14, 16, 20, 24, 28, 32]);
    expect(Object.values(tokens.space)).toEqual([4, 8, 12, 16, 24, 32, 48]);
  });
});
