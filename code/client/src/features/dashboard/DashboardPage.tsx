import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { projectApi, teamApi, userApi } from "../../lib/api";
import { getPriorityClassName, getPriorityLabel } from "../../lib/priority";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"OPEN" | "DONE" | "ALL">("OPEN");

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: teamApi.list
  });

  const teams = teamsQuery.data ?? [];
  const activeTeamId = selectedTeamId ?? teams[0]?.id ?? null;

  const projectsQuery = useQuery({
    queryKey: ["projects", activeTeamId],
    queryFn: () => projectApi.list(activeTeamId!),
    enabled: Boolean(activeTeamId)
  });

  const myTasksQuery = useQuery({
    queryKey: ["my-tasks"],
    queryFn: userApi.myTasks
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: userApi.notifications
  });

  const activeTeam = useMemo(
    () => teams.find((team) => team.id === activeTeamId) ?? null,
    [activeTeamId, teams]
  );
  const canCreateProject = activeTeam?.role === "OWNER";
  const canManageActiveTeamProjects = activeTeam?.role === "OWNER" || activeTeam?.role === "ADMIN";

  const filteredMyTasks = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();

    return (myTasksQuery.data ?? []).filter((task) => {
      const matchesStatus =
        taskStatusFilter === "ALL" ||
        (taskStatusFilter === "OPEN" && !task.completedAt) ||
        (taskStatusFilter === "DONE" && Boolean(task.completedAt));
      const matchesKeyword =
        !keyword ||
        task.title.toLowerCase().includes(keyword) ||
        task.project.name.toLowerCase().includes(keyword) ||
        task.taskList.name.toLowerCase().includes(keyword);

      return matchesStatus && matchesKeyword;
    });
  }, [myTasksQuery.data, taskSearch, taskStatusFilter]);

  const createTeamMutation = useMutation({
    mutationFn: teamApi.create,
    onSuccess: (team) => {
      setTeamName("");
      setSelectedTeamId(team.id);
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: (name: string) => projectApi.create(activeTeamId!, { name }),
    onSuccess: () => {
      setProjectName("");
      void queryClient.invalidateQueries({ queryKey: ["projects", activeTeamId] });
    }
  });

  const markAllNotificationsReadMutation = useMutation({
    mutationFn: userApi.markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  const markNotificationReadMutation = useMutation({
    mutationFn: userApi.markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  function handleCreateTeam(event: FormEvent) {
    event.preventDefault();
    createTeamMutation.mutate({ name: teamName });
  }

  function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (activeTeamId && canCreateProject) {
      createProjectMutation.mutate(projectName);
    }
  }

  function handleNotificationLinkClick(notification: { id: string; isRead: boolean }) {
    if (!notification.isRead) {
      markNotificationReadMutation.mutate(notification.id);
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>工作台</h1>
        <p>先创建团队和项目，再进入看板管理任务。</p>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h2>团队</h2>
          <form className="compact-form" onSubmit={handleCreateTeam}>
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              placeholder="新团队名称"
              required
            />
            <button type="submit" disabled={createTeamMutation.isPending}>
              创建
            </button>
          </form>
          <MutationError error={createTeamMutation.error} />
          <div className="list">
            {teamsQuery.isLoading ? <span className="muted">团队加载中...</span> : null}
            {teams.map((team) => (
              <div className={team.id === activeTeamId ? "list-row selected" : "list-row"} key={team.id}>
                <button className="row-main" type="button" onClick={() => setSelectedTeamId(team.id)}>
                  <strong>{team.name}</strong>
                  <span>{team.role}</span>
                </button>
                {team.role === "OWNER" ? (
                  <Link className="mini-link" to={`/teams/${team.id}/settings`}>
                    设置
                  </Link>
                ) : null}
              </div>
            ))}
            {!teamsQuery.isLoading && teams.length === 0 ? (
              <span className="muted">还没有团队</span>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <h2>{activeTeam ? `${activeTeam.name} 的项目` : "项目"}</h2>
          {canCreateProject ? (
            <form className="compact-form" onSubmit={handleCreateProject}>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="新项目名称"
                disabled={!activeTeamId}
                required
              />
              <button type="submit" disabled={!activeTeamId || createProjectMutation.isPending}>
                创建
              </button>
            </form>
          ) : null}
          <MutationError error={createProjectMutation.error} />
          <div className="list">
            {projectsQuery.isLoading ? <span className="muted">项目加载中...</span> : null}
            {(projectsQuery.data ?? []).map((project) => (
              <div className="list-row" key={project.id}>
                <Link className="row-main" to={`/projects/${project.id}/board`}>
                  <strong>{project.name}</strong>
                  <span>{project.status}</span>
                </Link>
                <div className="row-actions">
                  <Link className="mini-link" to={`/projects/${project.id}/board`}>
                    看板
                  </Link>
                  {canManageActiveTeamProjects || project.role === "OWNER" ? (
                    <Link className="mini-link" to={`/projects/${project.id}/settings`}>
                      设置
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
            {activeTeamId && !projectsQuery.isLoading && (projectsQuery.data ?? []).length === 0 ? (
              <span className="muted">这个团队还没有项目</span>
            ) : null}
          </div>
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="panel dashboard-scroll-panel">
          <div className="panel-title-row">
            <h2>我的任务</h2>
            <select
              className="compact-select"
              value={taskStatusFilter}
              onChange={(event) => setTaskStatusFilter(event.target.value as typeof taskStatusFilter)}
            >
              <option value="OPEN">未完成</option>
              <option value="DONE">已完成</option>
              <option value="ALL">全部</option>
            </select>
          </div>
          <input
            className="filter-input"
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="搜索任务、项目或列表"
          />
          <div className="list dashboard-scroll-list">
            {myTasksQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
            {filteredMyTasks.map((task) => (
              <Link
                className="list-row"
                key={task.id}
                to={`/tasks/${task.id}`}
                state={{ returnTo: location.pathname }}
              >
                <div className="row-main">
                  <strong>{task.title}</strong>
                  <span>
                    {task.parentId ? "子任务 / " : ""}
                    {task.project.name} / {task.taskList.name}
                  </span>
                </div>
                <span className={getPriorityClassName(task.priority)}>
                  {getPriorityLabel(task.priority)}
                </span>
                <span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "无截止"}</span>
              </Link>
            ))}
            {!myTasksQuery.isLoading && filteredMyTasks.length === 0 ? (
              <span className="muted">没有匹配的任务</span>
            ) : null}
          </div>
        </section>

        <section className="panel dashboard-scroll-panel">
          <div className="panel-title-row">
            <h2>通知</h2>
            <button
              className="subtle-button"
              type="button"
              onClick={() => markAllNotificationsReadMutation.mutate()}
              disabled={markAllNotificationsReadMutation.isPending}
            >
              全部已读
            </button>
          </div>
          <div className="list dashboard-scroll-list">
            {notificationsQuery.isLoading ? <span className="muted">通知加载中...</span> : null}
            {(notificationsQuery.data ?? []).map((notification) => (
              <div className={notification.isRead ? "list-row" : "list-row unread"} key={notification.id}>
                {notification.link ? (
                  <Link
                    className="row-main"
                    to={notification.link}
                    state={{ returnTo: location.pathname }}
                    onClick={() => handleNotificationLinkClick(notification)}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.content}</span>
                  </Link>
                ) : (
                  <div className="row-main">
                    <strong>{notification.title}</strong>
                    <span>{notification.content}</span>
                  </div>
                )}
                <button
                  className="mini-button"
                  type="button"
                  onClick={() => markNotificationReadMutation.mutate(notification.id)}
                  disabled={notification.isRead || markNotificationReadMutation.isPending}
                >
                  已读
                </button>
              </div>
            ))}
            {!notificationsQuery.isLoading && (notificationsQuery.data ?? []).length === 0 ? (
              <span className="muted">暂无通知</span>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
