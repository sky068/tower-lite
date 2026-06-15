import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { Select } from "../../components/shared/Select";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { formatCalendarDate } from "../../lib/dateTime";
import { getMemberName, getMemberUser, isVerifiedSystemAdmin } from "../../lib/members";
import { getProjectPermissions } from "../../lib/permissions";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { useAuthStore } from "../../stores/authStore";
import type { Member, Task, TaskList, User } from "../../types/api";

type GanttTask = Task & {
  depth: number;
  listName: string;
  hasChildren: boolean;
  barStart: Date | null;
  barEnd: Date | null;
  barKind: "TASK" | "SUMMARY" | "NONE";
};

type GanttFilters = {
  keyword: string;
  assigneeId: string;
  priority: string;
  completion: "OPEN" | "DONE" | "ALL";
};

type GanttZoom = "DAY" | "WEEK" | "MONTH" | "QUARTER";
type GanttViewMode = "TASK" | "PEOPLE";

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

type PeopleGanttGroup = {
  id: string;
  name: string;
  email: string;
  user: User | null;
  tasks: GanttTask[];
  summarySegments: Array<{ start: Date; end: Date }>;
};

type PeopleGanttRow =
  | {
      id: string;
      kind: "PERSON";
      group: PeopleGanttGroup;
      task: null;
      depth: number;
      hasChildren: boolean;
    }
  | {
      id: string;
      kind: "TASK";
      group: PeopleGanttGroup;
      task: GanttTask;
      depth: number;
      hasChildren: boolean;
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

function getTaskOwnStart(task: Task) {
  return task.startDate ? startOfDay(new Date(task.startDate)) : null;
}

function getTaskOwnDue(task: Task) {
  return task.dueDate ? startOfDay(new Date(task.dueDate)) : null;
}

function getGanttTaskStart(task: GanttTask) {
  return task.barStart;
}

function getGanttTaskEnd(task: GanttTask) {
  return task.barEnd;
}

function formatAssigneeName(assignee: { name: string; status?: string }) {
  return assignee.status === "REMOVED" ? `${assignee.name}(已移除)` : assignee.name;
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

function GanttTreeToggle({
  task,
  collapsed,
  onToggle
}: {
  task: GanttTask;
  collapsed: boolean;
  onToggle: (taskId: string) => void;
}) {
  if (!task.hasChildren) {
    return <span className="gantt-tree-toggle-placeholder" aria-hidden="true" />;
  }

  return (
    <button
      className="gantt-tree-toggle"
      type="button"
      aria-label={`${collapsed ? "展开" : "折叠"} ${task.title}`}
      aria-expanded={!collapsed}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(task.id);
      }}
    >
      {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
}

function PeopleTreeToggle({
  label,
  hasChildren,
  collapsed,
  onToggle
}: {
  label: string;
  hasChildren: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (!hasChildren) {
    return <span className="gantt-tree-toggle-placeholder" aria-hidden="true" />;
  }

  return (
    <button
      className="gantt-tree-toggle"
      type="button"
      aria-label={`${collapsed ? "展开" : "折叠"} ${label}`}
      aria-expanded={!collapsed}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
}

function formatTaskDateRange(task: GanttTask) {
  if (task.barKind === "SUMMARY" && task.barStart && task.barEnd) {
    return `子任务汇总 ${formatCalendarDate(task.barStart.toISOString())} - ${formatCalendarDate(task.barEnd.toISOString())}`;
  }

  if (task.startDate && task.dueDate) {
    return `${formatCalendarDate(task.startDate)} - ${formatCalendarDate(task.dueDate)}`;
  }

  return "未排期";
}

function hasOwnSchedule(task: GanttTask) {
  return Boolean(task.startDate && task.dueDate);
}

function hasGanttBar(task: GanttTask) {
  return Boolean(getGanttTaskStart(task) && getGanttTaskEnd(task) && task.barKind !== "NONE");
}

function getTaskLevelMarker(task: GanttTask) {
  return task.depth > 0 ? "子任务" : null;
}

function mergeGanttTaskRangeSegments(tasks: GanttTask[]) {
  const ranges = tasks
    .map((task) => {
      const start = getGanttTaskStart(task);
      const end = getGanttTaskEnd(task);

      return start && end && task.barKind !== "NONE" ? { start, end } : null;
    })
    .filter((range): range is { start: Date; end: Date } => Boolean(range));

  const sortedRanges = ranges.sort((left, right) => left.start.getTime() - right.start.getTime());
  const segments: Array<{ start: Date; end: Date }> = [];

  sortedRanges.forEach((range) => {
    const lastSegment = segments.at(-1);

    if (!lastSegment) {
      segments.push({ start: range.start, end: range.end });
      return;
    }

    if (range.start.getTime() <= addDays(lastSegment.end, 1).getTime()) {
      lastSegment.end = new Date(Math.max(lastSegment.end.getTime(), range.end.getTime()));
      return;
    }

    segments.push({ start: range.start, end: range.end });
  });

  return segments;
}

function flattenTasks(lists: TaskList[]) {
  const tasks = lists.flatMap((list, listIndex) =>
    list.tasks.map((task, taskIndex) => ({
      task,
      listName: list.name,
      order: listIndex * 10_000 + taskIndex
    }))
  );
  const taskIds = new Set(tasks.map((item) => item.task.id));
  const taskById = new Map(tasks.map((item) => [item.task.id, item]));
  const taskByParentId = new Map<string, typeof tasks>();

  tasks.forEach((item) => {
    const parentId = item.task.parentId;

    if (!parentId || !taskIds.has(parentId)) {
      return;
    }

    taskByParentId.set(parentId, [...(taskByParentId.get(parentId) ?? []), item]);
  });

  function sortByProjectOrder(items: typeof tasks) {
    return [...items].sort((left, right) => left.order - right.order);
  }

  type ScheduleRange = { start: Date; end: Date };

  function mergeScheduleRanges(ranges: Array<ScheduleRange | null>) {
    const validRanges = ranges.filter((range): range is ScheduleRange => Boolean(range));

    if (validRanges.length === 0) {
      return null;
    }

    return {
      start: new Date(Math.min(...validRanges.map((range) => range.start.getTime()))),
      end: new Date(Math.max(...validRanges.map((range) => range.end.getTime())))
    };
  }

  function visit(item: typeof tasks[number], depth: number): { nodes: GanttTask[]; range: ScheduleRange | null } {
    const ownStart = getTaskOwnStart(item.task);
    const ownEnd = getTaskOwnDue(item.task);
    const hasOwnSchedule = Boolean(ownStart && ownEnd);
    const children = sortByProjectOrder(taskByParentId.get(item.task.id) ?? []);
    const childResults = children.map((child) => visit(child, depth + 1));
    const childRange = mergeScheduleRanges(childResults.map((result) => result.range));
    const ownRange = hasOwnSchedule ? { start: ownStart!, end: ownEnd! } : null;
    const barRange = ownRange ?? childRange;
    const barKind = ownRange ? "TASK" : childRange ? "SUMMARY" : "NONE";
    const aggregateRange = mergeScheduleRanges([ownRange, childRange]);
    const ganttTask: GanttTask = {
      ...item.task,
      depth,
      listName: item.listName,
      hasChildren: children.length > 0,
      barStart: barRange?.start ?? null,
      barEnd: barRange?.end ?? null,
      barKind
    };

    return {
      nodes: [ganttTask, ...childResults.flatMap((result) => result.nodes)],
      range: aggregateRange
    };
  }

  return sortByProjectOrder(tasks.filter((item) => !item.task.parentId || !taskById.has(item.task.parentId))).flatMap(
    (item) => visit(item, 0).nodes
  );
}

function taskMatchesFilters(task: GanttTask, filters: GanttFilters) {
  const keyword = filters.keyword.trim().toLowerCase();

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

function filterTasks(tasks: GanttTask[], filters: GanttFilters) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const includedTaskIds = new Set<string>();

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
    if (taskMatchesFilters(task, filters)) {
      includeWithAncestors(task);
    }
  });

  return tasks.filter((task) => includedTaskIds.has(task.id));
}

function buildTimeline(tasks: GanttTask[], zoom: GanttZoom) {
  const dates = tasks
    .flatMap((task) => [getGanttTaskStart(task), getGanttTaskEnd(task)])
    .filter((date): date is Date => Boolean(date));

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

function filterCollapsedTasks(tasks: GanttTask[], collapsedTaskIds: Set<string>) {
  if (collapsedTaskIds.size === 0) {
    return tasks;
  }

  const hiddenTaskIds = new Set<string>();

  return tasks.filter((task) => {
    const parentHidden = task.parentId ? hiddenTaskIds.has(task.parentId) : false;

    if (parentHidden) {
      hiddenTaskIds.add(task.id);
      return false;
    }

    if (collapsedTaskIds.has(task.id)) {
      hiddenTaskIds.add(task.id);
    }

    return true;
  });
}

function includeScheduledAncestors(tasks: GanttTask[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParentId = new Map<string, GanttTask[]>();
  const scheduledRootIds = new Set<string>();

  tasks.forEach((task) => {
    if (!task.parentId) {
      return;
    }

    childrenByParentId.set(task.parentId, [...(childrenByParentId.get(task.parentId) ?? []), task]);
  });

  tasks.forEach((task) => {
    if (!getGanttTaskStart(task) || !getGanttTaskEnd(task) || task.barKind === "NONE") {
      return;
    }

    let parentId = task.parentId;
    let rootId = task.id;
    while (parentId) {
      const parent = taskById.get(parentId);

      if (!parent) {
        break;
      }

      rootId = parent.id;
      parentId = parent.parentId;
    }
    scheduledRootIds.add(rootId);
  });

  const scheduledTreeTaskIds = new Set<string>();

  function includeDescendants(taskId: string) {
    scheduledTreeTaskIds.add(taskId);
    (childrenByParentId.get(taskId) ?? []).forEach((child) => includeDescendants(child.id));
  }

  scheduledRootIds.forEach(includeDescendants);

  return {
    tasks: tasks.filter((task) => scheduledTreeTaskIds.has(task.id)),
    scheduledTreeTaskIds
  };
}

function getCollapsedStorageKey(projectId: string) {
  return `tower.gantt.collapsed.${projectId}`;
}

function getPeopleCollapsedStorageKey(projectId: string) {
  return `tower.gantt.people.collapsed.${projectId}`;
}

function buildPeopleGroups(tasks: GanttTask[], members: Member[], assigneeFilter: string) {
  const groups: PeopleGanttGroup[] = [];

  function isAssignedToMember(task: GanttTask, memberId: string) {
    return (task.assignees ?? []).some((assignee) => assignee.id === memberId);
  }

  const memberGroups = members
    .filter((member) => assigneeFilter === "ALL" || assigneeFilter === member.id)
    .map((member) => {
      const memberTasks = tasks.filter((task) => isAssignedToMember(task, member.id) && hasOwnSchedule(task));

      return {
        id: `member:${member.id}`,
        name: getMemberName(member),
        email: member.email,
        user: getMemberUser(member),
        tasks: memberTasks,
        summarySegments: mergeGanttTaskRangeSegments(memberTasks)
      };
    });

  if (assigneeFilter !== "UNASSIGNED") {
    groups.push(...memberGroups);
  }

  if (assigneeFilter === "ALL" || assigneeFilter === "UNASSIGNED") {
    const unassignedTasks = tasks.filter((task) => (task.assignees?.length ?? 0) === 0 && hasOwnSchedule(task));

    if (unassignedTasks.length > 0 || assigneeFilter === "UNASSIGNED") {
      groups.push({
        id: "unassigned",
        name: "未分配",
        email: "",
        user: null,
        tasks: unassignedTasks,
        summarySegments: mergeGanttTaskRangeSegments(unassignedTasks)
      });
    }
  }

  return groups;
}

function buildPeopleTaskRows(group: PeopleGanttGroup, collapsedRowIds: Set<string>) {
  const tasks = group.tasks;
  const taskIds = new Set(tasks.map((task) => task.id));
  const childrenByParentId = new Map<string, GanttTask[]>();

  tasks.forEach((task) => {
    if (!task.parentId || !taskIds.has(task.parentId)) {
      return;
    }

    childrenByParentId.set(task.parentId, [...(childrenByParentId.get(task.parentId) ?? []), task]);
  });

  function visit(task: GanttTask, localDepth: number): PeopleGanttRow[] {
    const children = childrenByParentId.get(task.id) ?? [];
    const row: PeopleGanttRow = {
      id: `${group.id}:task:${task.id}`,
      kind: "TASK",
      group,
      task,
      depth: localDepth + 1,
      hasChildren: children.length > 0
    };

    if (collapsedRowIds.has(row.id)) {
      return [row];
    }

    return [
      row,
      ...children.flatMap((child) => visit(child, localDepth + 1))
    ];
  }

  return tasks
    .filter((task) => !task.parentId || !taskIds.has(task.parentId))
    .flatMap((task) => visit(task, 0));
}

function flattenPeopleGroups(groups: PeopleGanttGroup[], collapsedRowIds: Set<string>) {
  return groups.flatMap<PeopleGanttRow>((group) => {
    const groupRow: PeopleGanttRow = {
      id: group.id,
      kind: "PERSON",
      group,
      task: null,
      depth: 0,
      hasChildren: group.tasks.length > 0
    };

    if (collapsedRowIds.has(group.id)) {
      return [groupRow];
    }

    return [
      groupRow,
      ...buildPeopleTaskRows(group, collapsedRowIds)
    ];
  });
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

export function ProjectGanttPage({ viewMode = "TASK" }: { viewMode?: GanttViewMode }) {
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
  const [savedCollapsedState, setSavedCollapsedState] = useState<{ projectId: string; ids: Set<string> }>({
    projectId: "",
    ids: new Set()
  });
  const [savedPeopleCollapsedState, setSavedPeopleCollapsedState] = useState<{ projectId: string; ids: Set<string> }>({
    projectId: "",
    ids: new Set()
  });
  const [sessionCollapsedIds, setSessionCollapsedIds] = useState<Set<string>>(new Set());
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
    () => getProjectPermissions(user?.id, membersQuery.data, teamMembersQuery.data, isVerifiedSystemAdmin(user)),
    [membersQuery.data, teamMembersQuery.data, user]
  );

  useEffect(() => {
    if (!projectId || savedCollapsedState.projectId === projectId) {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(getCollapsedStorageKey(projectId));
      const parsedValue = rawValue ? JSON.parse(rawValue) : [];
      setSavedCollapsedState({
        projectId,
        ids: new Set(Array.isArray(parsedValue) ? parsedValue.filter((item) => typeof item === "string") : [])
      });
    } catch {
      setSavedCollapsedState({ projectId, ids: new Set() });
    }
  }, [savedCollapsedState.projectId, projectId]);

  useEffect(() => {
    if (!projectId || savedPeopleCollapsedState.projectId === projectId) {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(getPeopleCollapsedStorageKey(projectId));
      const parsedValue = rawValue ? JSON.parse(rawValue) : [];
      setSavedPeopleCollapsedState({
        projectId,
        ids: new Set(Array.isArray(parsedValue) ? parsedValue.filter((item) => typeof item === "string") : [])
      });
    } catch {
      setSavedPeopleCollapsedState({ projectId, ids: new Set() });
    }
  }, [savedPeopleCollapsedState.projectId, projectId]);

  useEffect(() => {
    setSessionCollapsedIds(new Set());
  }, [assigneeFilter, completionFilter, priorityFilter, projectId, taskSearch]);

  const allTasks = useMemo(() => flattenTasks(listsQuery.data ?? []), [listsQuery.data]);
  const hasActiveFilters = Boolean(
    taskSearch.trim() || assigneeFilter !== "ALL" || priorityFilter !== "ALL" || completionFilter !== "ALL"
  );
  const savedCollapsedTaskIds =
    projectId && savedCollapsedState.projectId === projectId ? savedCollapsedState.ids : new Set<string>();
  const collapsedTaskIds = hasActiveFilters ? sessionCollapsedIds : savedCollapsedTaskIds;
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
  const filteredPeopleTasks = useMemo(
    () =>
      allTasks.filter((task) =>
        taskMatchesFilters(task, {
          keyword: taskSearch,
          assigneeId: assigneeFilter,
          priority: priorityFilter,
          completion: completionFilter
        })
      ),
    [allTasks, assigneeFilter, completionFilter, priorityFilter, taskSearch]
  );
  const scheduledTree = useMemo(() => includeScheduledAncestors(filteredTasks), [filteredTasks]);
  const scheduledTasks = useMemo(
    () => filterCollapsedTasks(scheduledTree.tasks, collapsedTaskIds),
    [collapsedTaskIds, scheduledTree.tasks]
  );
  const unscheduledTasks = useMemo(
    () =>
      filterCollapsedTasks(
        filteredTasks.filter(
          (task) =>
            task.barKind === "NONE" && !scheduledTree.scheduledTreeTaskIds.has(task.id)
        ),
        collapsedTaskIds
      ),
    [collapsedTaskIds, filteredTasks, scheduledTree.scheduledTreeTaskIds]
  );
  const timeline = useMemo(() => buildTimeline(scheduledTasks, zoom), [scheduledTasks, zoom]);
  const peopleGroups = useMemo(
    () => buildPeopleGroups(filteredPeopleTasks, membersQuery.data ?? [], assigneeFilter),
    [assigneeFilter, filteredPeopleTasks, membersQuery.data]
  );
  const peopleTimeline = useMemo(
    () => buildTimeline(peopleGroups.flatMap((group) => group.tasks).filter(hasGanttBar), zoom),
    [peopleGroups, zoom]
  );
  const peopleCollapsedGroupIds =
    projectId && savedPeopleCollapsedState.projectId === projectId
      ? savedPeopleCollapsedState.ids
      : new Set<string>();
  const peopleScheduledGroups = useMemo(
    () => peopleGroups.filter((group) => group.tasks.length > 0),
    [peopleGroups]
  );
  const peopleScheduledRows = useMemo(
    () => flattenPeopleGroups(peopleScheduledGroups, peopleCollapsedGroupIds),
    [peopleCollapsedGroupIds, peopleScheduledGroups]
  );
  const activeTimeline = viewMode === "PEOPLE" ? peopleTimeline : timeline;
  const isArchived = projectQuery.data?.status === "ARCHIVED";
  const canReschedule = projectPermissions.canEditProject && !isArchived;
  const unitWidth = GANTT_ZOOM_OPTIONS.find((option) => option.value === zoom)?.unitWidth ?? 72;

  function toggleCollapsedTask(taskId: string) {
    if (!projectId) {
      return;
    }

    if (hasActiveFilters) {
      setSessionCollapsedIds((current) => {
        const nextIds = new Set(current);

        if (nextIds.has(taskId)) {
          nextIds.delete(taskId);
        } else {
          nextIds.add(taskId);
        }

        return nextIds;
      });
      return;
    }

    setSavedCollapsedState((current) => {
      const ids = current.projectId === projectId ? current.ids : new Set<string>();
      const nextIds = new Set(ids);

      if (nextIds.has(taskId)) {
        nextIds.delete(taskId);
      } else {
        nextIds.add(taskId);
      }

      window.localStorage.setItem(getCollapsedStorageKey(projectId), JSON.stringify([...nextIds]));
      return {
        projectId,
        ids: nextIds
      };
    });
  }

  function toggleCollapsedPerson(rowId: string) {
    if (!projectId) {
      return;
    }

    setSavedPeopleCollapsedState((current) => {
      const ids = current.projectId === projectId ? current.ids : new Set<string>();
      const nextIds = new Set(ids);

      if (nextIds.has(rowId)) {
        nextIds.delete(rowId);
      } else {
        nextIds.add(rowId);
      }

      window.localStorage.setItem(getPeopleCollapsedStorageKey(projectId), JSON.stringify([...nextIds]));
      return {
        projectId,
        ids: nextIds
      };
    });
  }

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
    if (!canReschedule || !activeTimeline || event.button !== 0) {
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
    const unitPx = track.getBoundingClientRect().width / activeTimeline.unitCount;
    const minDeltaUnits = mode === "END" ? 1 - width : 1 - left;
    const maxDeltaUnits = mode === "START" ? width - 1 : activeTimeline.unitCount - left - width + 1;

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

    const originalStart = getGanttTaskStart(current.task);
    const originalEnd = getGanttTaskEnd(current.task);

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

  function renderTaskBar(task: GanttTask, currentTimeline: NonNullable<ReturnType<typeof buildTimeline>>) {
    const start = getGanttTaskStart(task);
    const end = getGanttTaskEnd(task);
    const isSummaryBar = task.barKind === "SUMMARY";
    const hasBar = Boolean(start && end && task.barKind !== "NONE");

    if (!hasBar) {
      return null;
    }

    const left = diffUnits(currentTimeline.start, start!, zoom) + 1;
    const width = Math.max(diffUnits(start!, end!, zoom) + 1, 1);
    const isReschedulable = canReschedule && task.barKind === "TASK";
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
      <button
        className={`gantt-bar ${task.status === "DONE" ? "done" : ""} ${isSummaryBar ? "summary" : ""} ${
          dragState?.task.id === task.id ? "dragging" : ""
        }`}
        type="button"
        data-reschedulable={isReschedulable ? "true" : "false"}
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
        onPointerCancel={isReschedulable ? (event) => finishTaskBarDrag(event, task.id) : undefined}
        onPointerDown={isReschedulable ? (event) => handleTaskBarPointerDown(event, task, left, width) : undefined}
        onPointerMove={isReschedulable ? (event) => handleTaskBarPointerMove(event, task.id) : undefined}
        onPointerUp={isReschedulable ? (event) => finishTaskBarDrag(event, task.id) : undefined}
      >
        {isReschedulable ? <span className="gantt-resize-handle left" data-edge="left" aria-hidden="true" /> : null}
        {isReschedulable ? <span className="gantt-resize-handle right" data-edge="right" aria-hidden="true" /> : null}
      </button>
    );
  }

  function renderPeopleSummaryBar(group: PeopleGanttGroup, currentTimeline: NonNullable<ReturnType<typeof buildTimeline>>) {
    if (group.summarySegments.length === 0) {
      return null;
    }

    return (
      <>
        {group.summarySegments.map((segment, index) => {
          const left = diffUnits(currentTimeline.start, segment.start, zoom) + 1;
          const width = Math.max(diffUnits(segment.start, segment.end, zoom) + 1, 1);
          const title = `${group.name} 汇总 ${formatCalendarDate(segment.start.toISOString())} - ${formatCalendarDate(
            segment.end.toISOString()
          )}`;

          return (
            <span
              className="gantt-bar people-gantt-summary-bar"
              key={`${segment.start.toISOString()}:${segment.end.toISOString()}:${index}`}
              style={
                {
                  "--gantt-left": left,
                  "--gantt-width": width
                } as CSSProperties
              }
              title={title}
              aria-label={title}
            />
          );
        })}
      </>
    );
  }

  function renderTaskScheduledGrid() {
    if (!timeline || scheduledTasks.length === 0) {
      return null;
    }

    return (
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
            const isSummaryBar = task.barKind === "SUMMARY";

            return (
              <div className="gantt-row" key={task.id}>
                <div className="gantt-task-title" style={{ paddingLeft: `${task.depth * 18 + 12}px` }}>
                  <GanttTreeToggle task={task} collapsed={collapsedTaskIds.has(task.id)} onToggle={toggleCollapsedTask} />
                  <button className="gantt-task-title-button" type="button" onClick={() => openTask(task.id)}>
                    <span className="gantt-task-title-main">
                      <span className={`gantt-task-title-text ${task.depth === 0 ? "root" : "child"}`}>
                        {task.title}
                      </span>
                      <small>
                        {task.listName}
                        {isSummaryBar ? " · 子任务汇总" : ""}
                        {task.barKind === "NONE" ? " · 未排期" : ""}
                      </small>
                    </span>
                  </button>
                  <GanttAssigneeAvatars assignees={task.assignees} />
                </div>
                <div className="gantt-track">{renderTaskBar(task, timeline)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderPeopleScheduledGrid() {
    if (!peopleTimeline || peopleScheduledRows.length === 0) {
      return null;
    }

    return (
      <div className="gantt-scroll">
        <div
          className="gantt-grid people-gantt-grid"
          style={
            {
              "--gantt-units": peopleTimeline.unitCount,
              "--gantt-unit-width": `${unitWidth}px`
            } as CSSProperties
          }
        >
          <div className="gantt-header gantt-task-column">人员 / 任务</div>
          <div className="gantt-header gantt-date-column">
            {peopleTimeline.units.map((unit) => (
              <span key={unit.toISOString()}>{formatTimelineUnit(unit, zoom)}</span>
            ))}
          </div>
          {peopleScheduledRows.map((row) => {
            if (row.kind === "PERSON") {
              const collapsed = peopleCollapsedGroupIds.has(row.group.id);

              return (
                <div className="gantt-row" key={row.id}>
                  <div className="gantt-task-title people-gantt-person-title">
                    <PeopleTreeToggle
                      label={row.group.name}
                      hasChildren={row.hasChildren}
                      collapsed={collapsed}
                      onToggle={() => toggleCollapsedPerson(row.group.id)}
                    />
                    <span className="people-gantt-person">
                      {row.group.user ? <UserAvatar user={row.group.user} size="xs" /> : null}
                      <span className="gantt-task-title-main">
                        <span className="gantt-task-title-text root">{row.group.name}</span>
                        <small>{row.group.email || `${row.group.tasks.length} 个未分配任务`}</small>
                      </span>
                    </span>
                    <span className="muted people-gantt-count">{row.group.tasks.length} 个任务</span>
                  </div>
                  <div className="gantt-track people-gantt-group-track">
                    {renderPeopleSummaryBar(row.group, peopleTimeline)}
                  </div>
                </div>
              );
            }

            const levelMarker = getTaskLevelMarker(row.task);

            return (
              <div className="gantt-row" key={row.id}>
                <div
                  className="gantt-task-title people-gantt-task-title"
                  style={{ paddingLeft: `${row.depth * 18 + 12}px` }}
                >
                  <PeopleTreeToggle
                    label={row.task.title}
                    hasChildren={row.hasChildren}
                    collapsed={peopleCollapsedGroupIds.has(row.id)}
                    onToggle={() => toggleCollapsedPerson(row.id)}
                  />
                  <button className="gantt-task-title-button" type="button" onClick={() => openTask(row.task.id)}>
                    <span className="gantt-task-title-main">
                      <span className="people-gantt-task-name-row">
                        <span className="gantt-task-title-text child">{row.task.title}</span>
                        {levelMarker ? <span className="task-level-badge">{levelMarker}</span> : null}
                      </span>
                      <small>{row.task.listName}</small>
                    </span>
                  </button>
                  <span className={`${getPriorityClassName(row.task.priority)} priority-pill`}>
                    {getPriorityLabel(row.task.priority)}
                  </span>
                </div>
                <div className="gantt-track">{renderTaskBar(row.task, peopleTimeline)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
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
          <Link
            className={viewMode === "TASK" ? "active" : ""}
            aria-current={viewMode === "TASK" ? "page" : undefined}
            to={`/projects/${projectId}/gantt`}
          >
            甘特图(任务)
          </Link>
          <Link
            className={viewMode === "PEOPLE" ? "active" : ""}
            aria-current={viewMode === "PEOPLE" ? "page" : undefined}
            to={`/projects/${projectId}/gantt/people`}
          >
            甘特图(人员)
          </Link>
          {projectId && projectPermissions.canManageProject ? (
            <Link to={`/projects/${projectId}/settings`} state={{ returnTo: location.pathname }}>
              设置
            </Link>
          ) : null}
          {projectPermissions.canManageProject ? <Link to={`/projects/${projectId}/trash`}>回收站</Link> : null}
        </nav>
      </div>
      {isArchived ? (
        <section className="notice-panel">
          这个项目已归档，当前{viewMode === "PEOPLE" ? "人员甘特图" : "任务甘特图"}为只读状态。
        </section>
      ) : null}
      <section className="board-filters">
        <input
          value={taskSearch}
          onChange={(event) => setTaskSearch(event.target.value)}
          placeholder="搜索任务、负责人或标签"
        />
        <Select
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            { value: "ALL", label: "全部负责人" },
            { value: "UNASSIGNED", label: "未分配" },
            ...(membersQuery.data ?? []).map((member) => ({
              value: member.id,
              label: getMemberName(member),
              description: member.email,
              user: getMemberUser(member)
            }))
          ]}
        />
        <Select
          value={priorityFilter}
          onChange={setPriorityFilter}
          options={[
            { value: "ALL", label: "全部优先级" },
            ...PRIORITY_OPTIONS.map((option) => ({ ...option, priority: option.value }))
          ]}
        />
        <Select
          value={completionFilter}
          onChange={(value) => setCompletionFilter(value as typeof completionFilter)}
          options={[
            { value: "ALL", label: "全部完成状态" },
            { value: "OPEN", label: "未完成" },
            { value: "DONE", label: "已完成" }
          ]}
        />
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
      <section className="gantt-panel" aria-label={viewMode === "PEOPLE" ? "甘特图(人员)" : "甘特图(任务)"}>
        {listsQuery.isLoading ? (
          <span className="muted">{viewMode === "PEOPLE" ? "人员甘特图加载中..." : "任务甘特图加载中..."}</span>
        ) : null}
        {!listsQuery.isLoading && allTasks.length === 0 ? (
          <section className="empty-state">
            <h2>暂无任务</h2>
            <span>创建带开始日期或截止日期的任务后，会在这里看到排期。</span>
          </section>
        ) : null}
        {viewMode === "PEOPLE" ? renderPeopleScheduledGrid() : renderTaskScheduledGrid()}
        {!listsQuery.isLoading &&
        allTasks.length > 0 &&
        (viewMode === "PEOPLE" ? peopleScheduledRows.length === 0 : scheduledTasks.length === 0) ? (
          <section className="notice-panel">
            当前{viewMode === "PEOPLE" ? "人员任务" : "任务"}没有可展示的开始日期或截止日期。
          </section>
        ) : null}
        {viewMode === "TASK" && unscheduledTasks.length > 0 ? (
          <section className="gantt-unscheduled">
            <h2>未排期任务</h2>
            <div className="gantt-unscheduled-table">
              <div className="gantt-unscheduled-header">
                <span>任务</span>
                <span>优先级</span>
                <span>负责人</span>
              </div>
              {unscheduledTasks.map((task) => (
                <div className="gantt-unscheduled-row" key={task.id}>
                  <span
                    className="gantt-unscheduled-title"
                    style={{ "--gantt-task-depth": task.depth } as CSSProperties}
                  >
                    <GanttTreeToggle
                      task={task}
                      collapsed={collapsedTaskIds.has(task.id)}
                      onToggle={toggleCollapsedTask}
                    />
                    <button className="gantt-unscheduled-title-button" type="button" onClick={() => openTask(task.id)}>
                      <span className={`gantt-unscheduled-title-text ${task.depth === 0 ? "root" : "child"}`}>
                        {task.title}
                      </span>
                      <small>{task.listName}</small>
                    </button>
                  </span>
                  <span className={`${getPriorityClassName(task.priority)} priority-pill`}>
                    {getPriorityLabel(task.priority)}
                  </span>
                  <GanttAssigneeAvatars assignees={task.assignees} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
