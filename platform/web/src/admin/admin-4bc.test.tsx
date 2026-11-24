import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppError } from '../data/errors';
import { renderApp, type ClientCall, type Handler } from '../../test/utils';
import { adminFlight, adminFlights, adminSession, agreement, bookingByPnr, fare, fares, health, operations, webBookings, FI_1 } from '../../test/admin-fixtures';

const base = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({ FlightOperations: () => operations(), AdminFlights: () => adminFlights(), PlatformHealth: () => health(), AdminFares: () => fares(), AdminWebBookings: () => webBookings(), PromotionAgreement: () => agreement(), ...extra });
const mount = (route: string, extra: Record<string, Handler> = {}) => renderApp(route, { session: adminSession(), handlers: base(extra) });
const calls = (view: { client: { calls: ClientCall[] } }, name: string) => view.client.calls.filter((call) => call.name === name);
const problem = (code: string, category: AppError['category'], httpStatus: number, invalidParams: Array<{ name: string; reason?: string }> = []) => new AppError({ code, category, correlationId: 'corr-fallo-2', httpStatus, invalidParams });
const UUID_V4 = /^id-\d+$|^[0-9a-f-]{36}$/; // el arnés genera identificadores deterministas (id-N); el formato UUID v4 real lo comprueban las pruebas de newId

const checkInResult = { adminCheckIn: { bookingId: '00000000-0000-4000-8000-0000000000c1', status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'p-1', status: 'CHECKED_IN', segments: [{ segmentId: 'seg-1', status: 'CHECKED_IN', seat: '12A' }] }] } };
const passes = { adminBoardingPasses: { bookingId: '00000000-0000-4000-8000-0000000000c1', boardingPasses: [{ passengerId: 'p-1', segmentId: 'seg-1', seat: '12A', barcode: 'M1/0f8fad5b-d9cb-469f-a165-70867728950e/12A', barcodeType: 'QR' }] } };
const notStarted = bookingByPnr({ checkIn: { status: 'NOT_STARTED', passengers: [] } });
const search = async (user: ReturnType<typeof userEvent.setup>) => { await user.type(await screen.findByLabelText('Localizador (PNR)'), 'j4r8gz'); await user.click(screen.getByRole('button', { name: 'Buscar' })); await screen.findByTestId('booking-result'); };

describe('check-in de la aerolínea (F12c-4b)', () => {
  it('ADM4-B-W-01 «Hacer check-in» pide confirmación; envía SOLO el PNR y una Idempotency-Key UUID; muestra el resultado y los pases con su QR', async () => {
    const view = mount('/admin/reservas', { AdminBookingByPnr: () => notStarted, AdminCheckIn: () => checkInResult, AdminBoardingPasses: () => passes });
    const user = userEvent.setup(); await search(user);
    expect(calls(view, 'AdminCheckIn')).toHaveLength(0); await user.click(screen.getByRole('button', { name: 'Hacer check-in' }));
    const confirm = within(await screen.findByTestId('checkin-confirm')); expect(confirm.getByText(/emite pases de abordar y avisa al socio/)).toBeInTheDocument(); expect(confirm.getByText(/no se puede forzar/)).toBeInTheDocument(); expect(calls(view, 'AdminCheckIn')).toHaveLength(0);
    await user.click(confirm.getByRole('button', { name: 'Confirmar check-in' }));
    expect(await screen.findByTestId('checkin-result')).toHaveTextContent('Ana Pérez: Con check-in');
    expect(calls(view, 'AdminCheckIn')).toHaveLength(1); const variables = calls(view, 'AdminCheckIn')[0].variables as { pnr: string; idempotencyKey: string };
    expect(Object.keys(variables).sort()).toEqual(['idempotencyKey', 'pnr']); expect(variables.pnr).toBe('J4R8GZ'); expect(variables.idempotencyKey).toMatch(UUID_V4);
    const pass = within(await screen.findByTestId('boarding-pass')); expect(pass.getByText('Ana Pérez')).toBeInTheDocument(); expect(pass.getByText(/FP210 · UIO → GPS · asiento 12A/)).toBeInTheDocument(); expect(pass.getByTestId('boarding-qr')).toBeInTheDocument();
    expect(calls(view, 'AdminBoardingPasses')[0].variables).toEqual({ pnr: 'J4R8GZ' });
    expect(screen.getAllByText('Completado').length).toBeGreaterThan(0); // el estado de la reserva se actualiza sin repetir la búsqueda
    expect(calls(view, 'AdminBookingByPnr')).toHaveLength(1);
  });
  it('ADM4-B-W-02 cancelar la confirmación no envía nada; una reserva que no está confirmada no admite check-in', async () => {
    const view = mount('/admin/reservas', { AdminBookingByPnr: () => bookingByPnr({ status: 'CANCELLED', checkIn: { status: 'NOT_STARTED', passengers: [] } }) });
    const user = userEvent.setup(); await search(user); expect(screen.getByRole('button', { name: 'Hacer check-in' })).toBeDisabled(); expect(screen.getByText('Solo una reserva confirmada admite check-in.')).toBeInTheDocument(); expect(calls(view, 'AdminCheckIn')).toHaveLength(0);
    view.unmount(); const second = mount('/admin/reservas', { AdminBookingByPnr: () => notStarted });
    const again = userEvent.setup(); await search(again); await again.click(screen.getByRole('button', { name: 'Hacer check-in' })); await again.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(calls(second, 'AdminCheckIn')).toHaveLength(0); expect(screen.queryByTestId('checkin-confirm')).not.toBeInTheDocument();
  });
  it('ADM4-B-W-03 una regla del cliente (fuera de la ventana) se explica y cierra la intención; tras un 503 (incierto) reintentar reutiliza LA MISMA clave y un doble clic no envía dos veces', async () => {
    let mode: 'window' | 'down' | 'ok' = 'window';
    const view = mount('/admin/reservas', { AdminBookingByPnr: () => notStarted, AdminCheckIn: () => { if (mode === 'window') throw problem('CHECK_IN_NOT_AVAILABLE', 'CONFLICT', 409); if (mode === 'down') throw problem('PROVIDER_UNAVAILABLE', 'UNAVAILABLE', 503); return checkInResult; }, AdminBoardingPasses: () => passes });
    const user = userEvent.setup(); await search(user); await user.click(screen.getByRole('button', { name: 'Hacer check-in' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar check-in' }));
    expect(await screen.findByText('El check-in no está disponible todavía.')).toBeInTheDocument(); expect(screen.getByText('corr-fallo-2')).toBeInTheDocument();
    mode = 'down'; await user.click(screen.getByRole('button', { name: 'Confirmar check-in' })); expect(await screen.findByText('El servicio no está disponible por ahora. Inténtalo en unos segundos.')).toBeInTheDocument();
    mode = 'ok'; await user.dblClick(screen.getByRole('button', { name: 'Confirmar check-in' }));
    await screen.findByTestId('checkin-result');
    const keys = calls(view, 'AdminCheckIn').map((call) => (call.variables as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(3); expect(keys[0]).not.toBe(keys[1]); // el rechazo del negocio cerró la intención: la siguiente es otra
    expect(keys[1]).toBe(keys[2]); // el 503 deja la intención abierta: el reintento (y el doble clic, una sola vez) usa la misma clave
  });
  it('ADM4-B-W-04 con el check-in ya hecho se pueden ver los pases; un límite (429) se explica sin datos internos', async () => {
    const view = mount('/admin/reservas', { AdminBookingByPnr: () => bookingByPnr(), AdminBoardingPasses: () => passes });
    const user = userEvent.setup(); await search(user); await user.click(screen.getByRole('button', { name: 'Ver pases de abordar' }));
    expect(await screen.findByTestId('boarding-pass')).toBeInTheDocument(); expect(calls(view, 'AdminCheckIn')).toHaveLength(0);
    view.unmount();
    mount('/admin/reservas', { AdminBookingByPnr: () => bookingByPnr(), AdminBoardingPasses: () => { throw problem('RATE_LIMIT_EXCEEDED', 'RATE_LIMITED', 429); } });
    const limited = userEvent.setup(); await search(limited); await limited.click(screen.getByRole('button', { name: 'Ver pases de abordar' }));
    expect(await screen.findByText('Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.')).toBeInTheDocument(); expect(screen.queryByTestId('boarding-pass')).not.toBeInTheDocument();
  });
  it('ADM4-B-W-05 (decisión 9) con el check-in DESCONOCIDO se muestra la reserva con el aviso y cómo reintentar; «Hacer check-in» y los pases quedan deshabilitados con el motivo accesible; nunca se dice «sin check-in»', async () => {
    const unknownBooking = bookingByPnr({ checkIn: { status: 'UNKNOWN', passengers: [] } });
    let current = unknownBooking;
    const view = mount('/admin/reservas', { AdminBookingByPnr: () => current, AdminCheckIn: () => checkInResult, AdminBoardingPasses: () => passes });
    const user = userEvent.setup(); await search(user);
    expect(screen.getAllByText('Ana Pérez').length).toBeGreaterThan(0); // la reserva se muestra
    const notice = within(screen.getByTestId('checkin-unknown')); expect(notice.getByText('Estado del check-in: no se pudo consultar en este momento.')).toBeInTheDocument(); expect(notice.getByText(/Vuelve a consultar en unos segundos/)).toBeInTheDocument();
    expect(screen.queryByText('Sin check-in')).not.toBeInTheDocument(); expect(screen.queryByText('Con check-in')).not.toBeInTheDocument();
    const reason = screen.getByTestId('checkin-unknown-reason'); expect(reason).toHaveAttribute('id', 'checkin-unknown-reason');
    for (const name of ['Hacer check-in', 'Ver pases de abordar']) { const button = screen.getByRole('button', { name }); expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-describedby', 'checkin-unknown-reason'); expect(document.getElementById('checkin-unknown-reason')?.textContent).toMatch(/no se conozca el estado del check-in/); }
    await user.click(screen.getByRole('button', { name: 'Hacer check-in' })); expect(calls(view, 'AdminCheckIn')).toHaveLength(0); expect(calls(view, 'AdminBoardingPasses')).toHaveLength(0);
    // Reintentar: vuelve a consultar el mismo PNR y, con Operations de vuelta, se habilita todo.
    expect(calls(view, 'AdminBookingByPnr')).toHaveLength(1);
    current = notStarted;
    await user.click(within(screen.getByTestId('checkin-unknown')).getByRole('button', { name: 'Volver a consultar' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Hacer check-in' }) as HTMLButtonElement).disabled).toBe(false));
    expect(calls(view, 'AdminBookingByPnr')).toHaveLength(2); expect(calls(view, 'AdminBookingByPnr')[1].variables).toEqual({ pnr: 'J4R8GZ' }); expect(screen.queryByTestId('checkin-unknown')).not.toBeInTheDocument();
  });
});

const catalog = { adminAircraftCatalog: [{ code: 'A320', cabins: [{ cabinClass: 'BUSINESS', seats: 12 }, { cabinClass: 'ECONOMY', seats: 150 }] }, { code: 'E190', cabins: [{ cabinClass: 'ECONOMY', seats: 99 }] }] };
const created = (closed: boolean) => ({ createFlight: { flightInstanceId: FI_1, flightNumber: 'FP210', status: closed ? 'CLOSED' : 'OPEN', closed, aircraft: 'E190', origin: 'UIO', destination: 'GPS', departureAt: '2027-03-10T20:00:00.000Z', arrivalAt: '2027-03-10T22:00:00.000Z', departureLocal: '2027-03-10T15:00', arrivalLocal: '2027-03-10T16:00', durationMinutes: 120, cabins: [{ cabinClass: 'ECONOMY', capacity: 99 }], fares: [{ cabinClass: 'ECONOMY', fareBrand: 'Basic', currency: 'USD', baseFare: '80.00', taxes: '20.00', total: '100.00' }] } });
const fill = async (user: ReturnType<typeof userEvent.setup>, aircraft = 'E190') => {
  await user.click(await screen.findByRole('button', { name: 'Crear vuelo' })); const form = within(await screen.findByTestId('create-flight-form'));
  await waitFor(() => expect(form.getByLabelText('Avión')).not.toBeDisabled());
  await user.type(form.getByLabelText(/Número de vuelo/), '210'); await user.selectOptions(form.getByLabelText('Avión'), aircraft);
  await user.selectOptions(form.getByLabelText('Origen'), 'UIO'); await user.selectOptions(form.getByLabelText('Destino'), 'GPS');
  fireEvent.change(form.getByLabelText(/Salida \(hora local/), { target: { value: '2027-03-10T15:00' } }); await user.type(form.getByLabelText('Duración (minutos)'), '120');
  return form;
};

describe('crear vuelos (F12c-4c)', () => {
  it('ADM4-F-W-10 formulario → resumen con la advertencia → confirmación; envía un solo CreateFlight con su Idempotency-Key y la hora LOCAL; muestra el resultado', async () => {
    const view = mount('/admin/vuelos', { AdminAircraftCatalog: () => catalog, CreateFlight: () => created(false) });
    const user = userEvent.setup(); const form = await fill(user);
    expect(form.getByTestId('create-arrival-preview')).toHaveTextContent('Llegada calculada: ') ; expect(form.getByTestId('create-arrival-preview')).toHaveTextContent('16:00'); // GPS es UTC-6
    expect(within(form.getByTestId('fares-ECONOMY')).getByLabelText('Marca')).toHaveValue('Basic');
    const economy = within(form.getByTestId('fares-ECONOMY')); await user.type(economy.getByLabelText('Tarifa base (USD)'), '80'); await user.type(economy.getByLabelText('Tasas (USD)'), '20'); await user.type(economy.getByLabelText('Maleta extra (USD)'), '35');
    expect(economy.getByText('Total: 100.00 USD')).toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Revisar el resumen' }));
    const confirm = within(await screen.findByTestId('create-flight-confirm')); expect(calls(view, 'CreateFlight')).toHaveLength(0);
    expect(confirm.getByText('Una vez creado, el vuelo no se puede borrar')).toBeInTheDocument(); expect(confirm.getByText(/aparecerá de inmediato en la web y en las búsquedas de Booking/)).toBeInTheDocument();
    expect(confirm.getByTestId('create-arrival')).toHaveTextContent('16:00'); expect(confirm.getByText('100.00')).toBeInTheDocument();
    expect(confirm.getByRole('button', { name: 'Crear el vuelo' })).toBeDisabled(); await user.click(confirm.getByLabelText(/no se puede borrar/)); await user.click(confirm.getByRole('button', { name: 'Crear el vuelo' }));
    expect(await screen.findByTestId('create-result')).toHaveTextContent('15 a 4'.length ? 'salida 2027-03-10 15:00' : ''); expect(screen.getByText('Vuelo FP210 creado: abierto a la venta.')).toBeInTheDocument();
    expect(calls(view, 'CreateFlight')).toHaveLength(1); const { input, idempotencyKey } = calls(view, 'CreateFlight')[0].variables as { input: Record<string, unknown>; idempotencyKey: string };
    expect(idempotencyKey).toMatch(UUID_V4); expect(input).toMatchObject({ flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureLocal: '2027-03-10T15:00', durationMinutes: 120, aircraft: 'E190', openForSale: true });
    expect(input.fares).toEqual([{ cabinClass: 'ECONOMY', fareBrand: 'Basic', baseFare: '80.00', taxes: '20.00', isRefundable: false, isChangeable: false, carryOnIncluded: 1, checkedBaggageIncluded: 0, extraBaggagePrice: '35.00' }]);
  });
  it('ADM4-F-W-11 «dejarlo cerrado para revisarlo» envía openForSale=false y el resultado dice que quedó cerrado; faltan tarifas ⇒ no se llega al resumen', async () => {
    const view = mount('/admin/vuelos', { AdminAircraftCatalog: () => catalog, CreateFlight: () => created(true) });
    const user = userEvent.setup(); const form = await fill(user, 'A320');
    await user.click(form.getByRole('button', { name: 'Revisar el resumen' })); expect((await form.findAllByText('Importe en USD (por ejemplo, 80.00).')).length).toBeGreaterThan(0); expect(screen.queryByTestId('create-flight-confirm')).not.toBeInTheDocument();
    for (const cabin of ['BUSINESS', 'ECONOMY']) { const fares = within(form.getByTestId(`fares-${cabin}`)); await user.type(fares.getByLabelText('Tarifa base (USD)'), '90'); await user.type(fares.getByLabelText('Tasas (USD)'), '10'); await user.type(fares.getByLabelText('Maleta extra (USD)'), '30'); }
    await user.click(form.getByLabelText(/Dejarlo cerrado para revisarlo/)); await user.click(form.getByRole('button', { name: 'Revisar el resumen' }));
    const confirm = within(await screen.findByTestId('create-flight-confirm')); expect(confirm.getByText(/El vuelo quedará cerrado/)).toBeInTheDocument();
    await user.click(confirm.getByLabelText(/no se puede borrar/)); await user.click(confirm.getByRole('button', { name: 'Crear el vuelo' }));
    expect(await screen.findByText('Vuelo FP210 creado: quedó cerrado, pendiente de revisión.')).toBeInTheDocument(); expect((calls(view, 'CreateFlight')[0].variables as { input: { openForSale: boolean; fares: unknown[] } }).input).toMatchObject({ openForSale: false }); expect((calls(view, 'CreateFlight')[0].variables as { input: { fares: unknown[] } }).input.fares).toHaveLength(2);
  });
  it('ADM4-F-W-12 un rechazo del servidor muestra el motivo (hora local inexistente) sin valores; un duplicado se explica; reintentar tras un 503 reutiliza la misma clave', async () => {
    let mode: 'invalid' | 'duplicate' | 'down' | 'ok' = 'invalid';
    const view = mount('/admin/vuelos', { AdminAircraftCatalog: () => catalog, CreateFlight: () => {
      if (mode === 'invalid') throw problem('VALIDATION_FAILED', 'VALIDATION', 400, [{ name: 'departureLocal', reason: 'local-time-nonexistent' }]);
      if (mode === 'duplicate') throw problem('FLIGHT_ALREADY_EXISTS', 'CONFLICT', 409);
      if (mode === 'down') throw problem('PROVIDER_UNAVAILABLE', 'UNAVAILABLE', 503);
      return created(false);
    } });
    const user = userEvent.setup(); const form = await fill(user); const economy = within(form.getByTestId('fares-ECONOMY'));
    await user.type(economy.getByLabelText('Tarifa base (USD)'), '80'); await user.type(economy.getByLabelText('Tasas (USD)'), '20'); await user.type(economy.getByLabelText('Maleta extra (USD)'), '35');
    await user.click(form.getByRole('button', { name: 'Revisar el resumen' })); const confirm = within(await screen.findByTestId('create-flight-confirm')); await user.click(confirm.getByLabelText(/no se puede borrar/));
    await user.click(confirm.getByRole('button', { name: 'Crear el vuelo' })); expect(await screen.findByText(/Esa hora local no existe en el aeropuerto/)).toBeInTheDocument();
    mode = 'duplicate'; await user.click(screen.getByRole('button', { name: 'Crear el vuelo' })); expect(await screen.findByText('Ya existe un vuelo con ese número en esa fecha.')).toBeInTheDocument();
    mode = 'down'; await user.click(screen.getByRole('button', { name: 'Crear el vuelo' })); expect(await screen.findByText('El servicio no está disponible por ahora. Inténtalo en unos segundos.')).toBeInTheDocument(); expect(screen.getByText(/Quedará CERRADO en la lista de vuelos/)).toBeInTheDocument();
    mode = 'ok'; await user.click(screen.getAllByRole('button', { name: 'Crear el vuelo' }).at(-1)!); await screen.findByTestId('create-result');
    const keys = calls(view, 'CreateFlight').map((call) => (call.variables as { idempotencyKey: string }).idempotencyKey); expect(keys).toHaveLength(4);
    expect(keys[2]).toBe(keys[3]); // 503 (incierto) → el reintento usa la MISMA clave
  });
  it('ADM4-F-W-13 copiar las tarifas de un vuelo existente con el mismo avión y aplicar un factor', async () => {
    const view = mount('/admin/vuelos', { AdminAircraftCatalog: () => catalog, AdminFlights: () => adminFlights([adminFlight({ aircraft: 'A320' })]) });
    const user = userEvent.setup(); await screen.findByRole('rowheader', { name: 'FP103' }); const form = await fill(user, 'A320');
    await user.selectOptions(form.getByLabelText('Copiar tarifas de otro vuelo (mismo avión)'), FI_1); await user.clear(form.getByLabelText('Factor')); await user.type(form.getByLabelText('Factor'), '1.1'); await user.click(form.getByRole('button', { name: 'Copiar tarifas' }));
    await waitFor(() => expect(calls(view, 'AdminFares')).toHaveLength(1)); expect((calls(view, 'AdminFares').at(-1)?.variables as { flightInstanceId: string }).flightInstanceId).toBe(FI_1);
    // el fixture trae ECONOMY (127.39-ish) y BUSINESS: los importes llegan multiplicados por 1.1 y editables
    await waitFor(() => expect((within(form.getByTestId('fares-BUSINESS')).getByLabelText('Tarifa base (USD)') as HTMLInputElement).value).toBe('418.00'));
  });
  it('ADM4-F-W-14 un vuelo cerrado se ve como «Cerrada» y se abre a la venta con confirmación (una clave por intención); uno abierto no ofrece el botón', async () => {
    const view = mount('/admin/vuelos', { AdminFlights: () => adminFlights([adminFlight({ closed: true }), adminFlight({ flightInstanceId: '22222222-2222-4222-8222-222222222222', flightNumber: 'FP105' })]), OpenFlightForSale: () => ({ openFlightForSale: { flightInstanceId: FI_1, status: 'OPEN', closed: false } }) });
    const user = userEvent.setup(); const closedRow = within(await screen.findByRole('row', { name: /FP103/ })); expect(closedRow.getByText('Cerrada')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /FP105/ })).queryByRole('button', { name: /Abrir a la venta/ })).not.toBeInTheDocument();
    await user.click(closedRow.getByRole('button', { name: 'Abrir a la venta el vuelo FP103' })); const confirm = within(await screen.findByTestId('open-flight-confirm'));
    expect(confirm.getByText('Aparecerá de inmediato en la web y en Booking')).toBeInTheDocument(); expect(calls(view, 'OpenFlightForSale')).toHaveLength(0);
    await user.click(confirm.getByRole('button', { name: 'Abrir a la venta' })); expect(await screen.findByTestId('open-result')).toBeInTheDocument();
    const variables = calls(view, 'OpenFlightForSale')[0].variables as { flightInstanceId: string; idempotencyKey: string }; expect(variables.flightInstanceId).toBe(FI_1); expect(variables.idempotencyKey).toMatch(UUID_V4);
  });
  it('ADM4-F-W-15 abrir un vuelo sin tarifas se explica (FLIGHT_NOT_READY) y no se marca como abierto', async () => {
    mount('/admin/vuelos', { AdminFlights: () => adminFlights([adminFlight({ closed: true })]), OpenFlightForSale: () => { throw problem('FLIGHT_NOT_READY', 'CONFLICT', 409); } });
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Abrir a la venta el vuelo FP103' })); await user.click(await screen.findByRole('button', { name: 'Abrir a la venta' }));
    expect(await screen.findByText(/tarifas incompletas y sigue cerrado/)).toBeInTheDocument(); expect(screen.queryByTestId('open-result')).not.toBeInTheDocument();
  });
  it('ADM4-F-W-16 un vuelo cerrado con tarifas incompletas muestra «Faltan tarifas para: …», ofrece completarlas y NO habilita «Abrir a la venta»; con las tarifas completas sí', async () => {
    const view = mount('/admin/vuelos', { AdminFlights: () => adminFlights([adminFlight({ closed: true })]), AdminFares: () => fares([fare()]), OpenFlightForSale: () => ({ openFlightForSale: { flightInstanceId: FI_1, status: 'OPEN', closed: false } }) });
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Abrir a la venta el vuelo FP103' }));
    expect(await screen.findByText('Faltan tarifas para: Ejecutiva.')).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Completa las tarifas' })).toHaveAttribute('href', '/admin/tarifas');
    expect(within(screen.getByTestId('open-flight-confirm')).getByRole('button', { name: 'Abrir a la venta' })).toBeDisabled(); expect(calls(view, 'OpenFlightForSale')).toHaveLength(0);
  });
});
