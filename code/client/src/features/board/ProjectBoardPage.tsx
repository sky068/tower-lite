import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { boardApi } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { TaskDetailPanel } from "./TaskDetailPanel";

export function ProjectBoardPage() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [listDraftNames, setListDraftNames] = useState<Record<string, string>>({});
  const [listName, setListName] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [pendingDeleteListId, setPendingDeleteListId] = useState<string | null>(null);
  const [deleteTargetListId, setDeleteTargetListId] = useState("");
  const listsQuery = useQuery({
    queryKey: ["board", projectId],
    queryFn: () => boardApi.lists(projectId!),
    enabled: Boolean(projectId)
  });

  const lists = listsQuery.data ?? [];
  const createTaskMutation = useMutation({
    mutationFn: (input: { taskListId: string; title: string }) =>
      boardApi.createTask(projectId!, {
        ...input,
        assigneeId: user?.id
      }),
    onSuccess: (_task, variables) => {
      setDraftTitles((current) => ({
        ...current,
        [variables.taskListId]: ""
      }));
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  const createListMutation = useMutation({
    mutationFn: (name: string) => boardApi.createList(projectId!, { name }),
    onSuccess: () => {
      setListName("");
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
    }
  });

  function handleCreateTask(event: FormEvent, taskListId: string) {
    event.preventDefault();
    const title = draftTitles[taskListId]?.trim();

    if (!title || !projectId) {
      return;
    }

    createTaskMutation.mutate({ taskListId, title });
  }

  function handleCreateList(event: FormEvent) {
    event.preventDefault();
    const name = listName.trim();

    if (name && projectId) {
      createListMutation.mutate(name);
    }
  }

  function handleDropTask(taskListId: string) {
    if (!draggingTaskId) {
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

  function handleRenameList(event: FormEvent, listId: string) {
    event.preventDefault();
    const name = listDraftNames[listId]?.trim();

    if (name) {
      updateListMutation.mutate({ listId, name });
    }
  }

  function handleDeleteList(listId: string) {
    const list = lists.find((item) => item.id === listId);
    const fallbackTarget = lists.find((item) => item.id !== listId);

    if (!list) {
      return;
    }

    if (list.tasks.length === 0) {
      deleteListMutation.mutate({ listId });
      return;
    }

    setPendingDeleteListId(listId);
    setDeleteTargetListId(fallbackTarget?.id ?? "");
  }

  function handleConfirmDeleteList(event: FormEvent) {
    event.preventDefault();

    if (!pendingDeleteListId || !deleteTargetListId) {
      return;
    }

    deleteListMutation.mutate({
      listId: pendingDeleteListId,
      targetTaskListId: deleteTargetListId
    });
  }

  function handleMoveList(listId: string, direction: -1 | 1) {
    const currentIndex = lists.findIndex((list) => list.id === listId);
    const targetIndex = currentIndex + direction;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= lists.length) {
      return;
    }

    const nextLists = [...lists];
    const [item] = nextLists.splice(currentIndex, 1);
    nextLists.splice(targetIndex, 0, item);
    reorderListsMutation.mutate(
      nextLists.map((list, index) => ({
        id: list.id,
        sortKey: String((index + 1) * 1000)
      }))
    );
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h1>项目看板</h1>
        <p>V0 看板支持任务创建、任务详情、移动任务和一层子任务。</p>
        {projectId ? (
          <Link className="text-link inline" to={`/projects/${projectId}/settings`}>
            项目设置
          </Link>
        ) : null}
      </div>
      <form className="board-toolbar" onSubmit={handleCreateList}>
        <input
          value={listName}
          onChange={(event) => setListName(event.target.value)}
          placeholder="新列表名称"
        />
        <button type="submit" disabled={createListMutation.isPending}>
          添加列表
        </button>
      </form>
      <MutationError
        error={
          createListMutation.error ??
          updateListMutation.error ??
          deleteListMutation.error ??
          moveTaskMutation.error ??
          reorderListsMutation.error
        }
      />
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
        {lists.map((column, index) => (
          <section
            className="board-column"
            key={column.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDropTask(column.id)}
          >
            <form className="column-title-form" onSubmit={(event) => handleRenameList(event, column.id)}>
              <input
                value={listDraftNames[column.id] ?? column.name}
                onChange={(event) =>
                  setListDraftNames((current) => ({
                    ...current,
                    [column.id]: event.target.value
                  }))
                }
              />
              <button type="submit" disabled={updateListMutation.isPending}>保存</button>
              {lists.length > 1 ? (
                <button
                  className="danger-inline"
                  type="button"
                  disabled={deleteListMutation.isPending}
                  onClick={() => handleDeleteList(column.id)}
                >
                  删除
                </button>
              ) : null}
            </form>
            <div className="column-actions">
              <button
                type="button"
                disabled={index === 0 || reorderListsMutation.isPending}
                onClick={() => handleMoveList(column.id, -1)}
              >
                左移
              </button>
              <button
                type="button"
                disabled={index === lists.length - 1 || reorderListsMutation.isPending}
                onClick={() => handleMoveList(column.id, 1)}
              >
                右移
              </button>
            </div>
            {column.tasks.map((task) => (
              <button
                className="task-card task-card-button"
                key={task.id}
                type="button"
                draggable
                onDragStart={() => setDraggingTaskId(task.id)}
                onDragEnd={() => setDraggingTaskId(null)}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <strong>{task.title}</strong>
                <span>{task.priority}</span>
              </button>
            ))}
            {column.tasks.length === 0 ? <span className="muted">暂无任务</span> : null}
            <form className="task-create-form" onSubmit={(event) => handleCreateTask(event, column.id)}>
              <input
                value={draftTitles[column.id] ?? ""}
                onChange={(event) =>
                  setDraftTitles((current) => ({
                    ...current,
                    [column.id]: event.target.value
                  }))
                }
                placeholder="添加任务"
              />
              <button type="submit" disabled={createTaskMutation.isPending}>
                添加
              </button>
            </form>
          </section>
        ))}
      </div>
      {selectedTaskId ? (
        <TaskDetailPanel
          projectId={projectId!}
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}
    </div>
  );
}
