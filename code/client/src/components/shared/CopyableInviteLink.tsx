import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

type CopyableInviteLinkProps = {
  url: string;
  label?: string;
  variant?: "field" | "inline";
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Copy failed");
  }
}

export function CopyableInviteLink({ url, label, variant = "inline" }: CopyableInviteLinkProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await copyText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setCopyState("idle"), 1600);
  }

  const buttonText = copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制";

  const content = (
    <div className={`copy-link-row ${variant === "inline" ? "compact" : ""}`}>
      {variant === "field" ? (
        <input readOnly value={url} />
      ) : (
        <span className="muted copy-link-text" title={url}>
          {url}
        </span>
      )}
      <button className="copy-link-button" type="button" onClick={handleCopy}>
        {buttonText}
      </button>
    </div>
  );

  if (variant === "field") {
    return (
      <label className="copy-field">
        {label ?? "注册链接"}
        {content}
      </label>
    );
  }

  return content;
}
