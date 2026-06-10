import { Link } from "react-router-dom";
import { getApiErrorCode, getApiErrorStatus } from "../../lib/api";

type ResourceStateProps = {
  error: unknown;
  title?: string;
  backTo?: string;
  backLabel?: string;
};

export function ResourceState({
  error,
  title,
  backTo = "/dashboard",
  backLabel = "返回工作台"
}: ResourceStateProps) {
  const status = getApiErrorStatus(error);
  const code = getApiErrorCode(error);
  const isNotFound = status === 404 || code === "RESOURCE_NOT_FOUND";
  const isForbidden = status === 403 || code === "FORBIDDEN";

  const stateTitle =
    title ?? (isForbidden ? "没有访问权限" : isNotFound ? "内容不存在" : "页面暂时不可用");
  const description = isForbidden
    ? "你没有权限访问这个内容，或成员权限已经发生变化。"
    : isNotFound
      ? "这个内容可能已被删除、移动，或当前账号无法再访问。"
      : "请求没有成功，请稍后重试或返回工作台。";

  return (
    <section className="resource-state" role="status">
      <h2>{stateTitle}</h2>
      <p>{description}</p>
      <Link className="button-link secondary" to={backTo}>
        {backLabel}
      </Link>
    </section>
  );
}
