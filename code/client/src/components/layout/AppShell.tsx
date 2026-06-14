import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, Copy, FolderKanban, ListChecks, LogOut, Plus, Settings, Trash2, Unlink, Upload, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FormEvent, type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { MutationError } from "../shared/MutationError";
import { Select } from "../shared/Select";
import { UserAvatar } from "../shared/UserAvatar";
import { UserSelect } from "../shared/UserSelect";
import { authApi, projectApi, teamApi, userApi } from "../../lib/api";
import { formatRelativeTime } from "../../lib/dateTime";
import { getMemberUser } from "../../lib/members";
import { useRealtimeEvents } from "../../lib/realtime";
import { useAuthStore } from "../../stores/authStore";
import type { Notification, Project } from "../../types/api";

const realtimeStatusLabels = {
  idle: "实时连接未启动",
  connecting: "实时连接中",
  connected: "实时连接正常",
  reconnecting: "实时连接重连中"
};

const maxAvatarFileSize = 200 * 1024;
const allowedAvatarMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function AppShell() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, refreshToken, clearSession, updateUser } = useAuthStore();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [creatingProjectTeamId, setCreatingProjectTeamId] = useState<string | null>(null);
  const [notificationCenterFilter, setNotificationCenterFilter] = useState<"ALL" | "UNREAD">("ALL");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamAdminEmail, setNewTeamAdminEmail] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectAdminMemberId, setNewProjectAdminMemberId] = useState("");
  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [profileEmail, setProfileEmail] = useState(user?.email ?? "");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordFormError, setPasswordFormError] = useState("");
  const [accountSettingsSaved, setAccountSettingsSaved] = useState(false);
  const [emailActionMessage, setEmailActionMessage] = useState("");
  const [devEmailVerificationPath, setDevEmailVerificationPath] = useState<string | null>(null);
  const [emailCopyState, setEmailCopyState] = useState<"idle" | "copied">("idle");
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const realtimeStatus = useRealtimeEvents();
  const isSystemAdmin = user?.systemRole === "ADMIN";
  const userHasPassword = user?.hasPassword ?? true;
  const isFeishuBound = Boolean(user && "feishuBound" in user && user.feishuBound);

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
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: teamApi.list,
    enabled: Boolean(user)
  });
  const teams = teamsQuery.data ?? [];
  const projectQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: ["projects", team.id],
      queryFn: () => projectApi.list(team.id),
      enabled: Boolean(user)
    }))
  });
  const projectsByTeamId = useMemo(() => {
    const next = new Map<string, Project[]>();

    teams.forEach((team, index) => {
      next.set(team.id, projectQueries[index]?.data ?? []);
    });

    return next;
  }, [projectQueries, teams]);
  const isProjectsLoading = projectQueries.some((query) => query.isLoading);
  const totalProjectCount = useMemo(
    () => Array.from(projectsByTeamId.values()).reduce((count, projects) => count + projects.length, 0),
    [projectsByTeamId]
  );
  const creatingProjectTeam = useMemo(
    () => teams.find((team) => team.id === creatingProjectTeamId) ?? null,
    [creatingProjectTeamId, teams]
  );
  const canCreateProjectForCurrentTeam = Boolean(
    creatingProjectTeam && (isSystemAdmin || creatingProjectTeam.role === "ADMIN")
  );
  const projectAdminCandidatesQuery = useQuery({
    queryKey: ["team-members", creatingProjectTeamId],
    queryFn: () => teamApi.members(creatingProjectTeamId!),
    enabled: Boolean(creatingProjectTeamId && canCreateProjectForCurrentTeam)
  });

  const createTeamMutation = useMutation({
    mutationFn: () =>
      teamApi.create({
        name: newTeamName.trim(),
        adminEmail: newTeamAdminEmail.trim()
      }),
    onSuccess: (team) => {
      setNewTeamName("");
      setNewTeamAdminEmail("");
      setIsCreatingTeam(false);
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      navigate(`/teams/${team.id}`);
    }
  });
  const createProjectMutation = useMutation({
    mutationFn: () =>
      projectApi.create(creatingProjectTeamId!, {
        name: newProjectName.trim(),
        projectAdminTeamMemberId: newProjectAdminMemberId || undefined
      }),
    onSuccess: (project) => {
      const teamId = creatingProjectTeamId;
      setCreatingProjectTeamId(null);
      setNewProjectName("");
      setNewProjectAdminMemberId("");
      if (teamId) {
        void queryClient.invalidateQueries({ queryKey: ["projects", teamId] });
      }
      navigate(`/projects/${project.id}/board`);
    }
  });

  const updateProfileMutation = useMutation({
    mutationFn: () =>
      userApi.updateProfile({
        name: profileName.trim(),
        avatarUrl: profileAvatarUrl.trim() || null
      }),
    onSuccess: (updatedUser) => {
      try {
        updateUser(updatedUser);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      } catch {
        // The profile is saved on the server; a local cache write failure should not turn it into a failed save.
      }
    },
    onError: () => setAccountSettingsSaved(false)
  });

  const updateEmailMutation = useMutation({
    mutationFn: () =>
      userApi.updateEmail({
        email: profileEmail.trim()
      }),
    onSuccess: (result) => {
      setEmailActionMessage(result.verificationQueued ? "验证邮件已生成，请前往邮箱确认。" : "邮箱已验证。");
      setDevEmailVerificationPath(result.devVerificationPath ?? null);
      setEmailCopyState("idle");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => setAccountSettingsSaved(false)
  });

  const sendEmailVerificationMutation = useMutation({
    mutationFn: authApi.sendEmailVerification,
    onSuccess: (result) => {
      setEmailActionMessage(result.alreadyVerified ? "邮箱已验证。" : "验证邮件已生成，请前往邮箱确认。");
      setDevEmailVerificationPath(result.devVerificationPath ?? null);
      setEmailCopyState("idle");
    }
  });

  const updatePasswordMutation = useMutation({
    mutationFn: () =>
      userApi.updatePassword({
        currentPassword: currentPassword || undefined,
        newPassword
      }),
    onSuccess: () => {
      if (user) {
        updateUser({ ...user, hasPassword: true });
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFormError("");
    },
    onError: () => setAccountSettingsSaved(false)
  });

  const unbindFeishuMutation = useMutation({
    mutationFn: userApi.unbindFeishu,
    onSuccess: () => {
      void handleLogout();
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
    setProfileEmail(user?.email ?? "");
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
    setProfileEmail(user?.email ?? "");
    setProfileAvatarUrl(user?.avatarUrl ?? "");
    setProfileAvatarError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordFormError("");
    setAccountSettingsSaved(false);
    setEmailActionMessage("");
    setDevEmailVerificationPath(null);
    setEmailCopyState("idle");
  }

  function handleCreateTeam(event: FormEvent) {
    event.preventDefault();

    if (isSystemAdmin && newTeamName.trim() && newTeamAdminEmail.trim()) {
      createTeamMutation.mutate();
    }
  }

  function handleCreateProject(event: FormEvent) {
    event.preventDefault();

    if (
      creatingProjectTeamId &&
      canCreateProjectForCurrentTeam &&
      newProjectName.trim() &&
      (!isSystemAdmin || newProjectAdminMemberId)
    ) {
      createProjectMutation.mutate();
    }
  }

  function handleCancelCreateProject() {
    setCreatingProjectTeamId(null);
    setNewProjectName("");
    setNewProjectAdminMemberId("");
  }

  async function handleSaveAccountSettings(event: FormEvent) {
    event.preventDefault();

    const hasPasswordInput = Boolean(currentPassword || newPassword || confirmPassword);

    if (hasPasswordInput && (!newPassword || !confirmPassword || (userHasPassword && !currentPassword))) {
      setPasswordFormError(userHasPassword ? "如需修改密码，请完整填写当前密码、新密码和确认新密码。" : "如需设置密码，请填写新密码和确认新密码。");
      return;
    }

    if (hasPasswordInput && newPassword !== confirmPassword) {
      setPasswordFormError("两次输入的新密码不一致。");
      return;
    }

    if (!profileName.trim() || !profileEmail.trim() || profileAvatarError) {
      return;
    }

    const normalizedAvatarUrl = profileAvatarUrl.trim() || null;
    const profileChanged =
      profileName.trim() !== (user?.name ?? "") || normalizedAvatarUrl !== (user?.avatarUrl ?? null);
    const emailChanged = profileEmail.trim().toLowerCase() !== (user?.email ?? "").toLowerCase();

    setPasswordFormError("");
    setAccountSettingsSaved(false);

    try {
      if (profileChanged) {
        await updateProfileMutation.mutateAsync();
      }

      if (emailChanged) {
        await updateEmailMutation.mutateAsync();
      }

      if (hasPasswordInput) {
        await updatePasswordMutation.mutateAsync();
      }

      setAccountSettingsSaved(true);
    } catch {
      setAccountSettingsSaved(false);
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
        setAccountSettingsSaved(false);
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
    setAccountSettingsSaved(false);
  }

  async function handleCopyDevEmailVerificationLink() {
    if (!devEmailVerificationPath) {
      return;
    }

    await navigator.clipboard.writeText(`${window.location.origin}${devEmailVerificationPath}`);
    setEmailCopyState("copied");
    window.setTimeout(() => setEmailCopyState("idle"), 1600);
  }

  function handleUnbindFeishu() {
    if (!isFeishuBound || unbindFeishuMutation.isPending) {
      return;
    }

    if (!userHasPassword) {
      setPasswordFormError("解除绑定飞书前请先设置登录密码。");
      return;
    }

    if (window.confirm("确认解除绑定飞书？解除后会退出登录，后续需要使用邮箱和密码登录。")) {
      unbindFeishuMutation.mutate();
    }
  }

  const normalizedProfileAvatarUrl = profileAvatarUrl.trim() || null;
  const profileChanged =
    profileName.trim() !== (user?.name ?? "") || normalizedProfileAvatarUrl !== (user?.avatarUrl ?? null);
  const emailChanged = profileEmail.trim().toLowerCase() !== (user?.email ?? "").toLowerCase();
  const passwordChanged = Boolean(currentPassword || newPassword || confirmPassword);
  const accountSettingsDirty = profileChanged || emailChanged || passwordChanged;
  const isEmailVerified = Boolean(user?.emailVerifiedAt);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Tower Lite</div>
        <nav className="nav-list">
          <NavLink to="/dashboard" className="nav-item">
            <ListChecks size={18} />
            <span>工作台</span>
          </NavLink>
          <section className="nav-section" aria-label="团队">
            <header className="nav-section-header">
              <span>团队</span>
              {isSystemAdmin ? (
                <button
                  className="nav-section-action"
                  type="button"
                  aria-label="创建团队"
                  title="创建团队"
                  onClick={() => setIsCreatingTeam((current) => !current)}
                >
                  <Plus size={14} />
                </button>
              ) : null}
            </header>
            {isCreatingTeam && isSystemAdmin ? (
              <form className="sidebar-create-form" onSubmit={handleCreateTeam}>
                <input
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  placeholder="团队名称"
                  required
                />
                <input
                  value={newTeamAdminEmail}
                  onChange={(event) => setNewTeamAdminEmail(event.target.value)}
                  placeholder="管理员邮箱"
                  type="email"
                  required
                />
                <div className="sidebar-create-actions">
                  <button className="sidebar-confirm-button" type="submit" disabled={createTeamMutation.isPending}>
                    确定
                  </button>
                  <button
                    className="sidebar-cancel-button"
                    type="button"
                    disabled={createTeamMutation.isPending}
                    onClick={() => {
                      setNewTeamName("");
                      setNewTeamAdminEmail("");
                      setIsCreatingTeam(false);
                    }}
                  >
                    取消
                  </button>
                </div>
                <MutationError error={createTeamMutation.error} />
              </form>
            ) : null}
            <div className="nav-sub-list">
              {teamsQuery.isLoading ? <span className="nav-empty">团队加载中...</span> : null}
              {teams.map((team) => (
                <NavLink
                  key={team.id}
                  to={`/teams/${team.id}`}
                  className={({ isActive }) =>
                    isActive || location.pathname.startsWith(`/teams/${team.id}/`)
                      ? "nav-sub-item active"
                      : "nav-sub-item"
                  }
                >
                  <Building2 size={15} />
                  <span>{team.name}</span>
                </NavLink>
              ))}
              {!teamsQuery.isLoading && teams.length === 0 ? <span className="nav-empty">暂无团队</span> : null}
            </div>
          </section>
          <section className="nav-section" aria-label="项目">
            <header className="nav-section-header">
              <span>项目</span>
            </header>
            <div className="nav-project-groups">
              {teams.map((team) => {
                const projects = projectsByTeamId.get(team.id) ?? [];
                const canCreateProject = isSystemAdmin || team.role === "ADMIN";

                if (projects.length === 0 && !canCreateProject) {
                  return null;
                }

                return (
                  <div className="nav-project-group" key={team.id}>
                    <div className="nav-project-group-header">
                      <span className="nav-project-team-name">{team.name}</span>
                      {canCreateProject ? (
                        <button
                          className="nav-section-action"
                          type="button"
                          aria-label={`在${team.name}创建项目`}
                          title="创建项目"
                          onClick={() => {
                            setCreatingProjectTeamId((current) => (current === team.id ? null : team.id));
                            setNewProjectName("");
                            setNewProjectAdminMemberId("");
                          }}
                        >
                          <Plus size={14} />
                        </button>
                      ) : null}
                    </div>
                    {creatingProjectTeamId === team.id && canCreateProject ? (
                      <form className="sidebar-create-form" onSubmit={handleCreateProject}>
                        <input
                          value={newProjectName}
                          onChange={(event) => setNewProjectName(event.target.value)}
                          placeholder="项目名称"
                          required
                        />
                        <UserSelect
                          value={newProjectAdminMemberId}
                          onChange={setNewProjectAdminMemberId}
                          disabled={projectAdminCandidatesQuery.isLoading}
                          placeholder={isSystemAdmin ? "选择项目管理员" : "默认自己为项目管理员"}
                          users={(projectAdminCandidatesQuery.data ?? []).map((member) => ({
                            ...getMemberUser(member),
                            id: member.id
                          }))}
                        />
                        <div className="sidebar-create-actions">
                          <button
                            className="sidebar-confirm-button"
                            type="submit"
                            disabled={createProjectMutation.isPending || (isSystemAdmin && !newProjectAdminMemberId)}
                          >
                            确定
                          </button>
                          <button
                            className="sidebar-cancel-button"
                            type="button"
                            disabled={createProjectMutation.isPending}
                            onClick={handleCancelCreateProject}
                          >
                            取消
                          </button>
                        </div>
                        <MutationError error={createProjectMutation.error} />
                      </form>
                    ) : null}
                    {projects.map((project) => (
                      <NavLink
                        key={project.id}
                        to={`/projects/${project.id}/board`}
                        className={() =>
                          location.pathname.startsWith(`/projects/${project.id}/`)
                            ? "nav-sub-item project active"
                            : "nav-sub-item project"
                        }
                      >
                        <FolderKanban size={15} />
                        <span>{project.name}</span>
                      </NavLink>
                    ))}
                  </div>
                );
              })}
              {!teamsQuery.isLoading && !isProjectsLoading && totalProjectCount === 0 ? (
                <span className="nav-empty">暂无项目</span>
              ) : null}
            </div>
          </section>
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
                <UserAvatar user={user} size="lg" />
              </button>
              {isUserMenuOpen ? (
                <section className="user-popover" aria-label="用户菜单">
                  <header className="user-popover-header">
                    <div className="user-popover-avatar">
                      <UserAvatar user={user} size="lg" />
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
              <form className="modal-form account-settings-content" onSubmit={handleSaveAccountSettings}>
                <section className="account-settings-section account-settings-profile">
                  <h3>个人资料</h3>
                  <div className="avatar-editor compact">
                    <div className="avatar-preview" aria-label="当前头像">
                      <UserAvatar
                        user={
                          profileAvatarUrl
                            ? { name: profileName.trim() || "用户", avatarUrl: profileAvatarUrl }
                            : null
                        }
                        size="xl"
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
                </section>
                <section className="account-settings-section">
                  <h3>账号信息</h3>
                  <label>
                    名字
                    <input
                      value={profileName}
                      onChange={(event) => {
                        setProfileName(event.target.value);
                        setAccountSettingsSaved(false);
                      }}
                      required
                    />
                  </label>
                  <label>
                    邮箱
                    <input
                      type="email"
                      value={profileEmail}
                      onChange={(event) => {
                        setProfileEmail(event.target.value);
                        setAccountSettingsSaved(false);
                        setEmailActionMessage("");
                        setDevEmailVerificationPath(null);
                        setEmailCopyState("idle");
                      }}
                      required
                    />
                  </label>
                  <div className="account-email-status">
                    <span className={isEmailVerified ? "success-text" : "muted"}>
                      {isEmailVerified ? "邮箱已验证" : "邮箱未验证"}
                    </span>
                    {!isEmailVerified && !emailChanged ? (
                      <button
                        className="subtle-button"
                        type="button"
                        disabled={sendEmailVerificationMutation.isPending}
                        onClick={() => sendEmailVerificationMutation.mutate()}
                      >
                        {sendEmailVerificationMutation.isPending ? "生成中..." : "生成验证链接"}
                      </button>
                    ) : null}
                  </div>
                  <span className="muted">飞书未返回邮箱时会先使用临时邮箱，修改邮箱后需要通过验证链接确认。</span>
                  {emailActionMessage ? <span className="success-text">{emailActionMessage}</span> : null}
                  {devEmailVerificationPath ? (
                    <div className="account-email-link">
                      <input
                        value={`${window.location.origin}${devEmailVerificationPath}`}
                        readOnly
                        aria-label="开发环境邮箱验证链接"
                      />
                      <button type="button" onClick={() => void handleCopyDevEmailVerificationLink()}>
                        <Copy size={14} aria-hidden="true" />
                        <span>{emailCopyState === "copied" ? "已复制" : "复制"}</span>
                      </button>
                    </div>
                  ) : null}
                </section>
                <section className="account-settings-section account-settings-password">
                  <h3>{userHasPassword ? "修改密码" : "设置登录密码"}</h3>
                  {userHasPassword ? (
                    <label>
                      当前密码
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(event) => {
                          setCurrentPassword(event.target.value);
                          setPasswordFormError("");
                          setAccountSettingsSaved(false);
                        }}
                      />
                    </label>
                  ) : null}
                  <label>
                    新密码
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => {
                        setNewPassword(event.target.value);
                        setPasswordFormError("");
                        setAccountSettingsSaved(false);
                      }}
                      minLength={8}
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
                        setAccountSettingsSaved(false);
                      }}
                      minLength={8}
                    />
                  </label>
                  <span className="muted">
                    {userHasPassword ? "不修改密码时保持为空即可。" : "设置密码后可使用邮箱密码登录。"}
                  </span>
                </section>
                <section className="account-settings-section account-settings-feishu">
                  <h3>飞书绑定</h3>
                  {isFeishuBound ? (
                    <>
                      <span className="muted">当前账号已绑定飞书。</span>
                      <button
                        className="danger-inline-button"
                        type="button"
                        disabled={unbindFeishuMutation.isPending}
                        onClick={handleUnbindFeishu}
                      >
                        <Unlink size={16} aria-hidden="true" />
                        <span>{unbindFeishuMutation.isPending ? "解除中..." : "解除绑定飞书"}</span>
                      </button>
                    </>
                  ) : (
                    <span className="muted">当前账号未绑定飞书。</span>
                  )}
                </section>
                <footer className="account-settings-footer">
                  <div className="account-settings-status">
                    {passwordFormError ? <span className="error-text">{passwordFormError}</span> : null}
                    {accountSettingsSaved ? <span className="success-text">设置已保存。</span> : null}
                    <MutationError
                      error={
                        updateProfileMutation.error ??
                        updateEmailMutation.error ??
                        updatePasswordMutation.error ??
                        sendEmailVerificationMutation.error ??
                        unbindFeishuMutation.error
                      }
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={
                      updateProfileMutation.isPending ||
                      updateEmailMutation.isPending ||
                      updatePasswordMutation.isPending ||
                      sendEmailVerificationMutation.isPending ||
                      unbindFeishuMutation.isPending ||
                      !accountSettingsDirty ||
                      !profileName.trim() ||
                      !profileEmail.trim() ||
                      Boolean(profileAvatarError)
                    }
                  >
                    保存设置
                  </button>
                </footer>
              </form>
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
                <Select
                  className="compact-select"
                  ariaLabel="通知筛选"
                  value={notificationCenterFilter}
                  onChange={(value) => setNotificationCenterFilter(value as typeof notificationCenterFilter)}
                  options={[
                    { value: "ALL", label: "全部" },
                    { value: "UNREAD", label: "未读" }
                  ]}
                />
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
