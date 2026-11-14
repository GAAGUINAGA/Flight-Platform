import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { customer, fakeSession, renderApp, searchResult } from '../../test/utils';

const main = () => within(screen.getByRole('main'));
const fill = async (user: ReturnType<typeof userEvent.setup>, label: string, value: string): Promise<void> => { await user.type(main().getByLabelText(label), value); };

describe('sesión · iniciar sesión, registrarse, recuperar, nueva contraseña y retorno del enlace', () => {
  it('SESW-01 iniciar sesión con Supabase y volver a la ruta de origen (returnTo interno)', async () => {
    const user = userEvent.setup();
    const { session, client } = renderApp('/acceso?returnTo=%2Festado%3Fvuelo%3DFP103%26fecha%3D2026-12-10', { handlers: { FlightStatus: () => new Promise(() => undefined) } });
    await fill(user, 'Correo electrónico', ' ana@example.test '); await fill(user, 'Contraseña', 'secreto-123');
    await user.click(main().getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Estado de un vuelo' })).toBeInTheDocument();
    expect(session.calls).toEqual([{ method: 'signIn', args: ['ana@example.test', 'secreto-123'] }]);
    expect(screen.getByTestId('user-name')).toHaveTextContent('Ana Pérez');
    // Las credenciales nunca pasan por la capa de datos (GraphQL).
    expect(JSON.stringify(client.calls)).not.toContain('secreto-123');
  });

  it('SESW-02 returnTo externo o manipulado se ignora: vuelve al inicio', async () => {
    const user = userEvent.setup();
    for (const target of ['https%3A%2F%2Fmalo.example%2Frobo', '%2F%2Fmalo.example', '%2F%5Cmalo.example']) {
      const view = renderApp(`/acceso?returnTo=${target}`);
      await fill(user, 'Correo electrónico', 'ana@example.test'); await fill(user, 'Contraseña', 'secreto-123');
      await user.click(main().getByRole('button', { name: 'Iniciar sesión' }));
      expect(await screen.findByRole('heading', { name: '¿A dónde quieres ir?' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('SESW-03 credenciales inválidas: mensaje genérico, la contraseña se borra y no se navega; validación de campos vacíos', async () => {
    const user = userEvent.setup(); const session = fakeSession(); session.results.signIn = { ok: false, reason: 'invalid_credentials' };
    renderApp('/acceso', { session });
    await user.click(main().getByRole('button', { name: 'Iniciar sesión' }));
    expect(main().getByText('Escribe un correo válido.')).toBeInTheDocument();
    expect(main().getByText('Escribe tu contraseña.')).toBeInTheDocument();
    expect(session.calls).toHaveLength(0);
    await fill(user, 'Correo electrónico', 'ana@example.test'); await fill(user, 'Contraseña', 'mala');
    await user.click(main().getByRole('button', { name: 'Iniciar sesión' }));
    expect(await main().findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(main().getByLabelText('Contraseña')).toHaveValue('');
    expect(main().getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('SESW-04 doble clic en «Iniciar sesión» no repite la petición', async () => {
    const user = userEvent.setup(); const session = fakeSession();
    let release: (() => void) | undefined; const original = session.signIn.bind(session);
    session.signIn = (email, password) => new Promise((resolve) => { release = () => { void original(email, password).then(resolve); }; session.calls.push({ method: 'intento', args: [] }); });
    renderApp('/acceso', { session });
    await fill(user, 'Correo electrónico', 'ana@example.test'); await fill(user, 'Contraseña', 'secreto-123');
    const button = main().getByRole('button', { name: 'Iniciar sesión' });
    await user.dblClick(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(session.calls.filter((call) => call.method === 'intento')).toHaveLength(1);
    release?.();
    await screen.findByTestId('user-name');
  });

  it('SESW-05 registrarse: contraseña mínima, envío con el retorno del enlace y aviso que no revela si el correo existía', async () => {
    const user = userEvent.setup();
    const { session } = renderApp('/registro');
    await fill(user, 'Correo electrónico', 'nueva@example.test'); await fill(user, 'Contraseña', 'corta');
    await user.click(main().getByRole('button', { name: 'Crear cuenta' }));
    expect(main().getByText('Usa al menos 8 caracteres.')).toBeInTheDocument();
    expect(session.calls).toHaveLength(0);
    await fill(user, 'Nombre (opcional)', 'Nueva Persona'); await fill(user, 'Contraseña', '-larga-123');
    await user.click(main().getByRole('button', { name: 'Crear cuenta' }));
    expect(await main().findByRole('heading', { name: 'Confirma tu correo' })).toBeInTheDocument();
    expect(main().getByRole('status')).toHaveTextContent('Si el correo no tenía una cuenta, te enviamos un enlace para confirmarla.');
    expect(session.calls[0]).toEqual({ method: 'signUp', args: [{ email: 'nueva@example.test', password: 'corta-larga-123', name: 'Nueva Persona', redirectTo: `${window.location.origin}/acceso/retorno` }] });
  });

  it('SESW-06 registro con sesión inmediata (sin confirmación) entra directo; un fallo muestra el mensaje genérico', async () => {
    const user = userEvent.setup(); const session = fakeSession(); session.results.signUp = { ok: true, needsEmailConfirmation: false };
    const view = renderApp('/registro', { session });
    await fill(user, 'Correo electrónico', 'local@example.test'); await fill(user, 'Contraseña', 'secreto-123');
    await user.click(main().getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByTestId('user-name')).toBeInTheDocument();
    view.unmount();
    const failing = fakeSession(); failing.results.signUp = { ok: false, reason: 'signup_failed' };
    renderApp('/registro', { session: failing });
    await fill(user, 'Correo electrónico', 'existe@example.test'); await fill(user, 'Contraseña', 'secreto-123');
    await user.click(main().getByRole('button', { name: 'Crear cuenta' }));
    expect(await main().findByRole('alert')).toHaveTextContent('No pudimos crear la cuenta. Si ya tienes una, inicia sesión o recupera tu contraseña.');
  });

  it('SESW-07 recuperar contraseña: siempre el mismo aviso, exista o no la cuenta', async () => {
    const user = userEvent.setup();
    const { session } = renderApp('/recuperar');
    await fill(user, 'Correo electrónico', 'quien-sea@example.test');
    await user.click(main().getByRole('button', { name: 'Enviar enlace' }));
    expect(await main().findByRole('status')).toHaveTextContent('Si existe una cuenta con ese correo, enviamos un enlace para definir una nueva contraseña.');
    expect(session.calls[0]).toEqual({ method: 'requestPasswordReset', args: ['quien-sea@example.test', `${window.location.origin}/acceso/retorno`] });
  });

  it('SESW-08 retorno del enlace de recuperación → definir nueva contraseña (coincidencia y mínimo) → actualizada', async () => {
    const user = userEvent.setup(); const session = fakeSession(); session.results.exchangeCode = { ok: true, recovery: true };
    renderApp('/acceso/retorno?code=codigo-123', { session });
    expect(await main().findByRole('heading', { name: 'Nueva contraseña' })).toBeInTheDocument();
    expect(session.calls[0]).toEqual({ method: 'exchangeCode', args: ['codigo-123'] });
    await fill(user, 'Nueva contraseña', 'nueva-clave-456'); await fill(user, 'Repite la contraseña', 'otra-distinta');
    await user.click(main().getByRole('button', { name: 'Guardar contraseña' }));
    expect(main().getByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    await user.clear(main().getByLabelText('Repite la contraseña')); await fill(user, 'Repite la contraseña', 'nueva-clave-456');
    await user.click(main().getByRole('button', { name: 'Guardar contraseña' }));
    expect(await main().findByRole('heading', { name: 'Contraseña actualizada' })).toBeInTheDocument();
    expect(session.calls.at(-1)).toEqual({ method: 'updatePassword', args: ['nueva-clave-456'] });
  });

  it('SESW-09 retorno de confirmación de correo → sesión iniciada en Inicio; el código se canjea una sola vez', async () => {
    const { session } = renderApp('/acceso/retorno?code=confirmacion-1');
    expect(await screen.findByRole('heading', { name: '¿A dónde quieres ir?' })).toBeInTheDocument();
    expect(screen.getByTestId('user-name')).toBeInTheDocument();
    expect(session.calls.filter((call) => call.method === 'exchangeCode')).toHaveLength(1);
  });

  it('SESW-10 enlace vencido, con error o sin código: aviso y salidas; «nueva contraseña» sin sesión pide otro enlace', async () => {
    const expired = fakeSession(); expired.results.exchangeCode = { ok: false, reason: 'link_expired' };
    const first = renderApp('/acceso/retorno?code=viejo', { session: expired });
    expect(await main().findByText(/El enlace venció o ya se usó\. Solicita uno nuevo\./)).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Recuperar contraseña' })).toHaveAttribute('href', '/recuperar');
    first.unmount();
    const second = renderApp('/acceso/retorno?error=access_denied&error_code=otp_expired');
    expect(await main().findByRole('heading', { name: 'Enlace no válido' })).toBeInTheDocument();
    expect(second.session.calls).toHaveLength(0);
    second.unmount();
    renderApp('/nueva-contrasena');
    expect(main().getByRole('link', { name: 'Solicitar un enlace nuevo' })).toHaveAttribute('href', '/recuperar');
  });

  it('SESW-11 con sesión: la cabecera muestra al usuario y «Cerrar sesión» vuelve a anónimo; las pantallas de acceso redirigen', async () => {
    const user = userEvent.setup(); const session = fakeSession({ status: 'authenticated', user: customer, expiresAt: null });
    renderApp('/acceso', { session });
    expect(await screen.findByRole('heading', { name: '¿A dónde quieres ir?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Iniciar sesión' })).toBeInTheDocument());
    expect(session.calls.at(-1)?.method).toBe('signOut');
  });

  it('SESW-12 sesión expirada (refresco fallido): pantalla propia que conserva a dónde volver', async () => {
    const session = fakeSession({ status: 'authenticated', user: customer, expiresAt: null });
    renderApp('/resultados?tipo=ida&tramos=UIO-GPS-2030-12-10&adultos=1', { session, handlers: { SearchFlights: () => searchResult() } });
    await screen.findAllByRole('article');
    session.set({ status: 'anonymous', expired: true });
    expect(await screen.findByRole('heading', { name: 'Tu sesión expiró' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', `/acceso?returnTo=${encodeURIComponent('/resultados?tipo=ida&tramos=UIO-GPS-2030-12-10&adultos=1')}`);
  });
});
