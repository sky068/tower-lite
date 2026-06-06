import { Bell, ListChecks } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { authApi } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

const navItems = [
  { to: "/dashboard", label: "工作台", icon: ListChecks }
];

export function AppShell() {
  const { user, refreshToken, clearSession } = useAuthStore();

  async function handleLogout() {
    try {
      if (refreshToken) {
        await authApi.logout({ refreshToken });
      }
    } finally {
      clearSession();
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Tower Lite</div>
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className="nav-item">
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <strong>简化版 Tower</strong>
            <span>{user ? `${user.name}，V0 开发中` : "V0 开发中"}</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="通知">
              <Bell size={18} />
            </button>
            <button className="text-button" type="button" onClick={() => void handleLogout()}>
              退出
            </button>
          </div>
        </header>
        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
