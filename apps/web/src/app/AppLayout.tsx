import { NavLink, Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Navigation principale">
        <strong>Chiffra</strong>
        <div className="topbar__tabs">
          <NavLink className={({ isActive }) => `topbar__tab${isActive ? " topbar__tab--active" : ""}`} to="/upload">
            Upload
          </NavLink>
          <NavLink className={({ isActive }) => `topbar__tab${isActive ? " topbar__tab--active" : ""}`} to="/dashboard">
            Dashboard
          </NavLink>
          <NavLink className={({ isActive }) => `topbar__tab${isActive ? " topbar__tab--active" : ""}`} to="/review">
            Review
          </NavLink>
        </div>
      </nav>
      <Outlet />
    </main>
  );
}
