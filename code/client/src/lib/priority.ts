import type { Task } from "../types/api";

export const PRIORITY_OPTIONS: Array<{ value: Task["priority"]; label: string }> = [
  { value: "LOW", label: "低" },
  { value: "MEDIUM", label: "中" },
  { value: "HIGH", label: "高" },
  { value: "URGENT", label: "紧急" }
];

export function getPriorityLabel(priority: Task["priority"]) {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? priority;
}

export function getPriorityClassName(priority: Task["priority"]) {
  return `priority-chip priority-${priority.toLowerCase()}`;
}
