import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import styles from './ui.module.css';

export type NoticeKind = 'info' | 'success' | 'warning' | 'error';
const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };
const KIND_LABEL: Record<NoticeKind, string> = { info: 'Información', success: 'Listo', warning: 'Atención', error: 'Error' };

/** Aviso con icono y texto. Los errores se anuncian de inmediato (`role="alert"`); el resto, con cortesía (`role="status"`). */
export function Notice({ kind = 'info', title, children }: { kind?: NoticeKind; title?: string; children: ReactNode }) {
  const Icon = ICONS[kind];
  return (
    <div className={`${styles.notice} ${styles[kind]}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div className={styles.noticeBody}>
        <span className={styles.srOnly}>{KIND_LABEL[kind]}: </span>
        {title ? <p className={styles.noticeTitle}>{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
