import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { invitationApi } from "../../lib/api";

type AcceptInvitationResult = {
  ok: boolean;
  teamId: string;
  projectId: string | null;
};

export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const token = searchParams.get("token") ?? "";
  const hasSubmittedRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [result, setResult] = useState<AcceptInvitationResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (token && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;
      setStatus("pending");
      invitationApi
        .accept(token)
        .then((data) => {
          setResult(data);
          setStatus("success");

          void queryClient.invalidateQueries({ queryKey: ["teams"] });
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          void queryClient.invalidateQueries({ queryKey: ["project-members"] });
          void queryClient.invalidateQueries({ queryKey: ["team-members"] });
        })
        .catch((requestError) => {
          setError(requestError);
          setStatus("error");
        });
    }
  }, [queryClient, token]);

  const acceptedProjectId = result?.projectId;

  return (
    <div className="page">
      <div className="page-heading">
        <h1>接受邀请</h1>
        <p>系统会将当前登录账号加入对应团队或项目。</p>
      </div>
      <section className="panel invite-accept-panel">
        {!token ? (
          <>
            <h2>邀请链接无效</h2>
            <span className="muted">链接中缺少邀请凭证，请确认你打开的是完整邀请链接。</span>
            <Link className="text-link inline" to="/dashboard">
              返回工作台
            </Link>
          </>
        ) : null}
        {token && status === "pending" ? (
          <>
            <h2>正在接受邀请...</h2>
            <span className="muted">请稍候。</span>
          </>
        ) : null}
        {status === "success" ? (
          <>
            <h2>邀请已接受</h2>
            <span className="form-success">你已经加入对应团队或项目。</span>
            <div className="segmented-actions">
              {acceptedProjectId ? (
                <Link className="button-link" to={`/projects/${acceptedProjectId}/board`}>
                  进入项目看板
                </Link>
              ) : null}
              <Link className="button-link secondary" to="/dashboard">
                返回工作台
              </Link>
            </div>
          </>
        ) : null}
        {status === "error" ? (
          <>
            <h2>无法接受邀请</h2>
            <MutationError error={error} />
            <Link className="text-link inline" to="/dashboard">
              返回工作台
            </Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
