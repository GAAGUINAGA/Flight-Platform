import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config';
import { AppError } from '../data/errors';
import { BACK, booking, hold, signedIn, startedPurchase } from '../../test/purchase-fixtures';
import { renderApp, type Handler } from '../../test/utils';

const base = { Hold: () => hold(), Booking: () => ({ booking: booking() }) };
const created = (outcome: 'COMPLETED' | 'PENDING' = 'COMPLETED', overrides = {}): Handler => () => ({ createBooking: { outcome, booking: booking(overrides) } });
const fail = (category: ConstructorParameters<typeof AppError>[0]['category'], code: string, retryAfterSeconds?: number): Handler => () => { throw new AppError({ category, code, correlationId: 'corr-x', retryAfterSeconds }); };
const open = (extra: Record<string, Handler> = {}, config: Partial<AppConfig> = {}) => {
  const started = startedPurchase({ withHold: true, withPassengers: true });
  return { ...started, view: renderApp('/compra/pago', { session: signedIn(), purchase: started.purchase, handlers: { ...base, ...extra }, config }) };
};
const pay = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: /^Pagar USD/ }));
/** Texto al que apunta `aria-describedby` del campo. */
const described = (element: HTMLElement): string => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
const createCalls =(view: ReturnType<typeof renderApp>) => view.client.calls.filter((call) => call.name === 'CreateBooking');

describe('pago (§3.7): un paso de pago normal con procesamiento simulado', () => {
  it('PAY-01 resumen del importe, medios de pago y titular; JAMÁS campos de tarjeta; la nota de demostración solo aquí y sin hablar de «prueba»', async () => {
    const { view } = open();
    expect(await screen.findByRole('heading', { name: 'Pago' })).toBeInTheDocument();
    const aside = screen.getByRole('complementary', { name: 'Resumen del importe' });
    await waitFor(() => expect(aside).toHaveTextContent(/Total a pagar\s*USD 254,78/)); // el importe congelado sale del hold del servidor
    expect(screen.getByRole('radio', { name: /Tarjeta de crédito o débito/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Transferencia bancaria/ })).toBeInTheDocument(); expect(screen.getByRole('radio', { name: /Billetera digital/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Titular del pago')).toHaveValue('Ana Pérez');
    expect(screen.getByRole('button', { name: 'Pagar USD 254,78' })).toBeInTheDocument();
    // Nada que invite a escribir datos de una tarjeta real.
    expect(screen.queryByLabelText(/número de (la )?tarjeta|vencimiento de la tarjeta|cvv|cvc|código de seguridad/i)).not.toBeInTheDocument();
    for (const input of document.querySelectorAll('input')) expect(input.getAttribute('autocomplete') ?? '').not.toMatch(/^cc-(number|exp|csc)/);
    // La nota es discreta (no un aviso con rol) y está solo en este paso.
    const note = screen.getByText('Pago procesado en modo de demostración; no se realiza ningún cargo.');
    expect(note.closest('[role]')).toBeNull();
    const main = screen.getByRole('main'); expect(main.textContent).not.toMatch(/prueba|simulado/i);
    // El selector de escenarios no existe por omisión.
    expect(screen.queryByLabelText('Resultado del procesamiento')).not.toBeInTheDocument();
    expect(view.client.calls.filter((call) => call.name === 'CreateBooking')).toHaveLength(0);
  });

  it('PAY-02 «Pagar» crea la reserva con pay_ok_*, la clave de idempotencia y el MISMO correlationId que el hold; muestra la confirmación y borra la compra (y los datos de los pasajeros)', async () => {
    const user = userEvent.setup();
    const { view, purchase } = open({ CreateBooking: created() });
    const correlation = purchase.correlationId(() => 'corr-compra');
    await pay(user);
    expect(await screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    const [call] = createCalls(view);
    const variables = call.variables as { input: { holdId: string; paymentReference: string; passengers: Array<{ passengerId: string; firstName: string; assignedSeats: unknown[] }> }; idempotencyKey: string };
    expect(variables.input.holdId).toBe('h-1'); expect(variables.input.paymentReference).toMatch(/^pay_ok_[A-Za-z0-9_-]+$/); expect(variables.input.paymentReference.length).toBeLessThanOrEqual(64);
    expect(variables.input.passengers.map((p) => [p.passengerId, p.firstName, p.assignedSeats.length])).toEqual([['PAX-1', 'Ana', 1], ['PAX-2', 'Luis', 1]]);
    expect(variables.idempotencyKey).toEqual(expect.any(String)); expect(call.correlationId).toBe(correlation);
    expect(purchase.getState().offer).toBeNull(); expect(purchase.getState().drafts).toEqual([]);
    expect(screen.getByTestId('pnr')).toHaveTextContent('ABC123');
  });

  it('PAY-03 un doble clic (o Enter repetido) no compra dos veces: una sola mutación', async () => {
    const user = userEvent.setup(); let release: () => void = () => undefined;
    const { view } = open({ CreateBooking: () => new Promise((resolve) => { release = () => resolve({ createBooking: { outcome: 'COMPLETED', booking: booking() } }); }) });
    const button = await screen.findByRole('button', { name: /^Pagar USD/ });
    await user.dblClick(button); await user.keyboard('{Enter}');
    await waitFor(() => expect(createCalls(view)).toHaveLength(1));
    expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-busy', 'true');
    release(); expect(await screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    expect(createCalls(view)).toHaveLength(1);
  });

  it('PAY-04 tras un 503 con Retry-After el reintento reutiliza la Idempotency-Key y la referencia de pago (una reconexión no compra dos veces)', async () => {
    const user = userEvent.setup(); let attempts = 0;
    const { view } = open({ CreateBooking: () => { attempts += 1; if (attempts === 1) throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'c', retryAfterSeconds: 1 }); return { createBooking: { outcome: 'COMPLETED', booking: booking() } }; } });
    await pay(user);
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('El servicio no está disponible por ahora.'); expect(alert).toHaveTextContent('Podrás reintentar en 1 s.');
    const retry = within(alert).getByRole('button', { name: 'Reintentar' }); expect(retry).toBeDisabled();
    await waitFor(() => expect(retry).not.toBeDisabled(), { timeout: 3000 });
    await user.click(retry);
    expect(await screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    const [first, second] = createCalls(view).map((call) => call.variables as { input: { paymentReference: string }; idempotencyKey: string });
    expect(second.idempotencyKey).toBe(first.idempotencyKey); expect(second.input.paymentReference).toBe(first.input.paymentReference);
  });

  it('PAY-05 pago rechazado: lo dice, la selección sigue vigente y el nuevo intento usa clave y referencia nuevas', async () => {
    const user = userEvent.setup(); let attempts = 0;
    const { view, purchase } = open({ CreateBooking: () => { attempts += 1; if (attempts === 1) throw new AppError({ category: 'UNPROCESSABLE', code: 'PAYMENT_NOT_AUTHORIZED', correlationId: 'c' }); return { createBooking: { outcome: 'COMPLETED', booking: booking() } }; } });
    await pay(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El pago fue rechazado.'); expect(alert).toHaveTextContent('Tu selección sigue reservada');
    expect(purchase.getState().hold?.holdId).toBe('h-1'); expect(purchase.getState().drafts[0].firstName).toBe('Ana');
    expect(screen.getByRole('timer')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Intentar el pago de nuevo' }));
    await pay(user);
    expect(await screen.findByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeInTheDocument();
    const [first, second] = createCalls(view).map((call) => call.variables as { input: { paymentReference: string }; idempotencyKey: string });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey); expect(second.input.paymentReference).not.toBe(first.input.paymentReference);
  });

  it('PAY-06 los escenarios de rechazo y pendiente solo existen con VITE_TEST_PAYMENT_SCENARIOS y cambian la referencia (pay_denied_*, pay_pending_*)', async () => {
    const user = userEvent.setup();
    const { view } = open({ CreateBooking: created('PENDING', { status: 'PENDING_PAYMENT', tickets: [] }) }, { testPaymentScenarios: true });
    await user.selectOptions(await screen.findByLabelText('Resultado del procesamiento'), 'pending');
    await pay(user);
    expect(await screen.findByRole('heading', { name: 'Estamos confirmando tu pago' })).toBeInTheDocument();
    expect((createCalls(view)[0].variables as { input: { paymentReference: string } }).input.paymentReference).toMatch(/^pay_pending_/);
    view.unmount();
    const denied = open({ CreateBooking: fail('UNPROCESSABLE', 'PAYMENT_NOT_AUTHORIZED') }, { testPaymentScenarios: true });
    await user.selectOptions(await screen.findByLabelText('Resultado del procesamiento'), 'denied'); await pay(user);
    await screen.findByRole('alert'); expect((createCalls(denied.view)[0].variables as { input: { paymentReference: string } }).input.paymentReference).toMatch(/^pay_denied_/);
  });

  it.each([
    ['WEB_ACTIVE_BOOKINGS_LIMIT', 'RATE_LIMITED', 'Alcanzaste el número máximo de reservas activas de tu cuenta.', 'Ver mis reservas'],
    ['WEB_PASSENGERS_PER_DAY_LIMIT', 'RATE_LIMITED', 'Alcanzaste el número máximo de pasajeros que tu cuenta puede reservar por día.', 'Ver mis reservas'],
    ['WEB_PAYMENTS_DISABLED', 'UNPROCESSABLE', 'La venta en línea no está disponible por ahora.', 'Ir al inicio']
  ] as const)('PAY-07 %s: explica el límite o la indisponibilidad de la cuenta, con una salida útil y sin hablar de «pruebas» ni de pago rechazado', async (code, category, text, action) => {
    const user = userEvent.setup();
    open({ CreateBooking: fail(category, code) }); await pay(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text); expect(alert.textContent).not.toMatch(/prueba|rechazado/i);
    expect(within(alert).getByRole('link', { name: action })).toBeInTheDocument();
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('PAY-08 correo sin confirmar: pide confirmarlo y ofrece reenviar el enlace', async () => {
    const user = userEvent.setup(); const started = startedPurchase({ withHold: true, withPassengers: true }); const session = signedIn();
    renderApp('/compra/pago', { session, purchase: started.purchase, handlers: { ...base, CreateBooking: fail('FORBIDDEN', 'EMAIL_NOT_VERIFIED') } });
    await pay(user);
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Confirma tu correo electrónico para poder reservar.');
    await user.click(within(alert).getByRole('button', { name: 'Reenviar correo de confirmación' }));
    expect(await within(alert).findByText(/Te enviamos el enlace de confirmación/)).toBeInTheDocument();
    expect(session.calls.find((call) => call.method === 'resendConfirmation')?.args[0]).toBe('ana@example.test');
  });

  it('PAY-09 hold vencido en la reserva: lleva a buscar de nuevo con los criterios; asiento tomado: libera y vuelve a elegir', async () => {
    const user = userEvent.setup();
    const expired = open({ CreateBooking: fail('GONE', 'HOLD_EXPIRED') }); await pay(user);
    expect(within(await screen.findByRole('alert')).getByRole('link', { name: 'Buscar de nuevo' })).toHaveAttribute('href', BACK);
    expired.view.unmount();
    const taken = open({ CreateBooking: fail('CONFLICT', 'SEAT_TAKEN'), ReleaseHold: () => ({ releaseHold: true }), SeatMap: () => ({ seatMap: { segmentId: 's', cabins: [] } }) }); await pay(user);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Actualizar el mapa' }));
    expect(await screen.findByRole('heading', { name: 'Elige tu tarifa y tus asientos' })).toBeInTheDocument();
    expect(taken.view.client.calls.some((call) => call.name === 'ReleaseHold')).toBe(true); expect(taken.purchase.getState().hold).toBeNull();
  });

  it('PAY-10 datos de pasajeros incompletos no permiten pagar; sin hold no hay pago', async () => {
    const incomplete = renderApp('/compra/pago', { session: signedIn(), purchase: startedPurchase({ withHold: true }).purchase, handlers: base });
    expect(await screen.findByRole('heading', { name: 'Faltan datos de los pasajeros' })).toBeInTheDocument();
    incomplete.unmount();
    renderApp('/compra/pago', { session: signedIn() });
    expect(await screen.findByRole('heading', { name: 'No hay una compra en curso' })).toBeInTheDocument();
  });

  describe('un dato que el servidor rechazó se lleva a su campo (ADR-F12b1fix-05)', () => {
    const invalid = (code: string, names: string[]): Handler => () => { throw new AppError({ category: 'VALIDATION', code, correlationId: 'corr-v', invalidParams: names.map((name) => ({ name, reason: 'valor no válido' })) }); };

    it('PAY-12 VALIDATION_FAILED con invalidParams vuelve a los pasajeros con el error en el campo y el pasajero, lo escrito intacto y el foco en el primer campo con error', async () => {
      const user = userEvent.setup();
      const { purchase } = open({ CreateBooking: invalid('VALIDATION_FAILED', ['input.passengers.1.documentNumber', 'input.passengers.0.contact.email']) }); await pay(user);
      expect(await screen.findByRole('heading', { name: 'Datos de los pasajeros' })).toBeInTheDocument();
      const documents = screen.getAllByLabelText('Número de documento'); const email = screen.getByLabelText('Correo electrónico de contacto');
      expect(documents[1]).toHaveAttribute('aria-invalid', 'true'); expect(email).toHaveAttribute('aria-invalid', 'true');
      expect(described(documents[1])).toMatch(/Escribe el número del documento/); expect(described(email)).toBe('Escribe un correo electrónico válido.');
      expect(documents[0]).not.toHaveAttribute('aria-invalid');
      await waitFor(() => expect(email).toHaveFocus()); // el correo del pasajero 1 va antes que el documento del 2
      expect(documents[1]).toHaveValue('1798765432'); expect(purchase.getState().drafts[1].documentNumber).toBe('1798765432'); // se conserva lo escrito
      const summary = screen.getByRole('alert'); expect(summary).toHaveTextContent('Hay 2 campos por corregir');
      expect(within(summary).getByRole('link', { name: 'Pasajero 2: Número de documento' })).toBeInTheDocument(); expect(within(summary).getByRole('link', { name: 'Pasajero 1: Correo electrónico' })).toBeInTheDocument();
      // Al corregir un campo, su error del servidor desaparece; el otro sigue.
      await user.type(documents[1], '0');
      expect(documents[1]).not.toHaveAttribute('aria-invalid'); expect(email).toHaveAttribute('aria-invalid', 'true');
    });

    it('PAY-13 BAGGAGE_LIMIT_EXCEEDED llega como error del campo de maletas del pasajero y tramo que las pidió, con la cantidad intacta', async () => {
      const user = userEvent.setup();
      const { purchase } = open({ CreateBooking: invalid('BAGGAGE_LIMIT_EXCEEDED', []) });
      purchase.setDrafts(purchase.getState().drafts.map((draft, index) => (index === 0 ? { ...draft, extraBaggage: { 'it-1': 2 } } : draft)));
      await pay(user);
      expect(await screen.findByRole('heading', { name: 'Datos de los pasajeros' })).toBeInTheDocument();
      const select = document.getElementById('bag-0-it-1') as HTMLSelectElement;
      expect(select).toHaveAttribute('aria-invalid', 'true'); expect(select).toHaveValue('2');
      expect(described(select)).toMatch(/Superaste el máximo de maletas permitido para este tramo/);
      await waitFor(() => expect(select).toHaveFocus());
      expect(screen.getByRole('alert')).toHaveTextContent('Pasajero 1: Maletas adicionales (FP103)');
    });

    it('PAY-15 el servidor rechaza campos que la web dio por válidos (no pudo preverlo): con los motivos de la lista cerrada, la web marca cada uno en su campo y pasajero, sin perder lo escrito', async () => {
      const user = userEvent.setup();
      const rejected: Handler = () => { throw new AppError({ category: 'VALIDATION', code: 'VALIDATION_FAILED', correlationId: 'corr-s', invalidParams: [{ name: 'input.passengers.1.birthDate', reason: 'AGE_NOT_ALLOWED_FOR_TYPE' }, { name: 'input.passengers.0.contact.phone', reason: 'INVALID_FORMAT' }, { name: 'input.passengers.1.lastName', reason: 'REQUIRED' }] }); };
      const { purchase } = open({ CreateBooking: rejected });
      const before = JSON.stringify(purchase.getState().drafts); await pay(user);
      expect(await screen.findByRole('heading', { name: 'Datos de los pasajeros' })).toBeInTheDocument();
      const births = screen.getAllByLabelText('Fecha de nacimiento'); const lastNames = screen.getAllByLabelText('Apellidos'); const phones = screen.getAllByLabelText(/Teléfono/);
      expect(births[1]).toHaveAttribute('aria-invalid', 'true'); expect(described(births[1])).toMatch(/La fecha de nacimiento no corresponde a un pasajero/);
      expect(lastNames[1]).toHaveAttribute('aria-invalid', 'true'); expect(described(lastNames[1])).toBe('Completa este dato.');
      expect(phones[0]).toHaveAttribute('aria-invalid', 'true');
      expect(births[0]).not.toHaveAttribute('aria-invalid'); expect(lastNames[0]).not.toHaveAttribute('aria-invalid'); expect(phones[1]).not.toHaveAttribute('aria-invalid');
      expect(screen.getByRole('alert')).toHaveTextContent('Hay 3 campos por corregir');
      expect(JSON.stringify(purchase.getState().drafts)).toBe(before); // nada se pierde ni se normaliza de nuevo
    });

    it('PAY-14 un VALIDATION_FAILED que no nombra ningún campo (un servicio antiguo, o un rechazo que no es de un campo) se queda en el pago con el panel de error y la salida «Corregir datos»', async () => {
      const user = userEvent.setup();
      open({ CreateBooking: invalid('VALIDATION_FAILED', []) }); await pay(user);
      const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Revisa los datos ingresados.');
      expect(within(alert).getByRole('link', { name: 'Corregir datos' })).toHaveAttribute('href', '/compra/pasajeros');
      expect(screen.getByRole('heading', { name: 'Pago' })).toBeInTheDocument();
    });
  });

  it('PAY-11 sin sesión, el pago lleva al inicio de sesión y vuelve al pago', async () => {
    renderApp('/compra/pago', { purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: base });
    expect(await screen.findByRole('link', { name: 'Crear una cuenta' })).toHaveAttribute('href', '/registro?returnTo=%2Fcompra%2Fpago');
  });
});
