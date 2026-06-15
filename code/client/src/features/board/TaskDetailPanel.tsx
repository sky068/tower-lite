import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { MutationError } from "../../components/shared/MutationError";
import { ResourceState } from "../../components/shared/ResourceState";
import { Select } from "../../components/shared/Select";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { boardApi, projectApi } from "../../lib/api";
import { formatRelativeTime } from "../../lib/dateTime";
import { getMemberName, getMemberUser } from "../../lib/members";
import { useModalScrollLock } from "../../lib/modalScrollLock";
import { getPriorityClassName, getPriorityLabel, PRIORITY_OPTIONS } from "../../lib/priority";
import { getTaskStatusLabel, TASK_STATUS_OPTIONS } from "../../lib/taskStatus";
import { useAuthStore } from "../../stores/authStore";
import type { Task, TaskDetail, TaskList, TaskStatus } from "../../types/api";

type TaskDetailPanelProps = {
  projectId: string;
  taskId: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  closeOnSave?: boolean;
  onOpenTask?: (taskId: string) => void;
  onTaskMoved?: (targetTaskListId: string) => void;
  onClose: () => void;
};

function formatAssigneeName(assignee: { name: string; status?: string }) {
  return assignee.status === "REMOVED" ? `${assignee.name}(已移除)` : assignee.name;
}

function formatFullDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function AssigneeChip({ assignee }: { assignee: { name: string; avatarUrl: string | null; status?: string } }) {
  return (
    <span className="assignee-chip">
      <UserAvatar user={assignee} size="xs" />
      <span>{formatAssigneeName(assignee)}</span>
    </span>
  );
}

function DateInputBox({
  ariaLabel,
  disabled,
  max,
  min,
  onChange,
  value
}: {
  ariaLabel: string;
  disabled?: boolean;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <span className="date-input-wrap">
      <input
        aria-label={ariaLabel}
        className={value ? "date-input" : "date-input date-input-empty"}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {!value ? <span className="date-input-placeholder">未设置</span> : null}
    </span>
  );
}

function updateTaskInTaskLists(lists: TaskList[] | undefined, updatedTask: Task) {
  return lists?.map((list) => ({
    ...list,
    tasks: list.tasks.map((task) => (task.id === updatedTask.id ? { ...task, ...updatedTask } : task))
  }));
}

function findScrollableParent(target: EventTarget | null, boundary: HTMLElement | null) {
  if (!(target instanceof HTMLElement) || !boundary) {
    return null;
  }

  if (!boundary.contains(target)) {
    return null;
  }

  let current: HTMLElement | null = target;

  while (current && boundary.contains(current)) {
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;

    if (canScrollY) {
      return current;
    }

    current = current.parentElement;
  }

  return boundary;
}

export function TaskDetailPanel({
  projectId,
  taskId,
  readOnly = false,
  readOnlyReason,
  closeOnSave = true,
  onOpenTask,
  onTaskMoved,
  onClose
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const taskAssigneeDropdownRef = useRef<HTMLDivElement | null>(null);
  const subTaskAssigneeDropdownRef = useRef<HTMLDivElement | null>(null);
  const commentMentionDropdownRef = useRef<HTMLDivElement | null>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const detailBodyRef = useRef<HTMLDivElement | null>(null);
  const [activeTaskId, setActiveTaskId] = useState(taskId);
  const [comment, setComment] = useState("");
  const [isCommentMentionOpen, setIsCommentMentionOpen] = useState(false);
  const [commentMentionQuery, setCommentMentionQuery] = useState("");
  const [commentMentionRange, setCommentMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [isTaskAssigneeOpen, setIsTaskAssigneeOpen] = useState(false);
  const [isSubTaskCreateOpen, setIsSubTaskCreateOpen] = useState(false);
  const [isSubTaskProjectMemberOpen, setIsSubTaskProjectMemberOpen] = useState(false);
  const [subTaskTitle, setSubTaskTitle] = useState("");
  const [subTaskListId, setSubTaskListId] = useState("");
  const [subTaskStatus, setSubTaskStatus] = useState<TaskStatus>("TODO");
  const [subTaskProjectMemberIds, setSubTaskProjectMemberIds] = useState<string[]>([]);
  const [subTaskStartDate, setSubTaskStartDate] = useState("");
  const [subTaskDueDate, setSubTaskDueDate] = useState("");
  const [subTaskDateError, setSubTaskDateError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectMemberIds, setProjectMemberIds] = useState<string[]>([]);
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

  useModalScrollLock(true);

  useEffect(() => {
    setActiveTaskId(taskId);
  }, [taskId]);

  useEffect(() => {
    setIsTaskAssigneeOpen(false);
    setIsSubTaskCreateOpen(false);
    setIsSubTaskProjectMemberOpen(false);
    setIsCommentMentionOpen(false);
    setComment("");
    setCommentMentionQuery("");
    setCommentMentionRange(null);
    setSubTaskTitle("");
    setSubTaskStatus("TODO");
    setSubTaskProjectMemberIds([]);
    setSubTaskStartDate("");
    setSubTaskDueDate("");
    setSubTaskDateError("");
  }, [activeTaskId]);

  useEffect(() => {
    if (readOnly) {
      setIsTaskAssigneeOpen(false);
      setIsSubTaskProjectMemberOpen(false);
      setIsCommentMentionOpen(false);
    }
  }, [readOnly]);

  useEffect(() => {
    if (!isTaskAssigneeOpen && !isSubTaskProjectMemberOpen && !isCommentMentionOpen) {
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
        setIsSubTaskProjectMemberOpen(false);
      }

      if (!commentMentionDropdownRef.current?.contains(event.target as Node)) {
        setIsCommentMentionOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isCommentMentionOpen, isTaskAssigneeOpen, isSubTaskProjectMemberOpen]);

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
  const memberIds = useMemo(
    () => new Set((membersQuery.data ?? []).map((member) => member.id)),
    [membersQuery.data]
  );
  const removedAssignees = useMemo(
    () =>
      (task?.assignees ?? []).filter(
        (assignee) => assignee.status === "REMOVED" || !memberIds.has(assignee.id)
      ),
    [memberIds, task?.assignees]
  );
  const currentList = useMemo(
    () => lists.find((list) => list.id === task?.taskListId) ?? null,
    [lists, task?.taskListId]
  );
  const taskProjectMemberNames = useMemo(() => {
    const members = membersQuery.data ?? [];
    const memberNames = members
      .filter((member) => projectMemberIds.includes(member.id))
      .map(getMemberName);
    const removedNames = removedAssignees
      .filter((assignee) => projectMemberIds.includes(assignee.id))
      .map(formatAssigneeName);

    return [...memberNames, ...removedNames];
  }, [projectMemberIds, membersQuery.data, removedAssignees]);
  const taskProjectMemberSummaryItems = useMemo(() => {
    const activeAssignees = (membersQuery.data ?? [])
      .filter((member) => projectMemberIds.includes(member.id))
      .map(getMemberUser);
    const removedItems = removedAssignees.filter((assignee) => projectMemberIds.includes(assignee.id));

    return [...activeAssignees, ...removedItems];
  }, [projectMemberIds, membersQuery.data, removedAssignees]);
  const subTaskProjectMemberSummary = useMemo(() => {
    const members = membersQuery.data ?? [];
    const selectedNames = members
      .filter((member) => subTaskProjectMemberIds.includes(member.id))
      .map(getMemberName);

    if (selectedNames.length === 0) {
      return "选择负责人";
    }

    return selectedNames.length > 2
      ? `${selectedNames.slice(0, 2).join(", ")} 等 ${selectedNames.length} 人`
      : selectedNames.join(", ");
  }, [membersQuery.data, subTaskProjectMemberIds]);
  const commentMentionOptions = useMemo(() => {
    const query = commentMentionQuery.trim().toLowerCase();
    const members = (membersQuery.data ?? []).filter((member) => member.user);

    if (!query) {
      return members;
    }

    return members.filter((member) =>
      getMemberUser(member).name.toLowerCase().includes(query) ||
      getMemberUser(member).email.toLowerCase().includes(query)
    );
  }, [commentMentionQuery, membersQuery.data]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setProjectMemberIds(
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
    mutationFn: (input: { content: string; mentionIds: string[] }) => boardApi.createComment(activeTaskId, input),
    onSuccess: () => {
      setComment("");
      setIsCommentMentionOpen(false);
      setCommentMentionQuery("");
      setCommentMentionRange(null);
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
      projectMemberIds: string[];
      startDate: string | null;
      dueDate: string | null;
    }) =>
      boardApi.createTask(projectId, {
        taskListId: subTaskListId || task!.taskListId,
        parentId: activeTaskId,
        projectMemberIds: input.projectMemberIds,
        status: subTaskStatus,
        title: input.title,
        startDate: input.startDate,
        dueDate: input.dueDate
      }),
    onSuccess: () => {
      setSubTaskTitle("");
      setSubTaskListId(task?.taskListId ?? "");
      setSubTaskStatus("TODO");
      setSubTaskProjectMemberIds([]);
      setSubTaskStartDate("");
      setSubTaskDueDate("");
      setSubTaskDateError("");
      setIsSubTaskCreateOpen(false);
      setIsSubTaskProjectMemberOpen(false);
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
        projectMemberIds: projectMemberIds.filter((projectMemberId) => !removedAssignees.some((assignee) => assignee.id === projectMemberId)),
        status,
        priority,
        startDate: startDate || null,
        dueDate: dueDate || null
      }),
    onSuccess: async (updatedTask) => {
      queryClient.setQueryData<TaskDetail>(["task", activeTaskId], (current) =>
        current ? { ...current, ...updatedTask } : current
      );
      queryClient.setQueryData<TaskList[]>(["project-task-list", projectId], (current) =>
        updateTaskInTaskLists(current, updatedTask)
      );

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
      createCommentMutation.mutate({
        content,
        mentionIds: getCommentMentionIds(content)
      });
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
        projectMemberIds: subTaskProjectMemberIds,
        startDate: subTaskStartDate || null,
        dueDate: subTaskDueDate || null
      });
    }
  }

  function handleCancelCreateSubTask() {
    setIsSubTaskCreateOpen(false);
    setIsSubTaskProjectMemberOpen(false);
    setSubTaskTitle("");
    setSubTaskListId(task?.taskListId ?? "");
    setSubTaskStatus("TODO");
    setSubTaskProjectMemberIds([]);
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

  function toggleTaskProjectMember(userId: string, checked: boolean) {
    const removedIds = removedAssignees.map((assignee) => assignee.id);

    setProjectMemberIds((current) => {
      const activeIds = current.filter((projectMemberId) => !removedIds.includes(projectMemberId));
      const nextActiveIds = checked
        ? [...activeIds, userId]
        : activeIds.filter((projectMemberId) => projectMemberId !== userId);

      return [...new Set([...nextActiveIds, ...removedIds])];
    });
  }

  function toggleSubTaskProjectMember(userId: string, checked: boolean) {
    setSubTaskProjectMemberIds((current) =>
      checked
        ? [...new Set([...current, userId])]
        : current.filter((projectMemberId) => projectMemberId !== userId)
    );
  }

  function getMentionTrigger(value: string, caret: number) {
    const beforeCaret = value.slice(0, caret);
    const start = beforeCaret.lastIndexOf("@");

    if (start === -1) {
      return null;
    }

    const query = beforeCaret.slice(start + 1);
    if (/\s/.test(query)) {
      return null;
    }

    return { start, end: caret, query };
  }

  function updateCommentMentionState(value: string, caret: number) {
    const trigger = getMentionTrigger(value, caret);

    if (!trigger || readOnly) {
      setIsCommentMentionOpen(false);
      setCommentMentionQuery("");
      setCommentMentionRange(null);
      return;
    }

    setIsCommentMentionOpen(true);
    setCommentMentionQuery(trigger.query);
    setCommentMentionRange({ start: trigger.start, end: trigger.end });
  }

  function handleCommentChange(value: string, caret: number) {
    setComment(value);
    updateCommentMentionState(value, caret);
  }

  function insertCommentMention(member: { user: { id: string; name: string } | null }) {
    if (!member.user) {
      return;
    }
    const textarea = commentTextareaRef.current;
    const caret = textarea?.selectionStart ?? comment.length;
    const range = commentMentionRange ?? getMentionTrigger(comment, caret);
    const insertText = `@${member.user.name} `;
    const nextComment = range
      ? `${comment.slice(0, range.start)}${insertText}${comment.slice(range.end)}`
      : `${comment}${comment ? " " : ""}${insertText}`;
    const nextCaret = range ? range.start + insertText.length : nextComment.length;

    setComment(nextComment);
    setIsCommentMentionOpen(false);
    setCommentMentionQuery("");
    setCommentMentionRange(null);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function getCommentMentionIds(content: string) {
    return [
      ...new Set(
        (membersQuery.data ?? [])
          .filter((member) => member.user && (content.includes(`@${member.user.name}`) || content.includes(`@${member.user.email}`)))
          .map((member) => member.user!.id)
      )
    ];
  }

  function handleOpenTask(nextTaskId: string) {
    setActiveTaskId(nextTaskId);
    onOpenTask?.(nextTaskId);
  }

  function handleBackdropWheel(event: WheelEvent<HTMLDivElement>) {
    const scrollable = findScrollableParent(event.target, detailBodyRef.current);

    if (!scrollable) {
      event.preventDefault();
      return;
    }

    const canScroll = scrollable.scrollHeight > scrollable.clientHeight;

    if (!canScroll) {
      event.preventDefault();
      return;
    }

    const isAtTop = scrollable.scrollTop <= 0;
    const isAtBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;

    if ((event.deltaY < 0 && isAtTop) || (event.deltaY > 0 && isAtBottom)) {
      event.preventDefault();
    }
  }

  return (
    <div className="modal-backdrop" onWheel={handleBackdropWheel}>
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
          <button className="task-detail-close-button" type="button" aria-label="关闭任务详情" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {taskQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
        {taskQuery.error ? <ResourceState error={taskQuery.error} /> : null}
        {task ? (
          <div className="task-detail-body" ref={detailBodyRef}>
            {readOnly && readOnlyReason ? (
              <section className="notice-panel task-readonly-notice">
                {readOnlyReason}
              </section>
            ) : null}
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
                          taskProjectMemberNames.length > 0 ? taskProjectMemberNames.join(", ") : "未分配"
                        }
                      >
                        {taskProjectMemberSummaryItems.length > 0 ? (
                          <span className="assignee-summary-list">
                            {taskProjectMemberSummaryItems.map((assignee) => (
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
                          <label className="checkbox-row" key={member.id}>
                            <input
                              type="checkbox"
                              checked={projectMemberIds.includes(member.id)}
                              onChange={(event) =>
                                toggleTaskProjectMember(member.id, event.target.checked)
                              }
                            />
                            <UserAvatar user={getMemberUser(member)} size="xs" />
                            <span>{getMemberName(member)}</span>
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
                  <Select
                    value={status}
                    disabled={readOnly}
                    onChange={(value) => setStatus(value as TaskStatus)}
                    options={TASK_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </label>
                <div className="detail-form-row">
                  <label>
                    优先级
                    <Select
                      value={priority}
                      disabled={readOnly}
                      onChange={(value) => setPriority(value as typeof priority)}
                      options={PRIORITY_OPTIONS.map((option) => ({ ...option, priority: option.value }))}
                    />
                  </label>
                  <label>
                    清单
                    <Select
                      value={taskListId || task.taskListId}
                      disabled={readOnly || moveTaskMutation.isPending}
                      onChange={setTaskListId}
                      options={lists.map((list) => ({ value: list.id, label: list.name }))}
                    />
                  </label>
                </div>
                <div className="detail-form-row">
                  <label>
                    开始日期
                    <DateInputBox
                      ariaLabel="开始日期"
                      value={startDate}
                      max={dueDate || undefined}
                      disabled={readOnly}
                      onChange={setStartDate}
                    />
                  </label>
                  <label>
                    截止日期
                    <DateInputBox
                      ariaLabel="截止日期"
                      value={dueDate}
                      min={startDate || undefined}
                      disabled={readOnly}
                      onChange={setDueDate}
                    />
                  </label>
                </div>
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
                  <Select
                    aria-label="子任务状态"
                    value={subTaskStatus}
                    onChange={(value) => setSubTaskStatus(value as TaskStatus)}
                    disabled={!canCreateSubTask}
                    options={TASK_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                  <Select
                    aria-label="子任务清单"
                    value={subTaskListId || task.taskListId}
                    onChange={setSubTaskListId}
                    disabled={!canCreateSubTask}
                    options={lists.map((list) => ({ value: list.id, label: list.name }))}
                  />
                  <DateInputBox
                    ariaLabel="子任务开始日期"
                    value={subTaskStartDate}
                    max={subTaskDueDate || undefined}
                    disabled={!canCreateSubTask}
                    onChange={setSubTaskStartDate}
                  />
                  <DateInputBox
                    ariaLabel="子任务截止日期"
                    value={subTaskDueDate}
                    min={subTaskStartDate || undefined}
                    disabled={!canCreateSubTask}
                    onChange={setSubTaskDueDate}
                  />
                  <div className="assignee-dropdown subtask-assignee-field" ref={subTaskAssigneeDropdownRef}>
                    <button
                      className="assignee-dropdown-trigger"
                      type="button"
                      aria-expanded={isSubTaskProjectMemberOpen}
                      disabled={!canCreateSubTask}
                      onClick={() => setIsSubTaskProjectMemberOpen((current) => !current)}
                    >
                      <span>{subTaskProjectMemberSummary}</span>
                      <span aria-hidden="true">⌄</span>
                    </button>
                    {isSubTaskProjectMemberOpen ? (
                      <div className="checkbox-list assignee-dropdown-menu">
                        {(membersQuery.data ?? []).map((member) => (
                          <label className="checkbox-row" key={member.id}>
                            <input
                              type="checkbox"
                              checked={subTaskProjectMemberIds.includes(member.id)}
                              disabled={!canCreateSubTask}
                              onChange={(event) =>
                                toggleSubTaskProjectMember(member.id, event.target.checked)
                              }
                            />
                            <UserAvatar user={getMemberUser(member)} size="xs" />
                            <span>{getMemberName(member)}</span>
                          </label>
                        ))}
                        {(membersQuery.data ?? []).length === 0 ? (
                          <span className="muted">暂无可选成员</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
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
                <div className="comment-input-wrap" ref={commentMentionDropdownRef}>
                  <textarea
                    ref={commentTextareaRef}
                    value={comment}
                    onChange={(event) =>
                      handleCommentChange(event.target.value, event.currentTarget.selectionStart)
                    }
                    onClick={(event) => updateCommentMentionState(comment, event.currentTarget.selectionStart)}
                    onKeyUp={(event) => updateCommentMentionState(comment, event.currentTarget.selectionStart)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsCommentMentionOpen(false);
                      }
                    }}
                    placeholder="写一条评论，输入 @ 提及成员"
                    rows={3}
                    disabled={readOnly}
                  />
                  {isCommentMentionOpen ? (
                    <div className="comment-mention-menu">
                      {commentMentionOptions.map((member) => (
                        <button
                          className="comment-mention-option"
                          type="button"
                          key={member.id}
                          onClick={() => insertCommentMention(member)}
                        >
                          <UserAvatar user={member.user} size="xs" />
                          <span>{member.user?.name}</span>
                          <small>{member.user?.email}</small>
                        </button>
                      ))}
                      {commentMentionOptions.length === 0 ? (
                        <span className="muted">没有匹配成员</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button type="submit" disabled={readOnly || createCommentMutation.isPending}>
                  发送
                </button>
              </form>
              <div className="comment-list">
                {task.comments.map((item) => (
                  <article className="comment" key={item.id}>
                    <div className="comment-header">
                      <span className="comment-meta">
                        <strong>{item.author.name}</strong>
                        <time dateTime={item.createdAt} title={formatFullDateTime(item.createdAt)}>
                          {formatRelativeTime(item.createdAt)}
                        </time>
                      </span>
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
