import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { FlightStatusQuery } from '@flight-platform/graphql-schema/generated/types';
import { AppError } from '../data/errors';
import { renderApp } from '../../test/utils';

const status = (patch: Partial<FlightStatusQuery['flightStatus']> = {}): FlightStatusQuery => ({ flightStatus: {
  flightNumber: 'FP103', date: '2026-12-10', marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'A320', status: 'DELAYED', delayMinutes: 25, updatedAt: '2026-12-10T12:00:00Z',
  departure: { iataCode: 'UIO', terminal: '1', gate: null, scheduledAt: '2026-12-10T13:35:00Z', estimatedAt: '2026-12-10T14:00:00Z', actualAt: null },
  arrival: { iataCode: 'GPS', terminal: null, gate: null, scheduledAt: '2026-12-10T16:30:00Z', estimatedAt: null, actualAt: null }, ...patch
} });

describe('estado de un vuelo', () => {
  it('EST-01 consulta por número y fecha local de salida; muestra el estado con texto e icono y las horas en la zona de cada aeropuerto', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/estado', { handlers: { FlightStatus: () => status() } });
    await user.type(screen.getByLabelText('Número de vuelo'), 'fp 103');
    fireEvent.change(screen.getByLabelText('Fecha de salida'), { target: { value: '2026-12-10' } });
    await user.click(screen.getByRole('button', { name: 'Consultar estado' }));
    expect(await screen.findByTestId('flight-status')).toHaveTextContent('Retrasado');
    expect(client.calls[0]).toMatchObject({ name: 'FlightStatus', variables: { flightNumber: 'FP103', date: '2026-12-10' } });
    expect(screen.getByText('Retraso estimado: 25 min.')).toBeInTheDocument();
    const departure = within(screen.getByRole('region', { name: 'Salida: Quito' }));
    expect(departure.getByText('Programada').nextElementSibling).toHaveTextContent('08:35 · 10 dic 2026');
    expect(departure.getByText('Estimada').nextElementSibling).toHaveTextContent('09:00');
    expect(departure.getByText('Horas en hora de Quito.')).toBeInTheDocument();
    expect(departure.getByText('Terminal').nextElementSibling).toHaveTextContent('1');
    const arrival = within(screen.getByRole('region', { name: 'Llegada: Baltra (Galápagos)' }));
    expect(arrival.getByText('Programada').nextElementSibling).toHaveTextContent('10:30');
    expect(arrival.queryByText('Estimada')).not.toBeInTheDocument();
  });

  it('EST-02 la puerta se muestra SOLO si el servicio la envía (H-6)', async () => {
    const without = renderApp('/estado?vuelo=FP103&fecha=2026-12-10', { handlers: { FlightStatus: () => status() } });
    await without.findByTestId('flight-status');
    expect(without.queryByText('Puerta')).not.toBeInTheDocument();
    without.unmount();
    const withGate = renderApp('/estado?vuelo=FP103&fecha=2026-12-10', { handlers: { FlightStatus: () => status({ status: 'BOARDING', delayMinutes: null, departure: { ...status().flightStatus.departure, gate: 'A12' } }) } });
    expect(await withGate.findByTestId('flight-status')).toHaveTextContent('Embarcando');
    expect(withGate.getByText('Puerta').nextElementSibling).toHaveTextContent('A12');
    expect(withGate.queryByText(/Retraso estimado/)).not.toBeInTheDocument();
  });

  it('EST-03 404 FLIGHT_STATUS_NOT_AVAILABLE: explica que la fecha es la de salida en hora del origen; no ofrece reintentar', async () => {
    renderApp('/estado?vuelo=FP999&fecha=2026-12-10', { handlers: { FlightStatus: () => { throw new AppError({ category: 'NOT_FOUND', code: 'FLIGHT_STATUS_NOT_AVAILABLE', correlationId: 'corr-404' }); } } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No encontramos ese vuelo en esa fecha. La fecha es la de salida, en hora del aeropuerto de origen.');
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('EST-04 validación del formulario: número con formato de vuelo y fecha; sin consulta hasta corregir', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/estado', { handlers: { FlightStatus: () => status() } });
    await user.type(screen.getByLabelText('Número de vuelo'), '<x>');
    fireEvent.change(screen.getByLabelText('Fecha de salida'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Consultar estado' }));
    expect(screen.getByText('Escribe el número de vuelo, por ejemplo FP103.')).toBeInTheDocument();
    expect(screen.getByText('Elige la fecha de salida.')).toBeInTheDocument();
    expect(client.calls).toHaveLength(0);
    const bad = renderApp('/estado?vuelo=%3Cscript%3E&fecha=hoy', { handlers: { FlightStatus: () => status() } });
    expect(bad.client.calls).toHaveLength(0);
  });

  it('EST-05 indisponible: ofrece reintentar y se recupera; cada estado operativo tiene su rótulo', async () => {
    const user = userEvent.setup(); let fail = true; let code: FlightStatusQuery['flightStatus']['status'] = 'CANCELLED';
    renderApp('/estado?vuelo=FP103&fecha=2026-12-10', { handlers: { FlightStatus: () => { if (fail) throw new AppError({ category: 'UNAVAILABLE', code: 'GATEWAY_UNAVAILABLE' }); return status({ status: code, delayMinutes: null }); } } });
    fail = false;
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('flight-status')).toHaveTextContent('Cancelado');
    const labels: Record<string, string> = { SCHEDULED: 'Programado', DEPARTED: 'En vuelo', ARRIVED: 'Aterrizó', DIVERTED: 'Desviado' };
    for (const [next, label] of Object.entries(labels)) {
      code = next as typeof code;
      await user.click(screen.getByRole('button', { name: 'Consultar estado' }));
      await screen.findByText(label);
    }
  });
});
