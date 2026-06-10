import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { projectApi, teamApi, userApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getPriorityClassName, getPriorityLabel } from "../../lib/priority";
import type { MyTask } from "../../types/api";

type MyTaskTreeNode = {
  key: string;
  task: MyTask;
  children: MyTask[];
};

const taskStatusTabs = [
  { value: "OPEN", label: "未完成" },
  { value: "DONE", label: "已完成" },
  { value: "ALL", label: "全部" }
] as const;

const defaultTeamStorageKey = "tower.dashboard.defaultTeamId";
const defaultProjectStorageKey = "tower.dashboard.defaultProjects";

function readStoredDefaultTeamId() {
  return localStorage.getItem(defaultTeamStorageKey);
}

function readStoredDefaultProjects() {
  try {
    return JSON.parse(localStorage.getItem(defaultProjectStorageKey) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStoredDefaultProject(teamId: string, projectId: string) {
  const nextDefaults = {
    ...readStoredDefaultProjects(),
    [teamId]: projectId
  };
  localStorage.setItem(defaultProjectStorageKey, JSON.stringify(nextDefaults));
  return nextDefaults;
}

function formatCompletedByName(completedBy: MyTask["completedBy"]) {
  if (!completedBy) {
    return "未知成员";
  }

  return completedBy.isRemoved ? `${completedBy.name}(已移除)` : completedBy.name;
}

function formatDeletedBy(user: { name: string; email: string } | null) {
  return user ? `${user.name} / ${user.email}` : "未知成员";
}

function MyTaskLink({
  task,
  depth,
  backgroundLocation,
  returnTo,
  isContextOnly = false
}: {
  task: MyTask;
  depth: 0 | 1;
  backgroundLocation: ReturnType<typeof useLocation>;
  returnTo: string;
  isContextOnly?: boolean;
}) {
  const className = [
    "list-row",
    "task-tree-row",
    depth === 1 ? "child" : null,
    isContextOnly ? "context" : null
  ].filter(Boolean).join(" ");
  const completionText = task.completedAt
    ? `${formatCompletedByName(task.completedBy)} ${formatCalendarDate(task.completedAt)}完成`
    : null;

  return (
    <Link
      className={className}
      to={`/tasks/${task.id}`}
      state={{ backgroundLocation, returnTo }}
    >
      <div className="row-main">
        <strong>{task.title}</strong>
        <span>
          {isContextOnly ? "父任务 / " : ""}
          {depth === 1 ? `子任务 / ${task.parentTask?.title ?? "父任务"} / ` : ""}
          {task.project.name} / {task.taskList.name}
        </span>
      </div>
      {completionText ? <span className="task-completion-meta">{completionText}</span> : null}
      <span className={getPriorityClassName(task.priority)}>
        {getPriorityLabel(task.priority)}
      </span>
      <span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "无截止"}</span>
    </Link>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => readStoredDefaultTeamId());
  const [defaultProjects, setDefaultProjects] = useState<Record<string, string>>(() => readStoredDefaultProjects());
  const [taskSearch, setTaskSearch] = useState("");
  const [taskProjectFilter, setTaskProjectFilter] = useState("ALL");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"OPEN" | "DONE" | "ALL">("OPEN");
  const [isProjectTrashOpen, setIsProjectTrashOpen] = useState(false);

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: teamApi.list
  });

  const teams = teamsQuery.data ?? [];
  const activeTeamId =
    teams.length === 0
      ? null
      : selectedTeamId && teams.some((team) => team.id === selectedTeamId)
        ? selectedTeamId
        : teams[0].id;

  const projectsQuery = useQuery({
    queryKey: ["projects", activeTeamId],
    queryFn: () => projectApi.list(activeTeamId!),
    enabled: Boolean(activeTeamId)
  });

  const myTasksQuery = useQuery({
    queryKey: ["my-tasks"],
    queryFn: userApi.myTasks
  });

  const activeTeam = useMemo(
    () => teams.find((team) => team.id === activeTeamId) ?? null,
    [activeTeamId, teams]
  );
  const projects = projectsQuery.data ?? [];
  const defaultProjectId = activeTeamId ? defaultProjects[activeTeamId] ?? projects[0]?.id ?? null : null;
  const canCreateProject = activeTeam?.role === "OWNER";
  const canManageActiveTeamProjects = activeTeam?.role === "OWNER" || activeTeam?.role === "ADMIN";
  const projectTrashQuery = useQuery({
    queryKey: ["team-project-trash", activeTeamId],
    queryFn: () => projectApi.trash(activeTeamId!),
    enabled: Boolean(activeTeamId && canManageActiveTeamProjects && isProjectTrashOpen)
  });
  const myTaskProjects = useMemo(() => {
    const projects = new Map<string, string>();

    for (const task of myTasksQuery.data ?? []) {
      if (task.isAssignedToMe) {
        projects.set(task.project.id, task.project.name);
      }
    }

    return Array.from(projects, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-CN")
    );
  }, [myTasksQuery.data]);

  const myTaskDisplay = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();
    const tasks = myTasksQuery.data ?? [];
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const visibleAssignedTaskIds = new Set<string>();

    function matchesTreeStatus(task: MyTask) {
      const parentTask = task.parentId ? taskMap.get(task.parentId) : null;
      const isCompletedBySelfOrParent = Boolean(task.completedAt || parentTask?.completedAt);

      return (
        taskStatusFilter === "ALL" ||
        (taskStatusFilter === "OPEN" && !isCompletedBySelfOrParent) ||
        (taskStatusFilter === "DONE" && isCompletedBySelfOrParent)
      );
    }

    const visibleAssignedTasks = tasks.filter((task) => {
      const matchesKeyword =
        !keyword ||
        task.title.toLowerCase().includes(keyword) ||
        task.parentTask?.title.toLowerCase().includes(keyword) ||
        task.project.name.toLowerCase().includes(keyword) ||
        task.taskList.name.toLowerCase().includes(keyword);
      const matchesProject = taskProjectFilter === "ALL" || task.project.id === taskProjectFilter;

      return task.isAssignedToMe && matchesTreeStatus(task) && matchesKeyword && matchesProject;
    });

    for (const task of visibleAssignedTasks) {
      visibleAssignedTaskIds.add(task.id);
    }

    const visibleContextParentIds = new Set(
      visibleAssignedTasks
        .map((task) => task.parentId)
        .filter((parentId): parentId is string => Boolean(parentId))
        .filter((parentId) => !visibleAssignedTaskIds.has(parentId))
    );

    return {
      tasks: tasks.filter(
        (task) => visibleAssignedTaskIds.has(task.id) || visibleContextParentIds.has(task.id)
      ),
      visibleAssignedTasks
    };
  }, [myTasksQuery.data, taskProjectFilter, taskSearch, taskStatusFilter]);

  const myTaskTree = useMemo(() => {
    const taskMap = new Map(myTaskDisplay.tasks.map((task) => [task.id, task]));

    const nodes: MyTaskTreeNode[] = [];

    for (const task of myTaskDisplay.visibleAssignedTasks) {
      if (task.parentId) {
        const parentTask = taskMap.get(task.parentId);

        if (parentTask) {
          nodes.push({
            key: `${parentTask.id}:${task.id}`,
            task: parentTask,
            children: [task]
          });
          continue;
        }
      }

      nodes.push({
        key: task.id,
        task,
        children: []
      });
    }

    return nodes;
  }, [myTaskDisplay]);
  const createTeamMutation = useMutation({
    mutationFn: teamApi.create,
    onSuccess: (team) => {
      setTeamName("");
      selectTeam(team.id);
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: (name: string) => projectApi.create(activeTeamId!, { name }),
    onSuccess: (project) => {
      setProjectName("");
      if (activeTeamId) {
        setDefaultProjects(writeStoredDefaultProject(activeTeamId, project.id));
      }
      void queryClient.invalidateQueries({ queryKey: ["projects", activeTeamId] });
    }
  });

  const restoreProjectMutation = useMutation({
    mutationFn: (projectId: string) => projectApi.restoreFromTrash(activeTeamId!, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-project-trash", activeTeamId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", activeTeamId] });
    }
  });

  const purgeProjectMutation = useMutation({
    mutationFn: (projectId: string) => projectApi.purgeFromTrash(activeTeamId!, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team-project-trash", activeTeamId] });
    }
  });

  function handleCreateTeam(event: FormEvent) {
    event.preventDefault();
    createTeamMutation.mutate({ name: teamName });
  }

  function selectTeam(teamId: string) {
    setSelectedTeamId(teamId);
    localStorage.setItem(defaultTeamStorageKey, teamId);
  }

  function selectProject(projectId: string) {
    if (!activeTeamId) {
      return;
    }

    setDefaultProjects(writeStoredDefaultProject(activeTeamId, projectId));
  }

  useEffect(() => {
    if (teamsQuery.isLoading) {
      return;
    }

    if (teams.length === 0) {
      setSelectedTeamId(null);
      localStorage.removeItem(defaultTeamStorageKey);
      return;
    }

    if (activeTeamId && selectedTeamId !== activeTeamId) {
      selectTeam(activeTeamId);
    }
  }, [activeTeamId, selectedTeamId, teams, teamsQuery.isLoading]);

  useEffect(() => {
    if (!activeTeamId || projectsQuery.isLoading || projects.length === 0) {
      return;
    }

    const storedProjectId = defaultProjects[activeTeamId];

    if (!storedProjectId || !projects.some((project) => project.id === storedProjectId)) {
      setDefaultProjects(writeStoredDefaultProject(activeTeamId, projects[0].id));
    }
  }, [activeTeamId, defaultProjects, projects, projectsQuery.isLoading]);

  function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    if (activeTeamId && canCreateProject) {
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
            {canManageActiveTeamProjects ? (
              <button
                className="secondary-inline-button"
                type="button"
                onClick={() => setIsProjectTrashOpen(true)}
              >
                项目回收站
              </button>
            ) : null}
          </form>
          <MutationError error={createTeamMutation.error} />
          <div className="list dashboard-compact-scroll-list">
            {teamsQuery.isLoading ? <span className="muted">团队加载中...</span> : null}
            {teams.map((team) => (
              <div className={team.id === activeTeamId ? "list-row selected" : "list-row"} key={team.id}>
                <button className="row-main" type="button" onClick={() => selectTeam(team.id)}>
                  <strong>{team.name}</strong>
                  <span>
                    {team.role}
                    {team.id === activeTeamId ? <i className="default-badge">默认</i> : null}
                  </span>
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
          <div className="list dashboard-compact-scroll-list">
            {projectsQuery.isLoading ? <span className="muted">项目加载中...</span> : null}
            {projects.map((project) => (
              <div className={project.id === defaultProjectId ? "list-row selected" : "list-row"} key={project.id}>
                <Link className="row-main" to={`/projects/${project.id}/board`} onClick={() => selectProject(project.id)}>
                  <strong>{project.name}</strong>
                  <span>
                    {project.status}
                    {project.id === defaultProjectId ? <i className="default-badge">默认</i> : null}
                  </span>
                </Link>
                <div className="row-actions">
                  <Link className="mini-link" to={`/projects/${project.id}/board`} onClick={() => selectProject(project.id)}>
                    看板
                  </Link>
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
        <section className="panel dashboard-scroll-panel dashboard-task-panel">
          <div className="panel-title-row">
            <h2>我的任务</h2>
            <div className="panel-title-actions">
              <select
                className="project-filter-select"
                aria-label="我的任务项目筛选"
                value={taskProjectFilter}
                onChange={(event) => setTaskProjectFilter(event.target.value)}
              >
                <option value="ALL">全部项目</option>
                {myTaskProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <div className="status-tabs" role="tablist" aria-label="我的任务状态筛选">
                {taskStatusTabs.map((tab) => (
                  <button
                    className={taskStatusFilter === tab.value ? "active" : ""}
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={taskStatusFilter === tab.value}
                    onClick={() => setTaskStatusFilter(tab.value)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <input
            className="filter-input"
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="搜索任务、项目或清单"
          />
          <div className="list dashboard-scroll-list">
            {myTasksQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
            {myTaskTree.map((node) => (
              <div className="task-tree-node" key={node.key}>
                <MyTaskLink
                  task={node.task}
                  depth={0}
                  backgroundLocation={location}
                  returnTo={location.pathname}
                  isContextOnly={!node.task.isAssignedToMe}
                />
                {node.children.length > 0 ? (
                  <div className="task-tree-children">
                    {node.children
                      .filter((child) => child.isAssignedToMe)
                      .map((child) => (
                        <MyTaskLink
                          key={child.id}
                          task={child}
                          depth={1}
                          backgroundLocation={location}
                          returnTo={location.pathname}
                        />
                      ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!myTasksQuery.isLoading && myTaskTree.length === 0 ? (
              <span className="muted">没有匹配的任务</span>
            ) : null}
          </div>
        </section>
      </div>

      {isProjectTrashOpen && canManageActiveTeamProjects ? (
        <div className="modal-backdrop">
          <section className="modal" aria-label="团队项目回收站">
            <header className="modal-header">
              <div>
                <h2>项目回收站</h2>
                <p>{activeTeam?.name ?? "当前团队"}</p>
              </div>
              <button className="text-button" type="button" onClick={() => setIsProjectTrashOpen(false)}>
                关闭
              </button>
            </header>
            <MutationError
              error={projectTrashQuery.error ?? restoreProjectMutation.error ?? purgeProjectMutation.error}
            />
            <div className="trash-list">
              {projectTrashQuery.isLoading ? <span className="muted">项目回收站加载中...</span> : null}
              {(projectTrashQuery.data?.projects ?? []).map((project) => (
                <div className="trash-row" key={project.id}>
                  <div className="trash-row-main">
                    <strong>{project.name}</strong>
                    <span>
                      {project.status === "ARCHIVED" ? "已归档" : "未归档"} · 删除人：
                      {formatDeletedBy(project.deletedBy)} · 删除于{" "}
                      {project.deletedAt ? formatCalendarDate(project.deletedAt) : "未知时间"}
                    </span>
                  </div>
                  <div className="segmented-actions compact-actions">
                    <button
                      type="button"
                      disabled={restoreProjectMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`确认恢复项目「${project.name}」？`)) {
                          restoreProjectMutation.mutate(project.id);
                        }
                      }}
                    >
                      恢复
                    </button>
                    <button
                      className="danger-inline"
                      type="button"
                      disabled={purgeProjectMutation.isPending}
                      onClick={() => {
                        const firstConfirmed = window.confirm(
                          `确认彻底删除项目「${project.name}」？项目内任务、清单、标签和评论都会被永久删除。`
                        );
                        const secondConfirmed =
                          firstConfirmed && window.confirm("这是不可恢复操作，请再次确认是否继续彻底删除。");
                        if (secondConfirmed) {
                          purgeProjectMutation.mutate(project.id);
                        }
                      }}
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              ))}
              {!projectTrashQuery.isLoading && (projectTrashQuery.data?.projects ?? []).length === 0 ? (
                <span className="muted">暂无已删除项目</span>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
