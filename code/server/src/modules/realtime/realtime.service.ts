import type { IncomingMessage, Server } from "node:http";
import { SystemRole } from "@prisma/client";
import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "../../lib/prisma.js";
import { verifyAccessToken } from "../../utils/token.js";

export type RealtimeEvent =
  | {
      type: "notification.changed";
    }
  | {
      type: "task.changed";
      projectId: string;
      taskId?: string;
    }
  | {
      type: "project.changed";
      projectId?: string;
      teamId?: string;
    }
  | {
      type: "team.changed";
      teamId?: string;
    }
  | {
      type: "tags.changed";
      projectId: string;
      taskId?: string;
    };

const clients = new Map<string, Set<WebSocket>>();

function writeEvent(socket: WebSocket, event: RealtimeEvent) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

export function installRealtimeServer(server: Server) {
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "", "http://localhost");

    if (requestUrl.pathname !== "/api/v1/events") {
      return;
    }

    const token = requestUrl.searchParams.get("token");

    if (!token) {
      socket.destroy();
      return;
    }

    try {
      const userId = verifyAccessToken(token).sub;

      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request, userId);
      });
    } catch {
      socket.destroy();
    }
  });

  websocketServer.on("connection", (socket: WebSocket, _request: IncomingMessage, userId: string) => {
    const unsubscribe = subscribeToRealtime(userId, socket);
    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  });
}

export function subscribeToRealtime(userId: string, socket: WebSocket) {
  let userClients = clients.get(userId);

  if (!userClients) {
    userClients = new Set();
    clients.set(userId, userClients);
  }

  userClients.add(socket);
  writeEvent(socket, { type: "notification.changed" });

  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }, 25_000);

  return () => {
    clearInterval(heartbeat);
    userClients?.delete(socket);

    if (userClients?.size === 0) {
      clients.delete(userId);
    }
  };
}

export function publishToUsers(userIds: string[], event: RealtimeEvent) {
  for (const userId of new Set(userIds)) {
    const userClients = clients.get(userId);

    if (!userClients) {
      continue;
    }

    for (const client of userClients) {
      writeEvent(client, event);
    }
  }
}

export function publishToUser(userId: string, event: RealtimeEvent) {
  publishToUsers([userId], event);
}

export async function publishProjectEvent(projectId: string, event: RealtimeEvent) {
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT candidate."userId"
    FROM (
      SELECT team_member."userId"
      FROM "Project" project
      JOIN "TeamMember" team_member ON team_member."teamId" = project."teamId"
      WHERE project."id" = ${projectId}
        AND project."deletedAt" IS NULL
        AND team_member."role" = 'ADMIN'
        AND team_member."userId" IS NOT NULL
      UNION
      SELECT project_member."userId"
      FROM "ProjectMember" project_member
      JOIN "Project" project ON project."id" = project_member."projectId"
      WHERE project."id" = ${projectId}
        AND project."deletedAt" IS NULL
        AND project_member."userId" IS NOT NULL
    ) candidate
  `;
  const systemAdmins = await prisma.user.findMany({
    where: {
      systemRole: SystemRole.ADMIN,
      deletedAt: null
    },
    select: {
      id: true
    }
  });

  publishToUsers([...rows.map((row) => row.userId), ...systemAdmins.map((user) => user.id)], event);
}

export async function publishTeamEvent(teamId: string, event: RealtimeEvent) {
  const members = await prisma.teamMember.findMany({
    where: {
      teamId,
      team: {
        deletedAt: null
      }
    },
    select: {
      userId: true
    }
  });
  const systemAdmins = await prisma.user.findMany({
    where: {
      systemRole: SystemRole.ADMIN,
      deletedAt: null
    },
    select: {
      id: true
    }
  });

  publishToUsers(
    [
      ...members.map((member) => member.userId).filter((memberUserId): memberUserId is string => Boolean(memberUserId)),
      ...systemAdmins.map((user) => user.id)
    ],
    event
  );
}
