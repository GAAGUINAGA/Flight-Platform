import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AIRPORTS, cityOf, formatLocalTimeWithZone, isIsoDate, todayAt } from '@flight-platform/format';
import { FlightOperationsOperation, PlatformHealthOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { FlightStatusCode } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { CABIN_LABEL } from './fare-rules';
import { useAutoRefresh, useLiveQuery, usePagedList } from './hooks';
import { alertLabel, cabinPercent, healthLabel, summarize, takenSeats, type OperationFlight } from './operations';
import { DataTable, FlightStatusBadge, HealthBadge, updatedText } from './parts';
import { FLIGHT_STATUSES, STATUS_LABEL } from './status-rules';
import a from './admin.module.css';

const PAGE = 50;

function CabinBars({ flight }: { flight: OperationFlight }) {
  return (
    <div className={a.bars}>
      {flight.cabins.map((cabin) => {
        const percent = cabinPercent(cabin);
        return (
          <div className={a.bar} key={cabin.cabinClass}>
            <span>{CABIN_LABEL[cabin.cabinClass]}</span>
            {/* La barra es decorativa (el texto lleva los números); `progress` evita estilos en línea, que la CSP del sitio no admite. */}
            <progress className={`${a.track} ${percent >= 90 ? a.trackHigh : ''}`} max={100} value={percent} aria-hidden="true" />
            <span>{takenSeats(cabin)}/{cabin.totalSeats} · {percent} %</span>
          </div>
        );
      })}
    </div>
  );
}

function Health() {
  const health = useLiveQuery(PlatformHealthOperation, {}, 'health');
  useAutoRefresh(health.reload);
  const data = health.data?.platformHealth;
  return (
    <section className={`${ui.card} ${a.health}`} aria-labelledby="health-title">
      <div className={a.between}>
        <h2 id="health-title">Salud de la plataforma</h2>
        <Button size="small" variant="secondary" onClick={health.reload} loading={health.refreshing}>Actualizar salud</Button>
      </div>
      {health.loading ? <LoadingState phase="normal" label="Consultando la salud" /> : null}
      {health.error && !data ? <ErrorPanel error={health.error} onRetry={health.reload} /> : null}
      {data ? (
        <>
          <div className={a.healthHead}>
            <span data-testid="health-status"><HealthBadge status={data.status} /></span>
            <span className={a.muted}>Versión {data.version} · nodo {data.nodeId}{data.latencyMs !== null ? ` · ${data.latencyMs} ms` : ''}</span>
          </div>
          <ul className={a.deps} aria-label="Servicios de la plataforma">
            {data.dependencies.map((dependency) => (
              <li className={a.dep} key={dependency.name}>
                <span>{dependency.name}{dependency.latencyMs !== null ? <span className={a.muted}> · {dependency.latencyMs} ms</span> : null}</span>
                <span className={`${a.badge} ${dependency.status === 'UP' ? a.ok : dependency.status === 'DEGRADED' ? a.warn : a.bad}`}>{healthLabel(dependency.status)}</span>
              </li>
            ))}
          </ul>
          {data.status === 'DOWN' ? <Notice kind="error" title="La plataforma reporta que está caída."><p>Se muestra el estado que informa el servicio; no es un error de esta pantalla.</p></Notice> : null}
        </>
      ) : null}
    </section>
  );
}

/** Dashboard operativo (diseño §3.13): ocupación por cabina de los vuelos de una fecha y salud de la plataforma. Se actualiza solo cada 30 s mientras la pestaña está visible. */
export function DashboardPage() {
  usePageTitle('Panel de operaciones');
  const { client } = useServices();
  const [date, setDate] = useState(() => todayAt('UIO')); const [origin, setOrigin] = useState(''); const [destination, setDestination] = useState(''); const [status, setStatus] = useState<FlightStatusCode | ''>('');
  const validDate = isIsoDate(date);
  const ops = usePagedList<OperationFlight>(async (after, correlationId, signal) => {
    const data = await client.execute(FlightOperationsOperation, { date, first: PAGE, after, ...(origin ? { origin } : {}), ...(destination ? { destination } : {}), ...(status ? { status } : {}) }, { correlationId, signal });
    return { items: data.flightOperations.items, endCursor: data.flightOperations.pageInfo.endCursor ?? null, hasNextPage: data.flightOperations.pageInfo.hasNextPage };
  }, `${date}|${origin}|${destination}|${status}`, { all: true, enabled: validDate });
  useAutoRefresh(ops.reload);
  const summary = summarize(ops.items);

  return (
    <>
      <div className={a.between}>
        <div>
          <span className={ui.eyebrow}>Operaciones</span>
          <h1>Panel de operaciones</h1>
        </div>
        <div className={a.row}>
          <span className={a.muted} aria-live="off">{updatedText(ops.updatedAt)}</span>
          <Button variant="secondary" onClick={ops.reload} loading={ops.refreshing}><RefreshCw size={16} aria-hidden="true" />Actualizar</Button>
        </div>
      </div>

      <form className={`${ui.card} ${a.filters}`} aria-label="Filtros del panel" onSubmit={(event) => event.preventDefault()} noValidate>
        <TextField label="Fecha de salida" type="date" value={date} onChange={(event) => setDate(event.target.value)} error={validDate ? undefined : 'Elige una fecha válida.'} hint="Fecha local del aeropuerto de origen" />
        <SelectField label="Origen" value={origin} onChange={(event) => setOrigin(event.target.value)}>
          <option value="">Todos</option>{AIRPORTS.map((airport) => <option key={airport.iata} value={airport.iata}>{cityOf(airport.iata)} ({airport.iata})</option>)}
        </SelectField>
        <SelectField label="Destino" value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="">Todos</option>{AIRPORTS.map((airport) => <option key={airport.iata} value={airport.iata}>{cityOf(airport.iata)} ({airport.iata})</option>)}
        </SelectField>
        <SelectField label="Estado" value={status} onChange={(event) => setStatus(event.target.value as FlightStatusCode | '')}>
          <option value="">Todos</option>{FLIGHT_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
        </SelectField>
      </form>

      <Health />

      {ops.phase === 'loading' && validDate ? <LoadingState phase="normal" label="Cargando la ocupación" skeletons={2} /> : null}
      {ops.phase === 'error' && ops.error ? <ErrorPanel error={ops.error} onRetry={ops.reload} /> : null}
      {ops.phase === 'ready' && ops.error ? <ErrorPanel error={ops.error} onRetry={ops.reload} /> : null}
      {ops.phase === 'ready' && validDate ? (
        ops.items.length === 0 ? (
          <div className={`${ui.card} ${a.empty}`}><h2>No hay vuelos para esos criterios</h2><p className={a.muted}>Prueba con otra fecha o quita algún filtro.</p></div>
        ) : (
          <>
            <dl className={a.cards}>
              <div className={`${ui.card} ${a.metric}`}><dt>Vuelos del día</dt><dd data-testid="metric-flights">{summary.flights}</dd></div>
              <div className={`${ui.card} ${a.metric}`}><dt>Ocupación media</dt><dd data-testid="metric-occupancy">{summary.averageOccupancy} %</dd></div>
              <div className={`${ui.card} ${a.metric}`}><dt>Reservas en espera (holds)</dt><dd data-testid="metric-holds">{summary.activeHolds}</dd></div>
              <div className={`${ui.card} ${a.metric}`}><dt>Alertas</dt><dd data-testid="metric-alerts">{summary.alerts}</dd></div>
            </dl>
            {ops.hasNext ? <Notice kind="warning" title="Hay más vuelos de los que se muestran."><p>El panel carga hasta 500 vuelos; afina los filtros para ver el resto.</p></Notice> : null}
            <DataTable caption={`Ocupación por cabina de los vuelos del ${date}`}>
              <thead><tr><th scope="col">Vuelo</th><th scope="col">Ruta</th><th scope="col">Salida</th><th scope="col">Estado</th><th scope="col">Ocupación por cabina</th><th scope="col">Alertas</th></tr></thead>
              <tbody>
                {ops.items.map((flight) => (
                  <tr key={`${flight.flightNumber}|${flight.departureAt}`}>
                    <th scope="row">{flight.flightNumber}</th>
                    <td>{flight.origin} → {flight.destination}</td>
                    <td>{formatLocalTimeWithZone(flight.departureAt, flight.origin)}</td>
                    <td><FlightStatusBadge status={flight.status} /></td>
                    <td><CabinBars flight={flight} /></td>
                    <td>
                      {flight.alerts.length === 0 ? <span className={a.muted}>Sin alertas</span> : (
                        <ul className={a.alerts} aria-label={`Alertas de ${flight.flightNumber}`}>
                          {flight.alerts.map((alert) => <li key={`${alert.code}|${alert.message ?? ''}`}><span className={`${a.badge} ${alert.severity === 'CRITICAL' ? a.bad : alert.severity === 'WARNING' ? a.warn : a.info}`} title={alert.message ?? undefined}>{alertLabel(alert.code)}</span></li>)}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </>
        )
      ) : null}
    </>
  );
}
