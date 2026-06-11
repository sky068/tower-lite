import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { openDateInputPicker } from "../../lib/dateInput";
import { formatCalendarDate } from "../../lib/dateTime";
import { getProjectPermissions } from "../../lib/permissions";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { TASK_STATUS_OPTIONS } from "../../lib/taskStatus";
import { useAuthStore } from "../../stores/authStore";
import type { Task, TaskList, TaskStatus } from "../../types/api";

function formatAssigneeName(assignee: { name: string; isRemoved?: boolean }) {
  return assignee.isRemoved ? `${assignee.name}(已移除)` : assignee.name;
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
  assigneeId: string;
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

  return (
    <div className="project-task-list-node">
      <div className={task.completedAt ? "project-task-list-row completed" : "project-task-list-row"}>
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
          {task.assignees && task.assignees.length > 0 ? (
            task.assignees.map((assignee) => (
              <span className="assignee-chip" key={assignee.id}>
                <UserAvatar user={assignee} size="xs" />
                <span>{formatAssigneeName(assignee)}</span>
              </span>
            ))
          ) : (
            <span className="project-task-unassigned">未分配</span>
          )}
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
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useState<string[]>([]);
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>("TODO");
  const [newTaskPriority, setNewTaskPriority] = useState<Task["priority"]>("MEDIUM");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskDateError, setNewTaskDateError] = useState("");

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
    () => getProjectPermissions(user?.id, membersQuery.data, teamMembersQuery.data, user?.systemRole === "ADMIN"),
    [membersQuery.data, teamMembersQuery.data, user?.id, user?.systemRole]
  );
  const assignableMembers = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const assignableMemberIds = useMemo(
    () => new Set(assignableMembers.map((member) => member.user.id)),
    [assignableMembers]
  );
  const defaultNewTaskAssigneeIds = useMemo(
    () => (user?.id && assignableMemberIds.has(user.id) ? [user.id] : []),
    [assignableMemberIds, user?.id]
  );
  const lists = listsQuery.data ?? [];
  const filteredLists = useMemo(
    () =>
      lists.map((list) => ({
        ...list,
        tasks: getFilteredTreeTasks(list.tasks, {
          keyword: taskSearch,
          assigneeId: assigneeFilter,
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
      assigneeIds?: string[];
      status?: TaskStatus;
      priority?: Task["priority"];
      startDate?: string | null;
      dueDate?: string | null;
    }) =>
      boardApi.createTask(projectId!, {
        taskListId: input.taskListId,
        title: input.title,
        description: input.description ?? undefined,
        assigneeIds: input.assigneeIds,
        status: input.status,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate
      }),
    onSuccess: () => {
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskAssigneeIds(defaultNewTaskAssigneeIds);
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
    setNewTaskAssigneeIds(defaultNewTaskAssigneeIds);
    setNewTaskDateError("");
    setIsCreateTaskOpen(true);
  }

  useEffect(() => {
    setNewTaskAssigneeIds((current) =>
      current.filter((assigneeId) => assignableMemberIds.has(assigneeId))
    );
  }, [assignableMemberIds]);

  function toggleNewTaskAssignee(userId: string, checked: boolean) {
    setNewTaskAssigneeIds((current) =>
      checked
        ? [...new Set([...current, userId])]
        : current.filter((assigneeId) => assigneeId !== userId)
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
      assigneeIds: newTaskAssigneeIds.filter((assigneeId) => assignableMemberIds.has(assigneeId)),
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
            甘特图
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
        <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
          <option value="ALL">全部负责人</option>
          <option value="UNASSIGNED">未分配</option>
          {assignableMembers.map((member) => (
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
                <select
                  value={newTaskStatus}
                  onChange={(event) => setNewTaskStatus(event.target.value as TaskStatus)}
                >
                  {TASK_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                清单
                <select value={newTaskListId} onChange={(event) => setNewTaskListId(event.target.value)}>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="checkbox-field">
                <legend>指派给</legend>
                <div className="checkbox-list">
                  {assignableMembers.map((member) => (
                    <label className="checkbox-row" key={member.user.id}>
                      <input
                        type="checkbox"
                        checked={newTaskAssigneeIds.includes(member.user.id)}
                        onChange={(event) =>
                          toggleNewTaskAssignee(member.user.id, event.target.checked)
                        }
                      />
                      <UserAvatar user={member.user} size="xs" />
                      <span>{member.user.name}</span>
                    </label>
                  ))}
                  {assignableMembers.length === 0 ? (
                    <span className="muted">暂无可选成员</span>
                  ) : null}
                </div>
              </fieldset>
              <label>
                优先级
                <select
                  value={newTaskPriority}
                  onChange={(event) => setNewTaskPriority(event.target.value as typeof newTaskPriority)}
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
