import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { ProjectBoardPage } from "../features/board/ProjectBoardPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { TeamSettingsPage } from "../features/team/TeamSettingsPage";
import { ProjectSettingsPage } from "../features/project/ProjectSettingsPage";
import { TaskPage } from "../features/task/TaskPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />
  },
  {
    path: "/login",
    element: <LoginPage />
  },
  {
    path: "/register",
    element: <RegisterPage />
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      {
        path: "/dashboard",
        element: <DashboardPage />
      },
      {
        path: "/projects/:projectId/board",
        element: <ProjectBoardPage />
      },
      {
        path: "/teams/:teamId/settings",
        element: <TeamSettingsPage />
      },
      {
        path: "/projects/:projectId/settings",
        element: <ProjectSettingsPage />
      },
      {
        path: "/tasks/:taskId",
        element: <TaskPage />
      }
    ]
  }
]);
