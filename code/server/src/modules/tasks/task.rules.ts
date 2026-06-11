import { AppError } from "../../middleware/error-handler.js";

export function assertValidDateRange(startDate?: Date | null, dueDate?: Date | null) {
  if (startDate && dueDate && startDate > dueDate) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Task start date cannot be after due date", 422);
  }
}

export function normalizeTaskDateRange(startDate?: Date | null, dueDate?: Date | null) {
  if (startDate && !dueDate) {
    return {
      startDate,
      dueDate: startDate
    };
  }

  if (!startDate && dueDate) {
    return {
      startDate: dueDate,
      dueDate
    };
  }

  return {
    startDate,
    dueDate
  };
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

export function assertTaskListEditable(taskList: { isDefault: boolean }) {
  if (taskList.isDefault) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Default task list cannot be edited",
      422
    );
  }
}

export function assertTaskListDeletable(taskList: { isDefault: boolean }) {
  if (taskList.isDefault) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Default task list cannot be deleted",
      422
    );
  }
}

export function assertTaskListNameAvailable(existingTaskList: { id: string } | null, taskListId?: string) {
  if (existingTaskList && existingTaskList.id !== taskListId) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "Task list name already exists in this project",
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
