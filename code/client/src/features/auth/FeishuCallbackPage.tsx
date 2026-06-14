import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

type FeishuCallbackSession = Awaited<ReturnType<typeof authApi.feishuCallback>>;

const feishuCallbackRequests = new Map<string, Promise<FeishuCallbackSession>>();

function getFeishuCallbackRequest(callbackKey: string, input: { code: string; state: string }) {
  const existingRequest = feishuCallbackRequests.get(callbackKey);

  if (existingRequest) {
    return existingRequest;
  }

  const request = authApi.feishuCallback(input);
  feishuCallbackRequests.set(callbackKey, request);
  window.setTimeout(() => feishuCallbackRequests.delete(callbackKey), 5 * 60 * 1000);

  return request;
}

export function FeishuCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { accessToken, setSession } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [isHandling, setIsHandling] = useState(true);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const feishuError = searchParams.get("error");
  const shouldHandleCallback = Boolean(code && state && !feishuError);

  useEffect(() => {
    if (accessToken && !shouldHandleCallback) {
      return;
    }

    let isActive = true;

    async function handleCallback() {
      if (feishuError) {
        if (!isActive) {
          return;
        }
        setError("飞书授权已取消或失败。");
        setIsHandling(false);
        return;
      }

      if (!code || !state) {
        if (!isActive) {
          return;
        }
        setError("飞书登录回调参数不完整，请重新发起登录。");
        setIsHandling(false);
        return;
      }

      try {
        const session = await getFeishuCallbackRequest(`${code}:${state}`, { code, state });
        if (!isActive) {
          return;
        }
        setSession(session);
        navigate(session.redirectTo || "/dashboard", { replace: true });
      } catch (requestError) {
        if (!isActive) {
          return;
        }
        setError(getApiErrorMessage(requestError, "飞书登录失败，请稍后再试。"));
        setIsHandling(false);
      }
    }

    void handleCallback();

    return () => {
      isActive = false;
    };
  }, [accessToken, code, feishuError, navigate, setSession, shouldHandleCallback, state]);

  if (accessToken && !shouldHandleCallback) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>飞书登录</h1>
        {isHandling ? <p>正在完成飞书登录...</p> : <p>没有完成登录，请返回后重试。</p>}
        {error ? <div className="form-error">{error}</div> : null}
        {!isHandling ? (
          <Link className="text-link" to="/login">
            返回登录
          </Link>
        ) : null}
      </section>
    </main>
  );
}
