import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

// Aserciones mínimas de DOM (sin dependencia adicional): las que usan las pruebas de componentes.
expect.extend({
  toBeInTheDocument(received: Element | null) { const pass = received !== null && document.contains(received); return { pass, message: () => `se esperaba que el elemento ${pass ? 'no ' : ''}estuviera en el documento` }; },
  toHaveTextContent(received: Element, expected: string | RegExp) { const text = (received.textContent ?? '').replace(/\s+/g, ' ').trim(); const pass = typeof expected === 'string' ? text.includes(expected) : expected.test(text); return { pass, message: () => `texto: «${text}»; esperado ${pass ? 'distinto de ' : ''}«${String(expected)}»` }; },
  toHaveAttribute(received: Element, name: string, value?: string) { const actual = received.getAttribute(name); const pass = value === undefined ? actual !== null : actual === value; return { pass, message: () => `atributo ${name}=«${String(actual)}»; esperado ${pass ? 'distinto de ' : ''}«${String(value)}»` }; },
  toHaveValue(received: HTMLInputElement | HTMLSelectElement, value: string) { const pass = received.value === value; return { pass, message: () => `valor «${received.value}»; esperado ${pass ? 'distinto de ' : ''}«${value}»` }; },
  toHaveFocus(received: Element) { const pass = document.activeElement === received; return { pass, message: () => `foco en ${document.activeElement?.outerHTML.slice(0, 120) ?? 'nada'}` }; },
  toBeChecked(received: HTMLInputElement) { return { pass: received.checked === true, message: () => 'se esperaba marcado' }; },
  toBeDisabled(received: HTMLButtonElement) { return { pass: received.disabled === true, message: () => 'se esperaba deshabilitado' }; }
});

// jsdom no implementa el desplazamiento de la ventana ni de los elementos.
// Las pruebas con entorno node (análisis de archivos) no tienen ventana.
if (typeof window !== 'undefined') {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  afterEach(() => { cleanup(); window.localStorage.clear(); });
}
