import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../data/errors';
import { renderApp, searchResult } from '../../test/utils';

const ROUTE = '/resultados?tipo=ida&tramos=UIO-GPS-2026-12-10&adultos=2';
const never = (): Promise<never> => new Promise(() => undefined);

describe('resultados de búsqueda', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-01T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('RES-01 éxito: varias ofertas con horas locales de cada aeropuerto, duración, escalas, tarifa más económica y total', async () => {
    const { client } = renderApp(ROUTE, { handlers: { SearchFlights: () => searchResult() } });
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(client.calls[0]).toMatchObject({ name: 'SearchFlights', variables: { input: { itineraries: [{ origin: 'UIO', destination: 'GPS', departureDate: '2026-12-10' }], passengers: { adults: 2, youths: 0, children: 0, infants: 0 } } } });
    const first = within(cards[0]);
    // 13:35Z = 08:35 en Quito; 16:30Z = 10:30 en Galápagos (UTC−6), no 11:30.
    expect(first.getByText('08:35')).toBeInTheDocument();
    expect(first.getByText('10:30')).toBeInTheDocument();
    expect(first.getByText('hora de Quito')).toBeInTheDocument();
    expect(first.getByText('hora de Baltra (Galápagos)')).toBeInTheDocument();
    expect(first.getByText('2 h 55 min')).toBeInTheDocument();
    expect(first.getByText('Directo')).toBeInTheDocument();
    expect(first.getByText('Economy · Light')).toBeInTheDocument();
    expect(first.getByText('desde USD 127,39 por adulto')).toBeInTheDocument();
    expect(first.getByText('USD 254,78')).toBeInTheDocument();
    expect(first.getByText('Tasas incluidas')).toBeInTheDocument();
    expect(within(cards[2]).getByText('1 escala · GYE')).toBeInTheDocument();
    expect(screen.getByText('3 ofertas')).toBeInTheDocument();
    expect(screen.getByText(/UIO – GPS/)).toBeInTheDocument();
    expect(screen.getByText(/10 dic 2026 · 2 adultos/)).toBeInTheDocument();
  });

  it('RES-02 orden por precio (por omisión) y por hora de salida, en el cliente (una sola consulta)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(ROUTE, { handlers: { SearchFlights: () => searchResult() } });
    const labels = async (): Promise<string[]> => (await screen.findAllByRole('article')).map((card) => card.getAttribute('aria-label') ?? '');
    expect(await labels()).toEqual(['Oferta FP103', 'Oferta FP105', 'Oferta FP201, FP2011']);
    await user.selectOptions(screen.getByLabelText('Ordenar por'), 'departure');
    expect(await labels()).toEqual(['Oferta FP201, FP2011', 'Oferta FP103', 'Oferta FP105']);
    expect(client.calls).toHaveLength(1);
  });

  it('RES-03 filtros en el cliente: solo directos y cabina; sin coincidencias lo dice sin perder los resultados', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(ROUTE, { handlers: { SearchFlights: () => searchResult() } });
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('checkbox', { name: 'Solo vuelos directos' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('2 de 3 ofertas con estos filtros')).toBeInTheDocument();
    const filters = within(screen.getByRole('complementary', { name: 'Filtros' }));
    await user.selectOptions(filters.getByLabelText('Cabina'), 'BUSINESS');
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('Business · Flex')).toBeInTheDocument();
    expect(within(cards[0]).getByText('desde USD 420,00 por adulto')).toBeInTheDocument();
    // Solo se ofrecen las cabinas que existen en las ofertas.
    expect(filters.queryByRole('option', { name: 'Primera' })).not.toBeInTheDocument();
    expect(client.calls).toHaveLength(1);
  });

  it('RES-04 vacío: mensaje y acción para modificar la búsqueda', async () => {
    renderApp(ROUTE, { handlers: { SearchFlights: () => ({ searchFlights: { totalOffers: 0, offers: [] } }) } });
    expect(await screen.findByRole('heading', { name: 'No hay vuelos para esa fecha' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Modificar búsqueda' })[0]).toHaveAttribute('href', '/');
  });

  it('RES-05 cargando: anuncia la búsqueda con aria-busy; al tardar (1,5 s y 8 s) avisa del arranque en frío y ofrece reintentar', async () => {
    vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-01T15:00:00Z'));
    const { client } = renderApp(ROUTE, { handlers: { SearchFlights: never } });
    const status = screen.getByRole('status', { busy: true });
    expect(status).toHaveTextContent('Buscando vuelos…');
    expect(screen.queryByText(/despertando el servicio/)).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText('Estamos despertando el servicio, puede tardar unos segundos.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    expect(screen.getByText(/Sigue intentando/)).toBeInTheDocument();
    // «Reintentar» relanza la MISMA intención: mismo X-Correlation-Id.
    await act(async () => { screen.getByRole('button', { name: 'Reintentar' }).click(); await vi.advanceTimersByTimeAsync(0); });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].correlationId).toBe(client.calls[0].correlationId);
    expect(client.calls[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('RES-06 error 503: mensaje del catálogo, Reintentar y el correlationId en Detalles; al reintentar se recupera', async () => {
    const user = userEvent.setup(); let fail = true;
    renderApp(ROUTE, { handlers: { SearchFlights: () => { if (fail) throw new AppError({ category: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', correlationId: 'corr-503' }); return searchResult(); } } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El servicio no está disponible por ahora. Inténtalo en unos segundos.');
    expect(alert).toHaveTextContent('corr-503');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findAllByRole('article')).toHaveLength(3);
  });

  it('RES-07 error 429: espera con cuenta regresiva (Retry-After) y Reintentar bloqueado mientras tanto', async () => {
    renderApp(ROUTE, { handlers: { SearchFlights: () => { throw new AppError({ category: 'RATE_LIMITED', code: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: 30, correlationId: 'c' }); } } });
    expect(await screen.findByText('Podrás reintentar en 30 s.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
    expect(screen.getByText('Hiciste demasiadas solicitudes. Espera un momento e inténtalo de nuevo.')).toBeInTheDocument();
  });

  it('RES-08 error 400 del servicio: invita a modificar la búsqueda; una URL inválida ni siquiera consulta', async () => {
    renderApp(ROUTE, { handlers: { SearchFlights: () => { throw new AppError({ category: 'VALIDATION', code: 'VALIDATION_FAILED', invalidParams: [{ name: 'input.itineraries[0].origin' }] }); } } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Revisa los datos ingresados.');
    expect(alert).toHaveTextContent('input.itineraries[0].origin');
    expect(within(alert).getByRole('link', { name: 'Modificar búsqueda' })).toHaveAttribute('href', '/');

    const bad = renderApp('/resultados?tipo=ida&tramos=UIO-UIO-2026-12-10', { handlers: { SearchFlights: () => searchResult() } });
    expect(await bad.findAllByText('Esta búsqueda no es válida o ya venció.')).not.toHaveLength(0);
    expect(bad.client.calls).toHaveLength(0);
    const past = renderApp('/resultados?tipo=ida&tramos=UIO-GPS-2026-11-01', { handlers: { SearchFlights: () => searchResult() } });
    expect(past.client.calls).toHaveLength(0);
  });

  it('RES-09 «Elegir» lleva a la pantalla provisional: invita a iniciar sesión y avisa que la compra llega en la próxima versión', async () => {
    const user = userEvent.setup();
    renderApp(ROUTE, { handlers: { SearchFlights: () => searchResult() } });
    await user.click(await screen.findByRole('button', { name: 'Elegir la oferta FP103 por USD 254,78' }));
    expect(await screen.findByRole('heading', { name: 'Ya casi puedes comprar aquí' })).toBeInTheDocument();
    expect(screen.getByText('La compra en línea llega en la próxima versión.')).toBeInTheDocument();
    expect(screen.getByText('Total desde USD 254,78')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/acceso?returnTo=%2Foferta%2Fof-1');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Volver a los resultados' })).toHaveAttribute('href', ROUTE));
  });

  it('RES-10 ida y vuelta: cada oferta muestra sus dos tramos y la consulta lleva los dos itinerarios', async () => {
    const result = searchResult(); const [first, second] = result.searchFlights.offers;
    const combined = { ...first, itineraries: [first.itineraries[0], { ...second.itineraries[0], itineraryId: 'vuelta' }] };
    const { client } = renderApp('/resultados?tipo=idavuelta&tramos=UIO-GPS-2026-12-10,GPS-UIO-2026-12-17&adultos=1', { handlers: { SearchFlights: () => ({ searchFlights: { totalOffers: 1, offers: [combined] } }) } });
    const card = await screen.findByRole('article');
    expect(within(card).getByText('Tramo 1')).toBeInTheDocument();
    expect(within(card).getByText('Tramo 2')).toBeInTheDocument();
    expect((client.calls[0].variables as { input: { itineraries: unknown[] } }).input.itineraries).toHaveLength(2);
  });
});
