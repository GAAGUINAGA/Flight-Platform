import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/data/errors';
import { adminFlights, adminSession, agreement, bookingByPnr, customerSession, FI_1, fare, fares, health, operations, statusUpdate, webBookings } from './admin-fixtures';
import { expectAccessible, renderApp, type Handler } from './utils';

/** Accesibilidad automática (axe) de TODAS las pantallas nuevas del panel de administrador (F12c-3), en sus estados principales. */
const base: Record<string, Handler> = { FlightOperations: () => operations(), AdminFlights: () => adminFlights(), PlatformHealth: () => health(), AdminFares: () => fares(), AdminWebBookings: () => webBookings(), PromotionAgreement: () => agreement(), UpdateFlightStatus: () => statusUpdate() };
const failing = (code: string, category: AppError['category']): Handler => () => { throw new AppError({ category, code, correlationId: 'corr-1', retryAfterSeconds: 20 }); };
type User = ReturnType<typeof userEvent.setup>;
type Screen = { name: string; route: string; handlers?: Record<string, Handler>; session?: () => ReturnType<typeof adminSession>; ready: () => Promise<unknown>; act?: (user: User) => Promise<void> };

const openStatus = async (user: User): Promise<void> => { await user.click(await screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' })); await screen.findByTestId('status-form'); };
const pickFlight = async (user: User): Promise<void> => { const select = await screen.findByLabelText('Vuelo'); await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1)); await user.selectOptions(select, FI_1); await screen.findByRole('table'); };

const SCREENS: Screen[] = [
  { name: 'Dashboard', route: '/admin', ready: () => screen.findByTestId('metric-flights') },
  { name: 'Dashboard · salud caída', route: '/admin', handlers: { PlatformHealth: () => health('DOWN') }, ready: () => screen.findByText('La plataforma reporta que está caída.') },
  { name: 'Dashboard · vacío', route: '/admin', handlers: { FlightOperations: () => operations([]) }, ready: () => screen.findByText('No hay vuelos para esos criterios') },
  { name: 'Dashboard · error 403', route: '/admin', handlers: { FlightOperations: failing('FORBIDDEN', 'FORBIDDEN') }, ready: () => screen.findByText('No tienes permiso para esta acción.') },
  { name: 'Vuelos · lista', route: '/admin/vuelos', ready: () => screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' }) },
  { name: 'Vuelos · formulario de estado', route: '/admin/vuelos', ready: () => screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' }), act: openStatus },
  { name: 'Vuelos · formulario con errores', route: '/admin/vuelos', ready: () => screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' }), act: async (user) => { await openStatus(user); await user.selectOptions(screen.getByLabelText('Nuevo estado'), 'DELAYED'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await screen.findByText('Un retraso necesita la nueva hora estimada de salida.'); } },
  { name: 'Vuelos · confirmación de un cambio irreversible', route: '/admin/vuelos', ready: () => screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' }), act: async (user) => { await openStatus(user); await user.selectOptions(screen.getByLabelText('Nuevo estado'), 'CANCELLED'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await screen.findByTestId('status-confirm'); } },
  { name: 'Vuelos · error de transición', route: '/admin/vuelos', handlers: { UpdateFlightStatus: failing('INVALID_STATUS_TRANSITION', 'CONFLICT') }, ready: () => screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' }), act: async (user) => { await openStatus(user); await user.selectOptions(screen.getByLabelText('Nuevo estado'), 'BOARDING'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await user.click(await screen.findByRole('button', { name: 'Confirmar cambio' })); await screen.findByRole('alert'); } },
  { name: 'Vuelos · resultado del cambio', route: '/admin/vuelos', ready: () => screen.findByRole('button', { name: 'Cambiar estado del vuelo FP103' }), act: async (user) => { await openStatus(user); await user.selectOptions(screen.getByLabelText('Nuevo estado'), 'BOARDING'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await user.click(await screen.findByRole('button', { name: 'Confirmar cambio' })); await screen.findByTestId('status-result'); } },
  { name: 'Vuelos · vacío', route: '/admin/vuelos', handlers: { AdminFlights: () => adminFlights([]), FlightOperations: () => operations([]) }, ready: () => screen.findByText(/No hay vuelos el /) },
  { name: 'Tarifas · sin vuelo elegido', route: '/admin/tarifas', ready: () => screen.findByLabelText('Vuelo') },
  { name: 'Tarifas · lista', route: '/admin/tarifas', ready: () => screen.findByLabelText('Vuelo'), act: pickFlight },
  { name: 'Tarifas · formulario', route: '/admin/tarifas', ready: () => screen.findByLabelText('Vuelo'), act: async (user) => { await pickFlight(user); await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); await screen.findByTestId('fare-form'); } },
  { name: 'Tarifas · formulario con errores', route: '/admin/tarifas', ready: () => screen.findByLabelText('Vuelo'), act: async (user) => { await pickFlight(user); await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); await user.clear(await screen.findByLabelText('Importe total (USD)')); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await screen.findByText(/hasta dos decimales, por ejemplo 127.39\./); } },
  { name: 'Tarifas · confirmación con antes y después', route: '/admin/tarifas', ready: () => screen.findByLabelText('Vuelo'), act: async (user) => { await pickFlight(user); await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); const total = await screen.findByLabelText('Importe total (USD)'); await user.clear(total); await user.type(total, '130.50'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await screen.findByTestId('fare-confirm'); } },
  { name: 'Tarifas · sin tarifas', route: '/admin/tarifas', handlers: { AdminFares: () => fares([]) }, ready: () => screen.findByLabelText('Vuelo'), act: async (user) => { const select = await screen.findByLabelText('Vuelo'); await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1)); await user.selectOptions(select, FI_1); await screen.findByText('Este vuelo aún no tiene tarifas'); } },
  { name: 'Tarifas · guardada', route: '/admin/tarifas', handlers: { UpsertFare: () => ({ upsertFare: fare() }) }, ready: () => screen.findByLabelText('Vuelo'), act: async (user) => { await pickFlight(user); await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); const total = await screen.findByLabelText('Importe total (USD)'); await user.clear(total); await user.type(total, '130.50'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await user.click(await screen.findByRole('button', { name: 'Guardar tarifa' })); await screen.findByTestId('fare-saved'); } },
  { name: 'Promociones · acuerdo vigente', route: '/admin/promociones', ready: () => screen.findByTestId('agreement') },
  { name: 'Promociones · sin acuerdo', route: '/admin/promociones', handlers: { PromotionAgreement: () => ({ promotionAgreement: null }) }, ready: () => screen.findByText('Aún no hay acuerdo de promociones') },
  { name: 'Promociones · formulario', route: '/admin/promociones', ready: () => screen.findByTestId('agreement'), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Editar el acuerdo' })); await screen.findByTestId('promotion-form'); } },
  { name: 'Promociones · descuento fuera de rango', route: '/admin/promociones', ready: () => screen.findByTestId('agreement'), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Editar el acuerdo' })); const percent = await screen.findByLabelText('Descuento máximo (%)'); await user.clear(percent); await user.type(percent, '120'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await screen.findByText('El descuento máximo debe estar entre 0 y 100.'); } },
  { name: 'Promociones · confirmación', route: '/admin/promociones', ready: () => screen.findByTestId('agreement'), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Editar el acuerdo' })); const percent = await screen.findByLabelText('Descuento máximo (%)'); await user.clear(percent); await user.type(percent, '20'); await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await screen.findByTestId('promotion-confirm'); } },
  { name: 'Reservas web · lista', route: '/admin/reservas-web', ready: () => screen.findByRole('table') },
  { name: 'Reservas web · con más páginas', route: '/admin/reservas-web', handlers: { AdminWebBookings: () => webBookings(undefined, 'cursor') }, ready: () => screen.findByRole('button', { name: 'Cargar más reservas' }) },
  { name: 'Reservas web · vacío', route: '/admin/reservas-web', handlers: { AdminWebBookings: () => webBookings([]) }, ready: () => screen.findByText('Aún no hay reservas del canal web') },
  { name: 'Reservas web · error', route: '/admin/reservas-web', handlers: { AdminWebBookings: failing('PROVIDER_UNAVAILABLE', 'UNAVAILABLE') }, ready: () => screen.findByRole('alert') },
  { name: 'Buscar reserva · formulario', route: '/admin/reservas', ready: () => screen.findByLabelText('Localizador (PNR)') },
  { name: 'Buscar reserva · encontrada', route: '/admin/reservas', handlers: { AdminBookingByPnr: () => bookingByPnr() }, ready: () => screen.findByLabelText('Localizador (PNR)'), act: async (user) => { await user.type(screen.getByLabelText('Localizador (PNR)'), 'J4R8GZ'); await user.click(screen.getByRole('button', { name: 'Buscar' })); await screen.findByTestId('booking-result'); } },
  { name: 'Buscar reserva · no encontrada', route: '/admin/reservas', handlers: { AdminBookingByPnr: () => ({ adminBookingByPnr: null }) }, ready: () => screen.findByLabelText('Localizador (PNR)'), act: async (user) => { await user.type(screen.getByLabelText('Localizador (PNR)'), 'ZZZZZZ'); await user.click(screen.getByRole('button', { name: 'Buscar' })); await screen.findByTestId('booking-missing'); } },
  { name: 'Buscar reserva · límite superado', route: '/admin/reservas', handlers: { AdminBookingByPnr: failing('RATE_LIMIT_EXCEEDED', 'RATE_LIMITED') }, ready: () => screen.findByLabelText('Localizador (PNR)'), act: async (user) => { await user.type(screen.getByLabelText('Localizador (PNR)'), 'J4R8GZ'); await user.click(screen.getByRole('button', { name: 'Buscar' })); await screen.findByText('Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.'); } },
  { name: 'Panel · ruta inexistente', route: '/admin/nada', ready: () => screen.findByRole('heading', { name: 'No encontramos esa página' }) },
  { name: 'Panel · cliente sin permiso', route: '/admin', session: customerSession, ready: () => screen.findByRole('heading', { name: 'No tienes permiso para esta sección' }) }
];

describe('accesibilidad automática (axe) del panel de administrador', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-10T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(SCREENS)('A11Y-A $name: sin infracciones, un solo h1 y región principal', async ({ route, handlers, session, ready, act }) => {
    renderApp(route, { handlers: { ...base, ...handlers }, session: (session ?? adminSession)() });
    await ready(); if (act) await act(userEvent.setup());
    await expectAccessible();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('A11Y-A2 toda tabla tiene título y encabezados de columna con scope, y la primera celda de cada fila es un encabezado de fila; los controles tienen nombre', async () => {
    for (const route of ['/admin', '/admin/vuelos', '/admin/reservas-web']) {
      const view = renderApp(route, { handlers: base, session: adminSession() });
      const table = await screen.findByRole('table'); expect(table.querySelector('caption')?.textContent?.length).toBeGreaterThan(0);
      for (const header of table.querySelectorAll('thead th')) expect(header.getAttribute('scope')).toBe('col');
      for (const row of table.querySelectorAll('tbody tr')) expect(row.querySelector('th[scope="row"]')).not.toBeNull();
      for (const control of document.querySelectorAll<HTMLElement>('main input, main select, main button')) {
        const named = control.getAttribute('aria-label') || (control.id && document.querySelector(`label[for="${control.id}"]`)) || control.closest('label') || control.textContent?.trim();
        expect(Boolean(named), control.outerHTML.slice(0, 90)).toBe(true);
      }
      view.unmount();
    }
  });
});
