import { AppError } from "../../middleware/error-handler.js";

export function assertValidDateRange(startDate?: Date | null, dueDate?: Date | null) {
  if (startDate && dueDate && startDate > dueDate) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Task start date cannot be after due date", 422);
  }
}

export function assertV0SubTaskParent(parentTask: { parentId: string | null }) {
  if (parentTask.parentId) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "V0 only supports one level of subtasks",
      422
    );
  }
}
