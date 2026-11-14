import { expect, test } from '@playwright/test';
import { expectAccessible, expectLegible, findFlight, graphql, platform, watch, type FoundFlight } from './support';

/**
 * Extremo a extremo de F12c-2a contra la plataforma local con la web (`npm run local:up -- -SkipDocker -Web`, datos de `npm run local:seed`):
 * buscar, ver resultados, consultar el estado de un vuelo, registrarse e iniciar sesión con un usuario de prueba local, y accesibilidad (axe).
 */
let flight: FoundFlight;
test.beforeAll(async ({ request }) => { flight = await findFlight(request); });

async function search(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Solo ida' }).check();
  await page.getByLabel('Desde', { exact: true }).selectOption(flight.origin);
  await page.getByLabel('Hacia').selectOption(flight.destination);
  await page.getByLabel('Ida', { exact: true }).fill(flight.date);
  await page.getByRole('button', { name: 'Buscar vuelos' }).click();
  await expect(page).toHaveURL(/\/resultados\?tipo=ida/);
}

test('E2E-01 buscar → resultados con varias ofertas, horas en la zona del aeropuerto, filtros y orden en el cliente → pantalla provisional', async ({ page }) => {
  const seen = watch(page);
  await search(page);
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBe(flight.offers);
  await expect(page.getByRole('article', { name: new RegExp(flight.flightNumber) }).first()).toBeVisible();
  // El navegador está en la zona de Tokio: la app debe rotular la hora local del aeropuerto.
  await expect(cards.first().getByText(/^hora de /).first()).toBeVisible();
  await expectAccessible(page, 'Resultados'); await expectLegible(page, 'Resultados');

  await page.getByLabel('Ordenar por').selectOption('departure');
  await page.getByRole('checkbox', { name: 'Solo vuelos directos' }).check();
  await expect(page.getByRole('status').filter({ hasText: /ofertas?/ })).toBeVisible();
  const searches = [...seen.hosts];
  await page.getByRole('checkbox', { name: 'Solo vuelos directos' }).uncheck();

  await cards.first().getByRole('button', { name: /^Elegir/ }).click();
  await expect(page.getByRole('heading', { name: 'Ya casi puedes comprar aquí' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  await expectAccessible(page, 'Oferta provisional');
  await page.getByRole('link', { name: 'Volver a los resultados' }).click();
  await expect(cards.first()).toBeVisible();

  // La web solo habla con su propio origen, el servicio GraphQL y el servicio de acceso; nunca con el Gateway (puerto 3000).
  const allowed = new Set([new URL(page.url()).host, new URL(platform().graphqlUrl).host, new URL(platform().authUrl).host]);
  expect([...new Set([...searches, ...seen.hosts])].filter((host) => !allowed.has(host))).toEqual([]);
  expect(seen.problems).toEqual([]);
});

test('E2E-02 ida y vuelta: la búsqueda lleva los dos tramos y los resultados (o el vacío) se muestran sin errores', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Desde', { exact: true }).selectOption(flight.origin);
  await page.getByLabel('Hacia').selectOption(flight.destination);
  await page.getByLabel('Ida', { exact: true }).fill(flight.date);
  await page.getByLabel('Vuelta', { exact: true }).fill(flight.date);
  await page.getByRole('button', { name: 'Buscar vuelos' }).click();
  await expect(page).toHaveURL(/tipo=idavuelta/);
  await expect(page.getByRole('article').first().or(page.getByRole('heading', { name: 'No hay vuelos para esa fecha' }))).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('E2E-03 estado de un vuelo por número y fecha local de salida; un vuelo inexistente explica la regla de la fecha', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/estado');
  await page.getByLabel('Número de vuelo').fill(flight.flightNumber.toLowerCase());
  await page.getByLabel('Fecha de salida').fill(flight.date);
  await page.getByRole('button', { name: 'Consultar estado' }).click();
  await expect(page.getByTestId('flight-status')).toHaveText(/Programado|Embarcando|En vuelo|Retrasado|Aterrizó|Cancelado|Desviado/);
  await expect(page.getByText(/^Horas en hora de /).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`vuelo=${flight.flightNumber}&fecha=${flight.date}`));
  await expectAccessible(page, 'Estado de un vuelo'); await expectLegible(page, 'Estado de un vuelo');
  expect(seen.problems).toEqual([]);

  await page.getByLabel('Número de vuelo').fill('ZZ9999');
  await page.getByRole('button', { name: 'Consultar estado' }).click();
  await expect(page.getByRole('alert')).toContainText('No encontramos ese vuelo en esa fecha. La fecha es la de salida, en hora del aeropuerto de origen.');
});

test('E2E-04 registrarse, cerrar sesión e iniciar sesión con un usuario de prueba local; el token sirve en GraphQL y el Gateway', async ({ page, request }) => {
  const seen = watch(page);
  const email = `e2e-${Date.now()}@example.test`; const password = 'clave-de-prueba-123';
  await page.goto('/registro');
  await expectAccessible(page, 'Registrarse');
  const main = page.getByRole('main');
  await main.getByLabel('Nombre (opcional)').fill('Persona de Prueba');
  await main.getByLabel('Correo electrónico').fill(email);
  await main.getByLabel('Contraseña').fill(password);
  await main.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByTestId('user-name')).toHaveText('Persona de Prueba');
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('fp.session'))).toBeNull();

  await page.goto('/acceso?returnTo=%2Festado');
  await expectAccessible(page, 'Iniciar sesión');
  await main.getByLabel('Correo electrónico').fill(email);
  await main.getByLabel('Contraseña').fill('otra-clave-000');
  await main.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(main.getByRole('alert')).toContainText('Correo o contraseña incorrectos.');
  await main.getByLabel('Contraseña').fill(password);
  await main.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/estado$/);
  await expect(page.getByTestId('user-name')).toHaveText('Persona de Prueba');

  // La sesión sobrevive a una recarga y su token lo aceptan el servicio GraphQL (viewer) y, a través de él, el Gateway (mis reservas).
  await page.reload();
  await expect(page.getByTestId('user-name')).toHaveText('Persona de Prueba');
  const token = await page.evaluate(() => (JSON.parse(window.localStorage.getItem('fp.session') ?? '{}') as { access_token?: string }).access_token ?? '');
  const viewer = await graphql<{ viewer: { role: string } }>(request, 'Viewer', {}, token);
  expect(viewer.data?.viewer.role).toBe('CUSTOMER');
  const bookings = await graphql<{ myBookings: { edges: unknown[] } }>(request, 'MyBookings', { first: 5 }, token);
  expect(bookings.errors).toBeUndefined();
  expect(bookings.data?.myBookings.edges).toEqual([]);
  // Solo se guarda la sesión y el identificador de dispositivo: nada más en el almacenamiento del navegador.
  expect(await page.evaluate(() => Object.keys(window.localStorage).sort())).toEqual(['fp.device', 'fp.session']);
  expect(seen.problems.filter((problem) => !/400 \(Bad Request\)/.test(problem))).toEqual([]); // el 400 es la contraseña incorrecta a propósito
});

test('E2E-05 recuperar contraseña con el enlace del buzón local → definir nueva contraseña → entrar con ella', async ({ page, request }) => {
  const email = `e2e-rec-${Date.now()}@example.test`;
  await page.goto('/registro');
  const main = page.getByRole('main');
  await main.getByLabel('Correo electrónico').fill(email);
  await main.getByLabel('Contraseña').fill('clave-original-123');
  await main.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByTestId('user-name')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await page.goto('/recuperar');
  await expectAccessible(page, 'Recuperar contraseña');
  await main.getByLabel('Correo electrónico').fill(email);
  await main.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(main.getByRole('status')).toContainText('Si existe una cuenta con ese correo');
  const mail = await (await request.get(`${platform().authUrl}/local/mailbox?email=${encodeURIComponent(email)}`)).json() as { link: string };
  await page.goto(mail.link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(main.getByRole('heading', { name: 'Nueva contraseña', exact: true })).toBeVisible();
  await expectAccessible(page, 'Nueva contraseña');
  await main.getByLabel('Nueva contraseña', { exact: true }).fill('clave-nueva-456');
  await main.getByLabel('Repite la contraseña').fill('clave-nueva-456');
  await main.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(main.getByRole('heading', { name: 'Contraseña actualizada' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/acceso');
  await main.getByLabel('Correo electrónico').fill(email);
  await main.getByLabel('Contraseña').fill('clave-nueva-456');
  await main.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByTestId('user-name')).toBeVisible();
  // Un enlace ya usado no sirve.
  await page.goto(mail.link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(main.getByRole('heading', { name: 'Enlace no válido' })).toBeVisible();
});

test('E2E-06 el sitio servido cumple la CSP y las cabeceras; las rutas profundas cargan la app; pantallas de sistema accesibles', async ({ page }) => {
  const seen = watch(page);
  const response = await page.goto('/estado');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toMatch(new RegExp(`connect-src ${new URL(platform().graphqlUrl).origin} ${new URL(platform().authUrl).origin};`));
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).not.toContain('unsafe');
  await expect(page.getByRole('heading', { name: 'Estado de un vuelo' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Entorno de pruebas');

  for (const [route, heading] of [['/no-existe', 'No encontramos esa página'], ['/sin-permiso', 'No tienes permiso para esta sección'], ['/sesion-expirada', 'Tu sesión expiró'], ['/no-disponible?espera=30', 'Estamos teniendo problemas']] as const) {
    expect((await page.goto(route))!.status()).toBe(200);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expectAccessible(page, heading); await expectLegible(page, heading);
  }
  // Una petición a un origen no permitido la bloquea la CSP (la app no puede hablar con el Gateway ni con terceros).
  const blocked = await page.evaluate(async () => { try { await fetch('http://127.0.0.1:3000/api/v2/vuelos/health'); return 'permitida'; } catch { return 'bloqueada'; } });
  expect(blocked).toBe('bloqueada');
  expect(seen.problems.filter((problem) => !/Content Security Policy|Refused to connect|Failed to fetch|ERR_BLOCKED_BY_CSP/.test(problem))).toEqual([]);
});

test('E2E-07 Inicio accesible y legible en escritorio y en móvil; teclado y menú móvil', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Buscar vuelos' })).toBeVisible();
  await expectAccessible(page, 'Inicio (escritorio)'); await expectLegible(page, 'Inicio (escritorio)');
  // Rutas destacadas: prellenan el buscador y llevan el foco a la fecha, sin buscar.
  await page.getByRole('button', { name: 'Buscar desde Quito a Cuenca' }).click();
  await expect(page.getByLabel('Hacia')).toHaveValue('CUE');
  await expect(page.getByLabel('Ida', { exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  // Teclado: el primer tabulador muestra «Saltar al contenido» con foco visible.
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expectAccessible(page, 'Inicio (móvil)'); await expectLegible(page, 'Inicio (móvil)');
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible();
  await expectAccessible(page, 'Menú móvil');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await search(page);
  await expect(page.getByRole('article').first()).toBeVisible();
  await expectAccessible(page, 'Resultados (móvil)'); await expectLegible(page, 'Resultados (móvil)');
  expect(seen.problems).toEqual([]);
});
