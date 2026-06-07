import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TaskListType } from "@prisma/client";
import { AppError } from "../../middleware/error-handler.js";
import {
  assertCustomTaskListName,
  assertTaskListDeletable,
  assertTaskListEditable,
  assertTaskDeletable,
  assertV0SubTaskParent,
  assertValidDateRange
} from "./task.rules.js";

describe("task rules", () => {
  it("allows empty or ordered task dates", () => {
    assert.doesNotThrow(() => assertValidDateRange(null, null));
    assert.doesNotThrow(() =>
      assertValidDateRange(new Date("2026-06-01"), new Date("2026-06-02"))
    );
  });

  it("rejects a start date after the due date", () => {
    assert.throws(
      () => assertValidDateRange(new Date("2026-06-03"), new Date("2026-06-02")),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
  });

  it("allows creating a subtask under a root task", () => {
    assert.doesNotThrow(() => assertV0SubTaskParent({ parentId: null }));
  });

  it("rejects creating a subtask under another subtask in V0", () => {
    assert.throws(
      () => assertV0SubTaskParent({ parentId: "parent-task-id" }),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
  });

  it("allows deleting custom task lists", () => {
    assert.doesNotThrow(() => assertTaskListDeletable({ type: TaskListType.CUSTOM }));
  });

  it("rejects deleting default task lists", () => {
    for (const type of [TaskListType.TODO, TaskListType.IN_PROGRESS, TaskListType.DONE]) {
      assert.throws(
        () => assertTaskListDeletable({ type }),
        (error) =>
          error instanceof AppError &&
          error.code === "BUSINESS_RULE_VIOLATION" &&
          error.status === 422
      );
    }
  });

  it("allows editing custom task lists", () => {
    assert.doesNotThrow(() => assertTaskListEditable({ type: TaskListType.CUSTOM }));
  });

  it("rejects editing default task lists", () => {
    for (const type of [TaskListType.TODO, TaskListType.IN_PROGRESS, TaskListType.DONE]) {
      assert.throws(
        () => assertTaskListEditable({ type }),
        (error) =>
          error instanceof AppError &&
          error.code === "BUSINESS_RULE_VIOLATION" &&
          error.status === 422
      );
    }
  });

  it("allows custom task list names that do not duplicate default lists", () => {
    assert.doesNotThrow(() => assertCustomTaskListName("评审中"));
  });

  it("rejects custom task list names that duplicate default lists", () => {
    for (const name of ["待处理", "进行中", "已完成", "  已完成  "]) {
      assert.throws(
        () => assertCustomTaskListName(name),
        (error) =>
          error instanceof AppError &&
          error.code === "BUSINESS_RULE_VIOLATION" &&
          error.status === 422
      );
    }
  });

  it("allows deleting tasks without subtasks", () => {
    assert.doesNotThrow(() => assertTaskDeletable({ subTaskCount: 0 }));
  });

  it("rejects deleting tasks that still have subtasks", () => {
    assert.throws(
      () => assertTaskDeletable({ subTaskCount: 1 }),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
  });
});
