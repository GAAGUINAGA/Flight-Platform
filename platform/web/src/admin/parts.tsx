import type { ReactNode } from 'react';
import type { FlightStatusCode } from '@flight-platform/graphql-schema/generated/types';
import { formatLocalTimeWithZone } from '@flight-platform/format';
import { healthLabel, healthTone } from './operations';
import { STATUS_LABEL } from './status-rules';
import a from './admin.module.css';

const STATUS_TONE: Readonly<Record<FlightStatusCode, 'ok' | 'warn' | 'bad' | 'info'>> = { SCHEDULED: 'info', BOARDING: 'info', DEPARTED: 'info', DELAYED: 'warn', ARRIVED: 'ok', CANCELLED: 'bad', DIVERTED: 'warn' };

/** Estado de un vuelo: siempre con texto (nunca solo color). */
export function FlightStatusBadge({ status }: { status: FlightStatusCode | null | undefined }) {
  if (!status) return <span className={a.muted}>—</span>;
  return <span className={`${a.badge} ${a[STATUS_TONE[status]]}`}>{STATUS_LABEL[status]}</span>;
}

export function HealthBadge({ status }: { status: string }) {
  return <span className={`${a.badge} ${a[healthTone(status)]}`}>{healthLabel(status)}</span>;
}

/** Tabla con encabezados y desplazamiento propio: el contenido ancho no ensancha la página y el desplazamiento se alcanza con teclado. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={a.tableWrap} role="region" aria-label={caption} tabIndex={0}>
      <table className={a.table}><caption>{caption}</caption>{children}</table>
    </div>
  );
}

/** «Actualizado a las 08:35 · hora de Quito» (la hora del panel es la de Quito, sede de la aerolínea). */
export const updatedText = (at: Date | null): string => (at ? `Actualizado a las ${formatLocalTimeWithZone(at, 'UIO')}.` : '');
