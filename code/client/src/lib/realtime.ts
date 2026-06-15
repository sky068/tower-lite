import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";

type RealtimeEvent =
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

export type RealtimeStatus = "idle" | "connecting" | "connected" | "reconnecting";

function invalidateProjectTaskViews(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ["board", projectId] });
  void queryClient.invalidateQueries({ queryKey: ["project-task-list", projectId] });
  // 甘特图当前复用 project-task-list；保留独立 key，未来拆 queryKey 时不会漏刷新。
  void queryClient.invalidateQueries({ queryKey: ["project-gantt", projectId] });
}

function getRealtimeOrigin() {
  const apiTarget =
    (import.meta.env.VITE_API_TARGET as string | undefined) ??
    (import.meta.env.DEV ? "http://127.0.0.1:4000" : undefined);

  if (!apiTarget) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  try {
    const url = new URL(apiTarget);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
}

export function useRealtimeEvents() {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [status, setStatus] = useState<RealtimeStatus>("idle");

  useEffect(() => {
    if (!accessToken) {
      setStatus("idle");
      return;
    }

    let isDisposed = false;
    setStatus("connecting");
    const socket = new WebSocket(
      `${getRealtimeOrigin()}/api/v1/events?token=${encodeURIComponent(accessToken)}`
    );
    let reconnectTimer: number | null = null;

    socket.onopen = () => {
      setStatus("connected");
    };

    socket.onmessage = (message) => {
      let event: RealtimeEvent;

      try {
        event = JSON.parse(message.data) as RealtimeEvent;
      } catch {
        return;
      }

      if (event.type === "notification.changed") {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        return;
      }

      if (event.type === "task.changed") {
        void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
        invalidateProjectTaskViews(queryClient, event.projectId);

        if (event.taskId) {
          void queryClient.invalidateQueries({ queryKey: ["task", event.taskId] });
        }

        return;
      }

      if (event.type === "project.changed") {
        void queryClient.invalidateQueries({ queryKey: ["teams"] });

        if (event.teamId) {
          void queryClient.invalidateQueries({ queryKey: ["projects", event.teamId] });
          void queryClient.invalidateQueries({ queryKey: ["team-invitations", event.teamId] });
        } else {
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          void queryClient.invalidateQueries({ queryKey: ["team-invitations"] });
        }

        if (event.projectId) {
          void queryClient.invalidateQueries({ queryKey: ["project", event.projectId] });
          void queryClient.invalidateQueries({ queryKey: ["project-members", event.projectId] });
          void queryClient.invalidateQueries({ queryKey: ["project-invitations", event.projectId] });
        }

        return;
      }

      if (event.type === "team.changed") {
        void queryClient.invalidateQueries({ queryKey: ["teams"] });

        if (event.teamId) {
          void queryClient.invalidateQueries({ queryKey: ["team-members", event.teamId] });
          void queryClient.invalidateQueries({ queryKey: ["projects", event.teamId] });
          void queryClient.invalidateQueries({ queryKey: ["team-invitations", event.teamId] });
        }

        return;
      }

      if (event.type === "tags.changed") {
        void queryClient.invalidateQueries({ queryKey: ["tags", event.projectId] });
        invalidateProjectTaskViews(queryClient, event.projectId);

        if (event.taskId) {
          void queryClient.invalidateQueries({ queryKey: ["task", event.taskId] });
        }
      }
    };

    socket.onclose = () => {
      if (isDisposed) {
        return;
      }

      setStatus("reconnecting");
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      reconnectTimer = window.setTimeout(() => {
        setReconnectAttempt((current) => current + 1);
      }, 2_000);
    };

    socket.onerror = () => {
      socket.close();
    };

    return () => {
      isDisposed = true;

      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      socket.close();
    };
  }, [accessToken, queryClient, reconnectAttempt]);

  return status;
}
