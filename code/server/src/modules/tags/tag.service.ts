import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { requireActiveProjectEditor, requireProjectAccess } from "../projects/project.policy.js";
import type { CreateTagInput, UpdateTagInput } from "./tag.schema.js";

function toTag(tag: { id: string; name: string; color: string; projectId: string }) {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    projectId: tag.projectId
  };
}

export async function listTags(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);

  const tags = await prisma.tag.findMany({
    where: {
      projectId
    },
    orderBy: {
      name: "asc"
    }
  });

  return tags.map(toTag);
}

export async function createTag(userId: string, projectId: string, input: CreateTagInput) {
  await requireActiveProjectEditor(userId, projectId);
  await assertTagNameAvailable(projectId, input.name);

  const tag = await prisma.tag.create({
    data: {
      projectId,
      name: input.name,
      color: input.color
    }
  });

  return toTag(tag);
}

export async function updateTag(
  userId: string,
  projectId: string,
  tagId: string,
  input: UpdateTagInput
) {
  await requireActiveProjectEditor(userId, projectId);
  await assertTagInProject(tagId, projectId);
  if (input.name) {
    await assertTagNameAvailable(projectId, input.name, tagId);
  }

  const tag = await prisma.tag.update({
    where: {
      id: tagId
    },
    data: input
  });

  return toTag(tag);
}

export async function deleteTag(userId: string, projectId: string, tagId: string) {
  await requireActiveProjectEditor(userId, projectId);
  await assertTagInProject(tagId, projectId);

  await prisma.$transaction(async (tx) => {
    await tx.taskTag.deleteMany({
      where: {
        tagId
      }
    });

    await tx.tag.delete({
      where: {
        id: tagId
      }
    });
  });

  return { ok: true };
}

export async function addTagToTask(userId: string, taskId: string, tagId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireActiveProjectEditor(userId, task.projectId);
  await assertTagInProject(tagId, task.projectId);

  await prisma.taskTag.upsert({
    where: {
      taskId_tagId: {
        taskId,
        tagId
      }
    },
    update: {},
    create: {
      taskId,
      tagId
    }
  });

  return { ok: true };
}

export async function removeTagFromTask(userId: string, taskId: string, tagId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null
    }
  });

  if (!task) {
    throw new AppError("RESOURCE_NOT_FOUND", "Task not found", 404);
  }

  await requireActiveProjectEditor(userId, task.projectId);

  await prisma.taskTag.deleteMany({
    where: {
      taskId,
      tagId
    }
  });

  return { ok: true };
}

async function assertTagInProject(tagId: string, projectId: string) {
  const tag = await prisma.tag.findFirst({
    where: {
      id: tagId,
      projectId
    }
  });

  if (!tag) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Tag must belong to this project", 422);
  }

  return tag;
}

async function assertTagNameAvailable(projectId: string, name: string, exceptTagId?: string) {
  const existingTag = await prisma.tag.findFirst({
    where: {
      projectId,
      name,
      id: exceptTagId
        ? {
            not: exceptTagId
          }
        : undefined
    }
  });

  if (existingTag) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "Tag name already exists in this project", 422);
  }
}
