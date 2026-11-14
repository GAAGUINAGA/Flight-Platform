import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, User, X } from 'lucide-react';
import { brand } from '@flight-platform/brand';
import { useServices, useSession } from '../../app/services';
import { logoUrl } from '../../brand/assets';
import { loginPath } from '../../session/return-to';
import styles from './layout.module.css';

const NAV = [{ to: '/', label: 'Buscar vuelos', end: true }, { to: '/estado', label: 'Estado de vuelo', end: false }];
const ENV_LABEL = { produccion: '', pruebas: 'Pruebas', local: 'Local' } as const;

/** Banda fija del entorno (diseño §3.14): visible en todo entorno que no sea producción. */
function EnvBand() {
  const { config } = useServices();
  if (config.envName === 'produccion') return null;
  return <div className={styles.envBand} role="note"><span className={styles.envName}>{ENV_LABEL[config.envName]}</span>{brand.texts.testEnvironmentNotice}</div>;
}

function MobileMenu({ onClose, onSignOut, authenticated, returnTo }: { onClose: () => void; onSignOut: () => void; authenticated: boolean; returnTo: string }) {
  const closeRef = useRef<HTMLButtonElement>(null); const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      // El foco no sale del menú mientras está abierto.
      const items = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'); if (!items || items.length === 0) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="menu-title" ref={drawerRef}>
        <div className={styles.drawerHead}>
          <h2 id="menu-title">Menú</h2>
          <button type="button" className={styles.close} onClick={onClose} ref={closeRef} aria-label="Cerrar menú"><X size={24} aria-hidden="true" /></button>
        </div>
        {NAV.map((item) => <Link key={item.to} className={styles.drawerLink} to={item.to} onClick={onClose}>{item.label}</Link>)}
        {authenticated
          ? <button type="button" className={styles.drawerLink} onClick={() => { onClose(); onSignOut(); }}>Cerrar sesión</button>
          : <><Link className={styles.drawerLink} to={loginPath(returnTo)} onClick={onClose}>Iniciar sesión</Link><Link className={styles.drawerLink} to="/registro" onClick={onClose}>Crear cuenta</Link></>}
      </div>
    </div>
  );
}

function AppHeader() {
  const { session: client } = useServices(); const session = useSession();
  const location = useLocation(); const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false); const menuButton = useRef<HTMLButtonElement>(null);
  const returnTo = `${location.pathname}${location.search}`;
  const signOut = (): void => { void client.signOut().then(() => navigate('/')); };
  const closeMenu = (): void => { setMenuOpen(false); menuButton.current?.focus(); };
  const authenticated = session.status === 'authenticated';
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link to="/" className={styles.logoLink} aria-label={`${brand.name}, ir al inicio`}><img className={styles.logo} src={logoUrl('dark')} alt="" width={166} height={36} /></Link>
        <nav className={styles.nav} aria-label="Principal">
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>{item.label}</NavLink>)}
        </nav>
        <div className={styles.right}>
          {authenticated ? (
            <>
              <span className={styles.userName} data-testid="user-name">{session.user.name ?? session.user.email ?? 'Mi cuenta'}</span>
              <button type="button" className={styles.account} onClick={signOut}><LogOut size={18} aria-hidden="true" /><span>Cerrar sesión</span></button>
            </>
          ) : (
            <Link className={styles.account} to={loginPath(returnTo)}><User size={18} aria-hidden="true" />Iniciar sesión</Link>
          )}
          <button type="button" className={styles.menuButton} ref={menuButton} onClick={() => setMenuOpen(true)} aria-label="Abrir menú" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu size={24} aria-hidden="true" /></button>
        </div>
      </div>
      {menuOpen ? <MobileMenu onClose={closeMenu} onSignOut={signOut} authenticated={authenticated} returnTo={returnTo} /> : null}
    </header>
  );
}

function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerGrid}>
          <div>
            <img src={logoUrl('light')} alt={brand.name} width={147} height={32} />
            <p className={styles.footerAbout}>{brand.texts.about}</p>
          </div>
          {brand.footer.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2>{column.title}</h2>
              <ul>{column.links.map((link) => <li key={link.to}><Link className={styles.footerLink} to={link.to}>{link.label}</Link></li>)}</ul>
            </nav>
          ))}
        </div>
        <details className={styles.credits}>
          <summary>{brand.texts.photoCreditsTitle}</summary>
          <ul>
            {Object.values(brand.photos).map((photo) => (
              <li key={photo.file}>{photo.alt}: <a href={photo.credit.sourceUrl} rel="noreferrer noopener" target="_blank">{photo.credit.author}</a>, <a href={photo.credit.licenseUrl} rel="noreferrer noopener" target="_blank">{photo.credit.license}</a> (redimensionada).</li>
            ))}
          </ul>
        </details>
        <div className={styles.footerBottom}><span>© {year} {brand.legalName}</span><span>{brand.texts.footerLegal}</span></div>
      </div>
    </footer>
  );
}

/** Marco de todas las pantallas: «saltar al contenido», banda de entorno, cabecera, contenido y pie. Al cambiar de ruta el foco va al contenido. */
export function AppLayout() {
  const location = useLocation(); const main = useRef<HTMLElement>(null); const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <a className={styles.skip} href="#contenido" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>Saltar al contenido</a>
      <EnvBand />
      <AppHeader />
      <main id="contenido" className={styles.main} tabIndex={-1} ref={main}><Outlet /></main>
      <AppFooter />
    </>
  );
}

export const pageClass = styles.page;
