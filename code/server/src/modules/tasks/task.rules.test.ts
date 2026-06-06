import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../middleware/error-handler.js";
import { assertV0SubTaskParent, assertValidDateRange } from "./task.rules.js";

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
});
