import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getProjectPermissions } from "../../lib/permissions";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { useAuthStore } from "../../stores/authStore";
import type { Task, TaskList } from "../../types/api";

type GanttTask = Task & {
  depth: number;
  listName: string;
};

type GanttFilters = {
  keyword: string;
  assigneeId: string;
  priority: string;
  completion: "OPEN" | "DONE" | "ALL";
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(start: Date, end: Date) {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000);
}

function getTaskStart(task: Task) {
  return task.startDate ? startOfDay(new Date(task.startDate)) : task.dueDate ? startOfDay(new Date(task.dueDate)) : null;
}

function getTaskEnd(task: Task) {
  return task.dueDate ? startOfDay(new Date(task.dueDate)) : task.startDate ? startOfDay(new Date(task.startDate)) : null;
}

function formatAssigneeName(assignee: { name: string; isRemoved?: boolean }) {
  return assignee.isRemoved ? `${assignee.name}(已移除)` : assignee.name;
}

function formatTaskDateRange(task: Task) {
  if (task.startDate && task.dueDate) {
    return `${formatCalendarDate(task.startDate)} - ${formatCalendarDate(task.dueDate)}`;
  }

  if (task.dueDate) {
    return `截止 ${formatCalendarDate(task.dueDate)}`;
  }

  if (task.startDate) {
    return `开始 ${formatCalendarDate(task.startDate)}`;
  }

  return "未排期";
}

function flattenTasks(lists: TaskList[]) {
  const flattened: GanttTask[] = [];

  lists.forEach((list) => {
    const taskByParentId = new Map<string, Task[]>();
    const taskIds = new Set(list.tasks.map((task) => task.id));

    list.tasks.forEach((task) => {
      if (!task.parentId || !taskIds.has(task.parentId)) {
        return;
      }

      taskByParentId.set(task.parentId, [...(taskByParentId.get(task.parentId) ?? []), task]);
    });

    function visit(task: Task, depth: number) {
      flattened.push({ ...task, depth, listName: list.name });
      (taskByParentId.get(task.id) ?? []).forEach((child) => visit(child, depth + 1));
    }

    list.tasks
      .filter((task) => !task.parentId || !taskIds.has(task.parentId))
      .forEach((task) => visit(task, 0));
  });

  return flattened;
}

function filterTasks(tasks: GanttTask[], filters: GanttFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const includedTaskIds = new Set<string>();

  function matchesTask(task: GanttTask) {
    const matchesKeyword =
      !keyword ||
      task.title.toLowerCase().includes(keyword) ||
      task.listName.toLowerCase().includes(keyword) ||
      (task.assignees ?? []).some((assignee) => assignee.name.toLowerCase().includes(keyword)) ||
      (task.tags ?? []).some((tag) => tag.name.toLowerCase().includes(keyword));
    const matchesAssignee =
      filters.assigneeId === "ALL" ||
      (filters.assigneeId === "UNASSIGNED" && (task.assignees?.length ?? 0) === 0) ||
      (task.assignees ?? []).some((assignee) => assignee.id === filters.assigneeId);
    const matchesPriority = filters.priority === "ALL" || task.priority === filters.priority;
    const matchesCompletion =
      filters.completion === "ALL" ||
      (filters.completion === "OPEN" && task.status !== "DONE") ||
      (filters.completion === "DONE" && task.status === "DONE");

    return matchesKeyword && matchesAssignee && matchesPriority && matchesCompletion;
  }

  function includeWithAncestors(task: GanttTask) {
    includedTaskIds.add(task.id);

    let parentId = task.parentId;
    while (parentId) {
      const parent = taskById.get(parentId);

      if (!parent || includedTaskIds.has(parent.id)) {
        break;
      }

      includedTaskIds.add(parent.id);
      parentId = parent.parentId;
    }
  }

  tasks.forEach((task) => {
    if (matchesTask(task)) {
      includeWithAncestors(task);
    }
  });

  return tasks.filter((task) => includedTaskIds.has(task.id));
}

function buildTimeline(tasks: GanttTask[]) {
  const dates = tasks.flatMap((task) => [getTaskStart(task), getTaskEnd(task)]).filter((date): date is Date => Boolean(date));

  if (dates.length === 0) {
    return null;
  }

  const min = addDays(new Date(Math.min(...dates.map((date) => date.getTime()))), -1);
  const max = addDays(new Date(Math.max(...dates.map((date) => date.getTime()))), 1);
  const dayCount = Math.max(diffDays(min, max) + 1, 1);
  const days = Array.from({ length: dayCount }, (_, index) => addDays(min, index));

  return {
    start: min,
    dayCount,
    days
  };
}

export function ProjectGanttPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [taskSearch, setTaskSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [completionFilter, setCompletionFilter] = useState<"OPEN" | "DONE" | "ALL">("ALL");

  const listsQuery = useQuery({
    queryKey: ["project-task-list", projectId],
    queryFn: () => boardApi.taskListView(projectId!),
    enabled: Boolean(projectId)
  });

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectApi.get(projectId!),
    enabled: Boolean(projectId)
  });

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => projectApi.members(projectId!),
    enabled: Boolean(projectId)
  });

  const teamMembersQuery = useQuery({
    queryKey: ["team-members", projectQuery.data?.teamId],
    queryFn: () => teamApi.members(projectQuery.data!.teamId),
    enabled: Boolean(projectQuery.data?.teamId)
  });

  const projectPermissions = useMemo(
    () => getProjectPermissions(user?.id, membersQuery.data, teamMembersQuery.data),
    [membersQuery.data, teamMembersQuery.data, user?.id]
  );
  const allTasks = useMemo(() => flattenTasks(listsQuery.data ?? []), [listsQuery.data]);
  const filteredTasks = useMemo(
    () =>
      filterTasks(allTasks, {
        keyword: taskSearch,
        assigneeId: assigneeFilter,
        priority: priorityFilter,
        completion: completionFilter
      }),
    [allTasks, assigneeFilter, completionFilter, priorityFilter, taskSearch]
  );
  const timeline = useMemo(() => buildTimeline(filteredTasks), [filteredTasks]);
  const scheduledTasks = filteredTasks.filter((task) => getTaskStart(task) && getTaskEnd(task));
  const unscheduledTasks = filteredTasks.filter((task) => !getTaskStart(task) || !getTaskEnd(task));
  const isArchived = projectQuery.data?.status === "ARCHIVED";

  function openTask(taskId: string) {
    navigate(`/tasks/${taskId}`, {
      state: {
        backgroundLocation: location,
        returnTo: location.pathname
      }
    });
  }

  if (projectQuery.error) {
    return (
      <div className="page">
        <ResourceState error={projectQuery.error} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>{projectQuery.data?.name ?? "项目"}</h1>
        <nav className="project-menu" aria-label="项目菜单">
          <Link to={`/projects/${projectId}/board`}>看板</Link>
          <Link to={`/projects/${projectId}/list`}>列表</Link>
          <Link className="active" aria-current="page" to={`/projects/${projectId}/gantt`}>
            甘特图
          </Link>
          {projectId && projectPermissions.canManageProject ? (
            <Link to={`/projects/${projectId}/settings`} state={{ returnTo: location.pathname }}>
              设置
            </Link>
          ) : null}
          {projectPermissions.canManageProject ? <Link to={`/projects/${projectId}/trash`}>回收站</Link> : null}
        </nav>
      </div>
      {isArchived ? <section className="notice-panel">这个项目已归档，当前甘特图为只读状态。</section> : null}
      <section className="board-filters">
        <input
          value={taskSearch}
          onChange={(event) => setTaskSearch(event.target.value)}
          placeholder="搜索任务、负责人或标签"
        />
        <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
          <option value="ALL">全部负责人</option>
          <option value="UNASSIGNED">未分配</option>
          {(membersQuery.data ?? []).map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.name}
            </option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
          <option value="ALL">全部优先级</option>
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={completionFilter}
          onChange={(event) => setCompletionFilter(event.target.value as typeof completionFilter)}
        >
          <option value="ALL">全部完成状态</option>
          <option value="OPEN">未完成</option>
          <option value="DONE">已完成</option>
        </select>
      </section>
      <MutationError error={listsQuery.error} />
      {!listsQuery.isLoading && allTasks.length > 0 && filteredTasks.length === 0 ? (
        <section className="notice-panel">当前筛选条件隐藏了所有任务，可以清空筛选条件查看。</section>
      ) : null}
      <section className="gantt-panel" aria-label="甘特图">
        {listsQuery.isLoading ? <span className="muted">甘特图加载中...</span> : null}
        {!listsQuery.isLoading && allTasks.length === 0 ? (
          <section className="empty-state">
            <h2>暂无任务</h2>
            <span>创建带开始日期或截止日期的任务后，会在这里看到排期。</span>
          </section>
        ) : null}
        {timeline && scheduledTasks.length > 0 ? (
          <div className="gantt-scroll">
            <div className="gantt-grid" style={{ "--gantt-days": timeline.dayCount } as CSSProperties}>
              <div className="gantt-header gantt-task-column">任务</div>
              <div className="gantt-header gantt-date-column">
                {timeline.days.map((day) => (
                  <span key={day.toISOString()}>{formatCalendarDate(day.toISOString())}</span>
                ))}
              </div>
              {scheduledTasks.map((task) => {
                const start = getTaskStart(task)!;
                const end = getTaskEnd(task)!;
                const left = diffDays(timeline.start, start) + 1;
                const width = Math.max(diffDays(start, end) + 1, 1);

                return (
                  <div className="gantt-row" key={task.id}>
                    <button
                      className="gantt-task-title"
                      type="button"
                      style={{ paddingLeft: `${task.depth * 18 + 12}px` }}
                      onClick={() => openTask(task.id)}
                    >
                      <span>{task.title}</span>
                      <small>{task.listName}</small>
                    </button>
                    <div className="gantt-track">
                      <button
                        className={`gantt-bar ${getPriorityClassName(task.priority)} ${
                          task.status === "DONE" ? "done" : ""
                        }`}
                        type="button"
                        style={{ "--gantt-left": left, "--gantt-width": width } as CSSProperties}
                        title={`${task.title} · ${formatTaskDateRange(task)} · ${getPriorityLabel(task.priority)}`}
                        onClick={() => openTask(task.id)}
                      >
                        <span>{task.title}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {!listsQuery.isLoading && allTasks.length > 0 && scheduledTasks.length === 0 ? (
          <section className="notice-panel">当前任务没有可展示的开始日期或截止日期。</section>
        ) : null}
        {unscheduledTasks.length > 0 ? (
          <section className="gantt-unscheduled">
            <h2>未排期任务</h2>
            <div className="list">
              {unscheduledTasks.map((task) => (
                <button className="gantt-unscheduled-row" key={task.id} type="button" onClick={() => openTask(task.id)}>
                  <span>
                    {task.title}
                    <small>{task.listName}</small>
                  </span>
                  <span className={`${getPriorityClassName(task.priority)} priority-pill`}>
                    {getPriorityLabel(task.priority)}
                  </span>
                  <span className="gantt-assignees">
                    {task.assignees && task.assignees.length > 0 ? (
                      task.assignees.map((assignee) => (
                        <span className="assignee-chip" key={assignee.id}>
                          <UserAvatar user={assignee} size="xs" />
                          <span>{formatAssigneeName(assignee)}</span>
                        </span>
                      ))
                    ) : (
                      <span className="muted">未分配</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
