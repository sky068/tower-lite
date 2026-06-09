import { Prisma, TaskListType } from "@prisma/client";

export function createDefaultTaskLists() {
  return [
    { name: "待处理", type: TaskListType.TODO, sortKey: new Prisma.Decimal(1000) },
    { name: "进行中", type: TaskListType.IN_PROGRESS, sortKey: new Prisma.Decimal(2000) },
    { name: "已完成", type: TaskListType.DONE, sortKey: new Prisma.Decimal(3000) }
  ];
}
