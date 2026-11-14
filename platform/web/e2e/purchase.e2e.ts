import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bookByApi, expectAccessible, expectLegible, findCheckInFlight, findFlight, holdSeatByApi, signUp, watch, type FoundFlight, type TestUser } from './support';

/**
 * Extremo a extremo de F12c-2b contra la plataforma local con la web (`npm run local:up -- -SkipDocker -Web`, datos de `npm run local:seed`):
 * la compra completa, mis reservas, el detalle, la postventa (equipaje, asiento, fecha, cancelación con cotización), el check-in y los errores
 * principales. Cada prueba crea su propio usuario en el servicio de acceso local.
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

async function chooseOffer(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Solo ida' }).check();
  await page.getByLabel('Desde', { exact: true }).selectOption(flight.origin);
  await page.getByLabel('Hacia').selectOption(flight.destination);
  await page.getByLabel('Ida', { exact: true }).fill(flight.date);
  await page.getByRole('button', { name: 'Buscar vuelos' }).click();
  await page.getByRole('article', { name: new RegExp(flight.flightNumber) }).first().getByRole('button', { name: /^Elegir/ }).click();
  await expect(page).toHaveURL(/\/oferta\//);
  await expect(page.getByRole('heading', { name: 'Elige tu tarifa y tus asientos' })).toBeVisible();
}

const freeSeats = (page: Page) => page.locator('button[data-seat][data-status="AVAILABLE"]');

async function fillPassenger(page: Page, user: TestUser, document = `17${String(Date.now()).slice(-8)}`): Promise<void> {
  const card = page.getByRole('region', { name: 'Pasajero 1 · Adulto' });
  await card.getByLabel('Nombres').fill('Ana María'); await card.getByLabel('Apellidos').fill('Pérez Vera');
  await card.getByLabel('Número de documento').fill(document);
  await card.getByLabel('Fecha de nacimiento').fill('1990-03-14'); await card.getByLabel('Género').selectOption('F');
  await card.getByLabel('Correo electrónico de contacto').fill(user.email); await card.getByLabel('Teléfono de contacto').fill('+593987654321');
}

/** Búsqueda → oferta → un asiento → pasajero → pago. Devuelve el asiento elegido. */
async function reachPayment(page: Page, user: TestUser): Promise<string> {
  await chooseOffer(page);
  const seat = await freeSeats(page).first().getAttribute('data-seat') ?? '';
  await freeSeats(page).first().click();
  await page.getByRole('button', { name: 'Continuar a datos de pasajeros' }).click();
  await expect(page.getByRole('heading', { name: 'Datos de los pasajeros' })).toBeVisible();
  await fillPassenger(page, user);
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await expect(page.getByRole('heading', { name: 'Pago', exact: true })).toBeVisible();
  return seat;
}

test('E2E-10 la compra completa: oferta y asientos, pasajeros, pago, confirmación, mis reservas, detalle, equipaje, asiento, fecha, cotizar y cancelar', async ({ page, request }) => {
  const seen = watch(page); const user = await signUp(request);
  await loginAs(page, user);
  await chooseOffer(page);

  await test.step('detalle de la oferta y mapa de asientos (con teclado)', async () => {
    await expect(page.getByRole('group', { name: 'Mapa de asientos' })).toBeVisible();
    await expectAccessible(page, 'Oferta y mapa de asientos'); await expectLegible(page, 'Oferta y mapa de asientos');
    const seat = freeSeats(page).first(); const number = await seat.getAttribute('data-seat');
    await seat.focus(); await page.keyboard.press('Enter'); // Enter elige el asiento enfocado
    await expect(page.getByRole('button', { name: new RegExp(`Asiento ${number}, .*elegido por Pasajero 1`) })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown'); // las flechas mueven el foco entre asientos (otra fila)
    const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-seat') ?? '');
    expect(moved).toMatch(/^\d+[A-Z]$/); expect(moved).not.toBe(number);
    await expect(page.getByRole('list', { name: 'Leyenda del mapa de asientos' })).toContainText('Apartado por otro viajero');
    await page.getByRole('button', { name: 'Continuar a datos de pasajeros' }).click();
  });

  await test.step('datos del pasajero: validación antes de llamar al servidor y temporizador del servidor', async () => {
    await expect(page.getByRole('heading', { name: 'Datos de los pasajeros' })).toBeVisible();
    await expect(page.getByRole('timer', { name: 'Tiempo restante de tu selección' })).toHaveText(/^\d\d:\d\d$/);
    await page.getByRole('button', { name: 'Continuar al pago' }).click();
    await expect(page.getByText('Revisa los datos marcados.')).toBeVisible();
    await expectAccessible(page, 'Pasajeros con errores'); await expectLegible(page, 'Pasajeros con errores');
    await fillPassenger(page, user);
    await expectAccessible(page, 'Pasajeros'); await page.getByRole('button', { name: 'Continuar al pago' }).click();
  });

  await test.step('pago: sin campos de tarjeta, nota de demostración solo aquí, y la reserva se confirma', async () => {
    await expect(page.getByRole('heading', { name: 'Pago', exact: true })).toBeVisible();
    await expect(page.getByLabel(/número de (la )?tarjeta|cvv|cvc|código de seguridad/i)).toHaveCount(0);
    await expect(page.getByText('Pago procesado en modo de demostración; no se realiza ningún cargo.')).toBeVisible();
    expect(await page.getByRole('main').innerText()).not.toMatch(/prueba|simulado/i);
    await expectAccessible(page, 'Pago'); await expectLegible(page, 'Pago');
    await page.getByLabel('Resultado del procesamiento').selectOption('ok');
    await page.getByRole('button', { name: /^Pagar USD/ }).click();
    await expect(page.getByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeVisible();
  });

  const pnr = (await page.getByTestId('pnr').innerText()).trim();
  const bookingUrl = await test.step('confirmación: PNR, boletos y itinerario en la hora local del aeropuerto', async () => {
    expect(pnr).toMatch(/^[A-Z0-9]{5,8}$/);
    await expect(page.getByRole('main').getByText(/^Llega: .* · hora de /)).toBeVisible();
    await expect(page.getByRole('main').getByRole('cell', { name: /^\d{10,}/ }).first()).toBeVisible();
    await expectAccessible(page, 'Confirmación'); await expectLegible(page, 'Confirmación');
    await page.getByRole('link', { name: 'Ver mi reserva' }).click();
    await expect(page.getByTestId('pnr')).toHaveText(pnr);
    return page.url();
  });

  await test.step('mis reservas: la reserva aparece, con filtros y el aviso para quien compró por una agencia', async () => {
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mis reservas' }).click();
    await expect(page.getByRole('article', { name: `Reserva ${pnr}` })).toBeVisible();
    await expect(page.getByText('¿Compraste por una agencia o con un socio?')).toBeVisible();
    await expectAccessible(page, 'Mis reservas'); await expectLegible(page, 'Mis reservas');
    await page.getByLabel('Código de reserva').fill(pnr); await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByRole('link', { name: `Ver reserva ${pnr}` }).click();
    await expect(page).toHaveURL(bookingUrl);
    await expectAccessible(page, 'Detalle de la reserva'); await expectLegible(page, 'Detalle de la reserva');
  });

  await test.step('postventa · comprar equipaje (importe y condiciones antes de confirmar)', async () => {
    await page.getByRole('link', { name: 'Gestionar mi reserva' }).first().click();
    await page.getByRole('tab', { name: 'Equipaje' }).click();
    await page.getByLabel(/^Maletas adicionales de Ana María Pérez Vera/).selectOption('1');
    await page.getByRole('button', { name: 'Revisar y pagar' }).click();
    await expect(page.getByRole('region', { name: 'Resumen del equipaje' })).toContainText('Total a pagar');
    await expectAccessible(page, 'Postventa · equipaje'); await expectLegible(page, 'Postventa · equipaje');
    await page.getByRole('button', { name: /^Pagar USD/ }).click();
    await expect(page.getByText('Agregamos tu equipaje.')).toBeVisible();
  });

  await test.step('postventa · cambiar el asiento (sin costo)', async () => {
    await page.getByRole('tab', { name: 'Asiento' }).click();
    await expect(page.getByRole('group', { name: 'Mapa de asientos' })).toBeVisible();
    await expectAccessible(page, 'Postventa · asiento');
    await freeSeats(page).first().click();
    await expect(page.getByRole('region', { name: 'Cambios de asiento' })).toContainText('Sin costo adicional.');
    await page.getByRole('button', { name: 'Confirmar el cambio de asiento' }).click();
    await expect(page.getByText('Cambiamos tus asientos.')).toBeVisible();
  });

  await test.step('postventa · cambiar la fecha: buscar y ver la diferencia a pagar antes de confirmar', async () => {
    await page.getByRole('tab', { name: 'Cambiar fecha' }).click();
    const next = new Date(Date.parse(`${flight.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Nueva fecha de salida').fill(next);
    await page.getByRole('button', { name: 'Buscar vuelos' }).click();
    await expect(page.getByRole('article', { name: /^Opción / }).first().or(page.getByText('No hay vuelos para esa fecha.')).or(page.getByRole('alert'))).toBeVisible();
    await expectAccessible(page, 'Postventa · fecha');
    if (await page.getByRole('article', { name: /^Opción /}).count() > 0) await expect(page.getByRole('article', { name: /^Opción / }).first()).toContainText('Total a pagar');
  });

  await test.step('postventa · cotizar y cancelar (reembolso y penalidad visibles antes de confirmar)', async () => {
    await page.getByRole('tab', { name: 'Cancelar' }).click();
    await page.getByRole('button', { name: 'Cotizar la cancelación' }).click();
    const quote = page.getByRole('region', { name: 'Cotización de la cancelación' });
    await expect(quote).toContainText('Reembolso'); await expect(quote).toContainText('Penalidad');
    await expectAccessible(page, 'Postventa · cancelar'); await expectLegible(page, 'Postventa · cancelar');
    const confirm = quote.getByRole('button', { name: 'Cancelar la reserva' }); await expect(confirm).toBeDisabled();
    await quote.getByRole('checkbox', { name: /cancelación es definitiva/ }).check(); await quote.getByRole('checkbox', { name: /Acepto el reembolso/ }).check();
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Tu reserva fue cancelada' })).toBeVisible();
    await page.getByRole('link', { name: 'Ver mi reserva' }).click();
    await expect(page.getByText('Esta reserva está cancelada.')).toBeVisible(); await expect(page.getByText('Cancelada').first()).toBeVisible();
  });

  const hosts = new Set([...seen.hosts].filter((host) => !/^(localhost|127\.0\.0\.1):/.test(host)));
  expect([...hosts]).toEqual([]);
  expect(seen.problems).toEqual([]);
});

test('E2E-11 el check-in fuera de ventana explica cuándo abre (hora local del aeropuerto) y el servidor tiene la última palabra', async ({ page, request }) => {
  const user = await signUp(request); const booked = await bookByApi(request, user, flight);
  await loginAs(page, user);
  await page.goto(`/reservas/${booked.bookingId}/checkin`);
  await expect(page.getByTestId('checkin-window')).toContainText(/El check-in (abre|está abierto|cerró)/);
  await expectAccessible(page, 'Check-in'); await expectLegible(page, 'Check-in');
  const window = await page.getByTestId('checkin-window').innerText();
  if (/abre el/.test(window)) {
    expect(window).toMatch(/\d{1,2} \w{3} \d{4} a las \d\d:\d\d, hora de /);
    await page.getByRole('button', { name: 'Hacer check-in' }).click();
    await expect(page.getByText('El check-in no está disponible todavía.')).toBeVisible();
  }
});

test('E2E-12 el check-in dentro de su ventana y el pase de abordar con la hora local del aeropuerto', async ({ page, request }) => {
  const near = await findCheckInFlight(request);
  test.skip(near === null, 'No aplicable: no hay ningún vuelo sembrado que salga dentro de la ventana de check-in (menos de 48 h y más de 60 min). Se cubre con las pruebas de componentes y de reglas (bordes de 48 h y 60 min).');
  const user = await signUp(request); const booked = await bookByApi(request, user, near!);
  await loginAs(page, user);
  await page.goto(`/reservas/${booked.bookingId}/checkin`);
  await expect(page.getByTestId('checkin-window')).toContainText('El check-in está abierto');
  await page.getByRole('button', { name: 'Hacer check-in' }).click();
  const pass = page.getByRole('article', { name: /^Pase de abordar de / }).first();
  await expect(pass).toBeVisible(); await expect(pass).toContainText(/hora de /); await expect(pass).toContainText('Asiento');
  const qr = pass.getByRole('img', { name: /^Código QR del pase de abordar de .+\. Código del pase: / }); // QR dibujado en el navegador bajo la CSP, con su texto alternativo
  await expect(qr).toBeVisible(); expect((await qr.boundingBox())?.width ?? 0).toBeGreaterThan(100);
  await expectAccessible(page, 'Pase de abordar'); await expectLegible(page, 'Pase de abordar');
  await expect(page.getByRole('button', { name: /Imprimir pases/ })).toBeVisible();
});

test('E2E-13 error: asiento tomado por otro viajero ⇒ explica, actualiza el mapa y deja elegir otro', async ({ page, request }) => {
  const other = await signUp(request, 'e2e-otro'); const user = await signUp(request);
  await loginAs(page, user); await chooseOffer(page);
  const seat = await freeSeats(page).first().getAttribute('data-seat') ?? '';
  await freeSeats(page).first().click();
  await holdSeatByApi(request, other, flight, seat); // otro viajero aparta ese asiento después de que se cargó el mapa
  await page.getByRole('button', { name: 'Continuar a datos de pasajeros' }).click();
  const alert = page.getByRole('alert'); await expect(alert).toContainText('Ese asiento acaba de ser ocupado. Elige otro.');
  await expectAccessible(page, 'Asiento tomado');
  await alert.getByRole('button', { name: 'Actualizar el mapa' }).click();
  await expect(page.locator(`button[data-seat="${seat}"]`)).toHaveAttribute('data-status', /HELD|BOOKED/);
  await freeSeats(page).first().click();
  await page.getByRole('button', { name: 'Continuar a datos de pasajeros' }).click();
  await expect(page.getByRole('heading', { name: 'Datos de los pasajeros' })).toBeVisible();
});

test('E2E-14 error: pago rechazado (la selección sigue vigente y se puede pagar de nuevo) y pago pendiente', async ({ page, request }) => {
  const user = await signUp(request); await loginAs(page, user); await reachPayment(page, user);
  await page.getByLabel('Resultado del procesamiento').selectOption('denied');
  await page.getByRole('button', { name: /^Pagar USD/ }).click();
  const alert = page.getByRole('alert'); await expect(alert).toContainText('El pago fue rechazado.'); await expect(alert).toContainText('Tu selección sigue reservada');
  await expect(page.getByRole('timer', { name: 'Tiempo restante de tu selección' })).toBeVisible();
  await expectAccessible(page, 'Pago rechazado');
  await alert.getByRole('button', { name: 'Intentar el pago de nuevo' }).click();
  await page.getByLabel('Resultado del procesamiento').selectOption('pending');
  await page.getByRole('button', { name: /^Pagar USD/ }).click();
  await expect(page.getByRole('heading', { name: /Estamos (confirmando tu pago|emitiendo tus boletos)|Tu reserva está en proceso|¡Tu reserva está confirmada!/ })).toBeVisible();
  await expect(page.getByTestId('pnr')).toBeVisible();
  await expectAccessible(page, 'Confirmación con pago pendiente');
});

test('E2E-15 error: el tope de reservas activas de la cuenta del canal WEB se explica con una salida útil', async ({ page, request }) => {
  test.setTimeout(240_000);
  const user = await signUp(request, 'e2e-tope');
  for (let i = 0; i < 5; i += 1) await bookByApi(request, user, flight); // el tope por omisión es de 5 reservas activas
  await loginAs(page, user); await reachPayment(page, user);
  await page.getByRole('button', { name: /^Pagar USD/ }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(/Alcanzaste el número máximo de (reservas activas|pasajeros)/);
  expect(await alert.innerText()).not.toMatch(/prueba/i);
  await expect(alert.getByRole('link', { name: 'Ver mis reservas' })).toBeVisible();
  await expectAccessible(page, 'Tope de la cuenta');
});

test('E2E-16 sesión vencida a mitad de la compra: vuelve a iniciar sesión sin perder lo escrito', async ({ page, request }) => {
  const user = await signUp(request); await loginAs(page, user); await reachPayment(page, user);
  await page.getByLabel('Titular del pago').fill('Titular Escrito');
  await page.evaluate(() => window.localStorage.removeItem('fp.session')); // el dispositivo pierde la sesión
  await page.getByRole('button', { name: /^Pagar USD/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu sesión expiró' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Iniciar sesión' }).click();
  const main = page.getByRole('main');
  await main.getByLabel('Correo electrónico').fill(user.email); await main.getByLabel('Contraseña').fill(user.password);
  await main.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/compra\/pago$/);
  await expect(page.getByLabel('Titular del pago')).toHaveValue('Titular Escrito');
  await page.getByRole('button', { name: /^Pagar USD/ }).click();
  await expect(page.getByRole('heading', { name: '¡Tu reserva está confirmada!' })).toBeVisible();
});

test('E2E-17 sin sesión, las pantallas de compra y reservas llevan al inicio de sesión y vuelven; móvil sin desplazamiento horizontal', async ({ page, request }: { page: Page; request: APIRequestContext }) => {
  for (const route of ['/reservas', '/compra/pago', '/reservas/00000000-0000-4000-8000-000000000000']) {
    await page.goto(route); await expect(page).toHaveURL(new RegExp(`/acceso\\?returnTo=${encodeURIComponent(route).replace(/%/g, '%')}`));
  }
  const user = await signUp(request); await loginAs(page, user);
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseOffer(page);
  await expect(page.getByRole('group', { name: 'Mapa de asientos' })).toBeVisible();
  await expectLegible(page, 'Oferta (móvil)'); await expectAccessible(page, 'Oferta (móvil)');
  await page.goto('/reservas'); await expect(page.getByRole('heading', { name: 'Aún no tienes reservas' })).toBeVisible();
  await expectLegible(page, 'Mis reservas (móvil)'); await expectAccessible(page, 'Mis reservas vacío');
});
