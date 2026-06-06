import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { MutationError } from "../../components/shared/MutationError";
import { boardApi, projectApi } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

type TaskDetailPanelProps = {
  projectId: string;
  taskId: string;
  onClose: () => void;
};

export function TaskDetailPanel({ projectId, taskId, onClose }: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [comment, setComment] = useState("");
  const [subTaskTitle, setSubTaskTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dateError, setDateError] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#2563eb");

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => boardApi.getTask(taskId)
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
  const tags = tagsQuery.data ?? [];
  const currentList = useMemo(
    () => lists.find((list) => list.id === task?.taskListId) ?? null,
    [lists, task?.taskListId]
  );

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setAssigneeId(task.assigneeId ?? "");
      setPriority(task.priority);
      setStartDate(task.startDate ? task.startDate.slice(0, 10) : "");
      setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
    }
  }, [task]);

  const createCommentMutation = useMutation({
    mutationFn: (content: string) => boardApi.createComment(taskId, { content }),
    onSuccess: () => {
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    }
  });

  const createSubTaskMutation = useMutation({
    mutationFn: (title: string) =>
      boardApi.createTask(projectId, {
        taskListId: task!.taskListId,
        parentId: taskId,
        assigneeId: user?.id,
        title
      }),
    onSuccess: () => {
      setSubTaskTitle("");
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const updateTaskMutation = useMutation({
    mutationFn: () =>
      boardApi.updateTask(taskId, {
        title: title.trim(),
        description: description.trim() || null,
        assigneeId: assigneeId || null,
        priority,
        startDate: startDate || null,
        dueDate: dueDate || null
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const moveTaskMutation = useMutation({
    mutationFn: (targetTaskListId: string) => {
      const targetList = lists.find((list) => list.id === targetTaskListId);
      const lastSortKey = targetList?.tasks.at(-1)?.sortKey;
      const nextSortKey = lastSortKey ? String(Number(lastSortKey) + 1000) : "1000";
      return boardApi.moveTask(taskId, { targetTaskListId, sortKey: nextSortKey });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const createTagMutation = useMutation({
    mutationFn: () => boardApi.createTag(projectId, { name: tagName.trim(), color: tagColor }),
    onSuccess: () => {
      setTagName("");
      void queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
    }
  });

  const addTagMutation = useMutation({
    mutationFn: (tagId: string) => boardApi.addTag(taskId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    }
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagId: string) => boardApi.removeTag(taskId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: () => boardApi.deleteTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
      onClose();
    }
  });

  function handleCreateComment(event: FormEvent) {
    event.preventDefault();
    const content = comment.trim();

    if (content) {
      createCommentMutation.mutate(content);
    }
  }

  function handleCreateSubTask(event: FormEvent) {
    event.preventDefault();
    const title = subTaskTitle.trim();

    if (title && task) {
      createSubTaskMutation.mutate(title);
    }
  }

  function handleUpdateTask(event: FormEvent) {
    event.preventDefault();

    if (startDate && dueDate && startDate > dueDate) {
      setDateError("开始日期不能晚于截止日期。");
      return;
    }

    setDateError("");

    if (title.trim()) {
      updateTaskMutation.mutate();
    }
  }

  function handleCreateTag(event: FormEvent) {
    event.preventDefault();

    if (tagName.trim()) {
      createTagMutation.mutate();
    }
  }

  return (
    <div className="drawer-backdrop">
      <aside className="task-drawer" aria-label="任务详情">
        <header className="drawer-header">
          <div>
            <span className="eyebrow">任务详情</span>
            <h2>{task?.title ?? "加载中..."}</h2>
          </div>
          <button className="text-button" type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        {taskQuery.isLoading ? <span className="muted">任务加载中...</span> : null}
        {task ? (
          <div className="drawer-body">
            <section className="detail-section">
              <h3>基础信息</h3>
              <MutationError error={updateTaskMutation.error} />
              <form className="detail-form" onSubmit={handleUpdateTask}>
                <label>
                  标题
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
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
                  />
                </label>
                <label>
                  负责人
                  <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                    <option value="">未分配</option>
                    {(membersQuery.data ?? []).map((member) => (
                      <option key={member.user.id} value={member.user.id}>
                        {member.user.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  优先级
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as typeof priority)}
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="URGENT">URGENT</option>
                  </select>
                </label>
                <label>
                  开始日期
                  <input
                    type="date"
                    value={startDate}
                    max={dueDate || undefined}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label>
                  截止日期
                  <input
                    type="date"
                    value={dueDate}
                    min={startDate || undefined}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </label>
                {dateError ? <span className="form-error inline-error">{dateError}</span> : null}
                <button type="submit" disabled={updateTaskMutation.isPending}>
                  保存
                </button>
              </form>
              <div className="detail-grid">
                <span>所在列</span>
                <strong>{currentList?.name ?? "未知"}</strong>
                <span>优先级</span>
                <strong>{task.priority}</strong>
                <span>开始日期</span>
                <strong>{task.startDate ? new Date(task.startDate).toLocaleDateString() : "未设置"}</strong>
                <span>截止日期</span>
                <strong>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "未设置"}</strong>
              </div>
            </section>

            <section className="detail-section">
              <h3>移动到</h3>
              <MutationError error={moveTaskMutation.error} />
              <div className="segmented-actions">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    disabled={list.id === task.taskListId || moveTaskMutation.isPending}
                    onClick={() => moveTaskMutation.mutate(list.id)}
                  >
                    {list.name}
                  </button>
                ))}
              </div>
            </section>

            <section className="detail-section danger-zone">
              <h3>危险操作</h3>
              <MutationError error={deleteTaskMutation.error} />
              <button
                className="danger-button"
                type="button"
                disabled={deleteTaskMutation.isPending}
                onClick={() => deleteTaskMutation.mutate()}
              >
                删除任务
              </button>
            </section>

            <section className="detail-section">
              <h3>标签</h3>
              <MutationError error={createTagMutation.error ?? addTagMutation.error ?? removeTagMutation.error} />
              <div className="tag-list">
                {tags.map((tag) => {
                  const selected = task.tags.some((item) => item.id === tag.id);
                  return (
                    <button
                      className={selected ? "tag-chip selected" : "tag-chip"}
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        selected
                          ? removeTagMutation.mutate(tag.id)
                          : addTagMutation.mutate(tag.id)
                      }
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
                />
                <input
                  aria-label="标签颜色"
                  type="color"
                  value={tagColor}
                  onChange={(event) => setTagColor(event.target.value)}
                />
                <button type="submit" disabled={createTagMutation.isPending}>
                  创建
                </button>
              </form>
            </section>

            <section className="detail-section">
              <h3>子任务</h3>
              <MutationError error={createSubTaskMutation.error} />
              <form className="compact-form" onSubmit={handleCreateSubTask}>
                <input
                  value={subTaskTitle}
                  onChange={(event) => setSubTaskTitle(event.target.value)}
                  placeholder={task.parentId ? "V0 不支持子任务继续拆分" : "新增子任务"}
                  disabled={Boolean(task.parentId)}
                />
                <button
                  type="submit"
                  disabled={Boolean(task.parentId) || createSubTaskMutation.isPending}
                >
                  添加
                </button>
              </form>
              <div className="list">
                {task.subTasks.map((subTask) => (
                  <div className="list-row" key={subTask.id}>
                    <strong>{subTask.title}</strong>
                    <span>{subTask.priority}</span>
                  </div>
                ))}
                {task.subTasks.length === 0 ? <span className="muted">暂无子任务</span> : null}
              </div>
            </section>

            <section className="detail-section">
              <h3>评论</h3>
              <MutationError error={createCommentMutation.error} />
              <form className="comment-form" onSubmit={handleCreateComment}>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="写一条评论"
                  rows={3}
                />
                <button type="submit" disabled={createCommentMutation.isPending}>
                  发送
                </button>
              </form>
              <div className="comment-list">
                {task.comments.map((item) => (
                  <article className="comment" key={item.id}>
                    <strong>{item.author.name}</strong>
                    <p>{item.content}</p>
                  </article>
                ))}
                {task.comments.length === 0 ? <span className="muted">暂无评论</span> : null}
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
