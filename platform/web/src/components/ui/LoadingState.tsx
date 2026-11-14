import type { LoadingPhase } from '../../app/services';
import { Button } from './Button';
import styles from './ui.module.css';

/**
 * Estado de carga amable para los arranques en frío (diseño F12c-0 §9.1): esqueleto al principio; pasado 1,5 s avisa que el
 * servicio está despertando; pasados 8 s ofrece reintentar. A los 25 s la capa de datos entrega un error de indisponibilidad.
 */
export function LoadingState({ phase, label = 'Cargando', skeletons = 0, onRetry }: { phase: LoadingPhase; label?: string; skeletons?: number; onRetry?: () => void }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
      {skeletons > 0 && phase === 'normal'
        ? <div className={styles.skeletonList} aria-hidden="true">{Array.from({ length: skeletons }, (_, index) => <div key={index} className={styles.skeleton} />)}</div>
        : <span className={`${styles.spinner} ${styles.spinnerLarge}`} aria-hidden="true" />}
      <p className={phase === 'normal' ? styles.srOnly : undefined}>
        {phase === 'normal' ? `${label}…` : 'Estamos despertando el servicio, puede tardar unos segundos.'}
      </p>
      {phase === 'very-slow' ? (
        <>
          <p className={styles.muted}>Sigue intentando. Si prefieres, vuelve a lanzar la consulta.</p>
          {onRetry ? <Button variant="secondary" size="small" onClick={onRetry}>Reintentar</Button> : null}
        </>
      ) : null}
    </div>
  );
}
