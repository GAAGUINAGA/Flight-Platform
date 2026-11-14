import { tokens, type Tokens } from './tokens';

type TokenValue = string | number | { readonly [key: string]: TokenValue };

const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
/** Grupos cuyos números no llevan unidad. */
const UNITLESS = ['font-weight', 'font-line-height'];

function flatten(prefix: string, value: TokenValue, out: Array<[string, string]>): void {
  if (typeof value === 'object') { for (const [key, child] of Object.entries(value)) flatten(prefix ? `${prefix}-${kebab(key)}` : kebab(key), child, out); return; }
  const unitless = UNITLESS.some((group) => prefix.startsWith(group));
  out.push([`--${prefix}`, typeof value === 'number' ? (unitless ? String(value) : `${value}px`) : value]);
}

/** Lista `[--variable, valor]` de todos los tokens (p. ej. `--color-primary`, `--space-s4`, `--font-size-md`). */
export function cssVariables(source: Tokens = tokens): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  flatten('', source as unknown as TokenValue, out);
  return out;
}

/** Contenido de `tokens.css`: las variables en `:root`. Se genera; no se edita a mano. */
export function tokensToCss(source: Tokens = tokens): string {
  const lines = cssVariables(source).map(([name, value]) => `  ${name}: ${value};`);
  return `/* GENERADO desde packages/design-tokens/src/tokens.ts (npm run build -w @flight-platform/design-tokens). No editar a mano. */\n:root {\n${lines.join('\n')}\n}\n`;
}
