import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MemberCheckboxDropdown } from "../../components/shared/MemberCheckboxPicker";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { Select } from "../../components/shared/Select";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { openDateInputPicker } from "../../lib/dateInput";
import { formatCalendarDate } from "../../lib/dateTime";
import { getMemberName, getMemberUser, isVerifiedSystemAdmin } from "../../lib/members";
import { useModalScrollLock } from "../../lib/modalScrollLock";
import { getProjectPermissions } from "../../lib/permissions";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { TASK_STATUS_OPTIONS } from "../../lib/taskStatus";
import { useAuthStore } from "../../stores/authStore";
import type { Task, TaskList, TaskStatus } from "../../types/api";

function formatAssigneeName(assignee: { name: string; status?: string }) {
  return assignee.status === "REMOVED" ? `${assignee.name}(已移除)` : assignee.name;
}

type TaskAssignee = NonNullable<Task["assignees"]>[number];

function AssigneeChip({ assignee }: { assignee: TaskAssignee }) {
  return (
    <span className="assignee-chip">
      <UserAvatar user={assignee} size="xs" />
      <span>{formatAssigneeName(assignee)}</span>
    </span>
  );
}

function TaskAssigneesCell({ assignees }: { assignees?: Task["assignees"] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const visibleAssignees = assignees?.slice(0, 2) ?? [];
  const hiddenAssignees = assignees?.slice(2) ?? [];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function updatePopoverPosition() {
    const button = moreButtonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = 190;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));

    setPopoverPosition({
      top: Math.max(8, rect.top - 8),
      left
    });
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePopoverPosition();

    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen]);

  if (visibleAssignees.length === 0) {
    return <span className="project-task-unassigned">未分配</span>;
  }

  return (
    <span className="project-task-assignee-summary" ref={rootRef}>
      {visibleAssignees.map((assignee) => (
        <AssigneeChip assignee={assignee} key={assignee.id} />
      ))}
      {hiddenAssignees.length > 0 ? (
        <>
          <button
            className="project-task-assignee-more"
            ref={moreButtonRef}
            type="button"
            aria-label={`查看另外 ${hiddenAssignees.length} 位负责人`}
            aria-expanded={isOpen}
            onClick={() => {
              updatePopoverPosition();
              setIsOpen((current) => !current);
            }}
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
          {isOpen ? (
            <span
              className="project-task-assignee-popover"
              role="list"
              style={popoverPosition ? { left: popoverPosition.left, top: popoverPosition.top } : undefined}
            >
              {assignees?.map((assignee) => (
                <span className="project-task-assignee-popover-item" role="listitem" key={assignee.id}>
                  <UserAvatar user={assignee} size="xs" />
                  <span>{formatAssigneeName(assignee)}</span>
                </span>
              ))}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

function formatDateRange(task: Task) {
  if (task.startDate && task.dueDate) {
    return `${formatCalendarDate(task.startDate)}-${formatCalendarDate(task.dueDate)}`;
  }

  if (task.dueDate) {
    return formatCalendarDate(task.dueDate);
  }

  if (task.startDate) {
    return `${formatCalendarDate(task.startDate)}-`;
  }

  return "-";
}

function buildTaskTree(tasks: Task[]) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const childrenByParentId = new Map<string, Task[]>();

  tasks.forEach((task) => {
    if (!task.parentId || !taskIds.has(task.parentId)) {
      return;
    }

    childrenByParentId.set(task.parentId, [...(childrenByParentId.get(task.parentId) ?? []), task]);
  });

  return {
    roots: tasks.filter((task) => !task.parentId || !taskIds.has(task.parentId)),
    childrenByParentId
  };
}

function getFilteredTreeTasks(tasks: Task[], filters: {
  keyword: string;
  projectMemberId: string;
  priority: string;
  completion: "OPEN" | "DONE" | "ALL";
}) {
  const keyword = filters.keyword.trim().toLowerCase();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const includedTaskIds = new Set<string>();

  function matchesTask(task: Task) {
    const matchesKeyword =
      !keyword ||
      task.title.toLowerCase().includes(keyword) ||
      (task.assignees ?? []).some((assignee) => assignee.name.toLowerCase().includes(keyword)) ||
      (task.tags ?? []).some((tag) => tag.name.toLowerCase().includes(keyword));
    const matchesAssignee =
      filters.projectMemberId === "ALL" ||
      (filters.projectMemberId === "UNASSIGNED" && (task.assignees?.length ?? 0) === 0) ||
      (task.assignees ?? []).some((assignee) => assignee.id === filters.projectMemberId);
    const matchesPriority = filters.priority === "ALL" || task.priority === filters.priority;
    const matchesCompletion =
      filters.completion === "ALL" ||
      (filters.completion === "OPEN" && task.status !== "DONE") ||
      (filters.completion === "DONE" && task.status === "DONE");

    return matchesKeyword && matchesAssignee && matchesPriority && matchesCompletion;
  }

  function includeWithAncestors(task: Task) {
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

type TaskTreeRowsProps = {
  tasks: Task[];
  childrenByParentId: Map<string, Task[]>;
  depth?: number;
  onOpenTask: (taskId: string) => void;
};

function TaskTreeRows({ tasks, childrenByParentId, depth = 0, onOpenTask }: TaskTreeRowsProps) {
  return (
    <>
      {tasks.map((task) => {
        return (
          <TaskTreeRow
            childrenByParentId={childrenByParentId}
            depth={depth}
            key={task.id}
            onOpenTask={onOpenTask}
            task={task}
          />
        );
      })}
    </>
  );
}

function TaskTreeRow({
  task,
  childrenByParentId,
  depth,
  onOpenTask
}: {
  task: Task;
  childrenByParentId: Map<string, Task[]>;
  depth: number;
  onOpenTask: (taskId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = childrenByParentId.get(task.id) ?? [];
  const hasChildren = children.length > 0;
  const completedSubTaskCount = children.filter((child) => child.status === "DONE" || child.completedAt).length;
  const rowClassName = [
    "project-task-list-row",
    depth === 0 ? "root" : "child",
    task.completedAt ? "completed" : null
  ].filter(Boolean).join(" ");

  return (
    <div className="project-task-list-node">
      <div className={rowClassName}>
        <span className="project-task-title-cell" style={{ paddingLeft: `${depth * 22}px` }}>
          {hasChildren ? (
            <button
              className="tree-toggle-button"
              type="button"
              aria-label={`${isExpanded ? "收起" : "展开"}${task.title}`}
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((current) => !current)}
            >
              {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <button className="project-task-title-button" type="button" onClick={() => onOpenTask(task.id)}>
            <span>{task.title}</span>
            {hasChildren ? (
              <span className="project-task-subtask-count">
                ({completedSubTaskCount}/{children.length})
              </span>
            ) : null}
          </button>
        </span>
        <span
          className={`${getPriorityClassName(task.priority)} project-task-priority-square`}
          title={getPriorityLabel(task.priority)}
        >
          {getPriorityLabel(task.priority)}
        </span>
        <span className="project-task-date-cell">{formatDateRange(task)}</span>
        <span className="project-task-assignees-cell">
          <TaskAssigneesCell assignees={task.assignees} />
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <TaskTreeRows
          tasks={children}
          childrenByParentId={childrenByParentId}
          depth={depth + 1}
          onOpenTask={onOpenTask}
        />
      ) : null}
    </div>
  );
}

function ProjectTaskListGroup({
  list,
  canCreateTask,
  onCreateTask,
  onOpenTask
}: {
  list: TaskList;
  canCreateTask: boolean;
  onCreateTask: (taskListId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const tree = useMemo(() => buildTaskTree(list.tasks), [list.tasks]);

  return (
    <section className="project-task-list-group" aria-label={`${list.name}清单`}>
      <div className="project-task-list-group-header">
        <button
          className="project-task-list-group-toggle"
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <strong>{list.name}</strong>
          <span>{list.tasks.length} 个任务</span>
        </button>
        {canCreateTask ? (
          <button
            className="icon-button compact-icon-button"
            type="button"
            aria-label={`在${list.name}新建任务`}
            title="新建任务"
            onClick={() => onCreateTask(list.id)}
          >
            <Plus size={16} />
          </button>
        ) : null}
      </div>
      {isExpanded ? (
        <div className="project-task-list-table">
          {tree.roots.length > 0 ? (
            <TaskTreeRows
              tasks={tree.roots}
              childrenByParentId={tree.childrenByParentId}
              onOpenTask={onOpenTask}
            />
          ) : (
            <span className="project-task-list-empty muted">暂无任务</span>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ProjectTaskListPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [taskSearch, setTaskSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [completionFilter, setCompletionFilter] = useState<"OPEN" | "DONE" | "ALL">("ALL");
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskListId, setNewTaskListId] = useState("");
  const [newTaskProjectMemberIds, setNewTaskProjectMemberIds] = useState<string[]>([]);
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>("TODO");
  const [newTaskPriority, setNewTaskPriority] = useState<Task["priority"]>("MEDIUM");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskDateError, setNewTaskDateError] = useState("");

  useModalScrollLock(isCreateTaskOpen);

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
  const assignableMembers = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const assignableMemberIds = useMemo(
    () => new Set(assignableMembers.map((member) => member.id)),
    [assignableMembers]
  );
  const currentUserProjectMember = useMemo(
    () => assignableMembers.find((member) => member.user?.id === user?.id),
    [assignableMembers, user?.id]
  );
  const defaultNewTaskProjectMemberIds = useMemo(
    () => (currentUserProjectMember ? [currentUserProjectMember.id] : []),
    [currentUserProjectMember]
  );
  const lists = listsQuery.data ?? [];
  const filteredLists = useMemo(
    () =>
      lists.map((list) => ({
        ...list,
        tasks: getFilteredTreeTasks(list.tasks, {
          keyword: taskSearch,
          projectMemberId: assigneeFilter,
          priority: priorityFilter,
          completion: completionFilter
        })
      })),
    [assigneeFilter, completionFilter, lists, priorityFilter, taskSearch]
  );
  const totalTaskCount = lists.reduce((sum, list) => sum + list.tasks.length, 0);
  const visibleTaskCount = filteredLists.reduce((sum, list) => sum + list.tasks.length, 0);
  const isArchived = projectQuery.data?.status === "ARCHIVED";
  const canCreateTask = projectPermissions.canEditProject && !isArchived;

  const createTaskMutation = useMutation({
    mutationFn: (input: {
      taskListId: string;
      title: string;
      description?: string | null;
      projectMemberIds?: string[];
      status?: TaskStatus;
      priority?: Task["priority"];
      startDate?: string | null;
      dueDate?: string | null;
    }) =>
      boardApi.createTask(projectId!, {
        taskListId: input.taskListId,
        title: input.title,
        description: input.description ?? undefined,
        projectMemberIds: input.projectMemberIds,
        status: input.status,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate
      }),
    onSuccess: () => {
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskProjectMemberIds(defaultNewTaskProjectMemberIds);
      setNewTaskStatus("TODO");
      setNewTaskPriority("MEDIUM");
      setNewTaskStartDate("");
      setNewTaskDueDate("");
      setNewTaskDateError("");
      setIsCreateTaskOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
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

  function openCreateTaskModal(taskListId: string) {
    if (!canCreateTask) {
      return;
    }

    setNewTaskListId(taskListId);
    setNewTaskProjectMemberIds(defaultNewTaskProjectMemberIds);
    setNewTaskDateError("");
    setIsCreateTaskOpen(true);
  }

  useEffect(() => {
    setNewTaskProjectMemberIds((current) =>
      current.filter((projectMemberId) => assignableMemberIds.has(projectMemberId))
    );
  }, [assignableMemberIds]);

  function toggleNewTaskProjectMember(userId: string, checked: boolean) {
    setNewTaskProjectMemberIds((current) =>
      checked
        ? [...new Set([...current, userId])]
        : current.filter((projectMemberId) => projectMemberId !== userId)
    );
  }

  function handleCreateTask(event: FormEvent) {
    event.preventDefault();
    const title = newTaskTitle.trim();

    if (newTaskStartDate && newTaskDueDate && newTaskStartDate > newTaskDueDate) {
      setNewTaskDateError("开始日期不能晚于截止日期。");
      return;
    }

    setNewTaskDateError("");

    if (!title || !projectId || !newTaskListId || !canCreateTask) {
      return;
    }

    createTaskMutation.mutate({
      taskListId: newTaskListId,
      title,
      description: newTaskDescription.trim() || null,
      projectMemberIds: newTaskProjectMemberIds.filter((projectMemberId) => assignableMemberIds.has(projectMemberId)),
      status: newTaskStatus,
      priority: newTaskPriority,
      startDate: newTaskStartDate || null,
      dueDate: newTaskDueDate || null
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
          <Link to={`/projects/${projectId}/board`}>
            看板
          </Link>
          <Link className="active" aria-current="page" to={`/projects/${projectId}/list`}>
            列表
          </Link>
          <Link to={`/projects/${projectId}/gantt`}>
            甘特图(任务)
          </Link>
          <Link to={`/projects/${projectId}/gantt/people`}>
            甘特图(人员)
          </Link>
          {projectId && projectPermissions.canManageProject ? (
            <Link
              to={`/projects/${projectId}/settings`}
              state={{ returnTo: location.pathname }}
            >
              设置
            </Link>
          ) : null}
          {projectPermissions.canManageProject ? (
            <Link to={`/projects/${projectId}/trash`}>
              回收站
            </Link>
          ) : null}
        </nav>
      </div>
      {isArchived ? (
        <section className="notice-panel">
          这个项目已归档，当前列表为只读状态。
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
            ...assignableMembers.map((member) => ({
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
      <section className="project-task-list-view">
        {listsQuery.isLoading ? <span className="muted">列表加载中...</span> : null}
        <MutationError error={listsQuery.error} />
        {!listsQuery.isLoading && totalTaskCount > 0 && visibleTaskCount === 0 ? (
          <section className="notice-panel">
            当前筛选条件隐藏了所有任务，可以切换为“全部完成状态”或清空搜索条件查看。
          </section>
        ) : null}
        {!listsQuery.isLoading && !listsQuery.error && lists.length === 0 ? (
          <section className="empty-state">
            <h2>暂无清单</h2>
            <span>项目暂无可用清单，请刷新后重试</span>
          </section>
        ) : null}
        {filteredLists.length > 0 ? (
          <div className="project-task-list-shell">
            <div className="project-task-list-shell-inner">
              <div className="project-task-list-head" role="row">
                <span>任务标题</span>
                <span>优先级</span>
                <span>截止时间</span>
                <span>负责人</span>
              </div>
              {filteredLists.map((list) => (
                <ProjectTaskListGroup
                  canCreateTask={canCreateTask}
                  list={list}
                  key={list.id}
                  onCreateTask={openCreateTaskModal}
                  onOpenTask={openTask}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {isCreateTaskOpen ? (
        <div className="modal-backdrop">
          <section className="modal" aria-label="新建任务">
            <header className="modal-header">
              <h2>新建任务</h2>
              <button className="text-button" type="button" onClick={() => setIsCreateTaskOpen(false)}>
                关闭
              </button>
            </header>
            <MutationError error={createTaskMutation.error} />
            <form className="modal-form" onSubmit={handleCreateTask}>
              <label>
                标题
                <input
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  required
                />
              </label>
              <label>
                描述
                <textarea
                  value={newTaskDescription}
                  onChange={(event) => setNewTaskDescription(event.target.value)}
                  rows={3}
                />
              </label>
              <label>
                状态
                <Select
                  value={newTaskStatus}
                  onChange={(value) => setNewTaskStatus(value as TaskStatus)}
                  options={TASK_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
              </label>
              <label>
                清单
                <Select
                  value={newTaskListId}
                  onChange={setNewTaskListId}
                  options={lists.map((list) => ({ value: list.id, label: list.name }))}
                />
              </label>
              <fieldset className="checkbox-field">
                <legend>指派给</legend>
                <MemberCheckboxDropdown
                  members={assignableMembers}
                  selectedIds={newTaskProjectMemberIds}
                  onToggle={toggleNewTaskProjectMember}
                />
              </fieldset>
              <label>
                优先级
                <Select
                  value={newTaskPriority}
                  onChange={(value) => setNewTaskPriority(value as typeof newTaskPriority)}
                  options={PRIORITY_OPTIONS.map((option) => ({ ...option, priority: option.value }))}
                />
              </label>
              <div className="form-grid-2">
                <label>
                  开始日期
                  <input
                    type="date"
                    value={newTaskStartDate}
                    max={newTaskDueDate || undefined}
                    onClick={(event) => openDateInputPicker(event.currentTarget)}
                    onChange={(event) => setNewTaskStartDate(event.target.value)}
                  />
                </label>
                <label>
                  截止日期
                  <input
                    type="date"
                    value={newTaskDueDate}
                    min={newTaskStartDate || undefined}
                    onClick={(event) => openDateInputPicker(event.currentTarget)}
                    onChange={(event) => setNewTaskDueDate(event.target.value)}
                  />
                </label>
              </div>
              {newTaskDateError ? <span className="form-error inline-error">{newTaskDateError}</span> : null}
              <button type="submit" disabled={createTaskMutation.isPending}>
                创建
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
