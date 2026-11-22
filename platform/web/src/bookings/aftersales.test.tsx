import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../data/errors';
import { booking, ITINERARY_ID, passes, seatMap, SEGMENT_ID, signedIn } from '../../test/purchase-fixtures';
import { itinerary, renderApp, type Handler } from '../../test/utils';

const money = (total: string) => ({ currency: 'USD', total, baseFare: null, taxes: null });
const fail = (category: ConstructorParameters<typeof AppError>[0]['category'], code: string, retryAfterSeconds?: number): Handler => () => { throw new AppError({ category, code, correlationId: 'corr-x', retryAfterSeconds }); };
const NOW = '2026-12-01T15:00:00Z';
const options = () => ({ baggageOptions: [
  { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, maxAllowed: 2, alreadyPurchased: 1, price: money('35.00') }, // el servidor ya descuenta lo comprado: 3 − 0 incluidas − 1
  { passengerId: 'PAX-2', itineraryId: ITINERARY_ID, maxAllowed: 3, alreadyPurchased: 0, price: money('35.00') }
] });
const base = { Booking: () => ({ booking: booking() }) };
const calls = (view: ReturnType<typeof renderApp>, name: string) => view.client.calls.filter((call) => call.name === name);
const vars = <T,>(call: { variables: unknown }): T => call.variables as T;

describe('postventa (§3.11): importe y condiciones siempre antes de confirmar', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });

  it('ASV-01 solo aparecen las pestañas que el estado permite; sin ninguna, lo explica', async () => {
    const some = renderApp('/reservas/b-1/postventa', { session: signedIn(), handlers: { Booking: () => ({ booking: booking({ availableActions: ['tickets', 'baggage-options', 'cancellation-quote'] }) }), BaggageOptions: () => options() } });
    expect(await screen.findByRole('tab', { name: 'Equipaje' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Cancelar' })).toBeInTheDocument(); expect(screen.queryByRole('tab', { name: 'Asiento' })).not.toBeInTheDocument(); expect(screen.queryByRole('tab', { name: 'Cambiar fecha' })).not.toBeInTheDocument();
    some.unmount();
    renderApp('/reservas/b-1/postventa', { session: signedIn(), handlers: { Booking: () => ({ booking: booking({ availableActions: ['tickets'] }) }) } });
    expect(await screen.findByText('Por ahora no hay cambios disponibles para esta reserva.')).toBeInTheDocument();
  });

  it('ASV-02b equipaje con tarifa FLEX (2 incluidas): el selector ofrece exactamente lo que el servidor acepta, sin descontar dos veces lo comprado', async () => {
    renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => ({ baggageOptions: [
      { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, maxAllowed: 1, alreadyPurchased: 0, price: money('35.00') }, // 3 − 2 incluidas − 0
      { passengerId: 'PAX-2', itineraryId: ITINERARY_ID, maxAllowed: 0, alreadyPurchased: 1, price: money('35.00') } // 3 − 2 incluidas − 1: ya no admite más
    ] }) } });
    const first = await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103');
    expect(within(first).getAllByRole('option').map((option) => option.textContent)).toEqual(['0', '1']);
    const second = screen.getByLabelText(/Maletas adicionales de .* en FP103/, { selector: '#qty-PAX-2\\|' + ITINERARY_ID });
    expect(within(second).getAllByRole('option').map((option) => option.textContent)).toEqual(['0']); expect(second).toBeDisabled();
  });

  it('ASV-02 equipaje: opciones por pasajero y tramo → cantidad → resumen con importe y condiciones → pagar; clave y referencia por acción', async () => {
    const user = userEvent.setup();
    const view = renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => options(), AddBaggage: () => ({ addBaggage: { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, totalBaggage: 3 } }) } });
    const select = await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['0', '1', '2']); // el servidor dice que puede agregar 2 más (máximo 3, ya compró 1)
    expect(screen.getAllByText('USD 35,00').length).toBeGreaterThan(0);
    await user.selectOptions(select, '2'); await user.click(screen.getByRole('button', { name: 'Revisar y pagar' }));
    const summary = screen.getByRole('region', { name: 'Resumen del equipaje' });
    expect(summary).toHaveTextContent(/Total a pagar\s*USD 70,00/); expect(summary).toHaveTextContent('no es reembolsable');
    expect(calls(view, 'AddBaggage')).toHaveLength(0); // nada cambia sin confirmación explícita
    await user.click(within(summary).getByRole('button', { name: 'Pagar USD 70,00' }));
    expect(await screen.findByText('Agregamos tu equipaje.')).toBeInTheDocument();
    const [call] = calls(view, 'AddBaggage');
    expect(vars<{ input: Record<string, unknown>; idempotencyKey: string }>(call).input).toMatchObject({ bookingId: 'b-1', passengerId: 'PAX-1', itineraryId: ITINERARY_ID, quantity: 2, paymentReference: expect.stringMatching(/^pay_ok_/) });
    expect(call.correlationId).toEqual(expect.any(String));
    await waitFor(() => expect(calls(view, 'BaggageOptions').length).toBe(2)); // se refrescan las opciones
  });

  it('ASV-03 un 503 en equipaje permite reintentar con la MISMA clave; un límite superado se explica', async () => {
    const user = userEvent.setup(); let attempts = 0;
    const view = renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => options(), AddBaggage: () => { attempts += 1; if (attempts === 1) throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'c' }); if (attempts === 2) throw new AppError({ category: 'UNPROCESSABLE', code: 'BAGGAGE_LIMIT_EXCEEDED', correlationId: 'c' }); return { addBaggage: { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, totalBaggage: 2 } }; } } });
    await user.selectOptions(await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103'), '1'); await user.click(screen.getByRole('button', { name: 'Revisar y pagar' }));
    await user.click(screen.getByRole('button', { name: 'Pagar USD 35,00' }));
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Superaste el máximo de maletas permitido.')).toBeInTheDocument();
    const [first, second] = calls(view, 'AddBaggage').map((call) => ({ ...vars<{ input: { paymentReference: string }; idempotencyKey: string }>(call), correlationId: call.correlationId }));
    expect(second.idempotencyKey).toBe(first.idempotencyKey); expect(second.input.paymentReference).toBe(first.input.paymentReference); expect(second.correlationId).toBe(first.correlationId);
  });

  const bagCall = (call: { variables: unknown; correlationId?: string }) => ({ ...vars<{ input: { passengerId: string; paymentReference: string }; idempotencyKey: string }>(call), correlationId: call.correlationId });
  const addTwoLines = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.selectOptions(await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103'), '1');
    await user.selectOptions(screen.getByLabelText(/Maletas adicionales de .* en FP103/, { selector: '#qty-PAX-2\\|' + ITINERARY_ID }), '1');
    await user.click(screen.getByRole('button', { name: 'Revisar y pagar' }));
  };

  it('ASV-03b varias líneas: si la segunda da 503, el reintento NO reenvía la primera y la segunda reusa SU clave; la pantalla dice qué quedó confirmado', async () => {
    const user = userEvent.setup(); let secondAttempts = 0;
    const view = renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => options(), AddBaggage: (call) => {
      if (vars<{ input: { passengerId: string } }>(call).input.passengerId === 'PAX-2') { secondAttempts += 1; if (secondAttempts === 1) throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'c' }); }
      return { addBaggage: { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, totalBaggage: 2 } };
    } } });
    await addTwoLines(user);
    const summary = screen.getByRole('region', { name: 'Resumen del equipaje' }); expect(summary).toHaveTextContent('USD 70,00');
    await user.click(within(summary).getByRole('button', { name: 'Pagar USD 70,00' }));
    expect(await within(summary).findByText('Confirmamos 1 de 2 líneas.')).toBeInTheDocument();
    expect(summary).toHaveTextContent('Confirmada'); expect(summary).toHaveTextContent('Falta confirmar');
    expect(calls(view, 'AddBaggage')).toHaveLength(2);
    await user.click(within(summary).getByRole('button', { name: 'Reintentar las líneas que faltan' }));
    expect(await screen.findByText('Agregamos tu equipaje.')).toBeInTheDocument();
    const sent = calls(view, 'AddBaggage').map(bagCall);
    expect(sent.map((call) => call.input.passengerId)).toEqual(['PAX-1', 'PAX-2', 'PAX-2']); // la primera se envió UNA sola vez
    expect(sent[2].idempotencyKey).toBe(sent[1].idempotencyKey); expect(sent[2].input.paymentReference).toBe(sent[1].input.paymentReference);
    expect(sent[1].idempotencyKey).not.toBe(sent[0].idempotencyKey); // una clave por línea
    expect(new Set(sent.map((call) => call.correlationId)).size).toBe(1);
  });

  it('ASV-03c un doble clic en «Pagar» no envía la compra dos veces', async () => {
    const user = userEvent.setup();
    const view = renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => options(), AddBaggage: () => new Promise((resolve) => setTimeout(() => resolve({ addBaggage: { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, totalBaggage: 2 } }), 150)) } });
    await user.selectOptions(await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103'), '1'); await user.click(screen.getByRole('button', { name: 'Revisar y pagar' }));
    await user.dblClick(screen.getByRole('button', { name: 'Pagar USD 35,00' }));
    expect(await screen.findByText('Agregamos tu equipaje.')).toBeInTheDocument();
    expect(calls(view, 'AddBaggage')).toHaveLength(1);
  });

  it('ASV-03d recargar la página a mitad de la intención: las claves viven en memoria y se pierden, pero la reserva ya muestra lo comprado y nada se reenvía por sí solo', async () => {
    const user = userEvent.setup(); let reloaded = false;
    const first = renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => options(), AddBaggage: (call) => { if (vars<{ input: { passengerId: string } }>(call).input.passengerId === 'PAX-2') throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'c' }); return { addBaggage: { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, totalBaggage: 2 } }; } } });
    await addTwoLines(user);
    await user.click(within(screen.getByRole('region', { name: 'Resumen del equipaje' })).getByRole('button', { name: 'Pagar USD 70,00' }));
    await screen.findByText('Confirmamos 1 de 2 líneas.');
    first.unmount(); reloaded = true; // «recarga»: estado en memoria nuevo
    const view = renderApp('/reservas/b-1/postventa?pestana=equipaje', { session: signedIn(), handlers: { ...base, BaggageOptions: () => ({ baggageOptions: [
      { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, maxAllowed: 1, alreadyPurchased: 2, price: money('35.00') }, { passengerId: 'PAX-2', itineraryId: ITINERARY_ID, maxAllowed: 3, alreadyPurchased: 0, price: money('35.00') }] }) } });
    expect(reloaded).toBe(true);
    await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103');
    expect(screen.queryByRole('region', { name: 'Resumen del equipaje' })).not.toBeInTheDocument(); // empieza de cero, con lo ya comprado a la vista
    expect(calls(view, 'AddBaggage')).toHaveLength(0);
  });

  it('ASV-04 asiento: mapa del tramo, elegir el nuevo (sin costo) y confirmar; cada acción de postventa abre su propia correlación y clave', async () => {
    const user = userEvent.setup();
    const view = renderApp('/reservas/b-1/postventa?pestana=asiento', { session: signedIn(), handlers: { ...base, SeatMap: () => seatMap(), ChangeSeats: () => ({ changeSeats: { seats: [{ passengerId: 'PAX-1', segmentId: SEGMENT_ID, previousSeatNumber: '8A', seatNumber: '8C', status: 'BOOKED' }] } }), BaggageOptions: () => options(), AddBaggage: () => ({ addBaggage: { passengerId: 'PAX-1', itineraryId: ITINERARY_ID, totalBaggage: 2 } }) } });
    expect(await screen.findByRole('button', { name: 'Asiento 8A, ventana, elegido por Pasajero 1 (asiento actual)' })).toBeInTheDocument();
    expect(view.client.calls.find((call) => call.name === 'SeatMap')?.variables).toMatchObject({ offerId: 'b-1', segmentId: SEGMENT_ID });
    await user.click(screen.getByRole('button', { name: 'Asiento 8C, pasillo, libre' }));
    const changes = screen.getByRole('region', { name: 'Cambios de asiento' });
    expect(changes).toHaveTextContent('Pasajero 1 · Ana Pérez · FP103 → asiento 8C'); expect(changes).toHaveTextContent('Sin costo adicional.');
    await user.click(within(changes).getByRole('button', { name: 'Confirmar el cambio de asiento' }));
    expect(await screen.findByText('Cambiamos tus asientos.')).toBeInTheDocument();
    const seats = calls(view, 'ChangeSeats')[0];
    expect(vars<{ bookingId: string; seats: unknown[]; idempotencyKey: string }>(seats)).toMatchObject({ bookingId: 'b-1', seats: [{ passengerId: 'PAX-1', segmentId: SEGMENT_ID, seatNumber: '8C' }] });
    // Otra acción de postventa (equipaje) en la misma pantalla: correlación y clave nuevas.
    await user.click(screen.getByRole('tab', { name: 'Equipaje' }));
    await user.selectOptions(await screen.findByLabelText('Maletas adicionales de Ana Pérez en FP103'), '1'); await user.click(screen.getByRole('button', { name: 'Revisar y pagar' })); await user.click(screen.getByRole('button', { name: 'Pagar USD 35,00' }));
    await screen.findByText('Agregamos tu equipaje.');
    const bag = calls(view, 'AddBaggage')[0];
    expect(bag.correlationId).not.toBe(seats.correlationId); expect(vars<{ idempotencyKey: string }>(bag).idempotencyKey).not.toBe(vars<{ idempotencyKey: string }>(seats).idempotencyKey);
  });

  it('ASV-05 SEAT_TAKEN al cambiar el asiento: explica y permite actualizar el mapa', async () => {
    const user = userEvent.setup();
    const view = renderApp('/reservas/b-1/postventa?pestana=asiento', { session: signedIn(), handlers: { ...base, SeatMap: () => seatMap(), ChangeSeats: fail('CONFLICT', 'SEAT_TAKEN') } });
    await user.click(await screen.findByRole('button', { name: 'Asiento 8C, pasillo, libre' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar el cambio de asiento' }));
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Ese asiento acaba de ser ocupado. Elige otro.');
    await user.click(within(alert).getByRole('button', { name: 'Actualizar el mapa' }));
    await waitFor(() => expect(calls(view, 'SeatMap')).toHaveLength(2));
  });

  const dateOffer = (total: string) => ({ searchDateChange: [{ changeOfferId: 'co-1', expiresAt: '2026-12-01T15:20:00Z', segments: itinerary({ id: 'x', flight: 'FP105', from: 'UIO', to: 'GPS', departure: '2026-12-12T17:20:00Z', arrival: '2026-12-12T20:15:00Z', minutes: 175 }).segments, priceDifference: { fareDifference: '30.00', taxDifference: '5.00', changeFee: '5.00', totalToPay: total } }] });

  it('ASV-06 cambiar la fecha: buscar, ver tarifa, tasas, cargo y total a pagar, confirmar con pago; el resultado vuelve al detalle', async () => {
    const user = userEvent.setup();
    const view = renderApp('/reservas/b-1/postventa?pestana=fecha', { session: signedIn(), handlers: { ...base, SearchDateChange: () => dateOffer('40.00'), ConfirmDateChange: () => ({ confirmDateChange: { outcome: 'COMPLETED', booking: booking() } }) } });
    await screen.findByLabelText('Nueva fecha de salida');
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(screen.getByText('Elige la nueva fecha de salida.')).toBeInTheDocument(); expect(calls(view, 'SearchDateChange')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Nueva fecha de salida'), { target: { value: '2026-12-12' } });
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    const offer = await screen.findByRole('article', { name: 'Opción FP105' });
    expect(vars<{ bookingId: string; changes: unknown[] }>(calls(view, 'SearchDateChange')[0])).toMatchObject({ bookingId: 'b-1', changes: [{ itineraryId: ITINERARY_ID, newDepartureDate: '2026-12-12' }] });
    expect(offer).toHaveTextContent(/Diferencia de tarifa\s*USD 30,00/); expect(offer).toHaveTextContent(/Diferencia de tasas\s*USD 5,00/); expect(offer).toHaveTextContent(/Cargo por cambio\s*USD 5,00/); expect(offer).toHaveTextContent(/Total a pagar\s*USD 40,00/);
    expect(offer).toHaveTextContent('12:20'); expect(offer).toHaveTextContent('hora de Quito'); // 17:20Z = 12:20 en Quito
    await user.click(within(offer).getByRole('button', { name: 'Elegir esta opción' }));
    const confirm = screen.getByRole('region', { name: 'Confirmar el cambio de fecha' }); expect(confirm).toHaveTextContent('Pagarás USD 40,00 por el cambio.');
    expect(calls(view, 'ConfirmDateChange')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar el cambio' }));
    expect(await screen.findByText('Cambiamos la fecha de tu viaje.')).toBeInTheDocument();
    expect(vars<{ input: Record<string, unknown> }>(calls(view, 'ConfirmDateChange')[0]).input).toMatchObject({ bookingId: 'b-1', changeOfferId: 'co-1', paymentReference: expect.stringMatching(/^pay_ok_/) });
  });

  it('ASV-07 un cambio sin costo no envía referencia de pago; una oferta vencida lleva a buscar de nuevo', async () => {
    const user = userEvent.setup(); let confirm: Handler = () => ({ confirmDateChange: { outcome: 'PENDING', booking: null } });
    const view = renderApp('/reservas/b-1/postventa?pestana=fecha', { session: signedIn(), handlers: { ...base, SearchDateChange: () => dateOffer('0.00'), ConfirmDateChange: (call) => confirm(call) } });
    await screen.findByLabelText('Nueva fecha de salida'); fireEvent.change(screen.getByLabelText('Nueva fecha de salida'), { target: { value: '2026-12-12' } });
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' })); await user.click(await screen.findByRole('button', { name: 'Elegir esta opción' }));
    expect(screen.getByRole('region', { name: 'Confirmar el cambio de fecha' })).toHaveTextContent('Este cambio no tiene costo adicional.');
    confirm = fail('GONE', 'CHANGE_OFFER_EXPIRED');
    await user.click(screen.getByRole('button', { name: 'Confirmar el cambio' }));
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('La oferta de cambio venció. Búscala de nuevo.');
    expect(within(alert).getByRole('link', { name: 'Buscar de nuevo' })).toHaveAttribute('href', '/reservas/b-1/postventa?pestana=fecha');
    expect(vars<{ input: Record<string, unknown> }>(calls(view, 'ConfirmDateChange')[0]).input).not.toHaveProperty('paymentReference');
  });

  it('ASV-08 cancelar: cotiza, muestra reembolso, penalidad y vigencia, exige las dos confirmaciones y cancela con el quoteId', async () => {
    const user = userEvent.setup();
    const quote = { cancellationQuote: { quoteId: 'q-1', isRefundable: true, refundAmount: '200.00', penaltyAmount: '54.78', currency: 'USD', expiresAt: '2026-12-01T15:05:00Z' } };
    const view = renderApp('/reservas/b-1/postventa?pestana=cancelar', { session: signedIn(), handlers: { ...base, CancellationQuote: () => quote, CancelBooking: () => ({ cancelBooking: { outcome: 'COMPLETED', status: 'CANCELLED', cancelledAt: NOW, ticketsVoided: ['1', '2'], message: null, refund: { refundId: 'r-1', amount: '200.00', penaltyAmount: '54.78', currency: 'USD', percentage: 78, status: 'CALCULATED' }, inventoryRestoration: { status: 'RESTORED', seatsReleased: 2 } } }) } });
    await user.click(await screen.findByRole('button', { name: 'Cotizar la cancelación' }));
    const panel = await screen.findByRole('region', { name: 'Cotización de la cancelación' });
    expect(panel).toHaveTextContent(/Reembolso\s*USD 200,00/); expect(panel).toHaveTextContent(/Penalidad\s*USD 54,78/); expect(panel).toHaveTextContent(/Cotización válida durante\s*05:00/);
    const cancel = within(panel).getByRole('button', { name: 'Cancelar la reserva' }); expect(cancel).toBeDisabled();
    await user.click(within(panel).getByRole('checkbox', { name: /cancelación es definitiva/ })); expect(cancel).toBeDisabled();
    await user.click(within(panel).getByRole('checkbox', { name: /Acepto el reembolso de USD 200,00 y la penalidad de USD 54,78/ })); expect(cancel).not.toBeDisabled();
    expect(calls(view, 'CancelBooking')).toHaveLength(0);
    await user.click(cancel);
    expect(await screen.findByRole('heading', { name: 'Tu reserva fue cancelada' })).toBeInTheDocument();
    expect(screen.getByText(/Reembolso calculado:/)).toHaveTextContent('USD 200,00');
    expect(vars(calls(view, 'CancelBooking')[0])).toMatchObject({ bookingId: 'b-1', quoteId: 'q-1', reasonCode: 'CUSTOMER_REQUEST', idempotencyKey: expect.any(String) });
  });

  it('ASV-09 una cotización vencida se vuelve a pedir (QUOTE_EXPIRED ⇒ «Cotizar de nuevo»)', async () => {
    const user = userEvent.setup(); let n = 0;
    const view = renderApp('/reservas/b-1/postventa?pestana=cancelar', { session: signedIn(), handlers: { ...base, CancellationQuote: () => { n += 1; return { cancellationQuote: { quoteId: `q-${n}`, isRefundable: false, refundAmount: '0.00', penaltyAmount: '0.00', currency: 'USD', expiresAt: '2026-12-01T15:05:00Z' } }; }, CancelBooking: fail('CONFLICT', 'QUOTE_EXPIRED') } });
    await user.click(await screen.findByRole('button', { name: 'Cotizar la cancelación' })); const panel = await screen.findByRole('region', { name: 'Cotización de la cancelación' });
    await user.click(within(panel).getByRole('checkbox', { name: /definitiva/ })); await user.click(within(panel).getByRole('checkbox', { name: /Acepto el reembolso/ })); await user.click(within(panel).getByRole('button', { name: 'Cancelar la reserva' }));
    expect(await screen.findByText('La cotización venció. Solicítala de nuevo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cotizar de nuevo' }));
    await waitFor(() => expect(calls(view, 'CancellationQuote')).toHaveLength(2));
    expect(within(await screen.findByRole('region', { name: 'Cotización de la cancelación' })).getByRole('button', { name: 'Cancelar la reserva' })).toBeDisabled(); // hay que confirmar de nuevo
  });
});

describe('check-in y pase de abordar (§3.12)', () => {
  afterEach(() => { vi.useRealTimers(); });
  const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
  const notYet = fail('CONFLICT', 'BOARDING_PASS_NOT_AVAILABLE');

  it('CHI-01 antes de la ventana: dice cuándo abre en la hora local del aeropuerto y, si se intenta, traduce la respuesta del servidor', async () => {
    at('2026-12-01T15:00:00Z'); const user = userEvent.setup();
    const view = renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { ...base, BoardingPasses: notYet, CheckIn: fail('CONFLICT', 'CHECK_IN_NOT_AVAILABLE') } });
    expect(await screen.findByTestId('checkin-window')).toHaveTextContent('El check-in abre el 8 dic 2026 a las 08:35, hora de Quito. Vuelo FP103.');
    expect(screen.getByText('Todavía no abre el check-in.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Hacer check-in' }); expect(button).not.toBeDisabled(); // el reloj del dispositivo puede estar mal: se permite intentar
    await user.click(button);
    expect(await screen.findByText('El check-in no está disponible todavía.')).toBeInTheDocument(); expect(calls(view, 'CheckIn')).toHaveLength(1);
  });

  it('CHI-02 dentro de la ventana: hace el check-in de todos y muestra un pase por pasajero y tramo, con hora local e imprimible', async () => {
    at('2026-12-09T15:00:00Z'); const user = userEvent.setup(); let done = false;
    const view = renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { ...base, BoardingPasses: () => { if (!done) throw new AppError({ category: 'CONFLICT', code: 'BOARDING_PASS_NOT_AVAILABLE', correlationId: 'c' }); return passes(); }, CheckIn: () => { done = true; return { checkIn: { bookingId: 'b-1', status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'PAX-1', status: 'CHECKED_IN', segments: [] }, { passengerId: 'PAX-2', status: 'CHECKED_IN', segments: [] }] } }; } } });
    expect(await screen.findByTestId('checkin-window')).toHaveTextContent('El check-in está abierto y cierra el 10 dic 2026 a las 07:35, hora de Quito.');
    await user.click(screen.getByRole('button', { name: 'Hacer check-in' }));
    const pass = await screen.findByRole('article', { name: /Pase de abordar de Ana Pérez, vuelo FP103/ });
    expect(pass).toHaveTextContent('PÉREZ / ANA'); expect(pass).toHaveTextContent('UIO'); expect(pass).toHaveTextContent('GPS');
    expect(pass).toHaveTextContent(/Salida\s*jue 10 dic 2026 · 08:35 · hora de Quito/); expect(pass).toHaveTextContent(/Asiento\s*8A/); expect(pass).toHaveTextContent(/Puerta\s*A4/); expect(pass).toHaveTextContent('Código AZTEC');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(within(screen.getAllByRole('article')[1]).queryByText('Puerta')).not.toBeInTheDocument(); // la puerta solo si el pase la trae
    expect(screen.getByRole('button', { name: /Imprimir pases/ })).toBeInTheDocument();
    expect(calls(view, 'CheckIn')).toHaveLength(1); expect(view.client.calls.filter((call) => call.name === 'CheckIn')[0].variables).toEqual({ bookingId: 'b-1' });
  });

  it('CHI-03 un pase ya emitido se muestra directamente, sin volver a pedir el check-in; fuera de la ventana por cierre lo dice', async () => {
    at('2026-12-09T15:00:00Z');
    const issued = renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { ...base, BoardingPasses: () => passes() } });
    expect(await screen.findAllByRole('article')).toHaveLength(2); expect(calls(issued, 'CheckIn')).toHaveLength(0);
    issued.unmount(); at('2026-12-10T12:50:00Z');
    renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { ...base, BoardingPasses: notYet } });
    expect(await screen.findByText('El check-in de este vuelo ya cerró.')).toBeInTheDocument();
    expect(screen.getByTestId('checkin-window')).toHaveTextContent('El check-in cerró el 10 dic 2026 a las 07:35, hora de Quito.');
  });

  it('CHI-04 sin sesión lleva al inicio de sesión; un fallo del check-in se puede reintentar', async () => {
    at('2026-12-09T15:00:00Z'); const user = userEvent.setup();
    const anonymous = renderApp('/reservas/b-1/checkin');
    expect(await screen.findByRole('link', { name: 'Crear una cuenta' })).toHaveAttribute('href', '/registro?returnTo=%2Freservas%2Fb-1%2Fcheckin');
    anonymous.unmount();
    renderApp('/reservas/b-1/checkin', { session: signedIn(), handlers: { ...base, BoardingPasses: notYet, CheckIn: fail('UNPROCESSABLE', 'CHECK_IN_FAILED') } });
    await user.click(await screen.findByRole('button', { name: 'Hacer check-in' }));
    expect(await screen.findByText('No pudimos completar el check-in.')).toBeInTheDocument();
  });
});
