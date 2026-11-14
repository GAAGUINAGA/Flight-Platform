import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cityOf, formatDate, formatLocalDate, formatLocalTimeWithZone, isIsoDate, localDate, todayAt } from '@flight-platform/format';
import { AdminFlightsOperation, FlightOperationsOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { AdminFlightsQuery, FlightStatusCode } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { usePagedList } from './hooks';
import { DataTable, FlightStatusBadge, updatedText } from './parts';
import { StatusChangePanel, type StatusResult, type StatusTarget } from './StatusChangePanel';
import { STATUS_LABEL } from './status-rules';
import a from './admin.module.css';

type AdminFlight = AdminFlightsQuery['adminFlights']['items'][number];
const PAGE = 50;

/** Vuelos de una fecha (API interna, con «cargar más») y cambio de estado por el PATCH de v2, con confirmación (diseño §3.13). */
export function FlightsPage() {
  usePageTitle('Vuelos');
  const { client } = useServices();
  const [date, setDate] = useState(() => todayAt('UIO')); const validDate = isIsoDate(date);
  const [selected, setSelected] = useState<StatusTarget | null>(null);
  const [done, setDone] = useState<{ result: StatusResult; target: StatusTarget } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, FlightStatusCode>>({});

  const flights = usePagedList<AdminFlight>(async (after, correlationId, signal) => {
    const data = await client.execute(AdminFlightsOperation, { date, first: PAGE, after }, { correlationId, signal });
    return { items: data.adminFlights.items, endCursor: data.adminFlights.pageInfo.endCursor ?? null, hasNextPage: data.adminFlights.pageInfo.hasNextPage };
  }, date, { enabled: validDate });
  // El estado operativo no viene en la API interna: se completa con el panel de operaciones v2 de la misma fecha.
  const statuses = usePagedList<{ flightNumber: string; date: string; status: FlightStatusCode }>(async (after, correlationId, signal) => {
    const data = await client.execute(FlightOperationsOperation, { date, first: PAGE, after }, { correlationId, signal });
    return { items: data.flightOperations.items.map((item) => ({ flightNumber: item.flightNumber, date: item.date, status: item.status })), endCursor: data.flightOperations.pageInfo.endCursor ?? null, hasNextPage: data.flightOperations.pageInfo.hasNextPage };
  }, date, { all: true, enabled: validDate });
  const known = new Map(statuses.items.map((item) => [item.flightNumber, item]));
  const statusOf = (flight: AdminFlight): FlightStatusCode | null => overrides[`${flight.flightNumber}|${flight.departureAt}`] ?? known.get(flight.flightNumber)?.status ?? null;

  const open = (flight: AdminFlight): void => {
    setDone(null);
    setSelected({ flightNumber: flight.flightNumber, origin: flight.departureIata, destination: flight.arrivalIata, departureAt: flight.departureAt, arrivalAt: flight.arrivalAt, date: known.get(flight.flightNumber)?.date ?? localDate(flight.departureAt, flight.departureIata), current: statusOf(flight) });
  };
  const finished = (result: StatusResult, target: StatusTarget): void => {
    setOverrides((previous) => ({ ...previous, [`${target.flightNumber}|${target.departureAt}`]: result.flight.status }));
    setDone({ result, target }); setSelected(null); statuses.reload();
  };

  return (
    <>
      <div className={a.between}>
        <div><span className={ui.eyebrow}>Operaciones</span><h1>Vuelos</h1></div>
        <span className={a.muted}>{updatedText(flights.updatedAt)}</span>
      </div>
      <form className={`${ui.card} ${a.toolbar}`} aria-label="Elegir la fecha" onSubmit={(event) => event.preventDefault()} noValidate>
        <TextField label="Fecha de salida" type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelected(null); setDone(null); setOverrides({}); }} error={validDate ? undefined : 'Elige una fecha válida.'} hint="Fecha local del aeropuerto de origen" />
        <Button variant="secondary" onClick={() => { flights.reload(); statuses.reload(); }} loading={flights.refreshing}>Actualizar</Button>
      </form>

      {done ? (
        <Notice kind="success" title={`El vuelo ${done.target.flightNumber} cambió de «${done.result.previousStatus ? STATUS_LABEL[done.result.previousStatus] : 'sin estado'}» a «${STATUS_LABEL[done.result.flight.status]}».`}>
          <p data-testid="status-result">Reservas afectadas: {done.result.affectedBookings}.{done.result.eventId ? <> Evento notificado: <code className={a.wrapCode}>{done.result.eventId}</code>.</> : null}</p>
          <p><Link to={`/estado?vuelo=${encodeURIComponent(done.target.flightNumber)}&fecha=${encodeURIComponent(done.target.date)}`}>Ver el estado público del vuelo</Link></p>
        </Notice>
      ) : null}
      {selected ? <StatusChangePanel key={`${selected.flightNumber}|${selected.date}`} target={selected} onDone={finished} onCancel={() => setSelected(null)} /> : null}

      {flights.phase === 'loading' && validDate ? <LoadingState phase="normal" label="Cargando los vuelos" skeletons={2} /> : null}
      {flights.error ? <ErrorPanel error={flights.error} onRetry={flights.reload} /> : null}
      {flights.phase === 'ready' && validDate ? (
        flights.items.length === 0 ? (
          <div className={`${ui.card} ${a.empty}`}><h2>No hay vuelos el {formatDate(date)}</h2><p className={a.muted}>Prueba con otra fecha.</p></div>
        ) : (
          <>
            <DataTable caption={`Vuelos del ${formatDate(date, { weekday: true })}`}>
              <thead><tr><th scope="col">Vuelo</th><th scope="col">Ruta</th><th scope="col">Salida</th><th scope="col">Estado</th><th scope="col">Venta</th><th scope="col" className={a.num}>Asientos</th><th scope="col"><span className={ui.srOnly}>Acciones</span></th></tr></thead>
              <tbody>
                {flights.items.map((flight) => (
                  <tr key={flight.flightInstanceId}>
                    <th scope="row">{flight.flightNumber}</th>
                    <td>{cityOf(flight.departureIata)} → {cityOf(flight.arrivalIata)}</td>
                    <td>{formatLocalDate(flight.departureAt, flight.departureIata)} · {formatLocalTimeWithZone(flight.departureAt, flight.departureIata)}</td>
                    <td><FlightStatusBadge status={statusOf(flight)} /></td>
                    <td>{flight.closed ? 'Cerrada' : 'Abierta'}</td>
                    <td className={a.num}>{flight.cabins.reduce((sum, cabin) => sum + cabin.capacity, 0)}</td>
                    <td><Button size="small" variant="secondary" onClick={() => open(flight)} aria-label={`Cambiar estado del vuelo ${flight.flightNumber}`}>Cambiar estado</Button></td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {statuses.error ? <Notice kind="warning" title="No pudimos traer el estado actual de los vuelos."><p>Puedes cambiar el estado igualmente; el Gateway valida cada transición. <Button size="small" variant="secondary" onClick={statuses.reload}>Reintentar</Button></p></Notice> : null}
            {flights.hasNext ? <div className={a.row}><Button variant="secondary" onClick={flights.loadMore} loading={flights.loadingMore}>Cargar más vuelos</Button></div> : null}
          </>
        )
      ) : null}
    </>
  );
}
