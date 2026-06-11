import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { authApi, projectApi, teamApi, userApi } from "../../lib/api";
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
const myTaskExpandedStorageKey = "tower.dashboard.myTaskTreeExpanded";

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

function readStoredMyTaskExpanded() {
  try {
    return JSON.parse(localStorage.getItem(myTaskExpandedStorageKey) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeStoredMyTaskExpanded(nextExpanded: Record<string, boolean>) {
  localStorage.setItem(myTaskExpandedStorageKey, JSON.stringify(nextExpanded));
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

function formatMyTaskDate(task: MyTask) {
  return task.dueDate ? formatCalendarDate(task.dueDate) : "-";
}

function MyTaskTreeRow({
  node,
  backgroundLocation,
  returnTo,
  expanded,
  onToggle
}: {
  node: MyTaskTreeNode;
  backgroundLocation: ReturnType<typeof useLocation>;
  returnTo: string;
  expanded: Record<string, boolean>;
  onToggle: (nodeKey: string) => void;
}) {
  const task = node.task;
  const childTasks = node.children.filter((child) => child.isAssignedToMe);
  const hasChildren = childTasks.length > 0;
  const isExpanded = expanded[node.key] ?? true;
  const isContextOnly = !task.isAssignedToMe;
  const completedSubTaskCount = childTasks.filter((child) => child.completedAt).length;
  const rowClassName = [
    "project-task-list-row",
    "dashboard-task-list-row",
    "root",
    task.completedAt ? "completed" : null,
    isContextOnly ? "context" : null
  ].filter(Boolean).join(" ");

  return (
    <div className="project-task-list-node">
      <div className={rowClassName}>
        <span className="project-task-title-cell">
          {hasChildren ? (
            <button
              className="tree-toggle-button"
              type="button"
              aria-label={`${isExpanded ? "收起" : "展开"}${task.title}`}
              aria-expanded={isExpanded}
              onClick={() => onToggle(node.key)}
            >
              {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <Link className="project-task-title-button" to={`/tasks/${task.id}`} state={{ backgroundLocation, returnTo }}>
            <span>{task.title}</span>
            {hasChildren ? (
              <span className="project-task-subtask-count">
                ({completedSubTaskCount}/{childTasks.length})
              </span>
            ) : null}
          </Link>
        </span>
        <span
          className={`${getPriorityClassName(task.priority)} project-task-priority-square`}
          title={getPriorityLabel(task.priority)}
        >
          {getPriorityLabel(task.priority)}
        </span>
        <span className="project-task-date-cell">
          {task.completedAt ? (
            <span className="task-completion-meta">
              {formatCompletedByName(task.completedBy)} {formatCalendarDate(task.completedAt)}完成
            </span>
          ) : (
            formatMyTaskDate(task)
          )}
        </span>
        <span className="dashboard-task-context-cell">
          {isContextOnly ? <span className="dashboard-task-context-label">父任务</span> : null}
          <span>{task.project.name}</span>
          <span>{task.taskList.name}</span>
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <div className="project-task-list-node">
          {childTasks.map((child) => (
            <div
              className={[
                "project-task-list-row",
                "dashboard-task-list-row",
                "child",
                child.completedAt ? "completed" : null
              ].filter(Boolean).join(" ")}
              key={child.id}
            >
              <span className="project-task-title-cell" style={{ paddingLeft: "22px" }}>
                <span className="tree-spacer" />
                <Link className="project-task-title-button" to={`/tasks/${child.id}`} state={{ backgroundLocation, returnTo }}>
                  <span>{child.title}</span>
                </Link>
              </span>
              <span
                className={`${getPriorityClassName(child.priority)} project-task-priority-square`}
                title={getPriorityLabel(child.priority)}
              >
                {getPriorityLabel(child.priority)}
              </span>
              <span className="project-task-date-cell">
                {child.completedAt ? (
                  <span className="task-completion-meta">
                    {formatCompletedByName(child.completedBy)} {formatCalendarDate(child.completedAt)}完成
                  </span>
                ) : (
                  formatMyTaskDate(child)
                )}
              </span>
              <span className="dashboard-task-context-cell">
                <span>{child.project.name}</span>
                <span>{child.taskList.name}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [teamName, setTeamName] = useState("");
  const [teamAdminEmail, setTeamAdminEmail] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectAdminUserId, setProjectAdminUserId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => readStoredDefaultTeamId());
  const [defaultProjects, setDefaultProjects] = useState<Record<string, string>>(() => readStoredDefaultProjects());
  const [taskSearch, setTaskSearch] = useState("");
  const [taskProjectFilter, setTaskProjectFilter] = useState("ALL");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"OPEN" | "DONE" | "ALL">("OPEN");
  const [myTaskExpanded, setMyTaskExpanded] = useState<Record<string, boolean>>(() => readStoredMyTaskExpanded());
  const [isProjectTrashOpen, setIsProjectTrashOpen] = useState(false);

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: teamApi.list
  });
  const currentUserQuery = useQuery({
    queryKey: ["current-user"],
    queryFn: authApi.me
  });

  const teams = teamsQuery.data ?? [];
  const isSystemAdmin = currentUserQuery.data?.systemRole === "ADMIN";
  const systemDefaultTeamId = teams.find((team) => team.isSystemDefault)?.id ?? null;
  const activeTeamId =
    teams.length === 0
      ? null
      : selectedTeamId && teams.some((team) => team.id === selectedTeamId)
        ? selectedTeamId
        : systemDefaultTeamId && teams.some((team) => team.id === systemDefaultTeamId)
          ? systemDefaultTeamId
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
  const systemDefaultProjectId = projects.find((project) => project.isSystemDefault)?.id ?? null;
  const defaultProjectId = activeTeamId
    ? defaultProjects[activeTeamId] ?? systemDefaultProjectId ?? projects[0]?.id ?? null
    : null;
  const canCreateTeam = isSystemAdmin;
  const canCreateProject = isSystemAdmin || activeTeam?.role === "ADMIN";
  const canManageActiveTeamProjects = isSystemAdmin || activeTeam?.role === "ADMIN";
  const teamMembersQuery = useQuery({
    queryKey: ["team-members", activeTeamId],
    queryFn: () => teamApi.members(activeTeamId!),
    enabled: Boolean(activeTeamId && canCreateProject)
  });
  const projectAdminCandidates = teamMembersQuery.data ?? [];
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
  const toggleMyTaskNode = (nodeKey: string) => {
    setMyTaskExpanded((current) => {
      const next = {
        ...current,
        [nodeKey]: !(current[nodeKey] ?? true)
      };
      writeStoredMyTaskExpanded(next);
      return next;
    });
  };
  const createTeamMutation = useMutation({
    mutationFn: teamApi.create,
    onSuccess: (team) => {
      setTeamName("");
      setTeamAdminEmail("");
      selectTeam(team.id);
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: { name: string; projectAdminUserId?: string }) =>
      projectApi.create(activeTeamId!, input),
    onSuccess: (project) => {
      setProjectName("");
      setProjectAdminUserId("");
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
    if (canCreateTeam) {
      createTeamMutation.mutate({ name: teamName, adminEmail: teamAdminEmail });
    }
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
    setProjectAdminUserId("");
  }, [activeTeamId]);

  useEffect(() => {
    if (!activeTeamId || projectsQuery.isLoading || projects.length === 0) {
      return;
    }

    const storedProjectId = defaultProjects[activeTeamId];

    const fallbackProjectId = systemDefaultProjectId ?? projects[0].id;

    if (!storedProjectId || !projects.some((project) => project.id === storedProjectId)) {
      setDefaultProjects(writeStoredDefaultProject(activeTeamId, fallbackProjectId));
    }
  }, [activeTeamId, defaultProjects, projects, projectsQuery.isLoading, systemDefaultProjectId]);

  function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    const nextProjectAdminUserId =
      projectAdminUserId || (isSystemAdmin ? "" : currentUserQuery.data?.id ?? "");

    if (activeTeamId && canCreateProject) {
      createProjectMutation.mutate({
        name: projectName,
        projectAdminUserId: nextProjectAdminUserId || undefined
      });
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
          {canCreateTeam ? (
            <form className="compact-form" onSubmit={handleCreateTeam}>
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="新团队名称"
                required
              />
              <input
                value={teamAdminEmail}
                onChange={(event) => setTeamAdminEmail(event.target.value)}
                placeholder="团队管理员邮箱"
                type="email"
                required
              />
              <button type="submit" disabled={createTeamMutation.isPending}>
                创建
              </button>
            </form>
          ) : null}
          <div className="compact-form">
            {canManageActiveTeamProjects ? (
              <button
                className="secondary-inline-button"
                type="button"
                onClick={() => setIsProjectTrashOpen(true)}
              >
                项目回收站
              </button>
            ) : null}
          </div>
          <MutationError error={createTeamMutation.error} />
          <div className="list dashboard-compact-scroll-list">
            {teamsQuery.isLoading ? <span className="muted">团队加载中...</span> : null}
            {teams.map((team) => (
              <div className={team.id === activeTeamId ? "list-row selected" : "list-row"} key={team.id}>
                <button className="row-main" type="button" onClick={() => selectTeam(team.id)}>
                  <strong>{team.name}</strong>
                  <span>
                    {team.role ?? "系统管理员"}
                    {team.id === activeTeamId ? <i className="default-badge">当前</i> : null}
                    {team.isSystemDefault ? <i className="default-badge">系统默认</i> : null}
                  </span>
                </button>
                {isSystemAdmin || team.role === "ADMIN" ? (
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
              <select
                value={projectAdminUserId}
                onChange={(event) => setProjectAdminUserId(event.target.value)}
                disabled={!activeTeamId || teamMembersQuery.isLoading}
                required={isSystemAdmin}
                title={isSystemAdmin ? "系统管理员创建项目时必须指定项目管理员" : "不选则默认自己为项目管理员"}
              >
                <option value="">
                  {isSystemAdmin ? "选择项目管理员" : "默认自己为项目管理员"}
                </option>
                {projectAdminCandidates.map((member) => (
                  <option key={member.user.id} value={member.user.id}>
                    {member.user.name} / {member.user.email}
                  </option>
                ))}
              </select>
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
                    {project.id === defaultProjectId ? <i className="default-badge">当前</i> : null}
                    {project.isSystemDefault ? <i className="default-badge">系统默认</i> : null}
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
          <div className="project-task-list-table dashboard-task-list-table dashboard-scroll-list">
            <div className="project-task-list-head dashboard-task-list-head">
              <span>任务标题</span>
              <span>优先级</span>
              <span>截止时间</span>
              <span>项目 / 清单</span>
            </div>
            {myTasksQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
            {myTaskTree.map((node) => (
              <MyTaskTreeRow
                backgroundLocation={location}
                expanded={myTaskExpanded}
                key={node.key}
                node={node}
                onToggle={toggleMyTaskNode}
                returnTo={location.pathname}
              />
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
