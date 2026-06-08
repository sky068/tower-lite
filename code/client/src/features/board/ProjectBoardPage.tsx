import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { boardApi, projectApi, teamApi } from "../../lib/api";
import { openDateInputPicker } from "../../lib/dateInput";
import { getProjectPermissions } from "../../lib/permissions";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { useAuthStore } from "../../stores/authStore";
import type { TaskList } from "../../types/api";

const reservedTaskListNames = new Set(["待处理", "进行中", "已完成"]);

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : null;
}

function formatAssigneeName(assignee: { name: string; isRemoved?: boolean }) {
  return assignee.isRemoved ? `${assignee.name}(已移除)` : assignee.name;
}

export function ProjectBoardPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const listDropCommittedRef = useRef(false);
  const [listDraftNames, setListDraftNames] = useState<Record<string, string>>({});
  const [listName, setListName] = useState("");
  const [listNameError, setListNameError] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [orderedListIds, setOrderedListIds] = useState<string[]>([]);
  const [pendingDeleteListId, setPendingDeleteListId] = useState<string | null>(null);
  const [deleteTargetListId, setDeleteTargetListId] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [completionFilter, setCompletionFilter] = useState<"OPEN" | "DONE" | "ALL">("ALL");
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskListId, setNewTaskListId] = useState("");
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useState<string[]>([]);
  const [newTaskPriority, setNewTaskPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [newTaskStartDate, setNewTaskStartDate] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskDateError, setNewTaskDateError] = useState("");
  const listsQuery = useQuery({
    queryKey: ["board", projectId],
    queryFn: () => boardApi.lists(projectId!),
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

  const lists = listsQuery.data ?? [];
  const projectPermissions = useMemo(
    () => getProjectPermissions(user?.id, membersQuery.data, teamMembersQuery.data),
    [membersQuery.data, teamMembersQuery.data, user?.id]
  );
  const canUseOrderedLists =
    orderedListIds.length === lists.length &&
    orderedListIds.every((listId) => lists.some((list) => list.id === listId));
  const displayedLists = canUseOrderedLists
    ? orderedListIds
        .map((listId) => lists.find((list) => list.id === listId))
        .filter((list): list is TaskList => Boolean(list))
    : lists;
  const totalTaskCount = lists.reduce((sum, list) => sum + list.tasks.length, 0);
  const visibleTaskCount = displayedLists.reduce((sum, list) => sum + getFilteredTasks(list.id).length, 0);
  const isArchived = projectQuery.data?.status === "ARCHIVED";
  const canEditProjectBoard = projectPermissions.canEditProject && !isArchived;
  const canManageTaskLists = projectPermissions.canManageProject && !isArchived;
  const defaultTaskListId = lists.find((list) => list.type === "TODO")?.id ?? lists[0]?.id ?? "";

  const createTaskMutation = useMutation({
    mutationFn: (input: {
      taskListId: string;
      title: string;
      description?: string | null;
      assigneeIds?: string[];
      priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
      startDate?: string | null;
      dueDate?: string | null;
    }) =>
      boardApi.createTask(projectId!, {
        taskListId: input.taskListId,
        title: input.title,
        description: input.description ?? undefined,
        assigneeIds: input.assigneeIds,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate
      }),
    onSuccess: () => {
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskListId(defaultTaskListId);
      setNewTaskAssigneeIds(user?.id ? [user.id] : []);
      setNewTaskPriority("MEDIUM");
      setNewTaskStartDate("");
      setNewTaskDueDate("");
      setNewTaskDateError("");
      setIsCreateTaskOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const createListMutation = useMutation({
    mutationFn: (name: string) => boardApi.createList(projectId!, { name }),
    onSuccess: () => {
      setListName("");
      setListNameError("");
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const moveTaskMutation = useMutation({
    mutationFn: (input: { taskId: string; targetTaskListId: string; sortKey: string }) =>
      boardApi.moveTask(input.taskId, {
        targetTaskListId: input.targetTaskListId,
        sortKey: input.sortKey
      }),
    onSuccess: () => {
      setDraggingTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const updateListMutation = useMutation({
    mutationFn: (input: { listId: string; name: string }) =>
      boardApi.updateList(projectId!, input.listId, { name: input.name }),
    onSuccess: () => {
      setListNameError("");
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const deleteListMutation = useMutation({
    mutationFn: (input: { listId: string; targetTaskListId?: string }) =>
      boardApi.deleteList(projectId!, input.listId, { targetTaskListId: input.targetTaskListId }),
    onSuccess: () => {
      setPendingDeleteListId(null);
      setDeleteTargetListId("");
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const reorderListsMutation = useMutation({
    mutationFn: (items: Array<{ id: string; sortKey: string }>) =>
      boardApi.reorderLists(projectId!, items),
    onSuccess: async () => {
      setDraggingListId(null);
      await queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      setOrderedListIds([]);
      listDropCommittedRef.current = false;
    },
    onError: () => {
      setDraggingListId(null);
      setOrderedListIds([]);
      listDropCommittedRef.current = false;
    }
  });

  useEffect(() => {
    if (!newTaskListId && defaultTaskListId) {
      setNewTaskListId(defaultTaskListId);
    }
  }, [defaultTaskListId, newTaskListId]);

  function handleCreateTask(event: FormEvent) {
    event.preventDefault();
    const title = newTaskTitle.trim();

    if (newTaskStartDate && newTaskDueDate && newTaskStartDate > newTaskDueDate) {
      setNewTaskDateError("开始日期不能晚于截止日期。");
      return;
    }

    setNewTaskDateError("");

    if (!title || !newTaskListId || !projectId || !canEditProjectBoard) {
      return;
    }

    createTaskMutation.mutate({
      taskListId: newTaskListId,
      title,
      description: newTaskDescription.trim() || null,
      assigneeIds: newTaskAssigneeIds,
      priority: newTaskPriority,
      startDate: newTaskStartDate || null,
      dueDate: newTaskDueDate || null
    });
  }

  function openCreateTaskModal(taskListId = defaultTaskListId) {
    if (!canEditProjectBoard) {
      return;
    }

    setNewTaskListId(taskListId);
    setNewTaskAssigneeIds(user?.id ? [user.id] : []);
    setNewTaskDateError("");
    setIsCreateTaskOpen(true);
  }

  function toggleNewTaskAssignee(userId: string, checked: boolean) {
    setNewTaskAssigneeIds((current) =>
      checked
        ? [...new Set([...current, userId])]
        : current.filter((assigneeId) => assigneeId !== userId)
    );
  }

  function getFilteredTasks(columnId: string) {
    const keyword = taskSearch.trim().toLowerCase();
    const column = lists.find((list) => list.id === columnId);

    return (column?.tasks ?? []).filter((task) => {
      const matchesKeyword =
        !keyword ||
        task.title.toLowerCase().includes(keyword) ||
        (task.assignees ?? []).some((assignee) => assignee.name.toLowerCase().includes(keyword)) ||
        (task.tags ?? []).some((tag) => tag.name.toLowerCase().includes(keyword));
      const matchesAssignee =
        assigneeFilter === "ALL" ||
        (assigneeFilter === "UNASSIGNED" && (task.assignees?.length ?? 0) === 0) ||
        (task.assignees ?? []).some((assignee) => assignee.id === assigneeFilter);
      const matchesPriority = priorityFilter === "ALL" || task.priority === priorityFilter;
      const matchesCompletion =
        completionFilter === "ALL" ||
        (completionFilter === "OPEN" && !task.completedAt) ||
        (completionFilter === "DONE" && Boolean(task.completedAt));

      return matchesKeyword && matchesAssignee && matchesPriority && matchesCompletion;
    });
  }

  function handleCreateList(event: FormEvent) {
    event.preventDefault();
    const name = listName.trim();

    if (reservedTaskListNames.has(name)) {
      setListNameError("自定义列表不能命名为待处理、进行中或已完成。");
      return;
    }

    if (name && projectId && canManageTaskLists) {
      setListNameError("");
      createListMutation.mutate(name);
    }
  }

  function handleDropTask(taskListId: string) {
    if (!draggingTaskId || draggingListId || !canEditProjectBoard) {
      return;
    }

    const targetList = lists.find((list) => list.id === taskListId);

    if (!targetList) {
      setDraggingTaskId(null);
      return;
    }

    const lastSortKey = targetList.tasks
      .filter((task) => task.id !== draggingTaskId)
      .at(-1)?.sortKey;
    const sortKey = lastSortKey ? String(Number(lastSortKey) + 1000) : "1000";
    moveTaskMutation.mutate({ taskId: draggingTaskId, targetTaskListId: taskListId, sortKey });
  }

  function getOrderedCustomLists() {
    return (canUseOrderedLists ? displayedLists : lists).filter(
      (list): list is TaskList => list.type === "CUSTOM"
    );
  }

  function handleDragOverList(event: DragEvent<HTMLElement>, targetList: TaskList) {
    if (!draggingListId || targetList.type !== "CUSTOM" || !canManageTaskLists) {
      return;
    }

    if (targetList.id === draggingListId) {
      const originalCustomIds = lists.filter((list) => list.type === "CUSTOM").map((list) => list.id);
      const nextCustomIds = getOrderedCustomLists().map((list) => list.id);
      const hasChanged =
        originalCustomIds.length === nextCustomIds.length &&
        originalCustomIds.some((listId, index) => listId !== nextCustomIds[index]);

      if (hasChanged) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }

      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    setOrderedListIds((current) => {
      const currentIds =
        current.length === lists.length && current.every((listId) => lists.some((list) => list.id === listId))
          ? current
          : lists.map((list) => list.id);
      const sourceIndex = currentIds.indexOf(draggingListId);
      const targetIndex = currentIds.indexOf(targetList.id);

      if (sourceIndex < 0 || targetIndex < 0) {
        return currentIds;
      }

      const nextIds = [...currentIds];
      const [sourceId] = nextIds.splice(sourceIndex, 1);
      nextIds.splice(targetIndex, 0, sourceId);

      return nextIds;
    });
  }

  function handleDropList(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (!draggingListId || reorderListsMutation.isPending) {
      return;
    }

    const originalCustomIds = lists.filter((list) => list.type === "CUSTOM").map((list) => list.id);
    const nextCustomLists = getOrderedCustomLists();
    const nextCustomIds = nextCustomLists.map((list) => list.id);
    const hasChanged =
      originalCustomIds.length === nextCustomIds.length &&
      originalCustomIds.some((listId, index) => listId !== nextCustomIds[index]);

    if (!hasChanged) {
      setDraggingListId(null);
      setOrderedListIds([]);
      listDropCommittedRef.current = false;
      return;
    }

    listDropCommittedRef.current = true;
    reorderListsMutation.mutate(
      nextCustomLists.map((list, index) => ({
        id: list.id,
        sortKey: String((index + 4) * 1000)
      }))
    );
  }

  function handleStartListDrag(event: DragEvent<HTMLElement>, listId: string) {
    if (!canManageTaskLists) {
      return;
    }

    const column = event.currentTarget.closest(".board-column");
    if (column instanceof HTMLElement) {
      event.dataTransfer.setDragImage(column, Math.min(column.clientWidth / 2, 160), 24);
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", listId);
    listDropCommittedRef.current = false;
    setDraggingTaskId(null);
    setDraggingListId(listId);
    setOrderedListIds(lists.map((list) => list.id));
  }

  function handleEndListDrag() {
    if (listDropCommittedRef.current || reorderListsMutation.isPending) {
      return;
    }

    setDraggingListId(null);
    setOrderedListIds([]);
  }

  function handleRenameList(event: FormEvent, listId: string) {
    event.preventDefault();
    const name = listDraftNames[listId]?.trim();

    if (name && reservedTaskListNames.has(name)) {
      setListNameError("自定义列表不能命名为待处理、进行中或已完成。");
      return;
    }

    if (name && canManageTaskLists) {
      setListNameError("");
      updateListMutation.mutate({ listId, name });
    }
  }

  function handleDeleteList(listId: string) {
    if (!canManageTaskLists) {
      return;
    }

    const list = lists.find((item) => item.id === listId);
    const fallbackTarget = lists.find((item) => item.id !== listId);

    if (!list || list.type !== "CUSTOM") {
      return;
    }

    if (list.tasks.length === 0 && window.confirm(`确认删除列表「${list.name}」？`)) {
      deleteListMutation.mutate({ listId });
      return;
    }

    if (list.tasks.length > 0) {
      setPendingDeleteListId(listId);
      setDeleteTargetListId(fallbackTarget?.id ?? "");
    }
  }

  function handleConfirmDeleteList(event: FormEvent) {
    event.preventDefault();

    if (!pendingDeleteListId || !deleteTargetListId || !canManageTaskLists) {
      return;
    }

    deleteListMutation.mutate({
      listId: pendingDeleteListId,
      targetTaskListId: deleteTargetListId
    });
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>项目看板</h1>
        <p>V0.1 看板支持任务创建、任务详情、移动任务和两级子任务。</p>
        {projectId && projectPermissions.canManageProject ? (
          <Link className="text-link inline" to={`/projects/${projectId}/settings`}>
            项目设置
          </Link>
        ) : null}
      </div>
      {isArchived ? (
        <section className="notice-panel">
          这个项目已归档，当前看板为只读状态。
        </section>
      ) : null}
      {!isArchived && !projectPermissions.canEditProject ? (
        <section className="notice-panel">
          你当前是只读成员，可以查看任务但不能修改看板。
        </section>
      ) : null}
      {canEditProjectBoard ? (
        <form className="board-toolbar" onSubmit={handleCreateList}>
          {canManageTaskLists ? (
            <>
              <input
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                placeholder="新列表名称"
              />
              <button type="submit" disabled={createListMutation.isPending}>
                添加列表
              </button>
            </>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            disabled={lists.length === 0}
            onClick={() => openCreateTaskModal()}
          >
            新建任务
          </button>
          {canManageTaskLists && listNameError ? (
            <span className="form-error inline-error">{listNameError}</span>
          ) : null}
        </form>
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
      <MutationError
        error={
          createListMutation.error ??
          updateListMutation.error ??
          deleteListMutation.error ??
          moveTaskMutation.error ??
          reorderListsMutation.error
        }
      />
      {!listsQuery.isLoading && totalTaskCount > 0 && visibleTaskCount === 0 ? (
        <section className="notice-panel">
          当前筛选条件隐藏了所有任务，可以切换为“全部完成状态”或清空搜索条件查看。
        </section>
      ) : null}
      {pendingDeleteListId ? (
        <section className="panel inline-panel">
          <div>
            <h2>删除列表</h2>
            <p className="muted">这个列表里还有任务，请选择任务迁移到哪个列表。</p>
          </div>
          <form className="settings-form inline" onSubmit={handleConfirmDeleteList}>
            <select
              value={deleteTargetListId}
              onChange={(event) => setDeleteTargetListId(event.target.value)}
              required
            >
              {lists
                .filter((list) => list.id !== pendingDeleteListId)
                .map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
            </select>
            <button type="submit" disabled={deleteListMutation.isPending}>
              确认删除
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setPendingDeleteListId(null);
                setDeleteTargetListId("");
              }}
            >
              取消
            </button>
          </form>
        </section>
      ) : null}
      <div className="board">
        {listsQuery.isLoading ? <span className="muted">看板加载中...</span> : null}
        {displayedLists.map((column) => {
          return (
          <section
            className={column.id === draggingListId ? "board-column dragging-list" : "board-column"}
            key={column.id}
            onDragOver={(event) => {
              if (draggingListId) {
                handleDragOverList(event, column);
                return;
              }

              if (canEditProjectBoard) {
                event.preventDefault();
              }
            }}
            onDrop={() => {
              if (draggingListId) {
                return;
              } else {
                handleDropTask(column.id);
              }
            }}
            onDropCapture={(event) => {
              if (draggingListId) {
                handleDropList(event);
              }
            }}
          >
            {column.type === "CUSTOM" ? (
              <form className="column-title-form" onSubmit={(event) => handleRenameList(event, column.id)}>
                <span
                  className="list-drag-handle"
                  draggable={canManageTaskLists}
                  title="拖拽排序"
                  onDragStart={(event) => handleStartListDrag(event, column.id)}
                  onDragEnd={handleEndListDrag}
                >
                  ::
                </span>
                <input
                  value={listDraftNames[column.id] ?? column.name}
                  disabled={!canManageTaskLists}
                  onChange={(event) =>
                    setListDraftNames((current) => ({
                      ...current,
                      [column.id]: event.target.value
                    }))
                  }
                />
                <button type="submit" disabled={!canManageTaskLists || updateListMutation.isPending}>保存</button>
                <button
                  className="danger-inline"
                  type="button"
                  disabled={!canManageTaskLists || deleteListMutation.isPending}
                  onClick={() => handleDeleteList(column.id)}
                >
                  删除
                </button>
              </form>
            ) : (
              <div className="column-title-static">
                <h2>{column.name}</h2>
                <span>默认状态</span>
              </div>
            )}
            {getFilteredTasks(column.id).map((task) => (
              <button
                className={task.completedAt ? "task-card task-card-button completed" : "task-card task-card-button"}
                key={task.id}
                type="button"
                draggable={canEditProjectBoard}
                onDragStart={() => {
                  if (canEditProjectBoard) {
                    setDraggingTaskId(task.id);
                  }
                }}
                onDragEnd={() => setDraggingTaskId(null)}
                onClick={() =>
                  navigate(`/tasks/${task.id}`, {
                    state: {
                      backgroundLocation: location,
                      returnTo: location.pathname
                    }
                  })
                }
              >
                <div className="task-card-title">
                  <strong>{task.title}</strong>
                  <span className={getPriorityClassName(task.priority)}>
                    {getPriorityLabel(task.priority)}
                  </span>
                </div>
                <div className="task-card-meta">
                  {task.assignees && task.assignees.length > 0 ? (
                    <span>{task.assignees.map(formatAssigneeName).join(", ")}</span>
                  ) : (
                    <span>未分配</span>
                  )}
                  {formatDate(task.dueDate) ? <span>截止 {formatDate(task.dueDate)}</span> : null}
                  {task.subTaskCount ? <span>{task.subTaskCount} 子任务</span> : null}
                </div>
                {task.tags && task.tags.length > 0 ? (
                  <div className="task-card-tags">
                    {task.tags.slice(0, 3).map((tag) => (
                      <span key={tag.id}>
                        <i style={{ backgroundColor: tag.color }} />
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            ))}
            {getFilteredTasks(column.id).length === 0 ? <span className="muted">暂无匹配任务</span> : null}
          </section>
        );
        })}
      </div>
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
                <select value={newTaskListId} onChange={(event) => setNewTaskListId(event.target.value)} required>
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
                  {(membersQuery.data ?? []).map((member) => (
                    <label className="checkbox-row" key={member.user.id}>
                      <input
                        type="checkbox"
                        checked={newTaskAssigneeIds.includes(member.user.id)}
                        onChange={(event) =>
                          toggleNewTaskAssignee(member.user.id, event.target.checked)
                        }
                      />
                      <span>{member.user.name}</span>
                    </label>
                  ))}
                  {(membersQuery.data ?? []).length === 0 ? (
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
