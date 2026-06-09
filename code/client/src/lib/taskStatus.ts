import type { TaskStatus } from "../types/api";

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: "TODO", label: "待处理" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "DONE", label: "已完成" }
];

export function getTaskStatusLabel(status: TaskStatus) {
  return TASK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}
