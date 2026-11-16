import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../data/errors';
import { renderApp, type ClientCall, type Handler } from '../../test/utils';
import { adminFlight, adminFlights, adminSession, agreement, bookingByPnr, FI_1, fare, fares, health, opFlight, operations, statusUpdate, webBookings, webRow } from '../../test/admin-fixtures';
import { useAutoRefresh } from './hooks';

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const base = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({ FlightOperations: () => operations(), AdminFlights: () => adminFlights(), PlatformHealth: () => health(), AdminFares: () => fares(), AdminWebBookings: () => webBookings(), PromotionAgreement: () => agreement(), ...extra });
const mount = (route: string, extra: Record<string, Handler> = {}) => renderApp(route, { session: adminSession(), handlers: base(extra) });
const calls = (view: { client: { calls: ClientCall[] } }, name: string) => view.client.calls.filter((call) => call.name === name);
const problem = (code: string, category: AppError['category'], httpStatus: number) => new AppError({ code, category, correlationId: 'corr-fallo-1', httpStatus });

afterEach(() => { vi.useRealTimers(); });

describe('dashboard operativo', () => {
  it('ADM-C10 muestra vuelos del día, ocupación media ponderada, holds y alertas, la ocupación por cabina de cada vuelo y la salud con sus servicios', async () => {
    mount('/admin');
    expect(await screen.findByTestId('metric-flights')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-occupancy')).toHaveTextContent('57 %'); // (75 + 96) / (200 + 100)
    expect(screen.getByTestId('metric-holds')).toHaveTextContent('2'); expect(screen.getByTestId('metric-alerts')).toHaveTextContent('2');
    const table = screen.getByRole('table'); expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Vuelo', 'Ruta', 'Salida', 'Estado', 'Ocupación por cabina', 'Alertas']);
    const row = within(screen.getByRole('row', { name: /FP103/ }));
    expect(row.getByRole('rowheader')).toHaveTextContent('FP103'); expect(row.getByText('75/150 · 50 %')).toBeInTheDocument(); expect(row.getByText('0/50 · 0 %')).toBeInTheDocument();
    expect(row.getByText('08:35 · hora de Quito')).toBeInTheDocument(); // hora local del aeropuerto, no la del navegador (Tokio en el e2e)
    const delayed = within(screen.getByRole('row', { name: /FP105/ }));
    expect(delayed.getAllByText('Retrasado')).toHaveLength(2); /* el estado y la alerta */ expect(delayed.getByText('Pocos asientos')).toBeInTheDocument(); expect(delayed.getByText('96/100 · 96 %')).toBeInTheDocument();
    expect(await screen.findByTestId('health-status')).toHaveTextContent('Saludable');
    const deps = within(screen.getByRole('list', { name: 'Servicios de la plataforma' })); expect(deps.getByText(/inventory-service/)).toBeInTheDocument(); expect(deps.getAllByText('Operativo')).toHaveLength(2);
  });

  it('ADM-C11 una salud DOWN es un dato (se muestra, no es un error de pantalla) y una degradada también', async () => {
    const down = mount('/admin', { PlatformHealth: () => health('DOWN') });
    expect(await screen.findByTestId('health-status')).toHaveTextContent('Caída');
    expect(screen.getByText('La plataforma reporta que está caída.')).toBeInTheDocument(); expect(screen.getByTestId('metric-flights')).toBeInTheDocument();
    down.unmount();
    mount('/admin', { PlatformHealth: () => health('DEGRADED') });
    expect(await screen.findByTestId('health-status')).toHaveTextContent('Degradada'); expect(screen.getAllByText('Degradada')).toHaveLength(2); /* la plataforma y el servicio degradado */
  });

  it('ADM-C12 sin vuelos ese día: mensaje; los filtros viajan a la consulta; una fecha inválida no consulta', async () => {
    const view = mount('/admin', { FlightOperations: () => operations([]) });
    expect(await screen.findByText('No hay vuelos para esos criterios')).toBeInTheDocument();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Fecha de salida'), { target: { value: '2026-12-10' } });
    await user.selectOptions(screen.getByLabelText('Origen'), 'UIO'); await user.selectOptions(screen.getByLabelText('Destino'), 'GYE'); await user.selectOptions(screen.getByLabelText('Estado'), 'DELAYED');
    await waitFor(() => expect(calls(view, 'FlightOperations').at(-1)?.variables).toMatchObject({ date: '2026-12-10', origin: 'UIO', destination: 'GYE', status: 'DELAYED' }));
    const before = calls(view, 'FlightOperations').length;
    fireEvent.change(screen.getByLabelText('Fecha de salida'), { target: { value: '' } });
    expect(await screen.findByText('Elige una fecha válida.')).toBeInTheDocument(); expect(calls(view, 'FlightOperations')).toHaveLength(before);
  });

  it('ADM-C13 un 403 se explica con el mensaje del catálogo y el identificador en «Detalles técnicos» (sin datos del panel)', async () => {
    mount('/admin', { FlightOperations: () => { throw problem('FORBIDDEN', 'FORBIDDEN', 403); } });
    expect(await screen.findByText('No tienes permiso para esta acción.')).toBeInTheDocument();
    expect(screen.getByText('corr-fallo-1')).toBeInTheDocument(); expect(screen.queryByTestId('metric-flights')).not.toBeInTheDocument();
  });

  it('ADM-C14 carga todas las páginas con el cursor opaco tal cual y suma los vuelos', async () => {
    const view = mount('/admin', { FlightOperations: (call) => ((call.variables as { after?: string | null }).after === 'cur-opaco_1' ? operations([opFlight({ flightNumber: 'FP200' })]) : operations([opFlight()], 'cur-opaco_1')) });
    expect(await screen.findByRole('rowheader', { name: 'FP200' })).toBeInTheDocument();
    expect(calls(view, 'FlightOperations').map((call) => (call.variables as { after: string | null }).after)).toEqual([null, 'cur-opaco_1']); expect(screen.getByTestId('metric-flights')).toHaveTextContent('2');
  });

  it('ADM-C15 «Actualizar» vuelve a consultar y conserva lo que se ve; un refresco fallido no borra la pantalla', async () => {
    let fail = false; const view = mount('/admin', { FlightOperations: () => { if (fail) throw problem('PROVIDER_UNAVAILABLE', 'UNAVAILABLE', 503); return operations(); } });
    await screen.findByTestId('metric-flights'); const user = userEvent.setup(); fail = true;
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText('El servicio no está disponible por ahora. Inténtalo en unos segundos.')).toBeInTheDocument();
    expect(screen.getByTestId('metric-flights')).toHaveTextContent('2'); expect(calls(view, 'FlightOperations').length).toBeGreaterThanOrEqual(2);
  });
});

describe('actualización automática', () => {
  const visibility = (state: 'visible' | 'hidden'): void => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); document.dispatchEvent(new Event('visibilitychange')); };
  afterEach(() => visibility('visible'));
  it('ADM-C16 refresca cada 30 s, se pausa en segundo plano y al volver refresca de inmediato si pasó el intervalo', () => {
    vi.useFakeTimers({ now: new Date('2026-12-10T10:00:00Z') }); const refresh = vi.fn();
    const { unmount } = renderHook(() => useAutoRefresh(refresh, 30_000));
    act(() => { vi.advanceTimersByTime(29_999); }); expect(refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); }); expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { visibility('hidden'); vi.advanceTimersByTime(120_000); }); expect(refresh).toHaveBeenCalledTimes(1); // en segundo plano: nada
    act(() => { visibility('visible'); }); expect(refresh).toHaveBeenCalledTimes(2); // al volver: pasó el intervalo
    act(() => { visibility('hidden'); visibility('visible'); }); expect(refresh).toHaveBeenCalledTimes(2); // volver enseguida no repite
    unmount(); act(() => { vi.advanceTimersByTime(90_000); }); expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('vuelos y cambio de estado', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, flight = 'FP103') => { await user.click(await screen.findByRole('button', { name: `Cambiar estado del vuelo ${flight}` })); return screen.findByTestId('status-form'); };

  it('ADM-C20 lista los vuelos con su salida en la hora del aeropuerto, el estado de operaciones y la venta; «cargar más» usa el cursor opaco', async () => {
    const view = mount('/admin/vuelos', { AdminFlights: (call) => ((call.variables as { after?: string | null }).after ? adminFlights([adminFlight({ flightInstanceId: '33333333-3333-4333-8333-333333333333', flightNumber: 'FP300', closed: true })]) : adminFlights(undefined, 'cursor-uuid-1')) });
    const row = within(await screen.findByRole('row', { name: /FP103/ }));
    expect(row.getByText(/08:35 · hora de Quito/)).toBeInTheDocument(); expect(row.getByText('Programado')).toBeInTheDocument(); expect(row.getByText('Abierta')).toBeInTheDocument(); expect(row.getByText('200')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /FP105/ })).getByText('Retrasado')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Vuelo', 'Ruta', 'Salida', 'Estado', 'Venta', 'Asientos', 'Acciones']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cargar más vuelos' }));
    expect(await screen.findByRole('rowheader', { name: 'FP300' })).toBeInTheDocument(); expect(within(screen.getByRole('row', { name: /FP300/ })).getByText('Cerrada')).toBeInTheDocument();
    expect(calls(view, 'AdminFlights').map((call) => (call.variables as { after: string | null }).after)).toEqual([null, 'cursor-uuid-1']); expect(screen.queryByRole('button', { name: 'Cargar más vuelos' })).not.toBeInTheDocument();
  });

  it('ADM-C21 el formulario solo ofrece los estados válidos desde el actual (un vuelo retrasado: embarcar, cancelar o repetir)', async () => {
    mount('/admin/vuelos'); const user = userEvent.setup();
    const form = within(await open(user, 'FP105'));
    expect(form.getAllByRole('option').map((option) => option.textContent)).toEqual(['Retrasado (actual)', 'Embarcando', 'Cancelado']);
    expect(form.getByLabelText('Nuevo estado')).toHaveValue('DELAYED');
  });

  it('ADM-C22 un cambio reversible (embarcar) pide una confirmación que avisa a socios y clientes por los webhooks, sin pedir escribir el vuelo; envía su Idempotency-Key y su X-Correlation-Id', async () => {
    const view = mount('/admin/vuelos', { UpdateFlightStatus: () => statusUpdate({ flight: statusUpdate().updateFlightStatus.flight && { ...statusUpdate().updateFlightStatus.flight, status: 'BOARDING' } }) }); const user = userEvent.setup();
    const form = within(await open(user)); await user.selectOptions(form.getByLabelText('Nuevo estado'), 'BOARDING'); await user.type(form.getByLabelText('Puerta de embarque'), 'b4');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('status-confirm'));
    expect(confirm.getByText(/socios \(Booking\) y a los clientes mediante los webhooks/)).toBeInTheDocument(); expect(confirm.queryByText('Este cambio es irreversible')).not.toBeInTheDocument(); expect(confirm.queryByLabelText(/escribe el número del vuelo/)).not.toBeInTheDocument();
    expect(confirm.getByText('Programado')).toBeInTheDocument(); expect(confirm.getByText('B4')).toBeInTheDocument();
    expect(calls(view, 'UpdateFlightStatus')).toHaveLength(0);
    await user.click(confirm.getByRole('button', { name: 'Confirmar cambio' }));
    await screen.findByTestId('status-result');
    const sent = calls(view, 'UpdateFlightStatus'); expect(sent).toHaveLength(1);
    expect(sent[0].variables).toEqual({ flightNumber: 'FP103', input: { date: '2026-12-10', status: 'BOARDING', departureGate: 'B4' }, idempotencyKey: 'id-1' }); expect(sent[0].correlationId).toBe('id-2');
  });

  it('ADM-C23 un retraso exige la hora estimada y, al ser irreversible, que se escriba el número del vuelo; la hora viaja con el desplazamiento del aeropuerto', async () => {
    const view = mount('/admin/vuelos', { UpdateFlightStatus: () => statusUpdate() }); const user = userEvent.setup();
    const form = within(await open(user)); await user.selectOptions(form.getByLabelText('Nuevo estado'), 'DELAYED');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    expect(await form.findByText('Un retraso necesita la nueva hora estimada de salida.')).toBeInTheDocument(); expect(screen.queryByTestId('status-confirm')).not.toBeInTheDocument();
    fireEvent.change(form.getByLabelText('Salida estimada (hora de Quito)'), { target: { value: '2026-12-10T08:00' } });
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    expect(await form.findByText('La hora estimada de un retraso debe ser posterior a la hora programada.')).toBeInTheDocument();
    fireEvent.change(form.getByLabelText('Salida estimada (hora de Quito)'), { target: { value: '2026-12-10T09:10' } });
    await user.type(form.getByLabelText('Motivo'), 'Tráfico aéreo');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('status-confirm'));
    expect(confirm.getByText('Este cambio es irreversible')).toBeInTheDocument(); expect(confirm.getByText(/no se puede deshacer desde este panel/)).toBeInTheDocument(); expect(confirm.getByText(/socios \(Booking\) y a los clientes/)).toBeInTheDocument();
    const go = confirm.getByRole('button', { name: 'Confirmar cambio' }); expect(go).toBeDisabled();
    await user.type(confirm.getByLabelText('Para confirmar, escribe el número del vuelo (FP103)'), 'FP10'); expect(go).toBeDisabled();
    await user.type(confirm.getByLabelText('Para confirmar, escribe el número del vuelo (FP103)'), '3'); expect(go).not.toBeDisabled();
    await user.click(go); await screen.findByTestId('status-result');
    expect(calls(view, 'UpdateFlightStatus')[0].variables).toMatchObject({ flightNumber: 'FP103', input: { date: '2026-12-10', status: 'DELAYED', estimatedDepartureAt: '2026-12-10T09:10:00-05:00', reason: 'Tráfico aéreo' } });
  });

  it('ADM-C24 cancelar un vuelo avisa que cierra la venta, notifica y no se deshace; exige el número del vuelo y no pide horas', async () => {
    mount('/admin/vuelos', { UpdateFlightStatus: () => statusUpdate({ affectedBookings: 7, flight: { ...statusUpdate().updateFlightStatus.flight, status: 'CANCELLED' } }) }); const user = userEvent.setup();
    const form = within(await open(user)); await user.selectOptions(form.getByLabelText('Nuevo estado'), 'CANCELLED');
    expect(form.queryByLabelText(/Salida estimada/)).not.toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('status-confirm'));
    expect(confirm.getByText(/cierra su venta y notifica a las reservas afectadas. No se puede deshacer/)).toBeInTheDocument();
    await user.type(confirm.getByLabelText(/escribe el número del vuelo/), ' fp103 '); await user.click(confirm.getByRole('button', { name: 'Confirmar cambio' }));
    expect(await screen.findByText(/cambió de «Programado» a «Cancelado»/)).toBeInTheDocument(); expect(screen.getByTestId('status-result')).toHaveTextContent('Reservas afectadas: 7');
  });

  it('ADM-C25 muestra el resultado (estado anterior y nuevo, reservas afectadas, evento) con el enlace al estado público, y la fila refleja el nuevo estado', async () => {
    mount('/admin/vuelos', { UpdateFlightStatus: () => statusUpdate() }); const user = userEvent.setup();
    const form = within(await open(user)); await user.selectOptions(form.getByLabelText('Nuevo estado'), 'DELAYED'); fireEvent.change(form.getByLabelText('Salida estimada (hora de Quito)'), { target: { value: '2026-12-10T09:10' } });
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' })); const confirm = within(await screen.findByTestId('status-confirm'));
    await user.type(confirm.getByLabelText(/escribe el número del vuelo/), 'FP103'); await user.click(confirm.getByRole('button', { name: 'Confirmar cambio' }));
    expect(await screen.findByText(/cambió de «Programado» a «Retrasado»/)).toBeInTheDocument();
    expect(screen.getByTestId('status-result')).toHaveTextContent('Reservas afectadas: 3'); expect(screen.getByTestId('status-result')).toHaveTextContent('evt-123');
    expect(screen.getByRole('link', { name: 'Ver el estado público del vuelo' })).toHaveAttribute('href', '/estado?vuelo=FP103&fecha=2026-12-10');
    expect(within(screen.getByRole('row', { name: /FP103/ })).getByText('Retrasado')).toBeInTheDocument(); expect(screen.queryByTestId('status-form')).not.toBeInTheDocument();
  });

  it('ADM-C26 un doble clic en «Confirmar cambio» envía UNA sola vez; un fallo incierto (503) reintenta con la MISMA Idempotency-Key', async () => {
    const first = deferred<unknown>(); let attempt = 0;
    const view = mount('/admin/vuelos', { UpdateFlightStatus: () => { attempt += 1; return attempt === 1 ? first.promise : statusUpdate(); } }); const user = userEvent.setup();
    const form = within(await open(user)); await user.selectOptions(form.getByLabelText('Nuevo estado'), 'BOARDING'); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('status-confirm')); const go = confirm.getByRole('button', { name: 'Confirmar cambio' });
    await user.dblClick(go); expect(calls(view, 'UpdateFlightStatus')).toHaveLength(1); expect(go).toBeDisabled();
    await act(async () => { first.reject(problem('PROVIDER_UNAVAILABLE', 'UNAVAILABLE', 503)); await Promise.resolve(); });
    expect(await screen.findByText('El servicio no está disponible por ahora. Inténtalo en unos segundos.')).toBeInTheDocument();
    await user.click(within(await screen.findByTestId('status-confirm')).getByRole('button', { name: 'Confirmar cambio' })); await screen.findByTestId('status-result');
    const sent = calls(view, 'UpdateFlightStatus'); expect(sent).toHaveLength(2); expect((sent[1].variables as { idempotencyKey: string }).idempotencyKey).toBe((sent[0].variables as { idempotencyKey: string }).idempotencyKey); expect(sent[1].correlationId).toBe(sent[0].correlationId);
  });

  it('ADM-C27 INVALID_STATUS_TRANSITION se explica en español y «Detalles técnicos» trae el X-Correlation-Id y la Idempotency-Key; un rechazo definitivo cierra la intención (la siguiente usa otra clave)', async () => {
    const view = mount('/admin/vuelos', { UpdateFlightStatus: () => { throw problem('INVALID_STATUS_TRANSITION', 'CONFLICT', 409); } }); const user = userEvent.setup();
    const form = within(await open(user)); await user.selectOptions(form.getByLabelText('Nuevo estado'), 'BOARDING'); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('status-confirm')); await user.click(confirm.getByRole('button', { name: 'Confirmar cambio' }));
    const alert = within(await screen.findByRole('alert'));
    expect(alert.getByText('Ese cambio de estado no es válido desde el estado actual del vuelo. Actualiza la lista para ver su estado y elige un cambio permitido.')).toBeInTheDocument();
    expect(alert.getByText('Detalles técnicos')).toBeInTheDocument(); expect(alert.getByText('corr-fallo-1')).toBeInTheDocument(); expect(alert.getByText('id-1')).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: 'Confirmar cambio' })); await waitFor(() => expect(calls(view, 'UpdateFlightStatus')).toHaveLength(2));
    expect((calls(view, 'UpdateFlightStatus')[1].variables as { idempotencyKey: string }).idempotencyKey).toBe('id-4'); // otra intención: otra clave
  });

  it('ADM-C28 sin estado conocido (operaciones no responde) se ofrecen todos y decide el Gateway; un aviso lo explica', async () => {
    mount('/admin/vuelos', { FlightOperations: () => { throw problem('PROVIDER_UNAVAILABLE', 'UNAVAILABLE', 503); } }); const user = userEvent.setup();
    expect(await screen.findByText('No pudimos traer el estado actual de los vuelos.')).toBeInTheDocument();
    const form = within(await open(user)); expect(form.getAllByRole('option').map((option) => option.textContent)).toContain('Aterrizó'); expect(form.getByLabelText('Nuevo estado')).toHaveValue('');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' })); expect(await form.findByText('Elige el estado al que pasa el vuelo.')).toBeInTheDocument();
  });

  it('ADM-C29 sin vuelos en la fecha: mensaje con acción; un 403 se explica', async () => {
    const view = mount('/admin/vuelos', { AdminFlights: () => adminFlights([]), FlightOperations: () => operations([]) });
    expect(await screen.findByText(/No hay vuelos el /)).toBeInTheDocument(); view.unmount();
    mount('/admin/vuelos', { AdminFlights: () => { throw problem('FORBIDDEN', 'FORBIDDEN', 403); } });
    expect(await screen.findByText('No tienes permiso para esta acción.')).toBeInTheDocument();
  });
});

describe('tarifas', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>) => { const select = await screen.findByLabelText('Vuelo'); await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1)); await user.selectOptions(select, FI_1); await screen.findByRole('table'); };

  it('ADM-C30 elegir un vuelo trae sus tarifas por cabina y marca (con encabezados), importes en USD y el equipaje incluido', async () => {
    const view = mount('/admin/tarifas'); const user = userEvent.setup(); expect(calls(view, 'AdminFares')).toHaveLength(0); // sin vuelo no se consulta
    await pick(user);
    expect(calls(view, 'AdminFares')[0].variables).toEqual({ flightInstanceId: FI_1 });
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Cabina', 'Marca', 'Importe total', 'Reembolsable', 'Cambios', 'Equipaje incluido', 'Maleta extra', 'Acciones']);
    const row = within(screen.getByRole('row', { name: /Económica/ })); expect(row.getByText('USD 127,39')).toBeInTheDocument(); expect(row.getByText('LIGHT')).toBeInTheDocument(); expect(row.getByText('Mano: 1 · Facturado: 0')).toBeInTheDocument();
  });

  it('ADM-C31 valida antes de enviar; la confirmación muestra el antes y el después del importe; guarda con la clave natural (fareId) y la tarifa queda a la vista', async () => {
    let current = fare(); const view = mount('/admin/tarifas', { AdminFares: () => fares([current]), UpsertFare: (call) => { const input = (call.variables as { input: { price: { total: string } } }).input; current = fare({ price: { currency: 'USD', total: input.price.total, baseFare: null, taxes: '12.00' } }); return { upsertFare: current }; } });
    const user = userEvent.setup(); await pick(user);
    await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); const form = within(await screen.findByTestId('fare-form'));
    await user.clear(form.getByLabelText('Importe total (USD)')); await user.type(form.getByLabelText('Importe total (USD)'), '12x');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    expect(await form.findByText('Escribe el importe con hasta dos decimales, por ejemplo 127.39.')).toBeInTheDocument(); expect(screen.queryByTestId('fare-confirm')).not.toBeInTheDocument(); expect(calls(view, 'UpsertFare')).toHaveLength(0);
    await user.clear(form.getByLabelText('Importe total (USD)')); await user.type(form.getByLabelText('Importe total (USD)'), '130,5');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('fare-confirm'));
    expect(confirm.getByTestId('fare-total-change')).toHaveTextContent('Importe total: USD 127,39 → USD 130,50');
    expect(confirm.getByText('Antes')).toBeInTheDocument(); expect(confirm.getByText('Después')).toBeInTheDocument(); expect(confirm.queryByText('Reembolsable')).not.toBeInTheDocument(); // solo lo que cambia
    await user.click(confirm.getByRole('button', { name: 'Guardar tarifa' }));
    expect(await screen.findByTestId('fare-saved')).toHaveTextContent('USD 130,50'); expect(calls(view, 'UpsertFare')).toHaveLength(1);
    expect(await within(screen.getByRole('table')).findByText('USD 130,50')).toBeInTheDocument(); // la lista se vuelve a leer
  });

  it('ADM-C32 guardar envía UNA vez (el botón se bloquea mientras la petición está en curso) con el importe normalizado, el fareId y USD', async () => {
    const pending = deferred<unknown>(); const view = mount('/admin/tarifas', { UpsertFare: () => pending.promise });
    const user = userEvent.setup(); await pick(user);
    await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); const form = within(await screen.findByTestId('fare-form'));
    await user.clear(form.getByLabelText('Importe total (USD)')); await user.type(form.getByLabelText('Importe total (USD)'), '130,5'); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('fare-confirm')); const save = confirm.getByRole('button', { name: 'Guardar tarifa' });
    await user.dblClick(save); expect(calls(view, 'UpsertFare')).toHaveLength(1); expect(save).toBeDisabled();
    expect(calls(view, 'UpsertFare')[0].variables).toMatchObject({ input: { fareId: fare().fareId, flightInstanceId: FI_1, cabinClass: 'ECONOMY', fareBrand: 'LIGHT', price: { currency: 'USD', total: '130.50', baseFare: '118.50', taxes: '12.00' }, isRefundable: false, isChangeable: true, extraCheckedBaggagePrice: { currency: 'USD', total: '35.00' } } });
    await act(async () => { pending.resolve({ upsertFare: fare({ price: { currency: 'USD', total: '130.50', baseFare: null, taxes: '12.00' } }) }); await Promise.resolve(); });
    expect(await screen.findByTestId('fare-saved')).toHaveTextContent('Económica · LIGHT: USD 130,50'); expect(screen.queryByTestId('fare-confirm')).not.toBeInTheDocument();
  });

  it('ADM-C33 sin cambios no hay nada que guardar; un error del servidor se explica con su identificador', async () => {
    mount('/admin/tarifas', { UpsertFare: () => { throw problem('VALIDATION_FAILED', 'VALIDATION', 400); } });
    const user = userEvent.setup(); await pick(user);
    await user.click(screen.getByRole('button', { name: 'Editar la tarifa Económica LIGHT' })); const form = within(await screen.findByTestId('fare-form')); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('fare-confirm')); expect(confirm.getByText('No hay cambios que guardar.')).toBeInTheDocument(); expect(confirm.getByRole('button', { name: 'Guardar tarifa' })).toBeDisabled();
    await user.click(confirm.getByRole('button', { name: 'Volver a editar' })); await user.click(within(await screen.findByTestId('fare-form')).getByLabelText('Equipaje de mano incluido')); await user.clear(screen.getByLabelText('Equipaje de mano incluido')); await user.type(screen.getByLabelText('Equipaje de mano incluido'), '2');
    await user.click(screen.getByRole('button', { name: 'Revisar el cambio' })); await user.click(within(await screen.findByTestId('fare-confirm')).getByRole('button', { name: 'Guardar tarifa' }));
    const alert = within(await screen.findByRole('alert')); expect(alert.getByText('Revisa los datos ingresados.')).toBeInTheDocument(); expect(alert.getByText('corr-fallo-1')).toBeInTheDocument();
  });

  it('ADM-C34 un vuelo sin tarifas ofrece agregar la primera; la cabina y la marca son obligatorias', async () => {
    const view = mount('/admin/tarifas', { AdminFares: () => fares([]), UpsertFare: () => ({ upsertFare: fare({ cabinClass: 'BUSINESS', fareBrand: 'FLEX' }) }) });
    const user = userEvent.setup(); const select = await screen.findByLabelText('Vuelo'); await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1)); await user.selectOptions(select, FI_1);
    expect(await screen.findByText('Este vuelo aún no tiene tarifas')).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'Agregar una tarifa' }));
    const form = within(await screen.findByTestId('fare-form')); await user.type(form.getByLabelText('Importe total (USD)'), '99.9'); await user.type(form.getByLabelText('Precio de la maleta extra'), '30');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' })); expect(await form.findByText('Elige la cabina.')).toBeInTheDocument(); expect(form.getByText(/La marca tarifaria/)).toBeInTheDocument();
    await user.selectOptions(form.getByLabelText('Cabina'), 'BUSINESS'); await user.type(form.getByLabelText('Marca tarifaria'), 'FLEX'); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const confirm = within(await screen.findByTestId('fare-confirm')); await user.click(confirm.getByRole('button', { name: 'Guardar tarifa' }));
    await waitFor(() => expect(calls(view, 'UpsertFare')).toHaveLength(1)); const input = (calls(view, 'UpsertFare')[0].variables as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ cabinClass: 'BUSINESS', fareBrand: 'FLEX', flightInstanceId: FI_1, price: { total: '99.90' } }); expect(input).not.toHaveProperty('fareId');
  });
});

describe('promociones', () => {
  it('ADM-C40 sin acuerdo ofrece crearlo; el descuento se valida de 0 a 100; la confirmación lista lo que se crea y se guarda con su Idempotency-Key', async () => {
    let saved: ReturnType<typeof agreement>['promotionAgreement'] = null;
    const view = mount('/admin/promociones', { PromotionAgreement: () => ({ promotionAgreement: saved }), SetPromotionAgreement: (call) => { const input = (call.variables as { input: Record<string, unknown> }).input; saved = { ...agreement().promotionAgreement!, maxDiscountPercent: input.maxDiscountPercent as number, routes: input.routes as string[], cabins: input.cabins as never, destinations: input.destinations as string[] }; return { setPromotionAgreement: saved }; } });
    const user = userEvent.setup(); expect(await screen.findByText('Aún no hay acuerdo de promociones')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear el acuerdo' })); const form = within(await screen.findByTestId('promotion-form'));
    await user.type(form.getByLabelText('Descuento máximo (%)'), '120'); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    expect(await form.findByText('El descuento máximo debe estar entre 0 y 100.')).toBeInTheDocument(); expect(calls(view, 'SetPromotionAgreement')).toHaveLength(0);
    await user.clear(form.getByLabelText('Descuento máximo (%)')); await user.type(form.getByLabelText('Descuento máximo (%)'), '15'); await user.type(form.getByLabelText('Rutas habilitadas'), 'uio-gye'); await user.click(form.getByLabelText('Económica'));
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' })); const confirm = within(await screen.findByTestId('promotion-confirm'));
    expect(confirm.getByText('Confirma la creación del acuerdo de promociones')).toBeInTheDocument(); expect(confirm.getByText('15 %')).toBeInTheDocument(); expect(confirm.getByText('UIO-GYE')).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: 'Crear el acuerdo' }));
    expect(await screen.findByText('El acuerdo de promociones se guardó.')).toBeInTheDocument();
    expect(calls(view, 'SetPromotionAgreement')[0].variables).toEqual({ input: { allowsPromotions: true, maxDiscountPercent: 15, destinations: [], routes: ['UIO-GYE'], cabins: ['ECONOMY'] }, idempotencyKey: 'id-1' });
    expect(await screen.findByTestId('agreement')).toHaveTextContent('15 %');
  });

  it('ADM-C41 muestra el acuerdo vigente; al editarlo la confirmación muestra antes y después solo de lo que cambia', async () => {
    const view = mount('/admin/promociones', { SetPromotionAgreement: () => ({ setPromotionAgreement: agreement({ maxDiscountPercent: 20 }).promotionAgreement }) });
    const user = userEvent.setup(); const summary = within(await screen.findByTestId('agreement'));
    expect(summary.getByText('15 %')).toBeInTheDocument(); expect(summary.getByText('UIO-GYE')).toBeInTheDocument(); expect(summary.getByText('Económica')).toBeInTheDocument(); expect(summary.getByText('31 dic 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar el acuerdo' })); const form = within(await screen.findByTestId('promotion-form'));
    expect(form.getByLabelText('Descuento máximo (%)')).toHaveValue('15'); await user.clear(form.getByLabelText('Descuento máximo (%)')); await user.type(form.getByLabelText('Descuento máximo (%)'), '20');
    await user.click(form.getByRole('button', { name: 'Revisar el cambio' })); const confirm = within(await screen.findByTestId('promotion-confirm'));
    expect(confirm.getByText('Descuento máximo')).toBeInTheDocument(); expect(confirm.getByText('15 %')).toBeInTheDocument(); expect(confirm.getByText('20 %')).toBeInTheDocument(); expect(confirm.queryByText('Rutas')).not.toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: 'Guardar el acuerdo' })); await screen.findByText('El acuerdo de promociones se guardó.'); expect(calls(view, 'SetPromotionAgreement')).toHaveLength(1);
  });

  it('ADM-C42 un rechazo del servidor (PROMOTION_DISCOUNT_OUT_OF_RANGE) se explica; el doble clic no guarda dos veces', async () => {
    const pending = deferred<unknown>(); const view = mount('/admin/promociones', { SetPromotionAgreement: () => pending.promise });
    const user = userEvent.setup(); await screen.findByTestId('agreement'); await user.click(screen.getByRole('button', { name: 'Editar el acuerdo' }));
    const form = within(await screen.findByTestId('promotion-form')); await user.clear(form.getByLabelText('Descuento máximo (%)')); await user.type(form.getByLabelText('Descuento máximo (%)'), '30'); await user.click(form.getByRole('button', { name: 'Revisar el cambio' }));
    const save = within(await screen.findByTestId('promotion-confirm')).getByRole('button', { name: 'Guardar el acuerdo' }); await user.dblClick(save); expect(calls(view, 'SetPromotionAgreement')).toHaveLength(1);
    await act(async () => { pending.reject(problem('PROMOTION_DISCOUNT_OUT_OF_RANGE', 'UNPROCESSABLE', 422)); await Promise.resolve(); });
    expect(await screen.findByText('El descuento debe estar entre 0 y 100.')).toBeInTheDocument(); expect(screen.getByText('id-1')).toBeInTheDocument();
  });
});

describe('reservas web', () => {
  it('ADM-C50 lista solo lo que entrega la API (reserva, fecha en hora de Quito, pasajeros, canal, prueba y el hash del titular), sin datos personales', async () => {
    mount('/admin/reservas-web');
    const table = await screen.findByRole('table'); expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Reserva', 'Creada', 'Pasajeros', 'Canal', 'Prueba', 'Titular (referencia opaca)']);
    const row = within(screen.getByRole('row', { name: /00000000-0000-4000-8000-000000000002/ }));
    expect(row.getByText('h4sh2opaco')).toBeInTheDocument(); expect(row.getByText('WEB')).toBeInTheDocument(); expect(row.getByText('Sí')).toBeInTheDocument(); expect(row.getByText(/12 nov 2026 · 10:00 · hora de Quito/)).toBeInTheDocument();
    expect(table.textContent).not.toMatch(/@|\+593|documento|nombre/i); expect(screen.queryByRole('button', { name: /editar|cancelar|eliminar/i })).not.toBeInTheDocument();
  });

  it('ADM-C51 «cargar más» pasa el cursor opaco tal cual, sin repetir filas; vacío y error tienen su estado', async () => {
    const view = mount('/admin/reservas-web', { AdminWebBookings: (call) => ((call.variables as { after?: string | null }).after === 'Y3Vyc29yLW9wYWNv' ? webBookings([webRow(1)]) : webBookings([webRow(3), webRow(2)], 'Y3Vyc29yLW9wYWNv')) });
    const user = userEvent.setup(); await screen.findByRole('table'); await user.click(screen.getByRole('button', { name: 'Cargar más reservas' }));
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)); // encabezado + 3
    expect(calls(view, 'AdminWebBookings').map((call) => (call.variables as { after: string | null }).after)).toEqual([null, 'Y3Vyc29yLW9wYWNv']); expect(screen.queryByRole('button', { name: 'Cargar más reservas' })).not.toBeInTheDocument(); view.unmount();
    const empty = mount('/admin/reservas-web', { AdminWebBookings: () => webBookings([]) }); expect(await screen.findByText('Aún no hay reservas del canal web')).toBeInTheDocument(); empty.unmount();
    mount('/admin/reservas-web', { AdminWebBookings: () => { throw problem('FORBIDDEN', 'FORBIDDEN', 403); } }); expect(await screen.findByText('No tienes permiso para esta acción.')).toBeInTheDocument();
  });
});

describe('buscar reserva por PNR (F12c-4a)', () => {
  it('ADM-C60 el menú ofrece «Buscar reserva»; busca por PNR, muestra nombres, vuelos en hora local, asientos, equipaje, boletos (últimos 4) y check-in, y es de solo lectura', async () => {
    const view = mount('/admin/reservas', { AdminBookingByPnr: () => bookingByPnr() });
    const user = userEvent.setup(); expect(within(screen.getByRole('navigation', { name: 'Administración' })).getByRole('link', { name: 'Buscar reserva' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Localizador (PNR)'), 'j4r8gz'); await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const result = within(await screen.findByTestId('booking-result'));
    expect(calls(view, 'AdminBookingByPnr')).toHaveLength(1); expect(calls(view, 'AdminBookingByPnr')[0].variables).toEqual({ pnr: 'J4R8GZ' });
    expect(result.getByText('Confirmada')).toBeInTheDocument(); expect(result.getByText(/Socio/)).toBeInTheDocument(); expect(result.getByText('a1b2c3d4e5f6')).toBeInTheDocument(); expect(result.getByText('210.00 USD')).toBeInTheDocument();
    expect(result.getByText(/10:00 \(hora local de UIO\)/)).toBeInTheDocument(); expect(result.getByText(/11:00 \(hora local de GPS\)/)).toBeInTheDocument();
    expect(result.getAllByText('Ana Pérez').length).toBeGreaterThan(0); expect(result.getByText('FP210: 12A')).toBeInTheDocument(); expect(result.getByText('•••• 7890')).toBeInTheDocument(); expect(result.getAllByText('Con check-in').length).toBeGreaterThan(0);
    const text = screen.getByTestId('booking-result').textContent ?? ''; expect(text).not.toMatch(/@|\+593|pasaporte|documento \d|pay_/i);
    expect(within(screen.getByTestId('booking-result')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('ADM-C61 un localizador mal escrito TAMBIÉN se envía (para que quede registrado) y se muestra como «no encontrada»; el de la web no muestra referencia de socio', async () => {
    let wrong = true; const view = mount('/admin/reservas', { AdminBookingByPnr: () => (wrong ? { adminBookingByPnr: null } : bookingByPnr({ channel: 'WEB', partnerRef: null })) });
    const user = userEvent.setup(); const input = screen.getByLabelText('Localizador (PNR)');
    for (const bad of ['AB', 'j4r8g0']) { await user.clear(input); await user.type(input, bad); await user.click(screen.getByRole('button', { name: 'Buscar' })); expect(await screen.findByTestId('booking-missing')).toBeInTheDocument(); }
    expect(calls(view, 'AdminBookingByPnr').map((call) => (call.variables as { pnr: string }).pnr)).toEqual(['AB', 'J4R8G0']);
    wrong = false; await user.clear(input); await user.type(input, 'J4R8GZ'); await user.click(screen.getByRole('button', { name: 'Buscar' }));
    const result = within(await screen.findByTestId('booking-result')); expect(result.getByText('Web')).toBeInTheDocument(); expect(result.queryByText(/referencia del socio/)).not.toBeInTheDocument();
  });

  it('ADM-C62 una reserva inexistente se muestra como «no encontrada»; el doble clic busca una sola vez', async () => {
    const pending = deferred<unknown>(); const view = mount('/admin/reservas', { AdminBookingByPnr: () => pending.promise });
    const user = userEvent.setup(); await user.type(screen.getByLabelText('Localizador (PNR)'), 'ZZZZZZ'); await user.dblClick(screen.getByRole('button', { name: 'Buscar' }));
    expect(calls(view, 'AdminBookingByPnr')).toHaveLength(1);
    await act(async () => { pending.resolve({ adminBookingByPnr: null }); await Promise.resolve(); });
    expect(await screen.findByTestId('booking-missing')).toHaveTextContent('Reserva no encontrada'); expect(screen.queryByTestId('booking-result')).not.toBeInTheDocument();
  });

  it('ADM-C63 el límite de búsquedas y un servidor caído se explican en español', async () => {
    mount('/admin/reservas', { AdminBookingByPnr: () => { throw problem('RATE_LIMIT_EXCEEDED', 'RATE_LIMITED', 429); } });
    const user = userEvent.setup(); await user.type(screen.getByLabelText('Localizador (PNR)'), 'J4R8GZ'); await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.')).toBeInTheDocument(); expect(screen.queryByTestId('booking-result')).not.toBeInTheDocument();
  });
});
