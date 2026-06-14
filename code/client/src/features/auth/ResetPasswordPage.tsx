import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authApi, getApiErrorMessage } from "../../lib/api";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("密码重置链接无效，请重新获取。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setIsSubmitting(true);

    try {
      await authApi.confirmPasswordReset({ token, newPassword });
      setIsDone(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "密码重置失败，请重新获取链接。"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>设置新密码</h1>
        <p>密码更新后，旧登录状态会失效。</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>
            新密码
            <input
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={isDone}
              required
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isDone}
              required
            />
          </label>
          {isDone ? <div className="form-success">密码已更新，请使用新密码登录。</div> : null}
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={isSubmitting || isDone || !token}>
            {isSubmitting ? "保存中..." : "保存新密码"}
          </button>
          <Link className="text-link" to="/login">
            返回登录
          </Link>
        </form>
      </section>
    </main>
  );
}
