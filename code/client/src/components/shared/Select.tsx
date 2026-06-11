import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "../../types/api";
import { UserAvatar } from "./UserAvatar";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  user?: Pick<User, "name" | "email" | "avatarUrl">;
};

type SelectProps = {
  "aria-label"?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string;
};

function PriorityMark({ priority }: { priority: NonNullable<SelectOption["priority"]> }) {
  return <span className={`select-priority-mark priority-${priority.toLowerCase()}`} aria-hidden="true" />;
}

export function Select({
  "aria-label": ariaLabelAlias,
  ariaLabel,
  className,
  disabled,
  onChange,
  options,
  placeholder,
  value
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  const hasAvatarOptions = options.some((option) => option.user);
  const triggerAriaLabel = ariaLabel ?? ariaLabelAlias;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className={`custom-select ${hasAvatarOptions ? "has-avatar-options" : ""} ${className ?? ""}`} ref={rootRef}>
      <button
        className="custom-select-trigger"
        type="button"
        aria-label={triggerAriaLabel}
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        {selectedOption ? (
          <span className="custom-select-value">
            {selectedOption.priority ? <PriorityMark priority={selectedOption.priority} /> : null}
            {selectedOption.user ? <UserAvatar user={selectedOption.user} size="xs" /> : null}
            <span>{selectedOption.label}</span>
          </span>
        ) : (
          <span className="custom-select-placeholder">{placeholder ?? "请选择"}</span>
        )}
        <span aria-hidden="true">⌄</span>
      </button>
      {isOpen ? (
        <div className="custom-select-menu" role="listbox">
          {options.map((option) => (
            <button
              className={[
                "custom-select-option",
                option.priority ? "has-priority" : "",
                option.user ? "has-avatar" : "",
                option.value === value ? "selected" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.priority ? <PriorityMark priority={option.priority} /> : null}
              {option.user ? <UserAvatar user={option.user} size="sm" /> : null}
              <span>
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
