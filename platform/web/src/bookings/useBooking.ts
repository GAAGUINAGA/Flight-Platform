import { useEffect, useRef, useState } from 'react';
import { BookingOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { BookingFieldsFragment, BookingStatus } from '@flight-platform/graphql-schema/generated/types';
import { useServices } from '../app/services';
import { toAppError, type AppError } from '../data/errors';
import { newCorrelationId } from '../data/identity';

export type Booking = BookingFieldsFragment;
/** Estados en los que la reserva todavía avanza sola (se consulta cada pocos segundos, con tope). */
export const IN_PROGRESS: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['PENDING', 'PENDING_PAYMENT', 'TICKET_ISSUING', 'CHANGE_PENDING', 'CANCELLATION_PENDING']);
export const POLL_MS = 4000;
export const POLL_MAX = 15;

export interface BookingState { booking: Booking | null; error: AppError | null; loading: boolean; /** Se agotó el tope de consultas y sigue en proceso. */ gaveUp: boolean; reload: () => void; setBooking: (booking: Booking) => void }

/**
 * Carga una reserva (`booking(bookingId)`, la fuente de verdad: la lista no trae las acciones). Con `poll` vuelve a consultarla
 * mientras esté en proceso, hasta `POLL_MAX` veces. Una consulta nueva NO borra lo que ya se muestra.
 */
export function useBooking(bookingId: string, options: { initial?: Booking | null; poll?: boolean } = {}): BookingState {
  const { client } = useServices();
  const [booking, setBooking] = useState<Booking | null>(options.initial ?? null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(!options.initial);
  const [tick, setTick] = useState(0); const [gaveUp, setGaveUp] = useState(false);
  const attempts = useRef(0); const correlation = useRef(newCorrelationId());

  useEffect(() => {
    const controller = new AbortController();
    client.execute(BookingOperation, { bookingId }, { correlationId: correlation.current, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setBooking(data.booking); setError(null); setLoading(false); } })
      .catch((failure: unknown) => { if (!controller.signal.aborted) { setError(toAppError(failure)); setLoading(false); } });
    return () => controller.abort();
  }, [client, bookingId, tick]);

  useEffect(() => {
    if (!options.poll || !booking || !IN_PROGRESS.has(booking.status)) return undefined;
    if (attempts.current >= POLL_MAX) { setGaveUp(true); return undefined; }
    const timer = setTimeout(() => { attempts.current += 1; setTick((value) => value + 1); }, POLL_MS);
    return () => clearTimeout(timer);
  }, [options.poll, booking, tick]);

  return {
    booking, error, loading, gaveUp,
    reload: () => { attempts.current = 0; setGaveUp(false); setLoading(booking === null); setError(null); setTick((value) => value + 1); },
    setBooking
  };
}
