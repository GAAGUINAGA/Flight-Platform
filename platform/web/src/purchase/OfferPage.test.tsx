import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppError } from '../data/errors';
import { BACK, hold, SEGMENT_ID, seatMap, signedIn, startedPurchase } from '../../test/purchase-fixtures';
import { renderApp } from '../../test/utils';
import { PurchaseStore } from './purchase-store';
import { IntentBook } from './intent';
import { memoryStore } from '../data/identity';
import { OFFER } from '../../test/purchase-fixtures';
import { counterIds } from '../../test/utils';

const seatButton = (name: RegExp | string) => screen.findByRole('button', { name });
const fresh = (): PurchaseStore => { const store = new PurchaseStore(memoryStore(), new IntentBook(counterIds())); store.start(OFFER, BACK, { adults: 2, youths: 0, children: 0, infants: 0 }); return store; };

describe('detalle de la oferta y mapa de asientos (§3.5)', () => {
  it('OFR-01 sin sesión lleva al inicio de sesión y vuelve a la oferta; sin selección en curso explica y vuelve a los resultados', async () => {
    const view = renderApp('/oferta/of-1', { purchase: fresh() });
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear una cuenta' })).toHaveAttribute('href', '/registro?returnTo=%2Foferta%2Fof-1');
    view.unmount();
    renderApp('/oferta/of-1', { session: signedIn() });
    expect(await screen.findByRole('heading', { name: 'Tu selección ya no está disponible' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a los resultados' })).toHaveAttribute('href', '/');
  });

  it('OFR-02 el mapa muestra los cinco estados con texto (no solo color) y los no libres no se pueden elegir', async () => {
    const user = userEvent.setup();
    const { purchase } = renderApp('/oferta/of-1', { session: signedIn(), purchase: fresh(), handlers: { SeatMap: () => seatMap() } });
    expect(await seatButton('Asiento 8A, ventana, libre')).toBeInTheDocument();
    for (const name of ['Asiento 9A, ventana, ocupado (con check-in)', 'Asiento 9B, pasillo, apartado por otro viajero', 'Asiento 9C, pasillo, ocupado', 'Asiento 9D, ventana, ocupado']) {
      const seat = screen.getByRole('button', { name }); expect(seat).toHaveAttribute('aria-disabled', 'true');
      await user.click(seat);
    }
    expect(purchase.getState().seats).toEqual({});
    expect(screen.getByRole('list', { name: 'Leyenda del mapa de asientos' })).toHaveTextContent(/Libre.*Elegido por ti.*Apartado por otro viajero.*Ocupado/s);
  });

  it('OFR-03 un asiento por pasajero con asiento: el elegido se anuncia, avanza al siguiente pasajero y volver a pulsarlo lo libera', async () => {
    const user = userEvent.setup();
    const { purchase } = renderApp('/oferta/of-1', { session: signedIn(), purchase: fresh(), handlers: { SeatMap: () => seatMap() } });
    await user.click(await seatButton('Asiento 8A, ventana, libre'));
    expect(screen.getByRole('button', { name: 'Asiento 8A, ventana, elegido por Pasajero 1' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Asiento 8C, pasillo, libre' }));
    expect(purchase.getState().seats[SEGMENT_ID]).toEqual(['8A', '8C']); // el segundo asiento fue al Pasajero 2, no se pisó el primero
    expect(screen.getByText('Asiento 8C')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Asiento 8A, ventana, elegido por Pasajero 1' }));
    expect(purchase.getState().seats[SEGMENT_ID]).toEqual(['', '8C']);
  });

  it('OFR-04 teclado: un solo tabulador entra al mapa, las flechas mueven el foco entre asientos y Enter elige', async () => {
    const user = userEvent.setup();
    renderApp('/oferta/of-1', { session: signedIn(), purchase: fresh(), handlers: { SeatMap: () => seatMap() } });
    const first = await seatButton('Asiento 8A, ventana, libre');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('button').filter((button) => button.hasAttribute('data-seat') && button.getAttribute('tabindex') === '0')).toHaveLength(1);
    first.focus();
    await user.keyboard('{ArrowRight}'); expect(screen.getByRole('button', { name: 'Asiento 8B, pasillo, libre' })).toHaveFocus();
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('button', { name: 'Asiento 9B, pasillo, apartado por otro viajero' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByRole('button', { name: 'Asiento 8B, pasillo, elegido por Pasajero 1' })).toBeInTheDocument();
  });

  it('OFR-05 «Continuar» sin todos los asientos avisa y no llama al servidor; con todos crea el hold con los asientos y el correlationId de la compra', async () => {
    const user = userEvent.setup();
    const { client, purchase } = renderApp('/oferta/of-1', { session: signedIn(), purchase: fresh(), handlers: { SeatMap: () => seatMap(), HoldOffer: () => ({ holdOffer: hold().hold }), Hold: () => hold() } });
    await user.click(await seatButton('Asiento 8A, ventana, libre'));
    await user.click(screen.getByRole('button', { name: 'Continuar a datos de pasajeros' }));
    expect(await screen.findByText('Elige un asiento para cada pasajero en todos los tramos.')).toBeInTheDocument();
    expect(client.calls.filter((call) => call.name === 'HoldOffer')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Asiento 8B, pasillo, libre' }));
    await user.click(screen.getByRole('button', { name: 'Continuar a datos de pasajeros' }));
    expect(await screen.findByRole('heading', { name: 'Datos de los pasajeros' })).toBeInTheDocument();
    const call = client.calls.find((entry) => entry.name === 'HoldOffer')!;
    expect(call.variables).toMatchObject({
      input: { offerId: 'of-1', selections: [{ itineraryId: 'it-1', cabinClass: 'ECONOMY', fareBrand: 'Light' }], passengers: { adults: 2, youths: 0, children: 0, infants: 0 }, seats: [{ segmentId: SEGMENT_ID, seatNumber: '8A' }, { segmentId: SEGMENT_ID, seatNumber: '8B' }] },
      idempotencyKey: expect.any(String)
    });
    expect(call.correlationId).toBe(purchase.getState().correlationId);
    expect(purchase.getState().hold?.holdId).toBe('h-1');
  });

  it('OFR-06 SEAT_TAKEN: explica, refresca el mapa, suelta solo el asiento tomado y conserva el resto de la selección', async () => {
    const user = userEvent.setup(); let taken = false;
    const { client, purchase } = renderApp('/oferta/of-1', { session: signedIn(), purchase: fresh(), handlers: {
      SeatMap: () => { const map = seatMap(); if (taken) map.seatMap.cabins[0].rows[0].seats[1] = { seatNumber: '8B', status: 'HELD', isAvailable: false, characteristics: ['AISLE'] }; return map; },
      HoldOffer: () => { taken = true; throw new AppError({ category: 'CONFLICT', code: 'SEAT_TAKEN', correlationId: 'corr-1' }); }
    } });
    await user.click(await seatButton('Asiento 8A, ventana, libre')); await user.click(screen.getByRole('button', { name: 'Asiento 8B, pasillo, libre' }));
    await user.click(screen.getByRole('button', { name: 'Continuar a datos de pasajeros' }));
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Ese asiento acaba de ser ocupado. Elige otro.');
    expect(alert).toHaveTextContent('el resto de tu selección se conserva');
    await user.click(within(alert).getByRole('button', { name: 'Actualizar el mapa' }));
    await waitFor(() => expect(client.calls.filter((call) => call.name === 'SeatMap')).toHaveLength(2));
    expect(await screen.findByRole('button', { name: 'Asiento 8B, pasillo, apartado por otro viajero' })).toBeInTheDocument();
    await waitFor(() => expect(purchase.getState().seats[SEGMENT_ID]).toEqual(['8A']));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('OFR-07 HOLD_EXPIRED / OFFER_NO_LONGER_AVAILABLE: ofrecen volver a buscar con los criterios (no al inicio en blanco)', async () => {
    const user = userEvent.setup();
    renderApp('/oferta/of-1', { session: signedIn(), purchase: startedPurchase().purchase, handlers: { SeatMap: () => seatMap(), HoldOffer: () => { throw new AppError({ category: 'CONFLICT', code: 'OFFER_NO_LONGER_AVAILABLE', correlationId: 'c' }); } } });
    await user.click(await screen.findByRole('button', { name: 'Continuar a datos de pasajeros' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Esa oferta ya no está disponible. Realiza una nueva búsqueda.');
    expect(within(alert).getByRole('link', { name: 'Buscar de nuevo' })).toHaveAttribute('href', BACK);
  });

  it('OFR-08 cambiar de tarifa descarta los asientos del tramo y un 503 deja «Reintentar» con la MISMA clave', async () => {
    const user = userEvent.setup(); let attempts = 0;
    const { client } = renderApp('/oferta/of-1', { session: signedIn(), purchase: startedPurchase().purchase, handlers: { SeatMap: () => seatMap(), HoldOffer: () => { attempts += 1; if (attempts === 1) throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', retryAfterSeconds: null }); return { holdOffer: hold().hold }; }, Hold: () => hold() } });
    await user.click(await screen.findByRole('button', { name: 'Continuar a datos de pasajeros' }));
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('El servicio no está disponible');
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Datos de los pasajeros' })).toBeInTheDocument();
    const [first, second] = client.calls.filter((call) => call.name === 'HoldOffer');
    expect((second.variables as { idempotencyKey: string }).idempotencyKey).toBe((first.variables as { idempotencyKey: string }).idempotencyKey);
    expect(second.correlationId).toBe(first.correlationId);
  });
});
