import { useRef, useState, type KeyboardEvent } from 'react';
import { Check, Hourglass, X } from 'lucide-react';
import { aisleAfter, columnLetters, isSelectable, moveFocus, seatLabel, SEAT_STATUS_LABEL, type Arrow, type MapSeat, type SeatMapCabin } from './seat-map';
import s from './purchase.module.css';

const ARROWS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

export interface SeatMapProps {
  cabin: SeatMapCabin;
  /** Asiento → nombre de quien lo eligió (para el nombre accesible y la marca de «elegido»). */
  chosen: Readonly<Record<string, string>>;
  onSelect: (seat: MapSeat) => void;
}

/** Leyenda: cada estado con su símbolo Y su texto (el color nunca es lo único). */
export function SeatLegend() {
  return (
    <ul className={s.legend} aria-label="Leyenda del mapa de asientos">
      <li><span className={s.keyBox} aria-hidden="true" />Libre</li>
      <li><span className={`${s.keyBox} ${s.keyChosen}`} aria-hidden="true"><Check size={12} color="currentColor" /></span>Elegido por ti</li>
      <li><span className={`${s.keyBox} ${s.keyHeld}`} aria-hidden="true"><Hourglass size={12} /></span>Apartado por otro viajero</li>
      <li><span className={`${s.keyBox} ${s.keyOccupied}`} aria-hidden="true"><X size={12} /></span>Ocupado</li>
    </ul>
  );
}

/**
 * Mapa de asientos de UNA cabina. Operable con teclado (flechas, Inicio y Fin; un solo tabulador entra al mapa) y con nombre
 * accesible por asiento («Asiento 8A, ventana, libre»). Los asientos no libres siguen enfocables (se anuncian) pero no se eligen.
 */
export function SeatMap({ cabin, chosen, onSelect }: SeatMapProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const firstFree = cabin.rows.flatMap((row) => row.seats).find((seat) => isSelectable(seat) || chosen[seat.seatNumber]);
  const [active, setActive] = useState<string | null>(null);
  const tabStop = active && refs.current.has(active) ? active : (firstFree ?? cabin.rows[0]?.seats[0])?.seatNumber;
  const letters = columnLetters(cabin);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, position: [number, number]): void => {
    if (!ARROWS.includes(event.key)) return;
    const target = moveFocus(cabin, position, event.key as Arrow);
    event.preventDefault();
    if (!target) return;
    const seat = cabin.rows[target[0]].seats[target[1]];
    setActive(seat.seatNumber); refs.current.get(seat.seatNumber)?.focus();
  };

  return (
    <div className={s.seatMap} role="group" aria-label="Mapa de asientos">
      <div className={s.cols} aria-hidden="true">
        <span className={s.rowNum} />
        {letters.map((letter, index) => (
          <span key={`${letter}-${index}`} className={s.contents}>
            <span className={s.colHead}>{letter}</span>
            {index < letters.length - 1 && cabin.rows.some((row) => aisleAfter(row, index)) ? <span className={s.aisle} /> : null}
          </span>
        ))}
        <span className={s.rowNum} />
      </div>
      {cabin.rows.map((row, rowIndex) => (
        <div key={row.rowNumber} className={s.seatRow} role="group" aria-label={`Fila ${row.rowNumber}`}>
          <span className={s.rowNum} aria-hidden="true">{row.rowNumber}</span>
          {row.seats.map((seat, colIndex) => {
            const by = chosen[seat.seatNumber]; const free = isSelectable(seat);
            const className = [s.seat, by ? s.seatChosen : seat.status === 'HELD' ? s.seatHeld : !free ? s.seatOccupied : ''].filter(Boolean).join(' ');
            return (
              <span key={seat.seatNumber} className={s.contents}>
                <button
                  type="button" className={className} data-seat={seat.seatNumber} data-status={by ? 'CHOSEN' : seat.status}
                  ref={(element) => { if (element) refs.current.set(seat.seatNumber, element); else refs.current.delete(seat.seatNumber); }}
                  aria-label={seatLabel(seat, by)} aria-pressed={by ? true : free ? false : undefined} aria-disabled={!free && !by ? true : undefined}
                  tabIndex={seat.seatNumber === tabStop ? 0 : -1} title={by ? `Elegido por ${by}` : SEAT_STATUS_LABEL[seat.status]}
                  onFocus={() => setActive(seat.seatNumber)}
                  onKeyDown={(event) => onKeyDown(event, [rowIndex, colIndex])}
                  onClick={() => { if (free || by) onSelect(seat); }}
                >
                  <span aria-hidden="true">
                    {by ? <Check size={18} /> : seat.status === 'HELD' ? <Hourglass size={16} /> : free ? seat.seatNumber.replace(/^\d+/, '') : <X size={16} />}
                  </span>
                </button>
                {aisleAfter(row, colIndex) ? <span className={s.aisle} aria-hidden="true" /> : null}
              </span>
            );
          })}
          <span className={s.rowNum} aria-hidden="true">{row.rowNumber}</span>
        </div>
      ))}
    </div>
  );
}
