import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ListChecks, LogOut, Settings, Trash2, Upload, UserRound, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FormEvent, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { MutationError } from "../shared/MutationError";
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

const maxAvatarFileSize = 200 * 1024;
const allowedAvatarMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function UserAvatar({ user, size = 18 }: { user: { name: string; avatarUrl: string | null } | null | undefined; size?: number }) {
  return user?.avatarUrl ? (
    <img src={user.avatarUrl} alt={user.name} />
  ) : (
    <UserRound size={size} aria-hidden="true" />
  );
}

export function AppShell() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, refreshToken, clearSession, updateUser } = useAuthStore();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [notificationCenterFilter, setNotificationCenterFilter] = useState<"ALL" | "UNREAD">("ALL");
  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordFormError, setPasswordFormError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
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

  const updateProfileMutation = useMutation({
    mutationFn: () =>
      userApi.updateProfile({
        name: profileName.trim(),
        avatarUrl: profileAvatarUrl.trim() || null
      }),
    onSuccess: (updatedUser) => {
      setProfileSaved(true);
      try {
        updateUser(updatedUser);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      } catch {
        // The profile is saved on the server; a local cache write failure should not turn it into a failed save.
      }
    },
    onError: () => {
      setProfileSaved(false);
    }
  });

  const updatePasswordMutation = useMutation({
    mutationFn: () =>
      userApi.updatePassword({
        currentPassword,
        newPassword
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFormError("");
      setPasswordSaved(true);
    },
    onError: () => {
      setPasswordSaved(false);
    }
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );
  const recentNotifications = notifications.slice(0, 6);
  const notificationCenterItems = useMemo(
    () =>
      notificationCenterFilter === "UNREAD"
        ? notifications.filter((notification) => !notification.isRead)
        : notifications,
    [notificationCenterFilter, notifications]
  );

  useEffect(() => {
    setIsNotificationsOpen(false);
    setIsUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setProfileName(user?.name ?? "");
    setProfileAvatarUrl(user?.avatarUrl ?? "");
  }, [user]);

  useEffect(() => {
    if (!isNotificationsOpen && !isUserMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }

      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isNotificationsOpen, isUserMenuOpen]);

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
    setIsNotificationCenterOpen(false);
  }

  function handleOpenNotificationCenter() {
    setIsNotificationsOpen(false);
    setIsNotificationCenterOpen(true);
  }

  function handleOpenAccountSettings() {
    setIsUserMenuOpen(false);
    setIsAccountSettingsOpen(true);
    setProfileName(user?.name ?? "");
    setProfileAvatarUrl(user?.avatarUrl ?? "");
    setProfileAvatarError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordFormError("");
    setProfileSaved(false);
    setPasswordSaved(false);
  }

  function handleUpdateProfile(event: FormEvent) {
    event.preventDefault();

    if (profileName.trim() && !profileAvatarError) {
      setProfileSaved(false);
      updateProfileMutation.mutate();
    }
  }

  function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!allowedAvatarMimeTypes.has(file.type)) {
      setProfileAvatarError("头像仅支持 PNG、JPG、WebP 或 GIF。");
      return;
    }

    if (file.size > maxAvatarFileSize) {
      setProfileAvatarError("头像图片不能超过 200KB。");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setProfileAvatarUrl(reader.result);
        setProfileAvatarError("");
        setProfileSaved(false);
      }
    };
    reader.onerror = () => {
      setProfileAvatarError("头像读取失败，请重新选择图片。");
    };
    reader.readAsDataURL(file);
  }

  function handleClearAvatar() {
    setProfileAvatarUrl("");
    setProfileAvatarError("");
    setProfileSaved(false);
  }

  function handleUpdatePassword(event: FormEvent) {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setPasswordFormError("两次输入的新密码不一致。");
      return;
    }

    setPasswordFormError("");
    setPasswordSaved(false);
    updatePasswordMutation.mutate();
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
                  <button className="notification-footer" type="button" onClick={handleOpenNotificationCenter}>
                    查看全部
                  </button>
                </section>
              ) : null}
            </div>
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="avatar-button"
                aria-label="用户菜单"
                aria-expanded={isUserMenuOpen}
                type="button"
                onClick={() => setIsUserMenuOpen((current) => !current)}
              >
                <UserAvatar user={user} />
              </button>
              {isUserMenuOpen ? (
                <section className="user-popover" aria-label="用户菜单">
                  <header className="user-popover-header">
                    <div className="user-popover-avatar">
                      <UserAvatar user={user} size={22} />
                    </div>
                    <div>
                      <strong>{user?.name}</strong>
                      <span>{user?.email}</span>
                    </div>
                  </header>
                  <div className="user-popover-actions">
                    <button type="button" onClick={handleOpenAccountSettings}>
                      <Settings size={16} />
                      <span>设置</span>
                    </button>
                    <button type="button" onClick={() => void handleLogout()}>
                      <LogOut size={16} />
                      <span>退出</span>
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </header>
        {isAccountSettingsOpen ? (
          <div className="modal-backdrop">
            <section className="modal account-settings-modal" aria-label="账号设置">
              <header className="modal-header">
                <h2>账号设置</h2>
                <button
                  className="icon-button modal-close-button"
                  type="button"
                  aria-label="关闭账号设置"
                  title="关闭"
                  onClick={() => setIsAccountSettingsOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="account-settings-content">
                <form className="modal-form" onSubmit={handleUpdateProfile}>
                  <h3>个人资料</h3>
                  <label>
                    名字
                    <input
                      value={profileName}
                      onChange={(event) => {
                        setProfileName(event.target.value);
                        setProfileSaved(false);
                      }}
                      required
                    />
                  </label>
                  <div className="avatar-editor">
                    <div className="avatar-preview" aria-label="当前头像">
                      <UserAvatar
                        user={profileAvatarUrl ? { name: profileName.trim() || "用户", avatarUrl: profileAvatarUrl } : null}
                        size={28}
                      />
                    </div>
                    <div className="avatar-editor-actions">
                      <label className="secondary-inline-button avatar-upload-button">
                        <Upload size={16} aria-hidden="true" />
                        <span>上传头像</span>
                        <input
                          aria-label="上传头像"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleAvatarFileChange}
                        />
                      </label>
                      {profileAvatarUrl ? (
                        <button className="secondary-inline-button" type="button" onClick={handleClearAvatar}>
                          <Trash2 size={16} aria-hidden="true" />
                          <span>恢复默认头像</span>
                        </button>
                      ) : null}
                    </div>
                    <span className="muted">支持 PNG、JPG、WebP 或 GIF，最大 200KB。</span>
                    {profileAvatarError ? <span className="form-error inline-error">{profileAvatarError}</span> : null}
                  </div>
                  <button type="submit" disabled={updateProfileMutation.isPending || !profileName.trim()}>
                    保存资料
                  </button>
                  {profileSaved ? <span className="success-text">资料已保存。</span> : null}
                  <MutationError error={updateProfileMutation.error} />
                </form>
                <form className="modal-form" onSubmit={handleUpdatePassword}>
                  <h3>修改密码</h3>
                  <label>
                    当前密码
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => {
                        setCurrentPassword(event.target.value);
                        setPasswordSaved(false);
                      }}
                      required
                    />
                  </label>
                  <label>
                    新密码
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => {
                        setNewPassword(event.target.value);
                        setPasswordFormError("");
                        setPasswordSaved(false);
                      }}
                      minLength={8}
                      required
                    />
                  </label>
                  <label>
                    确认新密码
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        setPasswordFormError("");
                        setPasswordSaved(false);
                      }}
                      minLength={8}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={updatePasswordMutation.isPending || !currentPassword || !newPassword}
                  >
                    更新密码
                  </button>
                  {passwordFormError ? <span className="error-text">{passwordFormError}</span> : null}
                  {passwordSaved ? <span className="success-text">密码已更新。</span> : null}
                  <MutationError error={updatePasswordMutation.error} />
                </form>
              </div>
            </section>
          </div>
        ) : null}
        {isNotificationCenterOpen ? (
          <div className="modal-backdrop">
            <section className="modal notification-center-modal" aria-label="全部通知">
              <header className="modal-header">
                <div>
                  <h2>全部通知</h2>
                  <span>{unreadCount > 0 ? `${unreadCount} 条未读` : "没有未读通知"}</span>
                </div>
                <button
                  className="icon-button modal-close-button"
                  type="button"
                  aria-label="关闭全部通知"
                  title="关闭"
                  onClick={() => setIsNotificationCenterOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="notification-center-toolbar">
                <select
                  className="compact-select"
                  value={notificationCenterFilter}
                  onChange={(event) =>
                    setNotificationCenterFilter(event.target.value as typeof notificationCenterFilter)
                  }
                >
                  <option value="ALL">全部</option>
                  <option value="UNREAD">未读</option>
                </select>
                <button
                  className="subtle-button"
                  type="button"
                  disabled={unreadCount === 0 || markAllNotificationsReadMutation.isPending}
                  onClick={() => markAllNotificationsReadMutation.mutate()}
                >
                  全部已读
                </button>
              </div>
              <div className="notification-center-list">
                {notificationsQuery.isLoading ? <span className="muted">通知加载中...</span> : null}
                {notificationCenterItems.map((notification) => (
                  <div
                    className={
                      notification.isRead
                        ? "notification-center-row"
                        : "notification-center-row unread"
                    }
                    key={notification.id}
                  >
                    {notification.link ? (
                      <Link
                        className="row-main"
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
                        className="row-main"
                        type="button"
                        onClick={() => handleOpenNotification(notification)}
                      >
                        <strong>{notification.title}</strong>
                        <span>{notification.content}</span>
                        <time dateTime={notification.createdAt}>
                          {formatRelativeTime(notification.createdAt)}
                        </time>
                      </button>
                    )}
                    <button
                      className="mini-button"
                      type="button"
                      disabled={notification.isRead || markNotificationReadMutation.isPending}
                      onClick={() => markNotificationReadMutation.mutate(notification.id)}
                    >
                      已读
                    </button>
                  </div>
                ))}
                {!notificationsQuery.isLoading && notificationCenterItems.length === 0 ? (
                  <span className="muted">
                    {notificationCenterFilter === "UNREAD" ? "暂无未读通知" : "暂无通知"}
                  </span>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
