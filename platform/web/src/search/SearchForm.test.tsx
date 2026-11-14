import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AIRPORTS } from '@flight-platform/format';
import { SearchForm, type SearchFormHandle } from './SearchForm';
import type { SearchCriteria } from './search-model';

const NOW = new Date('2026-12-01T15:00:00Z');
function setup(initial?: SearchCriteria) {
  const onSearch = vi.fn<(criteria: SearchCriteria) => void>(); const ref = createRef<SearchFormHandle>();
  render(<SearchForm ref={ref} onSearch={onSearch} now={NOW} initial={initial} />);
  return { onSearch, ref, user: userEvent.setup() };
}
const date = (label: string | RegExp, value: string): void => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); };

describe('buscador', () => {
  it('FRM-01 por omisión es ida y vuelta, con los aeropuertos de la tabla única y la fecha mínima del aeropuerto de origen', () => {
    setup();
    expect(screen.getByRole('radio', { name: 'Ida y vuelta' })).toBeChecked();
    const origin = screen.getByLabelText('Desde');
    expect(within(origin).getAllByRole('option')).toHaveLength(AIRPORTS.length + 1);
    expect(within(origin).getByRole('option', { name: 'Quito (UIO)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ida')).toHaveAttribute('min', '2026-12-01');
    expect(screen.getByLabelText('Vuelta')).toBeInTheDocument();
  });

  it('FRM-02 ida y vuelta: envía dos tramos, el regreso inverso al de ida', async () => {
    const { onSearch, user } = setup();
    await user.selectOptions(screen.getByLabelText('Desde'), 'GYE');
    await user.selectOptions(screen.getByLabelText('Hacia'), 'CUE');
    date('Ida', '2026-12-10'); date('Vuelta', '2026-12-17');
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch.mock.calls[0][0]).toMatchObject({ trip: 'idavuelta', legs: [{ origin: 'GYE', destination: 'CUE', date: '2026-12-10' }, { origin: 'CUE', destination: 'GYE', date: '2026-12-17' }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 }, cabin: null });
  });

  it('FRM-03 solo ida: un tramo; el botón de intercambio invierte origen y destino', async () => {
    const { onSearch, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Solo ida' }));
    expect(screen.queryByLabelText('Vuelta')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Intercambiar origen y destino' }));
    expect(screen.getByLabelText('Desde')).toHaveValue('GPS');
    expect(screen.getByLabelText('Hacia')).toHaveValue('UIO');
    date('Ida', '2026-12-10');
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(onSearch.mock.calls[0][0]).toMatchObject({ trip: 'ida', legs: [{ origin: 'GPS', destination: 'UIO', date: '2026-12-10' }] });
  });

  it('FRM-04 multidestino: agregar y quitar tramos hasta 6', async () => {
    const { onSearch, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Multidestino' }));
    expect(screen.getAllByRole('group', { name: /^Tramo \d$/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Agregar tramo' }));
    const legs = screen.getAllByRole('group', { name: /^Tramo \d$/ });
    expect(legs).toHaveLength(3);
    await user.selectOptions(within(legs[1]).getByLabelText('Hacia'), 'GYE');
    fireEvent.change(within(legs[0]).getByLabelText('Fecha'), { target: { value: '2026-12-10' } });
    fireEvent.change(within(legs[1]).getByLabelText('Fecha'), { target: { value: '2026-12-12' } });
    await user.click(screen.getByRole('button', { name: 'Quitar el tramo 3' }));
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(onSearch.mock.calls[0][0]).toMatchObject({ trip: 'multi', legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }, { origin: 'GPS', destination: 'GYE', date: '2026-12-12' }] });
    for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: 'Agregar tramo' }));
    expect(screen.getAllByRole('group', { name: /^Tramo \d$/ })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'Agregar tramo' })).not.toBeInTheDocument();
  });

  it('FRM-05 errores por campo, asociados al control y con el foco en el primero; no se busca', async () => {
    const { onSearch, user } = setup();
    await user.selectOptions(screen.getByLabelText('Hacia'), 'UIO');
    date('Ida', '2026-11-20'); date('Vuelta', '2026-11-19');
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(onSearch).not.toHaveBeenCalled();
    const destination = screen.getByLabelText('Hacia');
    expect(destination).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(destination.getAttribute('aria-describedby')!)).toHaveTextContent('El destino debe ser distinto del origen.');
    expect(screen.getAllByText('La fecha ya pasó en el aeropuerto de origen.')).toHaveLength(2); // ida y vuelta
    expect(destination).toHaveFocus();
  });

  it('FRM-06 pasajeros: infantes > adultos y más de 9 se rechazan con mensaje; la cabina viaja como filtro', async () => {
    const { onSearch, user } = setup();
    date('Ida', '2026-12-10'); date('Vuelta', '2026-12-17');
    fireEvent.change(screen.getByLabelText('Infantes'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Cada infante debe viajar con un adulto.');
    fireEvent.change(screen.getByLabelText('Adultos'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Niños'), { target: { value: '1' } });
    await user.selectOptions(screen.getByLabelText('Cabina'), 'BUSINESS');
    await user.click(screen.getByRole('button', { name: 'Buscar vuelos' }));
    expect(onSearch.mock.calls[0][0]).toMatchObject({ passengers: { adults: 2, youths: 0, children: 1, infants: 2 }, cabin: 'BUSINESS' });
  });

  it('FRM-07 una ruta destacada prellena origen y destino, lleva el foco a la fecha y NO lanza la búsqueda', async () => {
    const { onSearch, ref } = setup();
    ref.current!.prefill('GYE', 'BOG');
    expect(await screen.findByDisplayValue('Guayaquil (GYE)')).toBe(screen.getByLabelText('Desde'));
    expect(screen.getByLabelText('Hacia')).toHaveValue('BOG');
    expect(screen.getByLabelText('Ida')).toHaveFocus();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('FRM-08 todo el formulario se recorre con teclado', async () => {
    const { user } = setup();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Ida y vuelta' })).toHaveFocus();
    await user.tab(); expect(screen.getByLabelText('Desde')).toHaveFocus();
    await user.tab(); expect(screen.getByRole('button', { name: 'Intercambiar origen y destino' })).toHaveFocus();
    await user.tab(); expect(screen.getByLabelText('Hacia')).toHaveFocus();
  });
});
