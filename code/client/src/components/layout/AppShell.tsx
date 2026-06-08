import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ListChecks } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { authApi, userApi } from "../../lib/api";
import { formatRelativeTime } from "../../lib/dateTime";
import { useRealtimeEvents } from "../../lib/realtime";
import { useAuthStore } from "../../stores/authStore";
import type { Notification } from "../../types/api";

const navItems = [
  { to: "/dashboard", label: "工作台", icon: ListChecks }
];

const realtimeStatusLabels = {
  idle: "实时连接未启动",
  connecting: "实时连接中",
  connected: "实时连接正常",
  reconnecting: "实时连接重连中"
};

export function AppShell() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, refreshToken, clearSession } = useAuthStore();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const realtimeStatus = useRealtimeEvents();

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: userApi.notifications,
    enabled: Boolean(user)
  });

  const markNotificationReadMutation = useMutation({
    mutationFn: userApi.markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  const markAllNotificationsReadMutation = useMutation({
    mutationFn: userApi.markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );
  const recentNotifications = notifications.slice(0, 6);

  useEffect(() => {
    setIsNotificationsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isNotificationsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isNotificationsOpen]);

  async function handleLogout() {
    const tokenToRevoke = refreshToken;
    clearSession();
    navigate("/login", { replace: true });

    if (tokenToRevoke) {
      try {
        await authApi.logout({ refreshToken: tokenToRevoke });
      } catch {
        // The local session is already cleared; a failed revoke should not block logout.
      }
    }
  }

  function handleOpenNotification(notification: Notification) {
    if (!notification.isRead) {
      markNotificationReadMutation.mutate(notification.id);
    }
    setIsNotificationsOpen(false);
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
          <div className="topbar-title">
            <strong>简化版 Tower</strong>
            <span>{user ? `${user.name}，V0 开发中` : "V0 开发中"}</span>
          </div>
          <div className="topbar-actions">
            <span
              className={`realtime-status ${realtimeStatus}`}
              aria-label={realtimeStatusLabels[realtimeStatus]}
              title={realtimeStatusLabels[realtimeStatus]}
            />
            <div className="notification-menu" ref={notificationsRef}>
              <button
                className="icon-button notification-button"
                aria-label="通知"
                aria-expanded={isNotificationsOpen}
                type="button"
                onClick={() => setIsNotificationsOpen((current) => !current)}
              >
                <Bell size={18} />
                {unreadCount > 0 ? <span className="notification-badge">{unreadCount}</span> : null}
              </button>
              {isNotificationsOpen ? (
                <section className="notification-popover" aria-label="通知列表">
                  <header className="notification-popover-header">
                    <strong>通知</strong>
                    <button
                      className="mini-button"
                      type="button"
                      disabled={unreadCount === 0 || markAllNotificationsReadMutation.isPending}
                      onClick={() => markAllNotificationsReadMutation.mutate()}
                    >
                      全部已读
                    </button>
                  </header>
                  <div className="notification-list">
                    {notificationsQuery.isLoading ? <span className="muted">通知加载中...</span> : null}
                    {recentNotifications.map((notification) =>
                      notification.link ? (
                        <Link
                          className={notification.isRead ? "notification-item" : "notification-item unread"}
                          key={notification.id}
                          to={notification.link}
                          state={{ backgroundLocation: location, returnTo: location.pathname }}
                          onClick={() => handleOpenNotification(notification)}
                        >
                          <strong>{notification.title}</strong>
                          <span>{notification.content}</span>
                          <time dateTime={notification.createdAt}>
                            {formatRelativeTime(notification.createdAt)}
                          </time>
                        </Link>
                      ) : (
                        <button
                          className={notification.isRead ? "notification-item" : "notification-item unread"}
                          key={notification.id}
                          type="button"
                          onClick={() => handleOpenNotification(notification)}
                        >
                          <strong>{notification.title}</strong>
                          <span>{notification.content}</span>
                          <time dateTime={notification.createdAt}>
                            {formatRelativeTime(notification.createdAt)}
                          </time>
                        </button>
                      )
                    )}
                    {!notificationsQuery.isLoading && recentNotifications.length === 0 ? (
                      <span className="muted">暂无通知</span>
                    ) : null}
                  </div>
                  <Link className="notification-footer" to="/dashboard">
                    查看全部
                  </Link>
                </section>
              ) : null}
            </div>
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
