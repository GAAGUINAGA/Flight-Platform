import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, CircleCheck, Clock, PlaneLanding, PlaneTakeoff, Route, TriangleAlert, Users } from 'lucide-react';
import { cityOf, formatDate, formatLocalDate, formatLocalTime, isIsoDate, todayAt, zoneLabel } from '@flight-platform/format';
import { FlightStatusOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { FlightStatusCode, FlightStatusFieldsFragment } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useQuery } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import ui from '../components/ui/ui.module.css';
import styles from './pages.module.css';

const FLIGHT_NUMBER = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
export const normalizeFlightNumber = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

/** Estado operativo: texto + icono + tono (nunca solo color). */
const STATUS: Record<FlightStatusCode, { label: string; tone: 'info' | 'success' | 'warning' | 'error'; icon: typeof Clock }> = {
  SCHEDULED: { label: 'Programado', tone: 'info', icon: Clock },
  BOARDING: { label: 'Embarcando', tone: 'info', icon: Users },
  DEPARTED: { label: 'En vuelo', tone: 'info', icon: PlaneTakeoff },
  DELAYED: { label: 'Retrasado', tone: 'warning', icon: TriangleAlert },
  ARRIVED: { label: 'Aterrizó', tone: 'success', icon: CircleCheck },
  CANCELLED: { label: 'Cancelado', tone: 'error', icon: Ban },
  DIVERTED: { label: 'Desviado', tone: 'warning', icon: Route }
};

function Endpoint({ title, icon: Icon, endpoint }: { title: string; icon: typeof Clock; endpoint: FlightStatusFieldsFragment['departure'] }) {
  const iata = endpoint.iataCode;
  const row = (label: string, value: string | null) => (value ? <div className={styles.row}><dt>{label}</dt><dd>{formatLocalTime(value, iata)} <span className={ui.muted}>· {formatLocalDate(value, iata)}</span></dd></div> : null);
  return (
    <section className={ui.card} aria-label={`${title}: ${cityOf(iata)}`}>
      <h3 className={styles.endpointTitle}><Icon size={20} aria-hidden="true" />{title} · {cityOf(iata)} ({iata})</h3>
      <dl className={styles.rows}>
        {row('Programada', endpoint.scheduledAt)}
        {row('Estimada', endpoint.estimatedAt)}
        {row('Real', endpoint.actualAt)}
        {endpoint.terminal ? <div className={styles.row}><dt>Terminal</dt><dd>{endpoint.terminal}</dd></div> : null}
        {/* La puerta se muestra solo si el servicio la envía (H-6). */}
        {endpoint.gate ? <div className={styles.row}><dt>Puerta</dt><dd>{endpoint.gate}</dd></div> : null}
      </dl>
      <p className={ui.hint}>Horas en {zoneLabel(iata)}.</p>
    </section>
  );
}

export function FlightStatusResult({ status }: { status: FlightStatusFieldsFragment }) {
  const meta = STATUS[status.status]; const Icon = meta.icon;
  return (
    <div className={styles.statusResult} aria-live="polite">
      <div className={styles.statusHead}>
        <div>
          <span className={ui.eyebrow}>Vuelo {status.flightNumber} · {formatDate(status.date, { weekday: true })}</span>
          <h2 className={styles.statusRoute}>{cityOf(status.departure.iataCode)} – {cityOf(status.arrival.iataCode)}</h2>
        </div>
        <span className={`${styles.badge} ${styles[meta.tone]}`} data-testid="flight-status"><Icon size={18} aria-hidden="true" />{meta.label}</span>
      </div>
      {status.delayMinutes ? <p className={styles.delay}>Retraso estimado: {status.delayMinutes} min.</p> : null}
      <div className={styles.endpoints}>
        <Endpoint title="Salida" icon={PlaneTakeoff} endpoint={status.departure} />
        <Endpoint title="Llegada" icon={PlaneLanding} endpoint={status.arrival} />
      </div>
      <p className={ui.hint}>
        {status.aircraft ? `Aeronave: ${status.aircraft}. ` : ''}
        {status.updatedAt ? `Actualizado a las ${formatLocalTime(status.updatedAt, status.departure.iataCode)} (${zoneLabel(status.departure.iataCode)}).` : ''}
      </p>
    </div>
  );
}

/** Estado de un vuelo (diseño F12c-0 §3.3): número de vuelo + fecha LOCAL de salida. La consulta vive en la URL. */
export function FlightStatusPage() {
  usePageTitle('Estado de un vuelo');
  const [params, setParams] = useSearchParams();
  const queryFlight = normalizeFlightNumber(params.get('vuelo') ?? ''); const queryDate = params.get('fecha') ?? '';
  const valid = FLIGHT_NUMBER.test(queryFlight) && isIsoDate(queryDate);
  const [flight, setFlight] = useState(queryFlight); const [date, setDate] = useState(queryDate || todayAt('UIO'));
  const [errors, setErrors] = useState<{ flight?: string; date?: string }>({});
  const query = useQuery(FlightStatusOperation, valid ? { flightNumber: queryFlight, date: queryDate } : null, `${queryFlight}|${queryDate}`);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const number = normalizeFlightNumber(flight);
    const found = { ...(FLIGHT_NUMBER.test(number) ? {} : { flight: 'Escribe el número de vuelo, por ejemplo FP103.' }), ...(isIsoDate(date) ? {} : { date: 'Elige la fecha de salida.' }) };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setFlight(number);
    if (number === queryFlight && date === queryDate) query.reload(); else setParams({ vuelo: number, fecha: date });
  };

  return (
    <div className={pageClass}>
      <span className={ui.eyebrow}>Antes de salir de casa</span>
      <h1>Estado de un vuelo</h1>
      <form className={`${ui.card} ${styles.statusForm}`} onSubmit={submit} noValidate aria-label="Consultar el estado de un vuelo">
        <TextField label="Número de vuelo" value={flight} onChange={(event) => setFlight(event.target.value)} error={errors.flight} placeholder="FP103" autoComplete="off" autoCapitalize="characters" maxLength={8} />
        <TextField label="Fecha de salida" type="date" value={date} onChange={(event) => setDate(event.target.value)} error={errors.date} hint="Fecha local del aeropuerto de origen" />
        <Button type="submit" loading={query.status === 'loading'}>Consultar estado</Button>
      </form>
      {query.status === 'loading' ? <LoadingState phase={query.phase} label="Consultando el estado del vuelo" onRetry={query.reload} /> : null}
      {query.status === 'error' ? <div className={styles.gap}><ErrorPanel error={query.error} onRetry={query.reload} /></div> : null}
      {query.status === 'success' ? <FlightStatusResult status={query.data.flightStatus} /> : null}
    </div>
  );
}
