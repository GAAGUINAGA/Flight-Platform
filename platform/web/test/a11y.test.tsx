import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/data/errors';
import { customer, expectAccessible, fakeSession, renderApp, searchResult, type Handler } from './utils';

/** Accesibilidad automática (axe) de cada pantalla de esta entrega, en sus estados principales. */
const status = { flightStatus: {
  flightNumber: 'FP103', date: '2026-12-10', marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'A320', status: 'DELAYED', delayMinutes: 25, updatedAt: '2026-12-10T12:00:00Z',
  departure: { iataCode: 'UIO', terminal: '1', gate: 'A12', scheduledAt: '2026-12-10T13:35:00Z', estimatedAt: '2026-12-10T14:00:00Z', actualAt: null },
  arrival: { iataCode: 'GPS', terminal: null, gate: null, scheduledAt: '2026-12-10T16:30:00Z', estimatedAt: null, actualAt: null }
} };
const RESULTS = '/resultados?tipo=idavuelta&tramos=UIO-GPS-2026-12-10,GPS-UIO-2026-12-17&adultos=2';
const unavailable: Handler = () => { throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'corr', retryAfterSeconds: 20 }); };

const SCREENS: Array<{ name: string; route: string; handlers?: Record<string, Handler>; ready: () => Promise<unknown>; signedIn?: boolean }> = [
  { name: 'Inicio', route: '/', ready: () => screen.findByRole('form', { name: 'Buscar vuelos' }) },
  { name: 'Resultados · con ofertas', route: RESULTS, handlers: { SearchFlights: () => searchResult() }, ready: () => screen.findAllByRole('article') },
  { name: 'Resultados · vacío', route: RESULTS, handlers: { SearchFlights: () => ({ searchFlights: { totalOffers: 0, offers: [] } }) }, ready: () => screen.findByText('No hay vuelos para esa fecha') },
  { name: 'Resultados · cargando', route: RESULTS, handlers: { SearchFlights: () => new Promise(() => undefined) }, ready: () => screen.findByText('Buscando vuelos…') },
  { name: 'Resultados · error con espera', route: RESULTS, handlers: { SearchFlights: unavailable }, ready: () => screen.findByRole('alert') },
  { name: 'Resultados · búsqueda inválida', route: '/resultados?tipo=ida', ready: () => screen.findByText('Esta búsqueda no es válida o ya venció.') },
  { name: 'Oferta provisional', route: '/oferta/of-1', ready: () => screen.findByText('Ya casi puedes comprar aquí') },
  { name: 'Estado de un vuelo · formulario', route: '/estado', ready: () => screen.findByLabelText('Número de vuelo') },
  { name: 'Estado de un vuelo · resultado', route: '/estado?vuelo=FP103&fecha=2026-12-10', handlers: { FlightStatus: () => status }, ready: () => screen.findByTestId('flight-status') },
  { name: 'Estado de un vuelo · no encontrado', route: '/estado?vuelo=FP999&fecha=2026-12-10', handlers: { FlightStatus: () => { throw new AppError({ category: 'NOT_FOUND', code: 'FLIGHT_STATUS_NOT_AVAILABLE', correlationId: 'c' }); } }, ready: () => screen.findByRole('alert') },
  { name: 'Iniciar sesión', route: '/acceso', ready: () => screen.findByRole('heading', { name: 'Iniciar sesión' }) },
  { name: 'Registrarse', route: '/registro', ready: () => screen.findByRole('heading', { name: 'Crear cuenta' }) },
  { name: 'Recuperar contraseña', route: '/recuperar', ready: () => screen.findByRole('heading', { name: 'Recuperar contraseña' }) },
  { name: 'Nueva contraseña', route: '/nueva-contrasena', signedIn: true, ready: () => screen.findByRole('heading', { name: 'Nueva contraseña' }) },
  { name: 'Retorno del enlace · enlace vencido', route: '/acceso/retorno?error_code=otp_expired', ready: () => screen.findByRole('heading', { name: 'Enlace no válido' }) },
  { name: 'Sesión expirada', route: '/sesion-expirada?returnTo=%2Festado', ready: () => screen.findByRole('heading', { name: 'Tu sesión expiró' }) },
  { name: '403 sin permiso', route: '/sin-permiso', ready: () => screen.findByRole('heading', { name: 'No tienes permiso para esta sección' }) },
  { name: '404 no encontrado', route: '/no-existe', ready: () => screen.findByRole('heading', { name: 'No encontramos esa página' }) },
  { name: 'Servicio no disponible', route: '/no-disponible?espera=30&id=corr-1', ready: () => screen.findByRole('heading', { name: 'Estamos teniendo problemas' }) }
];

describe('accesibilidad automática (axe) de las pantallas', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-01T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(SCREENS)('A11Y-01 $name: sin infracciones, un solo h1, idioma y región principal', async ({ route, handlers, ready, signedIn }) => {
    renderApp(route, { handlers, ...(signedIn ? { session: fakeSession({ status: 'authenticated', user: customer, expiresAt: null }) } : {}) });
    await ready();
    await expectAccessible();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toBeInTheDocument();
  });

  it('A11Y-02 formularios con errores visibles y el menú móvil abierto: sin infracciones', async () => {
    const user = userEvent.setup();
    const login = renderApp('/acceso');
    await user.click((await screen.findAllByRole('button', { name: 'Iniciar sesión' }))[0]);
    await screen.findByText('Escribe un correo válido.');
    await expectAccessible();
    login.unmount();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await screen.findByRole('dialog', { name: 'Menú' });
    await expectAccessible();
  });

  it('A11Y-03 toda imagen tiene texto alternativo y todo control de formulario tiene nombre accesible', async () => {
    renderApp('/');
    await screen.findByRole('form', { name: 'Buscar vuelos' });
    for (const image of document.querySelectorAll('img')) expect(image.hasAttribute('alt')).toBe(true);
    for (const control of document.querySelectorAll<HTMLElement>('input, select, button')) {
      const labelled = control.getAttribute('aria-label') || (control.id && document.querySelector(`label[for="${control.id}"]`)) || control.closest('label') || control.textContent?.trim();
      expect(Boolean(labelled), control.outerHTML.slice(0, 80)).toBe(true);
    }
  });
});
