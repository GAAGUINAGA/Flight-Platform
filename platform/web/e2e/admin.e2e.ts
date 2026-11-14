import { expect, test, type Page } from '@playwright/test';
import { bookByApi, createAdmin, expectAccessible, expectLegible, findFlight, findTestFlight, graphql, localInput, signUp, watch, type FoundFlight, type TestUser } from './support';

/**
 * Extremo a extremo de F12c-3 (el panel de administrador) contra la plataforma local con la web (`npm run local:up -- -SkipDocker -Web`, SIN `-SkipBuild`,
 * datos de `npm run local:seed`). El administrador sale del acceso local de pruebas (`POST /local/admin-user`); el token real de Supabase con rol admin lo prueba el humano.
 * Cada corrida retrasa un vuelo de prueba lejano (un retraso no se deshace): `npm run local:seed` repone los datos.
 */
let flight: FoundFlight;
test.beforeAll(async ({ request }) => { flight = await findFlight(request); });

async function loginAs(page: Page, user: TestUser, to = '/acceso'): Promise<void> {
  await page.goto(to);
  const main = page.getByRole('main');
  await main.getByLabel('Correo electrónico').fill(user.email); await main.getByLabel('Contraseña').fill(user.password);
  await main.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByTestId('user-name')).toBeVisible();
}
const adminChunk = (page: Page): string[] => { const urls: string[] = []; page.on('request', (request) => { if (/AdminRoutes/.test(request.url())) urls.push(request.url()); }); return urls; };
const setDate = async (page: Page, label: string, date: string): Promise<void> => { await page.getByLabel(label, { exact: true }).fill(date); };

test('E2E-20 un cliente no puede entrar al panel: ve «Sin permiso», no descarga el fragmento del panel, no ve el enlace y GraphQL le niega las operaciones de administrador', async ({ page, request }) => {
  const seen = watch(page); const chunks = adminChunk(page); const customer = await signUp(request, 'e2e-cliente');
  await loginAs(page, customer);
  await expect(page.getByRole('navigation', { name: 'Principal' })).not.toContainText('Administración');
  for (const path of ['/admin', '/admin/vuelos', '/admin/tarifas', '/admin/promociones', '/admin/reservas-web']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'No tienes permiso para esta sección' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Administración' })).toHaveCount(0);
  }
  await expectAccessible(page, 'Panel · cliente sin permiso');
  expect(chunks, 'el fragmento del panel no se descarga para un cliente').toEqual([]);
  // La autoridad es GraphQL (y el Gateway): un cliente que invoque la operación directamente recibe FORBIDDEN.
  for (const [name, variables] of [['AdminFlights', {}], ['FlightOperations', { date: flight.date }], ['PromotionAgreement', {}], ['AdminWebBookings', {}], ['AdminFares', {}]] as const) {
    const reply = await graphql(request, name, variables, customer.token);
    // Un campo anulable con error (promotionAgreement) llega como `data: { campo: null }` junto al error: lo que importa es que no hay ningún dato.
    expect({ name, noData: Object.values(reply.data ?? {}).every((value) => value === null), code: reply.errors?.[0]?.extensions?.code }).toEqual({ name, noData: true, code: 'FORBIDDEN' });
  }
  expect(seen.problems).toEqual([]);
});

test('E2E-21 sin sesión, /admin lleva al inicio de sesión y, al entrar como administrador, vuelve al panel', async ({ page, request }) => {
  const admin = await createAdmin(request); const chunks = adminChunk(page);
  await page.goto('/admin/tarifas');
  await expect(page).toHaveURL(/\/acceso/); expect(chunks).toEqual([]);
  const main = page.getByRole('main');
  await main.getByLabel('Correo electrónico').fill(admin.email); await main.getByLabel('Contraseña').fill(admin.password); await main.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Tarifas', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toContainText('Administración');
});

test('E2E-22 el administrador ve el dashboard: ocupación por cabina de los vuelos de una fecha y la salud de la plataforma (con sus siete servicios)', async ({ page, request }) => {
  const seen = watch(page); const chunks = adminChunk(page); const admin = await createAdmin(request);
  await loginAs(page, admin, '/acceso'); await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Panel de operaciones', level: 1 })).toBeVisible();
  expect(chunks.length, 'el administrador sí descarga el fragmento del panel').toBeGreaterThan(0);
  await expect(page.getByTestId('health-status')).toContainText(/Saludable|Degradada|Caída/);
  await expect(page.getByRole('list', { name: 'Servicios de la plataforma' }).getByRole('listitem')).not.toHaveCount(0);
  await setDate(page, 'Fecha de salida', flight.date);
  await expect(page.getByTestId('metric-flights')).not.toHaveText('0'); await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(flight.flightNumber) }).first()).toContainText(/hora de/); // la hora sale en la del aeropuerto, no en la del navegador (Tokio)
  await expectAccessible(page, 'Dashboard'); await expectLegible(page, 'Dashboard');
  await page.setViewportSize({ width: 390, height: 844 }); await expectLegible(page, 'Dashboard (móvil)'); await expectAccessible(page, 'Dashboard (móvil)');
  expect(seen.problems).toEqual([]);
});

test('E2E-23 cambiar el estado de un vuelo de prueba con confirmación explícita: el cambio llega al estado PÚBLICO del vuelo', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request); const target = await findTestFlight(request, admin);
  test.skip(target === null, 'No hay un vuelo programado lejano: ejecuta npm run local:seed');
  const test_ = target!;
  await loginAs(page, admin); await page.goto('/admin/vuelos'); await setDate(page, 'Fecha de salida', test_.date);
  await expectAccessible(page, 'Vuelos'); await expectLegible(page, 'Vuelos');
  await page.getByRole('button', { name: `Cambiar estado del vuelo ${test_.flightNumber}` }).click();
  const form = page.getByTestId('status-form'); await expect(form).toBeVisible(); await expectAccessible(page, 'Vuelos · formulario de estado');

  await form.getByLabel('Nuevo estado').selectOption('DELAYED');
  await form.getByRole('button', { name: 'Revisar el cambio' }).click();
  await expect(form.getByText('Un retraso necesita la nueva hora estimada de salida.')).toBeVisible();
  const estimated = localInput(new Date(Date.parse(test_.departureAt) + 90 * 60_000).toISOString(), test_.origin);
  await form.getByLabel(/Salida estimada/).fill(estimated); await form.getByLabel('Puerta de embarque').fill('a7'); await form.getByLabel('Motivo').fill('Prueba e2e del panel');
  await form.getByRole('button', { name: 'Revisar el cambio' }).click();

  const confirm = page.getByTestId('status-confirm'); await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('socios (Booking) y a los clientes mediante los webhooks'); await expect(confirm).toContainText('irreversible');
  await expectAccessible(page, 'Vuelos · confirmación');
  const go = confirm.getByRole('button', { name: 'Confirmar cambio' }); await expect(go).toBeDisabled();
  await confirm.getByLabel(/escribe el número del vuelo/).fill('otro'); await expect(go).toBeDisabled();
  await confirm.getByLabel(/escribe el número del vuelo/).fill(test_.flightNumber); await expect(go).toBeEnabled();
  await go.dblclick(); // el doble clic no aplica dos cambios (una sola Idempotency-Key en curso)

  await expect(page.getByTestId('status-result')).toContainText('Reservas afectadas:');
  await expect(page.getByText(/cambió de «Programado» a «Retrasado»/)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(test_.flightNumber) }).first()).toContainText('Retrasado');
  await expectAccessible(page, 'Vuelos · resultado');

  // El cambio llega al estado público (sin sesión de administrador: la página pública).
  await page.getByRole('link', { name: 'Ver el estado público del vuelo' }).click();
  await expect(page.getByTestId('flight-status')).toContainText('Retrasado');
  await expect(page.getByText(/Retraso estimado: \d+ min\./)).toBeVisible();
  const status = await graphql<{ flightStatus: { status: string; departure: { estimatedAt: string | null } } }>(request, 'FlightStatus', { flightNumber: test_.flightNumber, date: test_.date });
  expect(status.data?.flightStatus.status).toBe('DELAYED'); expect(status.data?.flightStatus.departure.estimatedAt).toBeTruthy();
  expect(seen.problems).toEqual([]);
});

test('E2E-24 tarifas: elegir un vuelo, editar una tarifa con confirmación de antes y después, y restaurarla', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request);
  await loginAs(page, admin); await page.goto('/admin/tarifas'); await setDate(page, 'Fecha de salida', flight.date);
  const select = page.getByLabel('Vuelo', { exact: true }); await expect(select.locator('option', { hasText: flight.flightNumber }).first()).toBeAttached();
  await select.selectOption({ label: await select.locator('option', { hasText: flight.flightNumber }).first().innerText() });
  const table = page.getByRole('table'); await expect(table).toBeVisible(); await expectAccessible(page, 'Tarifas'); await expectLegible(page, 'Tarifas');
  const row = table.getByRole('row').nth(1);
  const cells = await row.locator('td').allInnerTexts(); const shown = cells[1]; // columna «Importe total»: «USD 127,39» (la marca es la primera celda de datos)
  const originalTotal = shown.replace(/[^\d,]/g, '').replace(',', '.'); const bumped = (Math.round(Number(originalTotal) * 100 + 100) / 100).toFixed(2);
  await row.getByRole('button', { name: /^Editar la tarifa/ }).click();
  const form = page.getByTestId('fare-form'); await expect(form).toBeVisible(); await expectAccessible(page, 'Tarifas · formulario');
  await form.getByLabel(/Importe total/).fill('abc'); await form.getByRole('button', { name: 'Revisar el cambio' }).click();
  await expect(form.getByText(/hasta dos decimales/)).toBeVisible();
  await form.getByLabel(/Importe total/).fill(bumped); await form.getByRole('button', { name: 'Revisar el cambio' }).click();
  const confirm = page.getByTestId('fare-confirm'); await expect(confirm.getByTestId('fare-total-change')).toContainText('→'); await expectAccessible(page, 'Tarifas · confirmación');
  await confirm.getByRole('button', { name: 'Guardar tarifa' }).click();
  await expect(page.getByTestId('fare-saved')).toBeVisible(); await expect(table.getByRole('row').nth(1)).toContainText(bumped.replace('.', ','));

  // Restaurar el importe original.
  await table.getByRole('row').nth(1).getByRole('button', { name: /^Editar la tarifa/ }).click();
  await page.getByTestId('fare-form').getByLabel(/Importe total/).fill(originalTotal); await page.getByTestId('fare-form').getByRole('button', { name: 'Revisar el cambio' }).click();
  await page.getByTestId('fare-confirm').getByRole('button', { name: 'Guardar tarifa' }).click();
  await expect(page.getByTestId('fare-saved')).toBeVisible(); await expect(table.getByRole('row').nth(1)).toContainText(originalTotal.replace('.', ','));
  expect(seen.problems).toEqual([]);
});

test('E2E-25 promociones: el acuerdo único de la aerolínea (o su estado vacío con la opción de crearlo)', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request);
  await loginAs(page, admin); await page.goto('/admin/promociones');
  await expect(page.getByRole('heading', { name: 'Promociones', level: 1 })).toBeVisible();
  const empty = page.getByText('Aún no hay acuerdo de promociones');
  await expect(empty.or(page.getByTestId('agreement'))).toBeVisible();
  if (await empty.isVisible()) { await expect(page.getByRole('button', { name: 'Crear el acuerdo' })).toBeVisible(); await expectAccessible(page, 'Promociones · sin acuerdo'); }
  else {
    await expectAccessible(page, 'Promociones · acuerdo');
    await page.getByRole('button', { name: 'Editar el acuerdo' }).click(); const form = page.getByTestId('promotion-form'); await expectAccessible(page, 'Promociones · formulario');
    await form.getByLabel('Descuento máximo (%)').fill('120'); await form.getByRole('button', { name: 'Revisar el cambio' }).click();
    await expect(form.getByText('El descuento máximo debe estar entre 0 y 100.')).toBeVisible();
  }
  await expectLegible(page, 'Promociones'); expect(seen.problems).toEqual([]);
});

test('E2E-26 reservas web: una compra del canal web aparece como de prueba, de solo lectura y sin datos personales', async ({ page, request }) => {
  const seen = watch(page); const admin = await createAdmin(request); const buyer = await signUp(request, 'e2e-comprador');
  const booked = await bookByApi(request, buyer, flight);
  await loginAs(page, admin); await page.goto('/admin/reservas-web');
  const table = page.getByRole('table'); await expect(table).toBeVisible();
  const row = table.getByRole('row', { name: new RegExp(booked.bookingId) }); await expect(row).toBeVisible();
  await expect(row).toContainText('WEB'); await expect(row).toContainText('Sí');
  const text = await table.innerText(); expect(text).not.toContain(buyer.email); expect(text).not.toMatch(/@|\+593|Api /); // ni correo, ni teléfono, ni el nombre del pasajero («Api Prueba»)
  await expect(page.getByRole('button', { name: /editar|cancelar|eliminar/i })).toHaveCount(0);
  await expectAccessible(page, 'Reservas web'); await expectLegible(page, 'Reservas web');
  await page.setViewportSize({ width: 390, height: 844 }); await expectLegible(page, 'Reservas web (móvil)');
  expect(seen.problems).toEqual([]);
});
