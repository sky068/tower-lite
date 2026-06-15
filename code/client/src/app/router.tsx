import { Navigate, Route, Routes, useLocation, useRoutes, type Location } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { VerifyEmailPage } from "../features/auth/VerifyEmailPage";
import { FeishuCallbackPage } from "../features/auth/FeishuCallbackPage";
import { ProjectBoardPage } from "../features/board/ProjectBoardPage";
import { ProjectGanttPage } from "../features/board/ProjectGanttPage";
import { ProjectTaskListPage } from "../features/board/ProjectTaskListPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { TeamDetailPage } from "../features/team/TeamDetailPage";
import { ProjectSettingsPage } from "../features/project/ProjectSettingsPage";
import { ProjectTrashPage } from "../features/project/ProjectTrashPage";
import { TaskModalRoute, TaskPage } from "../features/task/TaskPage";
import { AcceptInvitationPage } from "../features/invitation/AcceptInvitationPage";

type BackgroundRouteState = {
  backgroundLocation?: Location;
};

const routes = [
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
    path: "/forgot-password",
    element: <ForgotPasswordPage />
  },
  {
    path: "/auth/reset-password",
    element: <ResetPasswordPage />
  },
  {
    path: "/auth/verify-email",
    element: <VerifyEmailPage />
  },
  {
    path: "/auth/feishu/callback",
    element: <FeishuCallbackPage />
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
        path: "/projects/:projectId/list",
        element: <ProjectTaskListPage />
      },
      {
        path: "/projects/:projectId/gantt",
        element: <ProjectGanttPage viewMode="TASK" />
      },
      {
        path: "/projects/:projectId/gantt/people",
        element: <ProjectGanttPage viewMode="PEOPLE" />
      },
      {
        path: "/teams/:teamId",
        element: <TeamDetailPage />
      },
      {
        path: "/projects/:projectId/settings",
        element: <ProjectSettingsPage />
      },
      {
        path: "/projects/:projectId/trash",
        element: <ProjectTrashPage />
      },
      {
        path: "/invitations/accept",
        element: <AcceptInvitationPage />
      },
      {
        path: "/tasks/:taskId",
        element: <TaskPage />
      }
    ]
  }
];

export function AppRouter() {
  const location = useLocation();
  const state = location.state as BackgroundRouteState | null;
  const backgroundLocation = state?.backgroundLocation;
  const routedElement = useRoutes(routes, backgroundLocation ?? location);

  return (
    <>
      {routedElement}
      {backgroundLocation ? (
        <Routes>
          <Route
            path="/tasks/:taskId"
            element={
              <RequireAuth>
                <TaskModalRoute />
              </RequireAuth>
            }
          />
        </Routes>
      ) : null}
    </>
  );
}
