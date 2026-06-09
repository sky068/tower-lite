import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { MutationError } from "../../components/shared/MutationError";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { boardApi, projectApi } from "../../lib/api";
import { openDateInputPicker } from "../../lib/dateInput";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { getTaskStatusLabel, TASK_STATUS_OPTIONS } from "../../lib/taskStatus";
import { useAuthStore } from "../../stores/authStore";
import type { TaskStatus } from "../../types/api";

type TaskDetailPanelProps = {
  projectId: string;
  taskId: string;
  readOnly?: boolean;
  closeOnSave?: boolean;
  restoreWindowScrollOnClose?: boolean;
  onOpenTask?: (taskId: string) => void;
  onTaskMoved?: (targetTaskListId: string) => void;
  onClose: () => void;
};

function formatAssigneeName(assignee: { name: string; isRemoved?: boolean }) {
  return assignee.isRemoved ? `${assignee.name}(已移除)` : assignee.name;
}

function AssigneeChip({ assignee }: { assignee: { name: string; avatarUrl: string | null; isRemoved?: boolean } }) {
  return (
    <span className="assignee-chip">
      <UserAvatar user={assignee} size="xs" />
      <span>{formatAssigneeName(assignee)}</span>
    </span>
  );
}

export function TaskDetailPanel({
  projectId,
  taskId,
  readOnly = false,
  closeOnSave = true,
  restoreWindowScrollOnClose = true,
  onOpenTask,
  onTaskMoved,
  onClose
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const taskAssigneeDropdownRef = useRef<HTMLDivElement | null>(null);
  const subTaskAssigneeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [activeTaskId, setActiveTaskId] = useState(taskId);
  const [comment, setComment] = useState("");
  const [isTaskAssigneeOpen, setIsTaskAssigneeOpen] = useState(false);
  const [isSubTaskCreateOpen, setIsSubTaskCreateOpen] = useState(false);
  const [isSubTaskAssigneeOpen, setIsSubTaskAssigneeOpen] = useState(false);
  const [subTaskTitle, setSubTaskTitle] = useState("");
  const [subTaskListId, setSubTaskListId] = useState("");
  const [subTaskStatus, setSubTaskStatus] = useState<TaskStatus>("TODO");
  const [subTaskAssigneeIds, setSubTaskAssigneeIds] = useState<string[]>([]);
  const [subTaskStartDate, setSubTaskStartDate] = useState("");
  const [subTaskDueDate, setSubTaskDueDate] = useState("");
  const [subTaskDateError, setSubTaskDateError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [taskListId, setTaskListId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dateError, setDateError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#2563eb");
  const [tagDrafts, setTagDrafts] = useState<Record<string, { name: string; color: string }>>({});

  useEffect(() => {
    setActiveTaskId(taskId);
  }, [taskId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousScrollY = window.scrollY;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreWindowScrollOnClose) {
        window.scrollTo({ top: previousScrollY });
      }
    };
  }, [restoreWindowScrollOnClose]);

  useEffect(() => {
    setIsTaskAssigneeOpen(false);
    setIsSubTaskCreateOpen(false);
    setIsSubTaskAssigneeOpen(false);
    setSubTaskTitle("");
    setSubTaskStatus("TODO");
    setSubTaskAssigneeIds([]);
    setSubTaskStartDate("");
    setSubTaskDueDate("");
    setSubTaskDateError("");
  }, [activeTaskId]);

  useEffect(() => {
    if (!isTaskAssigneeOpen && !isSubTaskAssigneeOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        isTaskAssigneeOpen &&
        !taskAssigneeDropdownRef.current?.contains(event.target as Node)
      ) {
        setIsTaskAssigneeOpen(false);
      }

      if (!subTaskAssigneeDropdownRef.current?.contains(event.target as Node)) {
        setIsSubTaskAssigneeOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isTaskAssigneeOpen, isSubTaskAssigneeOpen]);

  const taskQuery = useQuery({
    queryKey: ["task", activeTaskId],
    queryFn: () => boardApi.getTask(activeTaskId)
  });

  const listsQuery = useQuery({
    queryKey: ["board", projectId],
    queryFn: () => boardApi.lists(projectId)
  });

  const tagsQuery = useQuery({
    queryKey: ["tags", projectId],
    queryFn: () => boardApi.tags(projectId)
  });

  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => projectApi.members(projectId)
  });

  const task = taskQuery.data;
  const lists = listsQuery.data ?? [];
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);
  const isMaxSubTaskDepth = (task?.parentTrail.length ?? 0) >= 2;
  const canCreateSubTask = Boolean(task && !readOnly && !isMaxSubTaskDepth);
  const memberUserIds = useMemo(
    () => new Set((membersQuery.data ?? []).map((member) => member.user.id)),
    [membersQuery.data]
  );
  const removedAssignees = useMemo(
    () =>
      (task?.assignees ?? []).filter(
        (assignee) => assignee.isRemoved || !memberUserIds.has(assignee.id)
      ),
    [memberUserIds, task?.assignees]
  );
  const currentList = useMemo(
    () => lists.find((list) => list.id === task?.taskListId) ?? null,
    [lists, task?.taskListId]
  );
  const taskAssigneeNames = useMemo(() => {
    const members = membersQuery.data ?? [];
    const memberNames = members
      .filter((member) => assigneeIds.includes(member.user.id))
      .map((member) => member.user.name);
    const removedNames = removedAssignees
      .filter((assignee) => assigneeIds.includes(assignee.id))
      .map(formatAssigneeName);

    return [...memberNames, ...removedNames];
  }, [assigneeIds, membersQuery.data, removedAssignees]);
  const taskAssigneeSummaryItems = useMemo(() => {
    const activeAssignees = (membersQuery.data ?? [])
      .filter((member) => assigneeIds.includes(member.user.id))
      .map((member) => member.user);
    const removedItems = removedAssignees.filter((assignee) => assigneeIds.includes(assignee.id));

    return [...activeAssignees, ...removedItems];
  }, [assigneeIds, membersQuery.data, removedAssignees]);
  const subTaskAssigneeSummary = useMemo(() => {
    const members = membersQuery.data ?? [];
    const selectedNames = members
      .filter((member) => subTaskAssigneeIds.includes(member.user.id))
      .map((member) => member.user.name);

    if (selectedNames.length === 0) {
      return "选择负责人";
    }

    return selectedNames.length > 2
      ? `${selectedNames.slice(0, 2).join(", ")} 等 ${selectedNames.length} 人`
      : selectedNames.join(", ");
  }, [membersQuery.data, subTaskAssigneeIds]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setAssigneeIds(
        task.assignees && task.assignees.length > 0
          ? task.assignees.map((assignee) => assignee.id)
          : []
      );
      setStatus(task.status);
      setPriority(task.priority);
      setTaskListId(task.taskListId);
      setStartDate(task.startDate ? task.startDate.slice(0, 10) : "");
      setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
      setSubTaskListId(task.taskListId);
    }
  }, [task]);

  useEffect(() => {
    if (!tagsQuery.data) {
      return;
    }

    setTagDrafts((current) => {
      const next: Record<string, { name: string; color: string }> = {};
      let hasChanged = false;

      for (const tag of tags) {
        next[tag.id] = current[tag.id] ?? { name: tag.name, color: tag.color };
        hasChanged ||= !current[tag.id];
      }

      hasChanged ||= Object.keys(current).length !== tags.length;

      return hasChanged ? next : current;
    });
  }, [tags, tagsQuery.data]);

  const createCommentMutation = useMutation({
    mutationFn: (content: string) => boardApi.createComment(activeTaskId, { content }),
    onSuccess: () => {
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
    }
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => boardApi.deleteComment(activeTaskId, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
    }
  });

  const createSubTaskMutation = useMutation({
    mutationFn: (input: {
      title: string;
      assigneeIds: string[];
      startDate: string | null;
      dueDate: string | null;
    }) =>
      boardApi.createTask(projectId, {
        taskListId: subTaskListId || task!.taskListId,
        parentId: activeTaskId,
        assigneeIds: input.assigneeIds,
        status: subTaskStatus,
        title: input.title,
        startDate: input.startDate,
        dueDate: input.dueDate
      }),
    onSuccess: () => {
      setSubTaskTitle("");
      setSubTaskListId(task?.taskListId ?? "");
      setSubTaskStatus("TODO");
      setSubTaskAssigneeIds([]);
      setSubTaskStartDate("");
      setSubTaskDueDate("");
      setSubTaskDateError("");
      setIsSubTaskCreateOpen(false);
      setIsSubTaskAssigneeOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
    }
  });

  const updateTaskMutation = useMutation({
    mutationFn: () =>
      boardApi.updateTask(activeTaskId, {
        title: title.trim(),
        description: description.trim() || null,
        assigneeIds,
        status,
        priority,
        startDate: startDate || null,
        dueDate: dueDate || null
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] }),
        queryClient.invalidateQueries({ queryKey: ["board", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] })
      ]);
    }
  });

  const moveTaskMutation = useMutation({
    mutationFn: (targetTaskListId: string) => {
      const targetList = lists.find((list) => list.id === targetTaskListId);
      const lastSortKey = targetList?.tasks.at(-1)?.sortKey;
      const nextSortKey = lastSortKey ? String(Number(lastSortKey) + 1000) : "1000";
      return boardApi.moveTask(activeTaskId, { targetTaskListId, sortKey: nextSortKey });
    },
    onSuccess: async (_task, targetTaskListId) => {
      onTaskMoved?.(targetTaskListId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] }),
        queryClient.invalidateQueries({ queryKey: ["board", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] })
      ]);
    }
  });

  const createTagMutation = useMutation({
    mutationFn: () => boardApi.createTag(projectId, { name: tagName.trim(), color: tagColor }),
    onSuccess: () => {
      setTagName("");
      void queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
    }
  });

  const updateTagMutation = useMutation({
    mutationFn: (input: { tagId: string; name: string; color: string }) =>
      boardApi.updateTag(projectId, input.tagId, { name: input.name, color: input.color }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
    }
  });

  const deleteTagMutation = useMutation({
    mutationFn: (tagId: string) => boardApi.deleteTag(projectId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
    }
  });

  const addTagMutation = useMutation({
    mutationFn: (tagId: string) => boardApi.addTag(activeTaskId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
    }
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagId: string) => boardApi.removeTag(activeTaskId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", activeTaskId] });
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: () => boardApi.deleteTask(activeTaskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
      onClose();
    }
  });

  function handleCreateComment(event: FormEvent) {
    event.preventDefault();
    const content = comment.trim();

    if (content && !readOnly) {
      createCommentMutation.mutate(content);
    }
  }

  function handleCreateSubTask(event: FormEvent) {
    event.preventDefault();
    const title = subTaskTitle.trim();

    if (subTaskStartDate && subTaskDueDate && subTaskStartDate > subTaskDueDate) {
      setSubTaskDateError("开始日期不能晚于截止日期。");
      return;
    }

    setSubTaskDateError("");

    if (title && task && canCreateSubTask) {
      createSubTaskMutation.mutate({
        title,
        assigneeIds: subTaskAssigneeIds,
        startDate: subTaskStartDate || null,
        dueDate: subTaskDueDate || null
      });
    }
  }

  function handleCancelCreateSubTask() {
    setIsSubTaskCreateOpen(false);
    setIsSubTaskAssigneeOpen(false);
    setSubTaskTitle("");
    setSubTaskListId(task?.taskListId ?? "");
    setSubTaskStatus("TODO");
    setSubTaskAssigneeIds([]);
    setSubTaskStartDate("");
    setSubTaskDueDate("");
    setSubTaskDateError("");
  }

  function handleDeleteTask() {
    const taskTitle = task?.title ? `「${task.title}」` : "这个任务";

    if (!readOnly && window.confirm(`确认将任务${taskTitle}移入回收站？`)) {
      deleteTaskMutation.mutate();
    }
  }

  function handleDeleteTag(tagId: string, tagName: string) {
    if (!readOnly && window.confirm(`确认删除标签「${tagName}」？此标签会从相关任务中移除。`)) {
      deleteTagMutation.mutate(tagId);
    }
  }

  function handleDeleteComment(commentId: string) {
    if (!readOnly && window.confirm("确认删除这条评论？")) {
      deleteCommentMutation.mutate(commentId);
    }
  }

  async function handleUpdateTask(event: FormEvent) {
    event.preventDefault();

    if (startDate && dueDate && startDate > dueDate) {
      setDateError("开始日期不能晚于截止日期。");
      return;
    }

    setDateError("");
    setSaveMessage("");

    if (title.trim() && task && taskListId && !readOnly) {
      try {
        await updateTaskMutation.mutateAsync();

        if (taskListId !== task.taskListId) {
          await moveTaskMutation.mutateAsync(taskListId);
        }

        if (closeOnSave) {
          onClose();
        } else {
          setSaveMessage("已保存");
        }
      } catch {
        // MutationError renders the API failure above the form.
      }
    }
  }

  function handleCreateTag(event: FormEvent) {
    event.preventDefault();

    if (tagName.trim() && !readOnly) {
      createTagMutation.mutate();
    }
  }

  function handleUpdateTag(event: FormEvent, tagId: string) {
    event.preventDefault();
    const draft = tagDrafts[tagId];
    const name = draft?.name.trim();

    if (name && draft?.color && !readOnly) {
      updateTagMutation.mutate({ tagId, name, color: draft.color });
    }
  }

  function toggleTaskAssignee(userId: string, checked: boolean) {
    const removedIds = removedAssignees.map((assignee) => assignee.id);

    setAssigneeIds((current) => {
      const activeIds = current.filter((assigneeId) => !removedIds.includes(assigneeId));
      const nextActiveIds = checked
        ? [...activeIds, userId]
        : activeIds.filter((assigneeId) => assigneeId !== userId);

      return [...new Set([...nextActiveIds, ...removedIds])];
    });
  }

  function toggleSubTaskAssignee(userId: string, checked: boolean) {
    setSubTaskAssigneeIds((current) =>
      checked
        ? [...new Set([...current, userId])]
        : current.filter((assigneeId) => assigneeId !== userId)
    );
  }

  function handleOpenTask(nextTaskId: string) {
    setActiveTaskId(nextTaskId);
    onOpenTask?.(nextTaskId);
  }

  return (
    <div className="modal-backdrop">
      <section className="task-detail-modal" aria-label="任务详情">
        <header className="task-detail-header">
          <div>
            <span className="eyebrow">任务详情</span>
            <h2>{task?.title ?? "加载中..."}</h2>
            {task?.parentTrail && task.parentTrail.length > 0 ? (
              <div className="parent-trail" aria-label="父任务路径">
                <span>父任务</span>
                <div>
                  {task.parentTrail.map((parentTask) => (
                    <button
                      className="parent-trail-button"
                      key={parentTask.id}
                      type="button"
                      onClick={() => handleOpenTask(parentTask.id)}
                    >
                      <span>{parentTask.title}</span>
                      <span aria-hidden="true">&gt;</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <button className="text-button" type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        {taskQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
        {task ? (
          <div className="task-detail-body">
            <section className="detail-section">
              <h3>基础信息</h3>
              <MutationError error={updateTaskMutation.error ?? moveTaskMutation.error} />
              <form className="detail-form" onSubmit={handleUpdateTask}>
                <label>
                  标题
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={readOnly}
                    required
                  />
                </label>
                <label>
                  描述
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="补充任务背景、验收标准或注意事项"
                    rows={4}
                    disabled={readOnly}
                  />
                </label>
                <div className="checkbox-field">
                  <span className="field-label">负责人</span>
                  <div className="task-assignee-editor" ref={taskAssigneeDropdownRef}>
                    <div className="task-assignee-summary-row">
                      <div
                        className="readonly-value task-assignee-summary"
                        title={
                          taskAssigneeNames.length > 0 ? taskAssigneeNames.join(", ") : "未分配"
                        }
                      >
                        {taskAssigneeSummaryItems.length > 0 ? (
                          <span className="assignee-summary-list">
                            {taskAssigneeSummaryItems.map((assignee) => (
                              <AssigneeChip assignee={assignee} key={assignee.id} />
                            ))}
                          </span>
                        ) : (
                          "未分配"
                        )}
                      </div>
                      {!readOnly ? (
                        <button
                          className="assignee-add-button"
                          type="button"
                          aria-label="编辑负责人"
                          aria-expanded={isTaskAssigneeOpen}
                          onClick={() => setIsTaskAssigneeOpen((current) => !current)}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    {isTaskAssigneeOpen && !readOnly ? (
                      <div className="checkbox-list assignee-dropdown-menu task-assignee-menu">
                        {(membersQuery.data ?? []).map((member) => (
                          <label className="checkbox-row" key={member.user.id}>
                            <input
                              type="checkbox"
                              checked={assigneeIds.includes(member.user.id)}
                              onChange={(event) =>
                                toggleTaskAssignee(member.user.id, event.target.checked)
                              }
                            />
                            <UserAvatar user={member.user} size="xs" />
                            <span>{member.user.name}</span>
                          </label>
                        ))}
                        {removedAssignees.map((assignee) => (
                          <label className="checkbox-row disabled" key={assignee.id}>
                            <input type="checkbox" checked disabled />
                            <UserAvatar user={assignee} size="xs" />
                            <span>{formatAssigneeName(assignee)}</span>
                          </label>
                        ))}
                        {(membersQuery.data ?? []).length === 0 && removedAssignees.length === 0 ? (
                          <span className="muted">暂无可选成员</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <label>
                  <span className="status-field-label">状态</span>
                  <select
                    value={status}
                    disabled={readOnly}
                    onChange={(event) => setStatus(event.target.value as TaskStatus)}
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
                  <select
                    value={taskListId || task.taskListId}
                    disabled={readOnly || moveTaskMutation.isPending}
                    onChange={(event) => setTaskListId(event.target.value)}
                  >
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  优先级
                  <select
                    value={priority}
                    disabled={readOnly}
                    onChange={(event) => setPriority(event.target.value as typeof priority)}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  开始日期
                  <input
                    type="date"
                    value={startDate}
                    max={dueDate || undefined}
                    disabled={readOnly}
                    onClick={(event) => openDateInputPicker(event.currentTarget)}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label>
                  截止日期
                  <input
                    type="date"
                    value={dueDate}
                    min={startDate || undefined}
                    disabled={readOnly}
                    onClick={(event) => openDateInputPicker(event.currentTarget)}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </label>
                {dateError ? <span className="form-error inline-error">{dateError}</span> : null}
                {saveMessage ? <span className="form-success inline-error">{saveMessage}</span> : null}
                <button
                  type="submit"
                  disabled={readOnly || updateTaskMutation.isPending || moveTaskMutation.isPending}
                >
                  {updateTaskMutation.isPending || moveTaskMutation.isPending ? "保存中..." : "保存"}
                </button>
              </form>
              <div className="detail-grid">
                <span>所在清单</span>
                <strong>{currentList?.name ?? "未知"}</strong>
                <span>状态</span>
                <strong>{getTaskStatusLabel(task.status)}</strong>
                <span>优先级</span>
                <strong>
                  <span className={getPriorityClassName(task.priority)}>
                    {getPriorityLabel(task.priority)}
                  </span>
                </strong>
                <span>开始日期</span>
                <strong>{task.startDate ? new Date(task.startDate).toLocaleDateString() : "未设置"}</strong>
                <span>截止日期</span>
                <strong>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "未设置"}</strong>
                <span>负责人</span>
                <strong>
                  {task.assignees && task.assignees.length > 0
                    ? (
                        <span className="assignee-chip-list">
                          {task.assignees.map((assignee) => (
                            <AssigneeChip assignee={assignee} key={assignee.id} />
                          ))}
                        </span>
                      )
                    : "未分配"}
                </strong>
              </div>
            </section>

            <section className="detail-section danger-zone">
              <h3>危险操作</h3>
              <MutationError error={deleteTaskMutation.error} />
              <button
                className="danger-button"
                type="button"
                disabled={readOnly || deleteTaskMutation.isPending}
                onClick={handleDeleteTask}
              >
                删除任务
              </button>
            </section>

            <section className="detail-section">
              <h3>标签</h3>
              <MutationError
                error={
                  createTagMutation.error ??
                  updateTagMutation.error ??
                  deleteTagMutation.error ??
                  addTagMutation.error ??
                  removeTagMutation.error
                }
              />
              <div className="tag-list">
                {tags.map((tag) => {
                  const selected = task.tags.some((item) => item.id === tag.id);
                  return (
                    <button
                      className={selected ? "tag-chip selected" : "tag-chip"}
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        readOnly
                          ? undefined
                          : selected
                          ? removeTagMutation.mutate(tag.id)
                          : addTagMutation.mutate(tag.id)
                      }
                      disabled={readOnly}
                    >
                      <span style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  );
                })}
                {tags.length === 0 ? <span className="muted">暂无标签</span> : null}
              </div>
              <form className="tag-form" onSubmit={handleCreateTag}>
                <input
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  placeholder="新标签"
                  disabled={readOnly}
                />
                <input
                  aria-label="标签颜色"
                  type="color"
                  value={tagColor}
                  disabled={readOnly}
                  onChange={(event) => setTagColor(event.target.value)}
                />
                <button type="submit" disabled={readOnly || createTagMutation.isPending}>
                  创建
                </button>
              </form>
              <div className="tag-manage-list">
                {tags.map((tag) => {
                  const draft = tagDrafts[tag.id] ?? { name: tag.name, color: tag.color };

                  return (
                    <form
                      className="tag-edit-row"
                      key={tag.id}
                      onSubmit={(event) => handleUpdateTag(event, tag.id)}
                    >
                      <input
                        value={draft.name}
                        onChange={(event) =>
                          setTagDrafts((current) => ({
                            ...current,
                            [tag.id]: {
                              ...draft,
                              name: event.target.value
                            }
                          }))
                        }
                        disabled={readOnly}
                        required
                      />
                      <input
                        aria-label={`${tag.name} 颜色`}
                        type="color"
                        value={draft.color}
                        onChange={(event) =>
                          setTagDrafts((current) => ({
                            ...current,
                            [tag.id]: {
                              ...draft,
                              color: event.target.value
                            }
                          }))
                        }
                        disabled={readOnly}
                      />
                      <button type="submit" disabled={readOnly || updateTagMutation.isPending}>
                        保存
                      </button>
                      <button
                        className="danger-inline"
                        type="button"
                        disabled={readOnly || deleteTagMutation.isPending}
                        onClick={() => handleDeleteTag(tag.id, tag.name)}
                      >
                        删除
                      </button>
                    </form>
                  );
                })}
              </div>
            </section>

            <section className="detail-section">
              <h3>子任务</h3>
              <MutationError error={createSubTaskMutation.error} />
              {!isSubTaskCreateOpen ? (
                <button
                  className="primary-inline-button"
                  type="button"
                  disabled={!canCreateSubTask}
                  onClick={() => setIsSubTaskCreateOpen(true)}
                >
                  {isMaxSubTaskDepth ? "已达到最大拆分层级" : "创建子任务"}
                </button>
              ) : (
                <form className="subtask-create-form" onSubmit={handleCreateSubTask}>
                  <input
                    value={subTaskTitle}
                    onChange={(event) => setSubTaskTitle(event.target.value)}
                    placeholder="新增子任务"
                    disabled={!canCreateSubTask}
                  />
                  <select
                    aria-label="子任务状态"
                    value={subTaskStatus}
                    onChange={(event) => setSubTaskStatus(event.target.value as TaskStatus)}
                    disabled={!canCreateSubTask}
                  >
                    {TASK_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="子任务清单"
                    value={subTaskListId || task.taskListId}
                    onChange={(event) => setSubTaskListId(event.target.value)}
                    disabled={!canCreateSubTask}
                  >
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                  <div className="assignee-dropdown" ref={subTaskAssigneeDropdownRef}>
                    <button
                      className="assignee-dropdown-trigger"
                      type="button"
                      aria-expanded={isSubTaskAssigneeOpen}
                      disabled={!canCreateSubTask}
                      onClick={() => setIsSubTaskAssigneeOpen((current) => !current)}
                    >
                      <span>{subTaskAssigneeSummary}</span>
                      <span aria-hidden="true">⌄</span>
                    </button>
                    {isSubTaskAssigneeOpen ? (
                      <div className="checkbox-list assignee-dropdown-menu">
                        {(membersQuery.data ?? []).map((member) => (
                          <label className="checkbox-row" key={member.user.id}>
                            <input
                              type="checkbox"
                              checked={subTaskAssigneeIds.includes(member.user.id)}
                              disabled={!canCreateSubTask}
                              onChange={(event) =>
                                toggleSubTaskAssignee(member.user.id, event.target.checked)
                              }
                            />
                            <UserAvatar user={member.user} size="xs" />
                            <span>{member.user.name}</span>
                          </label>
                        ))}
                        {(membersQuery.data ?? []).length === 0 ? (
                          <span className="muted">暂无可选成员</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <input
                    aria-label="子任务开始日期"
                    type="date"
                    value={subTaskStartDate}
                    max={subTaskDueDate || undefined}
                    onClick={(event) => openDateInputPicker(event.currentTarget)}
                    onChange={(event) => setSubTaskStartDate(event.target.value)}
                    disabled={!canCreateSubTask}
                  />
                  <input
                    aria-label="子任务截止日期"
                    type="date"
                    value={subTaskDueDate}
                    min={subTaskStartDate || undefined}
                    onClick={(event) => openDateInputPicker(event.currentTarget)}
                    onChange={(event) => setSubTaskDueDate(event.target.value)}
                    disabled={!canCreateSubTask}
                  />
                  <button
                    type="submit"
                    disabled={!canCreateSubTask || createSubTaskMutation.isPending}
                  >
                    添加
                  </button>
                  <button className="secondary-inline-button" type="button" onClick={handleCancelCreateSubTask}>
                    取消
                  </button>
                </form>
              )}
              {subTaskDateError ? (
                <span className="form-error inline-error">{subTaskDateError}</span>
              ) : null}
              <div className="list">
                {task.subTasks.map((subTask) => (
                  <div className="list-row" key={subTask.id}>
                    <button
                      className="row-main"
                      type="button"
                      onClick={() => handleOpenTask(subTask.id)}
                    >
                      <strong>{subTask.title}</strong>
                      <span>
                        状态：
                        {getTaskStatusLabel(subTask.status)}
                      </span>
                      <span>
                        清单：
                        {lists.find((list) => list.id === subTask.taskListId)?.name ?? "未知"}
                      </span>
                      <span>
                        开始：
                        {subTask.startDate
                          ? new Date(subTask.startDate).toLocaleDateString()
                          : "未设置"}
                      </span>
                      <span>
                        负责人：
                        {subTask.assignees && subTask.assignees.length > 0
                          ? (
                              <span className="assignee-chip-list inline">
                                {subTask.assignees.map((assignee) => (
                                  <AssigneeChip assignee={assignee} key={assignee.id} />
                                ))}
                              </span>
                            )
                          : "未分配"}
                      </span>
                    </button>
                    <span className={getPriorityClassName(subTask.priority)}>
                      {getPriorityLabel(subTask.priority)}
                    </span>
                  </div>
                ))}
                {task.subTasks.length === 0 ? <span className="muted">暂无子任务</span> : null}
              </div>
            </section>

            <section className="detail-section">
              <h3>评论</h3>
              <MutationError error={createCommentMutation.error ?? deleteCommentMutation.error} />
              <form className="comment-form" onSubmit={handleCreateComment}>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="写一条评论"
                  rows={3}
                  disabled={readOnly}
                />
                <button type="submit" disabled={readOnly || createCommentMutation.isPending}>
                  发送
                </button>
              </form>
              <div className="comment-list">
                {task.comments.map((item) => (
                  <article className="comment" key={item.id}>
                    <div className="comment-header">
                      <strong>{item.author.name}</strong>
                      {item.author.id === user?.id ? (
                        <button
                          className="mini-button"
                          type="button"
                          disabled={readOnly || deleteCommentMutation.isPending}
                          onClick={() => handleDeleteComment(item.id)}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                    <p>{item.content}</p>
                  </article>
                ))}
                {task.comments.length === 0 ? <span className="muted">暂无评论</span> : null}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
