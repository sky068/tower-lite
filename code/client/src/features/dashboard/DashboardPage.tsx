import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { projectApi, teamApi, userApi } from "../../lib/api";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

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
    if (activeTeamId) {
      createProjectMutation.mutate(projectName);
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
                <Link className="mini-link" to={`/teams/${team.id}/settings`}>
                  设置
                </Link>
              </div>
            ))}
            {!teamsQuery.isLoading && teams.length === 0 ? (
              <span className="muted">还没有团队</span>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <h2>{activeTeam ? `${activeTeam.name} 的项目` : "项目"}</h2>
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
          <MutationError error={createProjectMutation.error} />
          <div className="list">
            {projectsQuery.isLoading ? <span className="muted">项目加载中...</span> : null}
            {(projectsQuery.data ?? []).map((project) => (
              <div className="list-row" key={project.id}>
                <Link className="row-main" to={`/projects/${project.id}/board`}>
                  <strong>{project.name}</strong>
                  <span>{project.status}</span>
                </Link>
                <Link className="mini-link" to={`/projects/${project.id}/settings`}>
                  设置
                </Link>
              </div>
            ))}
            {activeTeamId && !projectsQuery.isLoading && (projectsQuery.data ?? []).length === 0 ? (
              <span className="muted">这个团队还没有项目</span>
            ) : null}
          </div>
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h2>我的任务</h2>
          <div className="list">
            {myTasksQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
            {(myTasksQuery.data ?? []).map((task) => (
              <Link className="list-row" key={task.id} to={`/tasks/${task.id}`}>
                <strong>{task.title}</strong>
                <span>{task.project.name} / {task.taskList.name}</span>
              </Link>
            ))}
            {!myTasksQuery.isLoading && (myTasksQuery.data ?? []).length === 0 ? (
              <span className="muted">暂无分配给你的任务</span>
            ) : null}
          </div>
        </section>

        <section className="panel">
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
          <div className="list">
            {notificationsQuery.isLoading ? <span className="muted">通知加载中...</span> : null}
            {(notificationsQuery.data ?? []).map((notification) => (
              <div className={notification.isRead ? "list-row" : "list-row unread"} key={notification.id}>
                {notification.link ? (
                  <Link className="row-main" to={notification.link}>
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
