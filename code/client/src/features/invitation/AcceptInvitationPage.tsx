import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MutationError } from "../../components/shared/MutationError";
import { getApiErrorMessage, invitationApi } from "../../lib/api";

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
  const errorMessage = getApiErrorMessage(error);
  const requiresEmailVerification = errorMessage === "请先完成邮箱验证，再接受注册链接。";

  return (
    <div className="page">
      <div className="page-heading">
        <h1>注册链接</h1>
        <p>系统会用当前登录账号认领同邮箱的团队或项目成员身份。</p>
      </div>
      <section className="panel invite-accept-panel">
        {!token ? (
          <>
            <h2>注册链接无效</h2>
            <span className="muted">链接中缺少注册凭证，请确认你打开的是完整注册链接。</span>
            <Link className="text-link inline" to="/dashboard">
              返回工作台
            </Link>
          </>
        ) : null}
        {token && status === "pending" ? (
          <>
            <h2>正在认领成员身份...</h2>
            <span className="muted">请稍候。</span>
          </>
        ) : null}
        {status === "success" ? (
          <>
            <h2>成员身份已认领</h2>
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
          requiresEmailVerification ? (
            <>
              <h2>请先验证邮箱</h2>
              <div className="form-info invite-guidance">
                <span>当前账号还没有完成邮箱验证，暂时不能认领团队或项目成员身份。</span>
                <span>请先到邮箱中打开验证链接。验证完成后，重新打开这条注册链接即可继续。</span>
              </div>
              <div className="segmented-actions">
                <Link className="button-link" to="/dashboard">
                  返回工作台
                </Link>
                <Link className="button-link secondary" to="/dashboard?account=settings">
                  去账号设置
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>无法认领成员身份</h2>
              <MutationError error={error} />
              <Link className="text-link inline" to="/dashboard">
                返回工作台
              </Link>
            </>
          )
        ) : null}
      </section>
    </div>
  );
}
