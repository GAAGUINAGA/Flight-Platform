import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/data/errors';
import { booking, hold, passes, seatMap, signedIn, startedPurchase } from './purchase-fixtures';
import { expectAccessible, renderApp, type Handler } from './utils';

/** Accesibilidad automática (axe) de TODAS las pantallas nuevas de F12c-2b, en sus estados principales. */
const money = (total: string) => ({ currency: 'USD', total, baseFare: null, taxes: null });
const down: Handler = () => { throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'corr', retryAfterSeconds: 20 }); };
const edge = (id: string, pnr: string) => ({ cursor: id, node: { bookingId: id, pnr, status: 'CONFIRMED', origin: 'UIO', destination: 'GPS', departureDate: '2026-12-10', availableActions: ['cancel'], grandTotal: money('254.78') } });
const base = { Booking: () => ({ booking: booking() }), Hold: () => hold(), SeatMap: () => seatMap() };
const quote = { cancellationQuote: { quoteId: 'q-1', isRefundable: true, refundAmount: '200.00', penaltyAmount: '54.78', currency: 'USD', expiresAt: '2026-12-01T15:05:00Z' } };

type Screen = { name: string; route: string; handlers?: Record<string, Handler>; purchase?: () => ReturnType<typeof startedPurchase>['purchase']; ready: () => Promise<unknown>; act?: (user: ReturnType<typeof userEvent.setup>) => Promise<void> };
const SCREENS: Screen[] = [
  { name: 'Oferta y mapa de asientos', route: '/oferta/of-1', handlers: base, purchase: () => startedPurchase().purchase, ready: () => screen.findByRole('button', { name: 'Asiento 8A, ventana, elegido por Pasajero 1' }) },
  { name: 'Oferta · error SEAT_TAKEN', route: '/oferta/of-1', handlers: { ...base, HoldOffer: () => { throw new AppError({ category: 'CONFLICT', code: 'SEAT_TAKEN', correlationId: 'c' }); } }, purchase: () => startedPurchase().purchase, ready: () => screen.findByRole('button', { name: 'Continuar a datos de pasajeros' }), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Continuar a datos de pasajeros' })); await screen.findByRole('alert'); } },
  { name: 'Oferta · selección no disponible', route: '/oferta/otra', handlers: base, purchase: () => startedPurchase().purchase, ready: () => screen.findByRole('heading', { name: 'Tu selección ya no está disponible' }) },
  { name: 'Pasajeros', route: '/compra/pasajeros', handlers: base, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' }) },
  { name: 'Pasajeros · con errores', route: '/compra/pasajeros', handlers: base, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' }), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Continuar al pago' })); await screen.findByRole('alert'); } },
  { name: 'Pasajeros · error al salir del campo', route: '/compra/pasajeros', handlers: base, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' }), act: async (user) => { await user.type(screen.getAllByLabelText('Nombres')[0], '-Ana'); await user.type(screen.getByLabelText('Teléfono de contacto'), '0987654321'); await user.tab(); await user.click(screen.getAllByLabelText('Nombres')[0]); await user.tab(); await screen.findByText(/Escribe los nombres solo con letras/); } },
  { name: 'Pasajeros · selector de país del teléfono abierto', route: '/compra/pasajeros', handlers: base, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' }), act: async (user) => { await user.click(screen.getAllByLabelText('País del teléfono')[0]); await screen.findByRole('listbox', { name: 'País del teléfono' }); } },
  { name: 'Pasajeros · selector de nacionalidad con búsqueda', route: '/compra/pasajeros', handlers: base, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' }), act: async (user) => { const field = screen.getAllByLabelText('Nacionalidad')[0]; await user.clear(field); await user.type(field, 'col'); await screen.findByRole('listbox', { name: 'Nacionalidad' }); } },
  { name: 'Pasajeros · fecha fuera de rango y caracteres bloqueados', route: '/compra/pasajeros', handlers: base, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' }), act: async (user) => { await user.type(screen.getAllByLabelText('Fecha de nacimiento')[0], '01012999'); await user.type(screen.getAllByLabelText('Nombres')[0], 'Ana2'); await user.type(screen.getByLabelText('Teléfono de contacto'), '09a'); await screen.findByText(/La fecha debe estar entre/); } },
  { name: 'Pasajeros · errores del servidor', route: '/compra/pasajeros', handlers: base, purchase: () => { const { purchase } = startedPurchase({ withHold: true, withPassengers: true }); purchase.setServerErrors({ '0.documentNumber': 'Escribe el número del documento: entre 5 y 20 letras o números, sin espacios ni guiones.', '1.extraBaggage.it-1': 'Superaste el máximo de maletas permitido para este tramo. Reduce las maletas adicionales.' }); return purchase; }, ready: () => screen.findByRole('alert') },
  { name: 'Pasajeros · hold vencido', route: '/compra/pasajeros', handlers: { ...base, Hold: () => hold({ status: 'EXPIRED' }) }, purchase: () => startedPurchase({ withHold: true }).purchase, ready: () => screen.findByText('Tu selección venció.') },
  { name: 'Pago', route: '/compra/pago', handlers: base, purchase: () => startedPurchase({ withHold: true, withPassengers: true }).purchase, ready: () => screen.findByRole('button', { name: 'Pagar USD 254,78' }) },
  { name: 'Pago · rechazado', route: '/compra/pago', handlers: { ...base, CreateBooking: () => { throw new AppError({ category: 'UNPROCESSABLE', code: 'PAYMENT_NOT_AUTHORIZED', correlationId: 'c' }); } }, purchase: () => startedPurchase({ withHold: true, withPassengers: true }).purchase, ready: () => screen.findByRole('button', { name: 'Pagar USD 254,78' }), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Pagar USD 254,78' })); await screen.findByRole('alert'); } },
  { name: 'Confirmación · confirmada', route: '/reservas/b-1/confirmacion', handlers: base, ready: () => screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' }) },
  { name: 'Confirmación · pago pendiente', route: '/reservas/b-1/confirmacion', handlers: { ...base, Booking: () => ({ booking: booking({ status: 'PENDING_PAYMENT', tickets: [], availableActions: ['issue-tickets'] }) }) }, ready: () => screen.findByRole('heading', { name: 'Estamos confirmando tu pago' }) },
  { name: 'Mis reservas · lista', route: '/reservas', handlers: { MyBookings: () => ({ myBookings: { edges: [edge('b-1', 'ABC123'), edge('b-2', 'DEF456')], pageInfo: { endCursor: 'x', hasNextPage: true } } }) }, ready: () => screen.findAllByRole('article') },
  { name: 'Mis reservas · vacío', route: '/reservas', handlers: { MyBookings: () => ({ myBookings: { edges: [], pageInfo: { endCursor: null, hasNextPage: false } } }) }, ready: () => screen.findByRole('heading', { name: 'Aún no tienes reservas' }) },
  { name: 'Mis reservas · error', route: '/reservas', handlers: { MyBookings: down }, ready: () => screen.findByRole('alert') },
  { name: 'Detalle de la reserva', route: '/reservas/b-1', handlers: base, ready: () => screen.findByTestId('pnr') },
  { name: 'Detalle · no encontrada', route: '/reservas/b-9', handlers: { Booking: () => { throw new AppError({ category: 'NOT_FOUND', code: 'NOT_FOUND', correlationId: 'c' }); } }, ready: () => screen.findByRole('heading', { name: 'Reserva no encontrada' }) },
  { name: 'Postventa · equipaje', route: '/reservas/b-1/postventa?pestana=equipaje', handlers: { ...base, BaggageOptions: () => ({ baggageOptions: [{ passengerId: 'PAX-1', itineraryId: 'it-1', maxAllowed: 3, alreadyPurchased: 0, price: money('35.00') }] }) }, ready: () => screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103') },
  { name: 'Postventa · asiento', route: '/reservas/b-1/postventa?pestana=asiento', handlers: base, ready: () => screen.findByRole('button', { name: 'Asiento 8C, pasillo, libre' }) },
  { name: 'Postventa · fecha', route: '/reservas/b-1/postventa?pestana=fecha', handlers: base, ready: () => screen.findByLabelText('Nueva fecha de salida') },
  { name: 'Postventa · cancelar con cotización', route: '/reservas/b-1/postventa?pestana=cancelar', handlers: { ...base, CancellationQuote: () => quote }, ready: () => screen.findByRole('button', { name: 'Cotizar la cancelación' }), act: async (user) => { await user.click(screen.getByRole('button', { name: 'Cotizar la cancelación' })); await screen.findByRole('region', { name: 'Cotización de la cancelación' }); } },
  { name: 'Check-in · antes de la ventana', route: '/reservas/b-1/checkin', handlers: { ...base, BoardingPasses: () => { throw new AppError({ category: 'CONFLICT', code: 'BOARDING_PASS_NOT_AVAILABLE', correlationId: 'c' }); } }, ready: () => screen.findByTestId('checkin-window') },
  { name: 'Pase de abordar', route: '/reservas/b-1/checkin', handlers: { ...base, BoardingPasses: () => passes() }, ready: () => screen.findAllByRole('article') }
];

describe('accesibilidad automática (axe) de las pantallas de compra, reservas, postventa y check-in', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-01T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(SCREENS)('A11Y-P $name: sin infracciones, un solo h1 y región principal', async ({ route, handlers, purchase, ready, act }) => {
    renderApp(route, { handlers, session: signedIn(), ...(purchase ? { purchase: purchase() } : {}) });
    await ready(); if (act) await act(userEvent.setup());
    await expectAccessible();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('A11Y-P2 el mapa de asientos: cada asiento tiene nombre accesible con su estado y los controles de las pantallas nuevas tienen nombre', async () => {
    renderApp('/oferta/of-1', { handlers: base, session: signedIn(), purchase: startedPurchase().purchase });
    const map = await screen.findByRole('group', { name: 'Mapa de asientos' });
    const seats = within(map).getAllByRole('button'); expect(seats).toHaveLength(8);
    for (const seat of seats) expect(seat.getAttribute('aria-label') ?? '').toMatch(/^Asiento \d+[A-Z], .*(libre|ocupado|apartado|elegido)/);
    for (const control of document.querySelectorAll<HTMLElement>('main input, main select, main button')) {
      const named = control.getAttribute('aria-label') || (control.id && document.querySelector(`label[for="${control.id}"]`)) || control.closest('label') || control.textContent?.trim();
      expect(Boolean(named), control.outerHTML.slice(0, 90)).toBe(true);
    }
  });
});
