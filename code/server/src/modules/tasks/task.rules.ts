import { TaskListType } from "@prisma/client";
import { AppError } from "../../middleware/error-handler.js";

const defaultTaskListNames = new Set(["待处理", "进行中", "已完成"]);

export function assertValidDateRange(startDate?: Date | null, dueDate?: Date | null) {
  if (startDate && dueDate && startDate > dueDate) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Task start date cannot be after due date", 422);
  }
}

export function assertV01SubTaskParent(parentTask: { depth: number }) {
  if (parentTask.depth >= 2) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "V0.1 only supports two levels of subtasks",
      422
    );
  }
}

export function assertTaskListDeletable(taskList: { type: TaskListType }) {
  if (taskList.type !== TaskListType.CUSTOM) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Default task lists cannot be deleted",
      422
    );
  }
}

export function assertTaskListEditable(taskList: { type: TaskListType }) {
  if (taskList.type !== TaskListType.CUSTOM) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Default task lists cannot be edited",
      422
    );
  }
}

export function assertCustomTaskListName(name: string) {
  if (defaultTaskListNames.has(name.trim())) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Custom task list name cannot duplicate default task lists",
      422
    );
  }
}

export function assertTaskDeletable(task: { subTaskCount: number }) {
  if (task.subTaskCount > 0) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Task with subtasks cannot be deleted",
      422
    );
  }
}
