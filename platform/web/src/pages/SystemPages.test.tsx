import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { brand } from '@flight-platform/brand';
import { SESSION_EXPIRED_EVENT } from '../app/App';
import { ErrorPanel } from '../components/ErrorPanel';
import { AppError, type ErrorCategory } from '../data/errors';
import { customer, fakeSession, renderApp } from '../../test/utils';

const main = () => within(screen.getByRole('main'));
const panel = (category: ErrorCategory, code: string, extra: { retryAfterSeconds?: number; onRetry?: () => void } = {}) =>
  render(<MemoryRouter initialEntries={['/resultados?tipo=ida']}><ErrorPanel error={new AppError({ category, code, correlationId: 'corr-1', retryAfterSeconds: extra.retryAfterSeconds })} onRetry={extra.onRetry} fixHref="/" /></MemoryRouter>);

describe('errores y pantallas de sistema', () => {
  it('SIS-01 la acción ofrecida depende de category/code: reintentar, iniciar sesión, buscar de nuevo, corregir, ir al inicio', () => {
    const onRetry = vi.fn();
    const retry = panel('UNAVAILABLE', 'PROVIDER_UNAVAILABLE', { onRetry });
    retry.getByRole('button', { name: 'Reintentar' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(retry.getByText('corr-1')).toBeInTheDocument();
    retry.unmount();
    const login = panel('UNAUTHENTICATED', 'UNAUTHENTICATED');
    expect(login.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/acceso?returnTo=%2Fresultados%3Ftipo%3Dida');
    login.unmount();
    const again = panel('CONFLICT', 'OFFER_NO_LONGER_AVAILABLE');
    expect(again.getByRole('alert')).toHaveTextContent('Esa oferta ya no está disponible. Realiza una nueva búsqueda.');
    expect(again.getByRole('link', { name: 'Buscar de nuevo' })).toHaveAttribute('href', '/');
    again.unmount();
    const fix = panel('VALIDATION', 'VALIDATION_FAILED');
    expect(fix.getByRole('link', { name: 'Modificar búsqueda' })).toBeInTheDocument();
    fix.unmount();
    const forbidden = panel('FORBIDDEN', 'FORBIDDEN');
    expect(forbidden.getByRole('link', { name: 'Ir al inicio' })).toBeInTheDocument();
    expect(forbidden.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('SIS-02 429/503 con Retry-After: cuenta regresiva y «Reintentar» se habilita al terminar', async () => {
    vi.useFakeTimers();
    try {
      const onRetry = vi.fn();
      const view = panel('UNAVAILABLE', 'PROVIDER_UNAVAILABLE', { retryAfterSeconds: 3, onRetry });
      expect(view.getByText('Podrás reintentar en 3 s.')).toBeInTheDocument();
      expect(view.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(view.getByText('Podrás reintentar en 2 s.')).toBeInTheDocument();
      for (let i = 0; i < 2; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(view.queryByText(/Podrás reintentar/)).not.toBeInTheDocument();
      view.getByRole('button', { name: 'Reintentar' }).click();
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('SIS-03 404: una ruta inexistente muestra un mensaje único con salidas', () => {
    renderApp('/reservas/de-otra-persona');
    expect(main().getByRole('heading', { name: 'No encontramos esa página' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Buscar vuelos' })).toHaveAttribute('href', '/');
    expect(document.title).toBe(`No encontrado · ${brand.name}`);
  });

  it('SIS-04 403: sin permiso, con enlace al inicio', () => {
    renderApp('/sin-permiso');
    expect(main().getByRole('heading', { name: 'No tienes permiso para esta sección' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Ir al inicio' })).toHaveAttribute('href', '/');
  });

  it('SIS-05 servicio no disponible: Retry-After con cuenta regresiva, reintento a una ruta interna y el identificador para soporte', async () => {
    vi.useFakeTimers();
    try {
      renderApp('/no-disponible?espera=2&returnTo=%2Festado&id=corr-503');
      expect(main().getByRole('heading', { name: 'Estamos teniendo problemas' })).toBeInTheDocument();
      expect(main().getByText('Podrás reintentar en 2 s.')).toBeInTheDocument();
      expect(main().getByRole('button', { name: 'Reintentar' })).toBeDisabled();
      expect(main().getByText('corr-503')).toBeInTheDocument();
      for (let i = 0; i < 2; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => { main().getByRole('button', { name: 'Reintentar' }).click(); });
      expect(main().getByRole('heading', { name: 'Estado de un vuelo' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
    // Un identificador o un destino manipulados no se muestran ni se siguen.
    const bad = renderApp('/no-disponible?id=%3Cimg%20src%3Dx%3E&returnTo=https%3A%2F%2Fmalo.example');
    expect(bad.container.querySelector('main details')).toBeNull();
    expect(bad.container.querySelector('main img')).toBeNull();
  });

  it('SIS-06 sesión expirada: pantalla propia; también cuando el servicio rechaza el token (evento del arranque)', async () => {
    const direct = renderApp('/sesion-expirada?returnTo=%2Festado');
    expect(main().getByRole('heading', { name: 'Tu sesión expiró' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/acceso?returnTo=%2Festado');
    direct.unmount();
    renderApp('/estado', { session: fakeSession({ status: 'authenticated', user: customer, expiresAt: null }) });
    await act(async () => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); });
    expect(main().getByRole('heading', { name: 'Tu sesión expiró' })).toBeInTheDocument();
  });

  it('SIS-07 banda de entorno: visible en pruebas y local, ausente en producción', () => {
    const tests = renderApp('/');
    expect(screen.getByRole('note')).toHaveTextContent(brand.texts.testEnvironmentNotice);
    tests.unmount();
    renderApp('/', { config: { envName: 'produccion' } });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('SIS-08 arranque: una consulta ligera despierta la cadena en segundo plano; si falla, Inicio sigue usable', async () => {
    const failing = renderApp('/', { handlers: { PlatformHealth: () => { throw new AppError({ category: 'UNAVAILABLE', code: 'GATEWAY_UNAVAILABLE' }); } } });
    expect(await screen.findByRole('form', { name: 'Buscar vuelos' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(failing.client.calls).toHaveLength(0); // el precalentamiento no cuenta como consulta de pantalla
  });

  it('SIS-09 menú móvil: diálogo con foco dentro, se cierra con Escape y devuelve el foco al botón', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const open = screen.getByRole('button', { name: 'Abrir menú' });
    await user.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Menú' });
    expect(within(dialog).getByRole('button', { name: 'Cerrar menú' })).toHaveFocus();
    expect(within(dialog).getByRole('link', { name: 'Estado de vuelo' })).toHaveAttribute('href', '/estado');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('SIS-10 Inicio: rutas destacadas por origen, sin precios; elegir una prellena el buscador sin lanzar la búsqueda', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/');
    const routes = screen.getByRole('region', { name: 'Destinos destacados' });
    expect(within(routes).getAllByRole('article')).toHaveLength(brand.featuredRoutes.UIO.length);
    expect(within(routes).queryByText(/USD/)).not.toBeInTheDocument();
    await user.selectOptions(within(routes).getByLabelText('Destinos destacados desde'), 'GYE');
    await user.click(within(routes).getByRole('button', { name: 'Buscar desde Guayaquil a Bogotá' }));
    const form = within(screen.getByRole('form', { name: 'Buscar vuelos' }));
    expect(form.getByLabelText('Desde')).toHaveValue('GYE');
    expect(form.getByLabelText('Hacia')).toHaveValue('BOG');
    expect(form.getByLabelText('Ida')).toHaveFocus();
    expect(client.calls).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '¿A dónde quieres ir?' })).toBeInTheDocument();
  });
});
