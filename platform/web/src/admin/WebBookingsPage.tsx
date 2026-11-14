import { formatLocalDate, formatLocalTimeWithZone } from '@flight-platform/format';
import { AdminWebBookingsOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { AdminWebBookingsQuery } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { usePagedList } from './hooks';
import { DataTable, updatedText } from './parts';
import a from './admin.module.css';

type Row = AdminWebBookingsQuery['adminWebBookings']['items'][number];
const PAGE = 20;

/**
 * Reservas del canal web marcadas como de prueba (solo lectura). Se muestra EXACTAMENTE lo que entrega la API: el identificador de la reserva, la fecha,
 * la cantidad de pasajeros y una referencia opaca (hash) del dueño; ningún dato personal. La hora es la de Quito (sede de la aerolínea).
 */
export function WebBookingsPage() {
  usePageTitle('Reservas web');
  const { client } = useServices();
  const list = usePagedList<Row>(async (after, correlationId, signal) => {
    const data = await client.execute(AdminWebBookingsOperation, { first: PAGE, after }, { correlationId, signal });
    return { items: data.adminWebBookings.items, endCursor: data.adminWebBookings.pageInfo.endCursor ?? null, hasNextPage: data.adminWebBookings.pageInfo.hasNextPage };
  }, 'web-bookings');

  return (
    <>
      <div className={a.between}>
        <div><span className={ui.eyebrow}>Canal web</span><h1>Reservas web</h1></div>
        <div className={a.row}><span className={a.muted}>{updatedText(list.updatedAt)}</span><Button variant="secondary" onClick={list.reload} loading={list.refreshing}>Actualizar</Button></div>
      </div>
      <Notice kind="info" title="Reservas de prueba, de la más reciente a la más antigua."><p>Son las reservas del canal web con pago simulado, sin cobro. Solo lectura: no se muestran datos personales de los viajeros.</p></Notice>

      {list.phase === 'loading' ? <LoadingState phase="normal" label="Cargando las reservas" skeletons={2} /> : null}
      {list.phase === 'error' && list.error ? <ErrorPanel error={list.error} onRetry={list.reload} /> : null}
      {list.phase === 'ready' ? (
        list.items.length === 0 ? (
          <div className={`${ui.card} ${a.empty}`}><h2>Aún no hay reservas del canal web</h2><p className={a.muted}>Cuando un cliente compre desde la web, su reserva aparecerá aquí.</p></div>
        ) : (
          <>
            <DataTable caption="Reservas del canal web (de prueba)">
              <thead><tr><th scope="col">Reserva</th><th scope="col">Creada</th><th scope="col" className={a.num}>Pasajeros</th><th scope="col">Canal</th><th scope="col">Prueba</th><th scope="col">Titular (referencia opaca)</th></tr></thead>
              <tbody>
                {list.items.map((row) => (
                  <tr key={row.bookingId}>
                    <th scope="row"><code className={a.wrapCode}>{row.bookingId}</code></th>
                    <td>{formatLocalDate(row.createdAt, 'UIO')} · {formatLocalTimeWithZone(row.createdAt, 'UIO')}</td>
                    <td className={a.num}>{row.passengers}</td>
                    <td>{row.channel}</td>
                    <td>{row.test ? 'Sí' : 'No'}</td>
                    <td>{row.owner ? <code className={a.wrapCode}>{row.owner}</code> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {list.error ? <ErrorPanel error={list.error} onRetry={list.loadMore} /> : null}
            {list.hasNext ? <div className={a.row}><Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Cargar más reservas</Button></div> : null}
          </>
        )
      ) : null}
    </>
  );
}
