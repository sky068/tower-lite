import { Bell, FolderKanban, ListChecks } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";

const navItems = [
  { to: "/dashboard", label: "我的任务", icon: ListChecks },
  { to: "/projects/demo/board", label: "项目看板", icon: FolderKanban }
];

export function AppShell() {
  const { user, clearSession } = useAuthStore();

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
            <button className="text-button" type="button" onClick={clearSession}>
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
