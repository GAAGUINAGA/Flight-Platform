import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Gauge, Plane, Tag, Ticket, Users } from 'lucide-react';
import { pageClass } from '../components/layout/AppLayout';
import { NotFoundPage } from '../pages/SystemPages';
import { DashboardPage } from './DashboardPage';
import { FaresPage } from './FaresPage';
import { FlightsPage } from './FlightsPage';
import { PromotionsPage } from './PromotionsPage';
import { WebBookingsPage } from './WebBookingsPage';
import a from './admin.module.css';

const MENU = [
  { to: '/admin', label: 'Dashboard', end: true, icon: Gauge },
  { to: '/admin/vuelos', label: 'Vuelos', end: false, icon: Plane },
  { to: '/admin/tarifas', label: 'Tarifas', end: false, icon: Tag },
  { to: '/admin/promociones', label: 'Promociones', end: false, icon: Ticket },
  { to: '/admin/reservas-web', label: 'Reservas web', end: false, icon: Users }
] as const;

/** Marco del panel: menú lateral y contenido. «Socios y webhooks» y «Telemetría» quedan fuera de esta versión (F12d). */
function AdminLayout() {
  return (
    <div className={pageClass}>
      <div className={a.shell}>
        <nav className={a.menu} aria-label="Administración">
          <p className={a.menuTitle}>Administración</p>
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `${a.menuLink} ${isActive ? a.menuActive : ''}`}>
              <item.icon size={18} aria-hidden="true" />{item.label}
            </NavLink>
          ))}
        </nav>
        <div className={a.content}><Outlet /></div>
      </div>
    </div>
  );
}

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="vuelos" element={<FlightsPage />} />
        <Route path="tarifas" element={<FaresPage />} />
        <Route path="promociones" element={<PromotionsPage />} />
        <Route path="reservas-web" element={<WebBookingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
