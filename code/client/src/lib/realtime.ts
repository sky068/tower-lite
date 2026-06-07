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

export function useRealtimeEvents() {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/v1/events?token=${encodeURIComponent(accessToken)}`
    );
    let reconnectTimer: number | null = null;

    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as RealtimeEvent;

      if (event.type === "notification.changed") {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        return;
      }

      if (event.type === "task.changed") {
        void queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["board", event.projectId] });

        if (event.taskId) {
          void queryClient.invalidateQueries({ queryKey: ["task", event.taskId] });
        }

        return;
      }

      if (event.type === "project.changed") {
        void queryClient.invalidateQueries({ queryKey: ["teams"] });

        if (event.teamId) {
          void queryClient.invalidateQueries({ queryKey: ["projects", event.teamId] });
        } else {
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
        }

        if (event.projectId) {
          void queryClient.invalidateQueries({ queryKey: ["project", event.projectId] });
          void queryClient.invalidateQueries({ queryKey: ["project-members", event.projectId] });
        }

        return;
      }

      if (event.type === "team.changed") {
        void queryClient.invalidateQueries({ queryKey: ["teams"] });

        if (event.teamId) {
          void queryClient.invalidateQueries({ queryKey: ["team-members", event.teamId] });
          void queryClient.invalidateQueries({ queryKey: ["projects", event.teamId] });
        }

        return;
      }

      if (event.type === "tags.changed") {
        void queryClient.invalidateQueries({ queryKey: ["tags", event.projectId] });
        void queryClient.invalidateQueries({ queryKey: ["board", event.projectId] });

        if (event.taskId) {
          void queryClient.invalidateQueries({ queryKey: ["task", event.taskId] });
        }
      }
    };

    socket.onclose = () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      reconnectTimer = window.setTimeout(() => {
        setReconnectAttempt((current) => current + 1);
      }, 2_000);
    };

    socket.onerror = () => {
      socket.close();
    };

    return () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      socket.close();
    };
  }, [accessToken, queryClient, reconnectAttempt]);
}
