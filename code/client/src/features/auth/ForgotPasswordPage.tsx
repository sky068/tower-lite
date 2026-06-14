import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";

function toAbsolutePath(path: string) {
  return `${window.location.origin}${path}`;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [devResetPath, setDevResetPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setDevResetPath(null);
    setCopyState("idle");
    setIsSubmitting(true);

    try {
      const result = await authApi.requestPasswordReset({ email });
      setDevResetPath(result.devResetPath ?? null);
      setMessage("如果邮箱已注册，系统会发送一封密码重置邮件。");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "密码重置请求失败，请稍后再试。"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!devResetPath) {
      return;
    }

    await navigator.clipboard.writeText(toAbsolutePath(devResetPath));
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>找回密码</h1>
        <p>输入账号邮箱，生成用于设置新密码的临时链接。</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            邮箱
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {message ? <div className="form-success">{message}</div> : null}
          {error ? <div className="form-error">{error}</div> : null}
          {devResetPath ? (
            <div className="auth-link-box">
              <input value={toAbsolutePath(devResetPath)} readOnly aria-label="开发环境密码重置链接" />
              <button type="button" onClick={() => void handleCopy()}>
                {copyState === "copied" ? "已复制" : "复制"}
              </button>
            </div>
          ) : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "发送中..." : "发送重置邮件"}
          </button>
          <Link className="text-link" to="/login">
            返回登录
          </Link>
        </form>
      </section>
    </main>
  );
}
