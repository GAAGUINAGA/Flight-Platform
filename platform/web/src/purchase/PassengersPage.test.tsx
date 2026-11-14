import { act, screen, waitFor, within } from '@testing-library/react';
// (la espera real de PAS-05 es de 2 s: el contador no se simula, se mide con el reloj monótono)
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../data/errors';
import { memoryStore } from '../data/identity';
import { BACK, hold, OFFER, signedIn, startedPurchase } from '../../test/purchase-fixtures';
import { customer, counterIds, itinerary, renderApp } from '../../test/utils';
import { IntentBook } from './intent';
import { PurchaseStore } from './purchase-store';

const handlers = { Hold: () => hold(), SeatMap: () => ({}) };
const gone = () => { throw new AppError({ category: 'GONE', code: 'HOLD_EXPIRED', correlationId: 'c' }); };

describe('datos de los pasajeros (§3.6)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('PAS-01 sin hold no hay formulario: pide elegir los asientos primero', async () => {
    renderApp('/compra/pasajeros', { session: signedIn() });
    expect(await screen.findByRole('heading', { name: 'Primero elige tus asientos' })).toBeInTheDocument();
  });

  it('PAS-02 un formulario por pasajero con sus asientos; enviar vacío marca cada campo y no avanza', async () => {
    const user = userEvent.setup();
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true }).purchase, handlers });
    expect(await screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pasajero 2 · Adulto' })).toBeInTheDocument();
    expect(screen.getByText('Asientos: FP103: 8A')).toBeInTheDocument(); expect(screen.getByText('Asientos: FP103: 8B')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    const summary = await screen.findByRole('alert'); expect(summary).toHaveTextContent('Revisa los datos marcados.');
    expect(screen.getAllByText('Escribe los nombres tal como figuran en el documento.')).toHaveLength(2);
    expect(screen.getAllByText('Escribe la fecha de nacimiento.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Pago' })).not.toBeInTheDocument();
    // Los errores nombran el campo pero jamás muestran lo escrito.
    await user.type(screen.getAllByLabelText('Número de documento')[0], '12');
    expect(screen.getAllByText('Escribe el número del documento (entre 5 y 20 letras o números).')[0]).toBeInTheDocument();
  });

  it('PAS-03 vuelo internacional ⇒ avisa que se exige pasaporte; un infante pide el adulto con el que viaja y no lleva asiento ni equipaje', async () => {
    const user = userEvent.setup();
    const international = { ...OFFER, itineraries: [itinerary({ id: 'it-1', flight: 'FP900', from: 'UIO', to: 'MAD', departure: '2026-12-10T22:00:00Z', arrival: '2026-12-11T10:00:00Z', minutes: 600 })] };
    const purchase = new PurchaseStore(memoryStore(), new IntentBook(counterIds())); purchase.start(international, BACK, { adults: 1, youths: 0, children: 0, infants: 1 }); purchase.setHold({ holdId: 'h-1', signature: 's' });
    renderApp('/compra/pasajeros', { session: signedIn(), purchase, handlers });
    expect(await screen.findByRole('heading', { name: 'Pasajero 2 · Infante' })).toBeInTheDocument();
    expect(screen.getByText('Viaja en brazos, sin asiento')).toBeInTheDocument();
    expect(screen.getAllByText('Equipaje adicional', { selector: 'strong' })).toHaveLength(1); // solo el adulto
    expect(screen.getByLabelText('Viaja con el adulto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    expect(screen.getAllByText('Los vuelos internacionales requieren pasaporte.')).toHaveLength(2);
    expect(screen.getByText('Indica el adulto con el que viaja el infante.')).toBeInTheDocument();
  });

  it('PAS-04 con todos los datos válidos pasa al pago; el equipaje adicional se suma al resumen', async () => {
    const user = userEvent.setup();
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { ...handlers, Hold: () => hold() } });
    await user.selectOptions(await screen.findByLabelText(/FP103 · maletas adicionales .* c\/u/, { selector: '#bag-0-it-1' }), '2');
    const aside = screen.getByRole('complementary', { name: 'Resumen de tu compra' });
    await waitFor(() => expect(aside).toHaveTextContent(/Equipaje adicional\s*USD 70,00/));
    expect(aside).toHaveTextContent(/Tarifas y tasas\s*USD 254,78/);
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    expect(await screen.findByRole('heading', { name: 'Pago' })).toBeInTheDocument();
  });

  it('PAS-05 el contador sale del servidor: descuenta desde su remainingSeconds y, al llegar a cero, confirma con el servidor (410 ⇒ vencido, sin avanzar)', async () => {
    let calls = 0;
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { Hold: () => { calls += 1; return calls === 1 ? hold({ remainingSeconds: 2 }) : gone(); } } });
    const timer = await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' });
    expect(timer).toHaveTextContent(/^00:0[12]$/);
    expect(await screen.findByText('Tu selección venció.', undefined, { timeout: 6000 })).toBeInTheDocument();
    expect(calls).toBe(2); // al llegar a cero consultó de nuevo al servidor
    expect(screen.getByRole('link', { name: 'Volver a buscar' })).toHaveAttribute('href', BACK);
    expect(screen.getByRole('button', { name: 'Continuar al pago' })).toBeDisabled();
  });

  it('PAS-05b al llegar a cero NO se declara vencido hasta que el servidor lo confirma: si aún le queda tiempo, el contador sigue; si dice cero, vence sin repetir consultas', async () => {
    let calls = 0;
    const view = renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { Hold: () => { calls += 1; return calls === 1 ? hold({ remainingSeconds: 1 }) : hold({ remainingSeconds: 45 }); } } });
    await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' });
    await waitFor(() => expect(calls).toBe(2), { timeout: 6000 });
    expect(await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' })).toHaveTextContent(/^0[01]:[0-5]\d$/); // volvió a contar desde lo que dijo el servidor
    expect(screen.queryByText('Tu selección venció.')).not.toBeInTheDocument();
    view.unmount();
    calls = 0;
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { Hold: () => { calls += 1; return hold({ remainingSeconds: 0 }); } } });
    expect(await screen.findByText('Tu selección venció.', undefined, { timeout: 6000 })).toBeInTheDocument();
    expect(calls).toBe(2); // una consulta inicial y una de confirmación; no entra en bucle
  });

  it('PAS-06 si el reloj del dispositivo está mal, manda el servidor: remainingSeconds, no la hora local', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-01T00:00:00Z')); // reloj del dispositivo adelantado años
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true }).purchase, handlers: { Hold: () => hold({ remainingSeconds: 540 }) } });
    expect(await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' })).toHaveTextContent('09:00');
  });

  it('PAS-07 una sesión vencida no pierde lo escrito: al volver a iniciar sesión el formulario conserva los datos', async () => {
    const user = userEvent.setup(); const session = signedIn();
    renderApp('/compra/pasajeros', { session, purchase: startedPurchase({ withHold: true }).purchase, handlers });
    await user.type((await screen.findAllByLabelText('Nombres'))[0], 'Ana');
    await user.type(screen.getAllByLabelText('Número de documento')[0], '1712345678');
    act(() => { session.set({ status: 'anonymous', expired: true }); });
    expect(await screen.findByRole('heading', { name: 'Tu sesión expiró' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Iniciar sesión' }));
    const main = within(screen.getByRole('main'));
    await user.type(main.getByLabelText('Correo electrónico'), customer.email ?? 'ana@example.test'); await user.type(main.getByLabelText('Contraseña'), 'clave-de-prueba-123');
    await user.click(main.getByRole('button', { name: 'Iniciar sesión' }));
    expect((await screen.findAllByLabelText('Nombres'))[0]).toHaveValue('Ana');
    expect(screen.getAllByLabelText('Número de documento')[0]).toHaveValue('1712345678');
  });
});
