import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useMemo, useRef, useState } from "react";
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

type GanttZoom = "DAY" | "WEEK" | "MONTH" | "QUARTER";

type GanttDragMode = "MOVE" | "START" | "END";

type DragState = {
  task: GanttTask;
  mode: GanttDragMode;
  startClientX: number;
  unitPx: number;
  previewDeltaUnits: number;
  deltaUnits: number;
  minDeltaUnits: number;
  maxDeltaUnits: number;
  hasMoved: boolean;
};

type UpdateTaskDatesInput = {
  task: GanttTask;
  startDate: Date;
  dueDate: Date;
  previousLists?: TaskList[];
};

const GANTT_ZOOM_OPTIONS: Array<{ value: GanttZoom; label: string; unitWidth: number }> = [
  { value: "DAY", label: "天", unitWidth: 68 },
  { value: "WEEK", label: "周", unitWidth: 104 },
  { value: "MONTH", label: "月", unitWidth: 96 },
  { value: "QUARTER", label: "季度", unitWidth: 120 }
];

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

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortYear(date: Date) {
  return String(date.getFullYear()).slice(-2);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(date), mondayOffset);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfQuarter(date: Date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfUnit(date: Date, zoom: GanttZoom) {
  if (zoom === "MONTH") {
    return startOfMonth(date);
  }

  if (zoom === "QUARTER") {
    return startOfQuarter(date);
  }

  if (zoom === "DAY") {
    return startOfDay(date);
  }

  return startOfWeek(date);
}

function addUnit(date: Date, zoom: GanttZoom, count: number) {
  if (zoom === "MONTH") {
    return addMonths(date, count);
  }

  if (zoom === "QUARTER") {
    return addMonths(date, count * 3);
  }

  if (zoom === "DAY") {
    return addDays(date, count);
  }

  return addDays(date, count * 7);
}

function diffUnits(start: Date, end: Date, zoom: GanttZoom) {
  const normalizedStart = startOfUnit(start, zoom);
  const normalizedEnd = startOfUnit(end, zoom);

  if (zoom === "MONTH") {
    return (
      (normalizedEnd.getFullYear() - normalizedStart.getFullYear()) * 12 +
      normalizedEnd.getMonth() -
      normalizedStart.getMonth()
    );
  }

  if (zoom === "QUARTER") {
    const startQuarter = normalizedStart.getFullYear() * 4 + Math.floor(normalizedStart.getMonth() / 3);
    const endQuarter = normalizedEnd.getFullYear() * 4 + Math.floor(normalizedEnd.getMonth() / 3);
    return endQuarter - startQuarter;
  }

  if (zoom === "DAY") {
    return Math.round((normalizedEnd.getTime() - normalizedStart.getTime()) / 86_400_000);
  }

  return Math.round((normalizedEnd.getTime() - normalizedStart.getTime()) / 604_800_000);
}

function formatTimelineUnit(date: Date, zoom: GanttZoom) {
  if (zoom === "DAY") {
    return `${formatShortYear(date)}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  if (zoom === "WEEK") {
    const end = addDays(date, 6);

    if (date.getFullYear() === end.getFullYear()) {
      return `${formatShortYear(date)}/${date.getMonth() + 1}/${date.getDate()}-${end.getMonth() + 1}/${end.getDate()}`;
    }

    return `${formatShortYear(date)}/${date.getMonth() + 1}/${date.getDate()}-${formatShortYear(end)}/${end.getMonth() + 1}/${end.getDate()}`;
  }

  if (zoom === "MONTH") {
    return `${formatShortYear(date)}/${date.getMonth() + 1}`;
  }

  if (zoom === "QUARTER") {
    return `${formatShortYear(date)} Q${Math.floor(date.getMonth() / 3) + 1}`;
  }

  return formatCalendarDate(date.toISOString());
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

function GanttAssigneeAvatars({ assignees }: { assignees: Task["assignees"] }) {
  if (!assignees || assignees.length === 0) {
    return <span className="muted gantt-unassigned">未分配</span>;
  }

  const assigneeNames = assignees.map(formatAssigneeName).join("、");

  return (
    <span className="gantt-assignee-avatars" aria-label={`负责人：${assigneeNames}`}>
      {assignees.map((assignee) => (
        <span className="gantt-assignee-avatar" key={assignee.id} title={formatAssigneeName(assignee)}>
          <UserAvatar user={assignee} size="xs" />
        </span>
      ))}
    </span>
  );
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

function buildTimeline(tasks: GanttTask[], zoom: GanttZoom) {
  const dates = tasks.flatMap((task) => [getTaskStart(task), getTaskEnd(task)]).filter((date): date is Date => Boolean(date));

  if (dates.length === 0) {
    return null;
  }

  const min = addUnit(startOfUnit(new Date(Math.min(...dates.map((date) => date.getTime()))), zoom), zoom, -1);
  const max = addUnit(startOfUnit(new Date(Math.max(...dates.map((date) => date.getTime()))), zoom), zoom, 1);
  const unitCount = Math.max(diffUnits(min, max, zoom) + 1, 1);
  const units = Array.from({ length: unitCount }, (_, index) => addUnit(min, zoom, index));

  return {
    start: min,
    unitCount,
    units
  };
}

function updateTaskDatesInLists(lists: TaskList[] | undefined, taskId: string, startDate: string, dueDate: string) {
  return lists?.map((list) => ({
    ...list,
    tasks: list.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            startDate,
            dueDate
          }
        : task
    )
  }));
}

export function ProjectGanttPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [taskSearch, setTaskSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [completionFilter, setCompletionFilter] = useState<"OPEN" | "DONE" | "ALL">("ALL");
  const [zoom, setZoom] = useState<GanttZoom>("DAY");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickTaskIdRef = useRef<string | null>(null);

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
  const timeline = useMemo(() => buildTimeline(filteredTasks, zoom), [filteredTasks, zoom]);
  const scheduledTasks = filteredTasks.filter((task) => getTaskStart(task) && getTaskEnd(task));
  const unscheduledTasks = filteredTasks.filter((task) => !getTaskStart(task) || !getTaskEnd(task));
  const isArchived = projectQuery.data?.status === "ARCHIVED";
  const canReschedule = projectPermissions.canEditProject && !isArchived;
  const unitWidth = GANTT_ZOOM_OPTIONS.find((option) => option.value === zoom)?.unitWidth ?? 72;

  const updateTaskDatesMutation = useMutation({
    mutationFn: (input: UpdateTaskDatesInput) =>
      boardApi.updateTask(input.task.id, {
        startDate: formatDateInputValue(input.startDate),
        dueDate: formatDateInputValue(input.dueDate)
      }),
    onMutate: async (input) => {
      const queryKey = ["project-task-list", projectId];
      const startDate = formatDateInputValue(input.startDate);
      const dueDate = formatDateInputValue(input.dueDate);

      await queryClient.cancelQueries({ queryKey });

      const previousLists = input.previousLists ?? queryClient.getQueryData<TaskList[]>(queryKey);

      queryClient.setQueryData<TaskList[]>(queryKey, (current) =>
        updateTaskDatesInLists(current, input.task.id, startDate, dueDate)
      );

      return { previousLists };
    },
    onError: (_error, _input, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(["project-task-list", projectId], context.previousLists);
      }
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["task", input.task.id] });
      void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
    }
  });

  function openTask(taskId: string) {
    navigate(`/tasks/${taskId}`, {
      state: {
        backgroundLocation: location,
        returnTo: location.pathname
      }
    });
  }

  function handleTaskBarPointerDown(
    event: PointerEvent<HTMLButtonElement>,
    task: GanttTask,
    left: number,
    width: number
  ) {
    if (!canReschedule || !timeline || event.button !== 0) {
      return;
    }

    const track = event.currentTarget.parentElement;

    if (!track) {
      return;
    }

    const target = event.target as HTMLElement;
    const resizeHandle = target.closest<HTMLElement>(".gantt-resize-handle");
    const mode: GanttDragMode =
      resizeHandle?.dataset.edge === "left" ? "START" : resizeHandle?.dataset.edge === "right" ? "END" : "MOVE";
    const unitPx = track.getBoundingClientRect().width / timeline.unitCount;
    const minDeltaUnits = mode === "END" ? 1 - width : 1 - left;
    const maxDeltaUnits = mode === "START" ? width - 1 : timeline.unitCount - left - width + 1;

    const nextState = {
      task,
      mode,
      startClientX: event.clientX,
      unitPx,
      previewDeltaUnits: 0,
      deltaUnits: 0,
      minDeltaUnits,
      maxDeltaUnits,
      hasMoved: false
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = nextState;
    setDragState(nextState);
  }

  function handleTaskBarPointerMove(event: PointerEvent<HTMLButtonElement>, taskId: string) {
    setDragState((current) => {
      if (!current || current.task.id !== taskId) {
        return current;
      }

      const rawDeltaUnits = (event.clientX - current.startClientX) / current.unitPx;
      const previewDeltaUnits = Math.min(Math.max(rawDeltaUnits, current.minDeltaUnits), current.maxDeltaUnits);
      const deltaUnits = Math.min(Math.max(Math.round(rawDeltaUnits), current.minDeltaUnits), current.maxDeltaUnits);
      const hasMoved = current.hasMoved || Math.abs(event.clientX - current.startClientX) > 4;

      if (
        previewDeltaUnits === current.previewDeltaUnits &&
        deltaUnits === current.deltaUnits &&
        hasMoved === current.hasMoved
      ) {
        return current;
      }

      const nextState = {
        ...current,
        previewDeltaUnits,
        deltaUnits,
        hasMoved
      };

      dragStateRef.current = nextState;
      return nextState;
    });
  }

  function finishTaskBarDrag(event: PointerEvent<HTMLButtonElement>, taskId: string) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const current = dragStateRef.current;

    if (!current || current.task.id !== taskId) {
      return;
    }

    if (current.hasMoved) {
      suppressClickTaskIdRef.current = taskId;
      window.setTimeout(() => {
        if (suppressClickTaskIdRef.current === taskId) {
          suppressClickTaskIdRef.current = null;
        }
      }, 0);
    }

    if (current.deltaUnits === 0) {
      dragStateRef.current = null;
      setDragState(null);
      return;
    }

    const originalStart = getTaskStart(current.task);
    const originalEnd = getTaskEnd(current.task);

    if (!originalStart || !originalEnd) {
      dragStateRef.current = null;
      setDragState(null);
      return;
    }

    const durationDays = diffDays(originalStart, originalEnd);
    const normalizedStart = startOfUnit(originalStart, zoom);
    const normalizedEnd = startOfUnit(originalEnd, zoom);
    let nextStart = originalStart;
    let nextEnd = originalEnd;

    if (current.mode === "MOVE") {
      nextStart = addUnit(normalizedStart, zoom, current.deltaUnits);
      nextEnd = addDays(nextStart, durationDays);
    } else if (current.mode === "START") {
      nextStart = addUnit(normalizedStart, zoom, current.deltaUnits);
    } else {
      nextEnd = addUnit(normalizedEnd, zoom, current.deltaUnits);
    }

    if (nextStart.getTime() > nextEnd.getTime()) {
      if (current.mode === "START") {
        nextStart = nextEnd;
      } else {
        nextEnd = nextStart;
      }
    }

    const queryKey = ["project-task-list", projectId];
    const startDate = formatDateInputValue(nextStart);
    const dueDate = formatDateInputValue(nextEnd);
    const previousLists = queryClient.getQueryData<TaskList[]>(queryKey);

    queryClient.setQueryData<TaskList[]>(queryKey, (cachedLists) =>
      updateTaskDatesInLists(cachedLists, current.task.id, startDate, dueDate)
    );

    dragStateRef.current = null;
    setDragState(null);

    updateTaskDatesMutation.mutate({
      task: current.task,
      startDate: nextStart,
      dueDate: nextEnd,
      previousLists
    });
  }

  function handleTaskBarClick(event: MouseEvent<HTMLButtonElement>, taskId: string) {
    const target = event.target as HTMLElement;

    if (target.closest(".gantt-resize-handle") || suppressClickTaskIdRef.current === taskId) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    openTask(taskId);
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
      <section className="gantt-toolbar" aria-label="甘特图缩放">
        <span className="muted">缩放</span>
        <div className="status-tabs">
          {GANTT_ZOOM_OPTIONS.map((option) => (
            <button
              className={zoom === option.value ? "active" : ""}
              type="button"
              key={option.value}
              aria-pressed={zoom === option.value}
              onClick={() => setZoom(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <MutationError error={listsQuery.error ?? updateTaskDatesMutation.error} />
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
            <div
              className="gantt-grid"
              style={
                {
                  "--gantt-units": timeline.unitCount,
                  "--gantt-unit-width": `${unitWidth}px`
                } as CSSProperties
              }
            >
              <div className="gantt-header gantt-task-column">任务</div>
              <div className="gantt-header gantt-date-column">
                {timeline.units.map((unit) => (
                  <span key={unit.toISOString()}>{formatTimelineUnit(unit, zoom)}</span>
                ))}
              </div>
              {scheduledTasks.map((task) => {
                const start = getTaskStart(task)!;
                const end = getTaskEnd(task)!;
                const left = diffUnits(timeline.start, start, zoom) + 1;
                const width = Math.max(diffUnits(start, end, zoom) + 1, 1);
                const taskDragState = dragState?.task.id === task.id ? dragState : null;
                const previewLeft =
                  taskDragState?.mode === "MOVE" || taskDragState?.mode === "START"
                    ? left + taskDragState.previewDeltaUnits
                    : left;
                const previewWidth =
                  taskDragState?.mode === "START"
                    ? width - taskDragState.previewDeltaUnits
                    : taskDragState?.mode === "END"
                      ? width + taskDragState.previewDeltaUnits
                      : width;

                return (
                  <div className="gantt-row" key={task.id}>
                    <button
                      className="gantt-task-title"
                      type="button"
                      style={{ paddingLeft: `${task.depth * 18 + 12}px` }}
                      onClick={() => openTask(task.id)}
                    >
                      <span className="gantt-task-title-main">
                        <span className={`gantt-task-title-text ${task.depth === 0 ? "root" : "child"}`}>
                          {task.title}
                        </span>
                        <small>{task.listName}</small>
                      </span>
                      <GanttAssigneeAvatars assignees={task.assignees} />
                    </button>
                    <div className="gantt-track">
                      <button
                        className={`gantt-bar ${getPriorityClassName(task.priority)} ${
                          task.status === "DONE" ? "done" : ""
                        } ${dragState?.task.id === task.id ? "dragging" : ""
                        }`}
                        type="button"
                        data-reschedulable={canReschedule ? "true" : "false"}
                        style={
                          {
                            "--gantt-left": left,
                            "--gantt-width": width,
                            "--gantt-preview-left": previewLeft,
                            "--gantt-preview-width": previewWidth
                          } as CSSProperties
                        }
                        title={`${task.title} · ${formatTaskDateRange(task)} · ${getPriorityLabel(task.priority)}`}
                        aria-label={`${task.title} 排期 ${formatTaskDateRange(task)}`}
                        onClick={(event) => handleTaskBarClick(event, task.id)}
                        onPointerCancel={(event) => finishTaskBarDrag(event, task.id)}
                        onPointerDown={(event) => handleTaskBarPointerDown(event, task, left, width)}
                        onPointerMove={(event) => handleTaskBarPointerMove(event, task.id)}
                        onPointerUp={(event) => finishTaskBarDrag(event, task.id)}
                      >
                        {canReschedule ? (
                          <span className="gantt-resize-handle left" data-edge="left" aria-hidden="true" />
                        ) : null}
                        <span className="gantt-bar-label">{task.title}</span>
                        {canReschedule ? (
                          <span className="gantt-resize-handle right" data-edge="right" aria-hidden="true" />
                        ) : null}
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
            <div className="gantt-unscheduled-table">
              <div className="gantt-unscheduled-header">
                <span>任务</span>
                <span>优先级</span>
                <span>负责人</span>
              </div>
              {unscheduledTasks.map((task) => (
                <button className="gantt-unscheduled-row" key={task.id} type="button" onClick={() => openTask(task.id)}>
                  <span
                    className="gantt-unscheduled-title"
                    style={{ "--gantt-task-depth": task.depth } as CSSProperties}
                  >
                    <span className={`gantt-unscheduled-title-text ${task.depth === 0 ? "root" : "child"}`}>
                      {task.title}
                    </span>
                    <small>{task.listName}</small>
                  </span>
                  <span className={`${getPriorityClassName(task.priority)} priority-pill`}>
                    {getPriorityLabel(task.priority)}
                  </span>
                  <GanttAssigneeAvatars assignees={task.assignees} />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
