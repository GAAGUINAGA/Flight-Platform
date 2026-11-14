import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../data/errors';
import { booking, signedIn } from '../../test/purchase-fixtures';
import { renderApp, type Handler } from '../../test/utils';

const date = (label: string, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); };
const fail = (category: ConstructorParameters<typeof AppError>[0]['category'], code: string): Handler => () => { throw new AppError({ category, code, correlationId: 'corr-x' }); };
const node = (id: string, pnr: string, extra = {}) => ({ cursor: `c-${id}`, node: { bookingId: id, pnr, status: 'CONFIRMED', origin: 'UIO', destination: 'GPS', departureDate: '2026-12-10', availableActions: ['cancel'], grandTotal: { currency: 'USD', total: '254.78', baseFare: null, taxes: null }, ...extra } });
const page = (edges: unknown[], next: string | null) => ({ myBookings: { edges, pageInfo: { endCursor: next, hasNextPage: next !== null } } });

describe('confirmación (§3.8)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-01T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('CNF-01 201: el PNR, los boletos, el itinerario en hora local y las acciones; sin hablar de «prueba»', async () => {
    renderApp({ pathname: '/reservas/b-1/confirmacion', state: { outcome: 'COMPLETED', booking: booking() } }, { session: signedIn(), handlers: { Booking: () => ({ booking: booking() }) } });
    expect(await screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    expect(screen.getByTestId('pnr')).toHaveTextContent('ABC123');
    const main = within(screen.getByRole('main'));
    expect(main.getByText('1234567890123')).toBeInTheDocument(); expect(main.getAllByText('Emitido')).toHaveLength(2);
    expect(main.getByText(/Sale: jue 10 dic 2026 · 08:35 · hora de Quito/)).toBeInTheDocument();
    expect(main.getByText(/Llega: jue 10 dic 2026 · 10:30 · hora de Baltra \(Galápagos\)/)).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'Ver mi reserva' })).toHaveAttribute('href', '/reservas/b-1');
    expect(main.getByRole('link', { name: 'Hacer check-in' })).toHaveAttribute('href', '/reservas/b-1/checkin');
    expect(main.getByRole('button', { name: 'Imprimir comprobante' })).toBeInTheDocument();
    expect(main.getByText('******6789')).toBeInTheDocument();
    expect(screen.getByRole('main').textContent).not.toMatch(/prueba/i);
  });

  it('CNF-02 202 pago pendiente: lo explica y consulta la reserva cada pocos segundos hasta que se confirma', async () => {
    vi.useRealTimers(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(new Date('2026-12-01T15:00:00Z'));
    let reads = 0; const pending = booking({ status: 'PENDING_PAYMENT', tickets: [], availableActions: ['tickets', 'issue-tickets', 'cancel'] });
    renderApp({ pathname: '/reservas/b-1/confirmacion', state: { outcome: 'PENDING', booking: pending } }, { session: signedIn(), handlers: { Booking: () => { reads += 1; return { booking: reads < 3 ? pending : booking() }; } } });
    // Con setTimeout simulado no se usan las esperas de Testing Library (dependen de él): se avanza el reloj y se consulta de forma síncrona.
    expect(screen.getByRole('heading', { name: 'Estamos confirmando tu pago' })).toBeInTheDocument();
    expect(screen.getByText(/esperando la confirmación del pago/)).toBeInTheDocument();
    expect(screen.getByTestId('pnr')).toHaveTextContent('ABC123');
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); }); expect(reads).toBe(2);
    expect(screen.getByRole('heading', { name: 'Estamos confirmando tu pago' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(screen.getByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    const calls = reads; await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); expect(reads).toBe(calls); // confirmada: deja de consultar
  });

  it('CNF-03 emisión en curso: ofrece reintentar la emisión y muestra el resultado', async () => {
    const issuing = booking({ status: 'TICKET_ISSUING', tickets: [], availableActions: ['tickets', 'issue-tickets', 'cancel'] });
    const { client } = renderApp({ pathname: '/reservas/b-1/confirmacion', state: { booking: issuing } }, { session: signedIn(), handlers: { Booking: () => ({ booking: issuing }), IssueTickets: () => ({ issueTickets: { issued: 2, booking: booking() } }) } });
    expect(await screen.findByRole('heading', { name: 'Estamos emitiendo tus boletos' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar la emisión' }));
    expect(await screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    expect(client.calls.filter((call) => call.name === 'IssueTickets')).toHaveLength(1);
  });

  it('CNF-04 reserva no completada: sin cargo y con la salida de buscar de nuevo', async () => {
    renderApp({ pathname: '/reservas/b-1/confirmacion', state: { booking: booking({ status: 'FAILED', tickets: [] }) } }, { session: signedIn(), handlers: { Booking: () => ({ booking: booking({ status: 'FAILED', tickets: [] }) }) } });
    expect(await screen.findByRole('heading', { name: 'No pudimos completar tu reserva' })).toBeInTheDocument();
    expect(screen.getByText(/no se realizó ningún cargo/)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Buscar vuelos' })).toHaveAttribute('href', '/');
  });
});

describe('mis reservas (§3.9)', () => {
  it('BKL-01 lista con el aviso de agencias o socios, fecha local del vuelo, estado con texto y «cargar más» con el cursor', async () => {
    const user = userEvent.setup(); let calls = 0;
    const { client } = renderApp('/reservas', { session: signedIn(), handlers: { MyBookings: () => { calls += 1; return calls === 1 ? page([node('b-3', 'CCC333'), node('b-2', 'BBB222', { status: 'CANCELLED' })], 'cur-2') : page([node('b-1', 'AAA111')], null); } } });
    expect(await screen.findByRole('heading', { name: 'Mis reservas' })).toBeInTheDocument();
    expect(screen.getByText('¿Compraste por una agencia o con un socio?')).toBeInTheDocument();
    expect(screen.getByText('Gestiona tu reserva con quien te la vendió. Aquí solo aparecen las reservas hechas en este sitio.')).toBeInTheDocument();
    const items = await screen.findAllByRole('article'); expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['Reserva CCC333', 'Reserva BBB222']);
    expect(within(items[0]).getByText(/UIO → GPS · sale el 10 dic 2026/)).toBeInTheDocument(); expect(within(items[0]).getByText('Confirmada')).toBeInTheDocument(); expect(within(items[1]).getByText('Cancelada')).toBeInTheDocument();
    expect(within(items[0]).getByRole('link', { name: 'Ver reserva CCC333' })).toHaveAttribute('href', '/reservas/b-3');
    expect(client.calls[0].variables).toMatchObject({ filter: null, first: 10, after: null });
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
    expect(client.calls[1].variables).toMatchObject({ after: 'cur-2' });
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('BKL-02 los filtros de la lista v2 (PNR, estado, fechas de creación) se envían y se limpian; un filtro inválido no llama al servidor', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/reservas', { session: signedIn(), handlers: { MyBookings: () => page([node('b-1', 'AAA111')], null) } });
    await screen.findByRole('article');
    await user.type(screen.getByLabelText('Código de reserva'), 'aaa111'); await user.selectOptions(screen.getByLabelText('Estado'), 'CONFIRMED');
    date('Creada desde', '2026-11-01'); date('Creada hasta', '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(screen.getByText('La fecha final no puede ser anterior a la inicial.')).toBeInTheDocument(); expect(client.calls).toHaveLength(1);
    date('Creada hasta', '2026-11-30');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => expect(client.calls).toHaveLength(2));
    expect(client.calls[1].variables).toMatchObject({ filter: { pnr: 'AAA111', status: 'CONFIRMED', createdFrom: '2026-11-01', createdTo: '2026-11-30' } });
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    await waitFor(() => expect(client.calls).toHaveLength(3)); expect(client.calls[2].variables).toMatchObject({ filter: null });
  });

  it('BKL-03 vacío (con y sin filtros), error con reintento y un error al cargar más que no borra lo ya mostrado', async () => {
    const user = userEvent.setup(); const down = (): never => { throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'c' }); };
    const empty = renderApp('/reservas', { session: signedIn(), handlers: { MyBookings: () => page([], null) } });
    expect(await screen.findByRole('heading', { name: 'Aún no tienes reservas' })).toBeInTheDocument();
    empty.unmount();
    const broken = renderApp('/reservas', { session: signedIn(), handlers: { MyBookings: down } });
    expect(await screen.findByRole('alert')).toHaveTextContent('El servicio no está disponible');
    broken.unmount();
    renderApp('/reservas', { session: signedIn(), handlers: { MyBookings: (call) => { if ((call.variables as { after: string | null }).after) return down(); return page([node('b-1', 'AAA111')], 'cur'); } } });
    await user.click(await screen.findByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('BKL-04 sin sesión lleva al inicio de sesión y vuelve a Mis reservas', async () => {
    renderApp('/reservas');
    expect(await screen.findByRole('link', { name: 'Crear una cuenta' })).toHaveAttribute('href', '/registro?returnTo=%2Freservas');
  });
});

describe('detalle de una reserva (§3.10)', () => {
  it('DET-01 confirmada: itinerario en hora local, pasajeros con documento enmascarado, boletos, historial y las acciones que permite su estado', async () => {
    renderApp('/reservas/b-1', { session: signedIn(), handlers: { Booking: () => ({ booking: booking() }) } });
    expect(await screen.findByTestId('pnr')).toHaveTextContent('ABC123');
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Confirmada')).toBeInTheDocument(); expect(main.getByText('USD 254,78')).toBeInTheDocument();
    expect(main.getByText(/Sale: jue 10 dic 2026 · 08:35 · hora de Quito/)).toBeInTheDocument();
    expect(main.getByText('******6789')).toBeInTheDocument(); expect(main.getByText('FP103: 8A')).toBeInTheDocument();
    expect(main.getByText('1234567890123')).toBeInTheDocument(); expect(main.getByText(/Boletos emitidos/)).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'Check-in y pase de abordar' })).toHaveAttribute('href', '/reservas/b-1/checkin');
    expect(main.getByRole('link', { name: 'Gestionar mi reserva' })).toHaveAttribute('href', '/reservas/b-1/postventa');
  });

  it('DET-02 las acciones salen de booking(bookingId): cancelada = solo lectura; en proceso = bloqueada con «En proceso»; sin acciones, sin botones', async () => {
    const cancelled = renderApp('/reservas/b-1', { session: signedIn(), handlers: { Booking: () => ({ booking: booking({ status: 'CANCELLED', availableActions: ['tickets'] }) }) } });
    expect(await screen.findByText('Esta reserva está cancelada.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Gestionar mi reserva' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Check-in/ })).not.toBeInTheDocument();
    cancelled.unmount();
    renderApp('/reservas/b-1', { session: signedIn(), handlers: { Booking: () => ({ booking: booking({ status: 'CHANGE_PENDING', availableActions: ['tickets'] }) }) } });
    expect(await screen.findByText('Hay una operación en proceso.')).toBeInTheDocument(); expect(screen.getByText('Cambio en proceso')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Gestionar mi reserva' })).not.toBeInTheDocument();
  });

  it('DET-03 una reserva inexistente o ajena (404) muestra un mensaje único', async () => {
    renderApp('/reservas/de-otra-persona', { session: signedIn(), handlers: { Booking: fail('NOT_FOUND', 'NOT_FOUND') } });
    expect(await screen.findByRole('heading', { name: 'Reserva no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a mis reservas' })).toHaveAttribute('href', '/reservas');
  });

  it('DET-04 emisión pendiente: «Reintentar la emisión» reemplaza la reserva con el resultado', async () => {
    renderApp('/reservas/b-1', { session: signedIn(), handlers: { Booking: () => ({ booking: booking({ status: 'TICKET_ISSUING', availableActions: ['issue-tickets', 'cancel'], tickets: [] }) }), IssueTickets: () => ({ issueTickets: { issued: 2, booking: booking() } }) } });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reintentar la emisión' }));
    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
  });
});
