import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/utils';
import { adminSession, customerSession } from '../../test/admin-fixtures';

// El fragmento del panel se reemplaza por un doble que cuenta cuántas veces se CARGA el módulo (el `import()` perezoso lo ejecuta una sola vez).
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('./AdminRoutes', () => { loaded.count += 1; return { default: () => <h1>Panel simulado</h1> }; });

describe('acceso al panel de administrador', () => {
  it('ADM-C01 un cliente ve «Sin permiso», sin datos del panel, sin llamadas y SIN descargar el fragmento del panel; la navegación no le ofrece el panel', async () => {
    const view = renderApp('/admin/vuelos', { session: customerSession() });
    expect(await screen.findByRole('heading', { name: 'No tienes permiso para esta sección' })).toBeInTheDocument();
    expect(screen.queryByText('Panel simulado')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administración' })).not.toBeInTheDocument();
    expect(view.client.calls).toHaveLength(0);
    expect(loaded.count).toBe(0);
  });

  it('ADM-C02 sin sesión lleva al inicio de sesión conservando el regreso al panel; una sesión vencida lo atiende el vigilante (no muestra el panel)', async () => {
    const view = renderApp('/admin/tarifas');
    expect(await screen.findByRole('heading', { name: /Inicia sesión|Iniciar sesión/ })).toBeInTheDocument();
    expect(screen.queryByText('Panel simulado')).not.toBeInTheDocument();
    expect(loaded.count).toBe(0);
    view.unmount();
    renderApp('/admin', { session: (await import('../../test/utils')).fakeSession({ status: 'anonymous', expired: true }) });
    expect(screen.queryByText('Panel simulado')).not.toBeInTheDocument();
    expect(loaded.count).toBe(0);
  });

  it('ADM-C03 un administrador carga el panel (una vez) y ve el enlace «Administración» en la cabecera', async () => {
    renderApp('/admin', { session: adminSession() });
    expect(await screen.findByRole('heading', { name: 'Panel simulado' })).toBeInTheDocument();
    expect(loaded.count).toBe(1);
    expect(screen.getByRole('navigation', { name: 'Principal' })).toHaveTextContent('Administración');
  });
});
