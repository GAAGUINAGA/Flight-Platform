import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bookByApi, createAdmin, expectAccessible, findCheckInFlight, graphql, signUp, watch, type TestUser } from './support';

/**
 * Extremo a extremo de F12c-4b (check-in hecho por la aerolínea) y F12c-4c (crear vuelos con su tarifa) contra la plataforma local con la web
 * (`npm run local:up -- -SkipDocker -Web`, SIN `-SkipBuild`, datos de `npm run local:seed`). El administrador sale del acceso local de pruebas; el token real de Supabase lo prueba el humano.
 * Cada corrida crea un vuelo nuevo (el vuelo no se puede borrar): el número sale al azar entre FP1000 y FP9999.
 */
async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/acceso'); const main = page.getByRole('main');
  await main.getByLabel('Correo electrónico').fill(user.email); await main.getByLabel('Contraseña').fill(user.password);
  await main.getByRole('button', { name: 'Iniciar sesión' }).click(); await expect(page.getByTestId('user-name')).toBeVisible();
}
const futureDate = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
interface SearchData { searchFlights: { offers: Array<{ itineraries: Array<{ segments: Array<{ flightNumber: string }> }> }> } }
async function publicOffers(request: APIRequestContext, date: string, origin: string, destination: string): Promise<string[]> {
  const reply = await graphql<SearchData>(request, 'SearchFlights', { input: { itineraries: [{ origin, destination, departureDate: date }], passengers: { adults: 1 } } });
  return (reply.data?.searchFlights.offers ?? []).flatMap((offer) => offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => segment.flightNumber)));
}

test('E2E-30 el administrador crea un vuelo con su tarifa: nace CERRADO (no aparece en la búsqueda pública), se revisa, se abre a la venta y entonces aparece', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request); const digits = String(1000 + Math.floor(Math.random() * 8999)); const number = `FP${digits}`; const date = futureDate(10);
  await loginAs(page, admin); await page.goto('/admin/vuelos');
  await page.getByLabel('Fecha de salida', { exact: true }).fill(date);
  await page.getByRole('button', { name: 'Crear vuelo' }).click(); const form = page.getByTestId('create-flight-form'); await expect(form).toBeVisible();
  await expect(form.getByLabel('Avión')).toBeEnabled(); await expectAccessible(page, 'Vuelos · crear vuelo');

  await form.getByLabel(/Número de vuelo/).fill(digits); await form.getByLabel('Avión').selectOption('E190');
  await form.getByLabel('Origen', { exact: true }).selectOption('UIO'); await form.getByLabel('Destino', { exact: true }).selectOption('GPS');
  await form.getByLabel(/Salida \(hora local/).fill(`${date}T15:00`); await form.getByLabel('Duración (minutos)').fill('120');
  await expect(form.getByTestId('create-arrival-preview')).toContainText('16:00'); // Galápagos es UTC-6: 15:00 en Quito + 2 h = 16:00 locales de Galápagos
  for (const group of await form.locator('[data-testid^="fares-"]').all()) {
    await group.getByLabel('Tarifa base (USD)').fill('80'); await group.getByLabel('Tasas (USD)').fill('20'); await group.getByLabel('Maleta extra (USD)').fill('35');
  }
  await form.getByLabel(/Dejarlo cerrado para revisarlo/).check();
  await form.getByRole('button', { name: 'Revisar el resumen' }).click();

  const confirm = page.getByTestId('create-flight-confirm'); await expect(confirm).toBeVisible(); await expect(confirm).toContainText('Una vez creado, el vuelo no se puede borrar');
  await expect(confirm.getByTestId('create-arrival')).toContainText('16:00'); await expect(confirm).toContainText('100.00'); await expectAccessible(page, 'Vuelos · resumen de la creación');
  const create = confirm.getByRole('button', { name: 'Crear el vuelo' }); await expect(create).toBeDisabled(); await confirm.getByLabel(/no se puede borrar/).check(); await expect(create).toBeEnabled(); await create.dblclick(); // el doble clic crea UN vuelo
  await expect(page.getByText(`Vuelo ${number} creado: quedó cerrado, pendiente de revisión.`)).toBeVisible();

  // Cerrado: figura en la lista como «Cerrada» y NO aparece en la búsqueda pública.
  const row = page.getByRole('row', { name: new RegExp(number) }); await expect(row).toContainText('Cerrada'); expect(await publicOffers(request, date, 'UIO', 'GPS')).not.toContain(number);
  await expectAccessible(page, 'Vuelos · lista con un vuelo cerrado');

  // Abrirlo a la venta (con confirmación): aparece de inmediato en la búsqueda pública.
  await row.getByRole('button', { name: `Abrir a la venta el vuelo ${number}` }).click(); const open = page.getByTestId('open-flight-confirm'); await expect(open).toContainText('Aparecerá de inmediato en la web y en Booking');
  await open.getByRole('button', { name: 'Abrir a la venta' }).click(); await expect(page.getByTestId('open-result')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(number) })).toContainText('Abierta');
  await expect.poll(async () => publicOffers(request, date, 'UIO', 'GPS'), { timeout: 30_000 }).toContain(number);
  expect(seen.problems).toEqual([]);
});

test('E2E-31 el administrador crea un vuelo ABIERTO de una vez (por omisión) y aparece en la búsqueda pública; repetirlo con el mismo número y día ⇒ ya existe', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request); const digits = String(1000 + Math.floor(Math.random() * 8999)); const number = `FP${digits}`; const date = futureDate(11);
  await loginAs(page, admin); await page.goto('/admin/vuelos'); await page.getByLabel('Fecha de salida', { exact: true }).fill(date);
  const fillForm = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Crear vuelo' }).click(); const form = page.getByTestId('create-flight-form'); await expect(form.getByLabel('Avión')).toBeEnabled();
    await form.getByLabel(/Número de vuelo/).fill(digits); await form.getByLabel('Avión').selectOption('E190'); await form.getByLabel('Origen', { exact: true }).selectOption('UIO'); await form.getByLabel('Destino', { exact: true }).selectOption('GPS');
    await form.getByLabel(/Salida \(hora local/).fill(`${date}T09:30`); await form.getByLabel('Duración (minutos)').fill('110');
    for (const group of await form.locator('[data-testid^="fares-"]').all()) { await group.getByLabel('Tarifa base (USD)').fill('95.50'); await group.getByLabel('Tasas (USD)').fill('24.50'); await group.getByLabel('Maleta extra (USD)').fill('40'); }
    await form.getByRole('button', { name: 'Revisar el resumen' }).click(); const confirm = page.getByTestId('create-flight-confirm'); await confirm.getByLabel(/no se puede borrar/).check(); await confirm.getByRole('button', { name: 'Crear el vuelo' }).click();
  };
  await fillForm(); await expect(page.getByText(`Vuelo ${number} creado: abierto a la venta.`)).toBeVisible();
  await expect.poll(async () => publicOffers(request, date, 'UIO', 'GPS'), { timeout: 30_000 }).toContain(number);
  // El mismo número el mismo día local (otra intención ⇒ otra clave) lo rechaza la aplicación.
  await fillForm(); await expect(page.getByText('Ya existe un vuelo con ese número en esa fecha.')).toBeVisible();
  expect((await publicOffers(request, date, 'UIO', 'GPS')).filter((value) => value === number).length).toBe(1);
  expect(seen.problems.filter((problem) => !/409|status of 409/.test(problem))).toEqual([]);
});

test('E2E-32 el administrador hace el check-in de la reserva de un CLIENTE dentro de la ventana y obtiene los pases con su QR; el pase es del dueño real', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request); const customer = await signUp(request, 'e2e-cliente-ci');
  const flight = await findCheckInFlight(request); test.skip(flight === null, 'No hay un vuelo sembrado dentro de la ventana de check-in (más de 60 min y menos de 48 h): ejecuta npm run local:seed');
  const booked = await bookByApi(request, customer, flight!);
  await loginAs(page, admin); await page.goto('/admin/reservas');
  await page.getByLabel('Localizador (PNR)').fill(booked.pnr); await page.getByRole('button', { name: 'Buscar' }).click(); await expect(page.getByTestId('booking-result')).toBeVisible();
  await expect(page.getByTestId('booking-result')).not.toContainText(customer.email); await expectAccessible(page, 'Buscar reserva · con el check-in');
  await page.getByRole('button', { name: 'Hacer check-in' }).click(); const confirm = page.getByTestId('checkin-confirm'); await expect(confirm).toContainText('emite pases de abordar y avisa al socio'); await expectAccessible(page, 'Buscar reserva · confirmación del check-in');
  await confirm.getByRole('button', { name: 'Confirmar check-in' }).dblclick(); // el doble clic hace UN check-in
  await expect(page.getByTestId('checkin-result')).toContainText('Con check-in');
  const pass = page.getByTestId('boarding-pass').first(); await expect(pass).toBeVisible(); await expect(pass.getByTestId('boarding-qr')).toBeVisible(); await expectAccessible(page, 'Buscar reserva · pases de abordar');
  // El dueño real: el cliente ve su propio check-in y sus pases por su sesión (si el dueño fuera otro, no los vería).
  const passes = await graphql<{ boardingPasses: Array<{ seat: string }> }>(request, 'BoardingPasses', { bookingId: booked.bookingId }, customer.token);
  expect(passes.errors).toBeUndefined(); expect(passes.data?.boardingPasses.length).toBeGreaterThan(0);
  expect(seen.problems).toEqual([]);
});

test('E2E-33 un cliente no puede crear vuelos, abrirlos ni hacer el check-in de la aerolínea: ni en el panel ni por GraphQL', async ({ page, request }) => {
  const seen = watch(page); const customer = await signUp(request, 'e2e-cliente-4bc'); await loginAs(page, customer);
  for (const path of ['/admin/vuelos', '/admin/reservas']) { await page.goto(path); await expect(page.getByRole('heading', { name: 'No tienes permiso para esta sección' })).toBeVisible(); await expect(page.getByRole('button', { name: /Crear vuelo|Hacer check-in/ })).toHaveCount(0); }
  const key = crypto.randomUUID();
  const attempts: Array<[string, unknown]> = [
    ['AdminCheckIn', { pnr: 'J4R8GZ', idempotencyKey: key }], ['AdminBoardingPasses', { pnr: 'J4R8GZ' }], ['AdminAircraftCatalog', {}], ['OpenFlightForSale', { flightInstanceId: crypto.randomUUID(), idempotencyKey: key }],
    ['CreateFlight', { idempotencyKey: key, input: { flightNumber: 'FP9999', origin: 'UIO', destination: 'GPS', departureLocal: `${futureDate(12)}T10:00`, durationMinutes: 120, aircraft: 'E190', fares: [{ cabinClass: 'ECONOMY', fareBrand: 'Basic', baseFare: '1.00', taxes: '1.00', isRefundable: false, isChangeable: false, carryOnIncluded: 1, checkedBaggageIncluded: 0, extraBaggagePrice: '1.00' }] } }]
  ];
  for (const [name, variables] of attempts) {
    const reply = await graphql(request, name, variables, customer.token);
    expect({ name, noData: Object.values(reply.data ?? {}).every((value) => value === null), code: reply.errors?.[0]?.extensions?.code }).toEqual({ name, noData: true, code: 'FORBIDDEN' });
  }
  expect(await publicOffers(request, futureDate(12), 'UIO', 'GPS')).not.toContain('FP9999');
  expect(seen.problems).toEqual([]);
});
