import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../middleware/error-handler.js";
import {
  assertTaskListDeletable,
  assertTaskListEditable,
  assertTaskListNameAvailable,
  assertTaskDeletable,
  assertV01SubTaskParent,
  assertValidDateRange,
  normalizeTaskDateRange
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

  it("fills a missing task date from the provided date", () => {
    const startOnlyDate = new Date("2026-06-03");
    const dueOnlyDate = new Date("2026-06-04");

    assert.deepEqual(normalizeTaskDateRange(startOnlyDate, null), {
      startDate: startOnlyDate,
      dueDate: startOnlyDate
    });
    assert.deepEqual(normalizeTaskDateRange(null, dueOnlyDate), {
      startDate: dueOnlyDate,
      dueDate: dueOnlyDate
    });
    assert.deepEqual(normalizeTaskDateRange(null, null), {
      startDate: null,
      dueDate: null
    });
  });

  it("allows creating a subtask under a root task", () => {
    assert.doesNotThrow(() => assertV01SubTaskParent({ depth: 0 }));
  });

  it("allows creating a second-level subtask in V0.1", () => {
    assert.doesNotThrow(() => assertV01SubTaskParent({ depth: 1 }));
  });

  it("rejects creating a third-level subtask in V0.1", () => {
    assert.throws(
      () => assertV01SubTaskParent({ depth: 2 }),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
  });

  it("allows editing and deleting non-default task lists", () => {
    assert.doesNotThrow(() => assertTaskListEditable({ isDefault: false }));
    assert.doesNotThrow(() => assertTaskListDeletable({ isDefault: false }));
  });

  it("rejects editing and deleting the default task list", () => {
    assert.throws(
      () => assertTaskListEditable({ isDefault: true }),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
    assert.throws(
      () => assertTaskListDeletable({ isDefault: true }),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
  });

  it("allows a unique or unchanged task list name", () => {
    assert.doesNotThrow(() => assertTaskListNameAvailable(null));
    assert.doesNotThrow(() => assertTaskListNameAvailable({ id: "same-list" }, "same-list"));
  });

  it("rejects duplicate task list names in the same project", () => {
    assert.throws(
      () => assertTaskListNameAvailable({ id: "other-list" }, "current-list"),
      (error) =>
        error instanceof AppError &&
        error.code === "BUSINESS_RULE_VIOLATION" &&
        error.status === 422
    );
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
