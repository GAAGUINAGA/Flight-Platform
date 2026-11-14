import { useEffect, useMemo, useState } from 'react';
import { ChangeSeatsOperation, SeatMapOperation } from '@flight-platform/graphql-schema/generated/operations';
import { useQuery, useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { SeatLegend, SeatMap } from '../purchase/SeatMap';
import { isSelectable, type MapSeat } from '../purchase/seat-map';
import { needsSeat } from '../purchase/passenger-rules';
import { useAction } from './useAction';
import type { Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

/**
 * Postventa · Asiento (§3.11): mapa del tramo (libre, apartado, ocupado), elegir el asiento nuevo de cada pasajero y confirmar. Sin costo.
 * El servicio de mapas solo usa el tramo: el identificador de oferta que pide la consulta es el de la reserva (formato válido, sin otro uso).
 */
export function SeatsTab({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const { client } = useServices(); const action = useAction();
  const segments = useMemo(() => (booking.itineraries ?? []).flatMap((itinerary) => itinerary.segments.map((segment) => ({ segment, cabin: itinerary.pricingOptions[0]?.cabinClass }))), [booking]);
  const passengers = useMemo(() => (booking.passengers ?? []).filter((passenger) => needsSeat(passenger.passengerType)), [booking]);
  const [segmentIndex, setSegmentIndex] = useState(0); const [paxId, setPaxId] = useState(passengers[0]?.passengerId ?? '');
  const [picked, setPicked] = useState<Record<string, string>>({}); // `${passengerId}|${segmentId}` → asiento nuevo
  const [refresh, setRefresh] = useState(0); const [done, setDone] = useState(false);
  const current = segments[segmentIndex]; const segmentId = current?.segment.segmentId ?? '';
  const query = useQuery(SeatMapOperation, current ? { offerId: booking.bookingId, segmentId } : null, `${booking.bookingId}:${segmentId}:${refresh}`);
  const cabin = query.status === 'success' ? query.data.seatMap.cabins.find((entry) => entry.cabinClass === current?.cabin) ?? query.data.seatMap.cabins[0] : undefined;
  const currentSeat = (passengerId: string): string | undefined => booking.passengers?.find((passenger) => passenger.passengerId === passengerId)?.assignedSeats?.find((seat) => seat.segmentId === segmentId)?.seatNumber;

  // Tras refrescar, un asiento elegido que ya no está libre se suelta.
  useEffect(() => {
    if (!cabin) return;
    const free = new Set(cabin.rows.flatMap((row) => row.seats).filter(isSelectable).map((seat) => seat.seatNumber));
    setPicked((previous) => { const next = { ...previous }; let changed = false; for (const [key, seat] of Object.entries(next)) if (key.endsWith(`|${segmentId}`) && !free.has(seat)) { delete next[key]; changed = true; } return changed ? next : previous; });
  }, [cabin, segmentId]);

  const chosen: Record<string, string> = {};
  passengers.forEach((passenger, index) => {
    const mine = picked[`${passenger.passengerId}|${segmentId}`]; if (mine) chosen[mine] = `Pasajero ${index + 1}`;
    const now = currentSeat(passenger.passengerId); if (now && !mine) chosen[now] = `Pasajero ${index + 1} (asiento actual)`;
  });
  const onSelect = (seat: MapSeat): void => {
    setDone(false);
    const owner = Object.entries(picked).find(([key, value]) => key.endsWith(`|${segmentId}`) && value === seat.seatNumber)?.[0];
    if (owner) { setPicked((previous) => { const next = { ...previous }; delete next[owner]; return next; }); return; }
    if (!isSelectable(seat) || !paxId) return;
    setPicked((previous) => ({ ...previous, [`${paxId}|${segmentId}`]: seat.seatNumber }));
  };

  const changes = Object.entries(picked).map(([key, seatNumber]) => { const [passengerId, seg] = key.split('|'); return { passengerId, segmentId: seg, seatNumber }; });
  const confirm = async (): Promise<void> => {
    const result = await action.run('seats', JSON.stringify(changes), (intent) => client.execute(ChangeSeatsOperation, { bookingId: booking.bookingId, seats: changes, idempotencyKey: intent.idempotencyKey }, { correlationId: intent.correlationId }));
    if (result) { setDone(true); setPicked({}); setRefresh((value) => value + 1); onDone(); }
  };
  const labelOf = (passengerId: string): string => { const index = passengers.findIndex((passenger) => passenger.passengerId === passengerId); const p = passengers[index]; return `Pasajero ${index + 1} · ${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim(); };
  const flightOfSegment = (id: string): string => segments.find((entry) => entry.segment.segmentId === id)?.segment.flightNumber ?? id;

  if (passengers.length === 0) return <Notice kind="info" title="Esta reserva no tiene asientos por cambiar."><p>Los infantes viajan sin asiento propio.</p></Notice>;
  return (
    <div className={s.stack}>
      {done ? <Notice kind="success" title="Cambiamos tus asientos."><p>El cambio no tiene costo y ya figura en tu reserva.</p></Notice> : null}
      <p className={s.muted}>El cambio de asiento no tiene costo. Elige el pasajero y el asiento nuevo.</p>
      {segments.length > 1 ? (
        <div className={s.segmentTabs} role="group" aria-label="Tramo del viaje">
          {segments.map(({ segment }, index) => <Button key={segment.segmentId} size="small" variant={index === segmentIndex ? 'primary' : 'secondary'} aria-pressed={index === segmentIndex} onClick={() => setSegmentIndex(index)}>{segment.flightNumber} · {segment.departure.iataCode} → {segment.arrival.iataCode}</Button>)}
        </div>
      ) : null}
      <fieldset className={s.paxTabs}>
        <legend className={s.legend2}>¿Para quién cambias el asiento?</legend>
        {passengers.map((passenger, index) => (
          <button key={passenger.passengerId} type="button" className={`${s.paxTab} ${passenger.passengerId === paxId ? s.paxTabActive : ''}`} aria-pressed={passenger.passengerId === paxId} onClick={() => setPaxId(passenger.passengerId)}>
            <span>Pasajero {index + 1} · {passenger.firstName} {passenger.lastName}</span>
            <span className={s.paxSeat}>{picked[`${passenger.passengerId}|${segmentId}`] ? `Nuevo: ${picked[`${passenger.passengerId}|${segmentId}`]}` : `Actual: ${currentSeat(passenger.passengerId) ?? 'sin asiento'}`}</span>
          </button>
        ))}
      </fieldset>
      <SeatLegend />
      {query.status === 'loading' ? <LoadingState phase={query.phase} label="Cargando el mapa de asientos" onRetry={query.reload} /> : null}
      {query.status === 'error' ? <ErrorPanel error={query.error} onRetry={query.reload} /> : null}
      {cabin ? <SeatMap cabin={cabin} chosen={chosen} onSelect={onSelect} /> : null}
      {changes.length > 0 ? (
        <section className={`${ui.card} ${s.stackSmall}`} aria-label="Cambios de asiento">
          <h3>Cambios por confirmar</h3>
          <ul>{changes.map((change) => <li key={`${change.passengerId}|${change.segmentId}`}>{labelOf(change.passengerId)} · {flightOfSegment(change.segmentId)} → asiento {change.seatNumber}</li>)}</ul>
          <p className={s.muted}>Sin costo adicional.</p>
          {action.error ? <ErrorPanel error={action.error} onRetry={() => void confirm()} onRefreshSeats={() => { action.clearError(); setRefresh((value) => value + 1); }} /> : null}
          <div className={s.row}><Button loading={action.busy} onClick={() => void confirm()}>Confirmar el cambio de asiento</Button><Button variant="secondary" onClick={() => setPicked({})}>Descartar</Button></div>
        </section>
      ) : null}
    </div>
  );
}
