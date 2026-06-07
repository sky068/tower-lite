import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTaskSchema, updateTaskSchema } from "./task.schema.js";

const taskListId = "00000000-0000-4000-8000-000000000001";

describe("task schemas", () => {
  it("does not coerce empty create dates to unix epoch", () => {
    const parsed = createTaskSchema.parse({
      taskListId,
      title: "Task",
      startDate: null,
      dueDate: ""
    });

    assert.equal(parsed.startDate, undefined);
    assert.equal(parsed.dueDate, undefined);
  });

  it("keeps explicit update date clears as null", () => {
    const parsed = updateTaskSchema.parse({
      startDate: null,
      dueDate: ""
    });

    assert.equal(parsed.startDate, null);
    assert.equal(parsed.dueDate, null);
  });
});
