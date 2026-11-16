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
import { CreateFlightPanel, type CreatedFlight } from './CreateFlightPanel';
import { OpenFlightPanel, type OpenTarget } from './OpenFlightPanel';
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
  const [creating, setCreating] = useState(false); const [created, setCreated] = useState<CreatedFlight | null>(null); const [opening, setOpening] = useState<OpenTarget | null>(null); const [opened, setOpened] = useState<string | null>(null);
  const createdDone = (flight: CreatedFlight): void => { setCreated(flight); setCreating(false); setDate(flight.departureLocal.slice(0, 10)); flights.reload(); statuses.reload(); };
  const openedDone = (target: OpenTarget): void => { setOpened(target.flightNumber); setOpening(null); flights.reload(); };
  const finished = (result: StatusResult, target: StatusTarget): void => {
    setOverrides((previous) => ({ ...previous, [`${target.flightNumber}|${target.departureAt}`]: result.flight.status }));
    setDone({ result, target }); setSelected(null); statuses.reload();
  };

  return (
    <>
      <div className={a.between}>
        <div><span className={ui.eyebrow}>Operaciones</span><h1>Vuelos</h1></div>
        <div className={a.row}><span className={a.muted}>{updatedText(flights.updatedAt)}</span><Button onClick={() => { setCreating(true); setCreated(null); setOpened(null); setSelected(null); setOpening(null); }} disabled={creating}>Crear vuelo</Button></div>
      </div>
      {created ? (
        <Notice kind="success" title={`Vuelo ${created.flightNumber} creado: ${created.closed ? 'quedó cerrado, pendiente de revisión' : 'abierto a la venta'}.`}>
          <p data-testid="create-result">{cityOf(created.origin)} → {cityOf(created.destination)} · salida {created.departureLocal.replace('T', ' ')} (hora de {cityOf(created.origin)}) · llegada {created.arrivalLocal.replace('T', ' ')} (hora de {cityOf(created.destination)}) · {created.fares.length} tarifa(s) guardadas y verificadas.</p>
          {created.closed ? <p>Revísalo en la lista y ábrelo con «Abrir a la venta».</p> : <p><Link to={`/estado?vuelo=${encodeURIComponent(created.flightNumber)}&fecha=${encodeURIComponent(created.departureLocal.slice(0, 10))}`}>Ver el estado público del vuelo</Link></p>}
        </Notice>
      ) : null}
      {opened ? <Notice kind="success" title={`El vuelo ${opened} se abrió a la venta.`}><p data-testid="open-result">Ya aparece en la web y en las búsquedas de Booking.</p></Notice> : null}
      {creating ? <CreateFlightPanel sources={flights.items.map((flight) => ({ flightInstanceId: flight.flightInstanceId, flightNumber: flight.flightNumber, aircraft: flight.aircraft }))} onDone={createdDone} onCancel={() => setCreating(false)} /> : null}
      {opening ? <OpenFlightPanel key={opening.flightInstanceId} target={opening} onDone={openedDone} onCancel={() => setOpening(null)} /> : null}
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
                    <td>
                      <div className={a.row}>
                        <Button size="small" variant="secondary" onClick={() => open(flight)} aria-label={`Cambiar estado del vuelo ${flight.flightNumber}`}>Cambiar estado</Button>
                        {flight.closed ? <Button size="small" onClick={() => { setOpened(null); setCreating(false); setOpening({ flightInstanceId: flight.flightInstanceId, flightNumber: flight.flightNumber, origin: flight.departureIata, destination: flight.arrivalIata, departureAt: flight.departureAt, cabins: flight.cabins.map((cabin) => ({ cabinClass: cabin.cabinClass, capacity: cabin.capacity })) }); }} aria-label={`Abrir a la venta el vuelo ${flight.flightNumber}`}>Abrir a la venta</Button> : null}
                      </div>
                    </td>
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
