import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMemberName, getMemberUser } from "../../lib/members";
import type { Member } from "../../types/api";
import { UserAvatar } from "./UserAvatar";

type MemberCheckboxPickerProps = {
  className?: string;
  disabled?: boolean;
  emptyText?: string;
  extraItems?: ReactNode;
  members: Member[];
  onToggle: (memberId: string, checked: boolean) => void;
  selectedIds: string[];
};

type MemberCheckboxDropdownProps = MemberCheckboxPickerProps & {
  triggerLabel?: string;
};

export function MemberCheckboxPicker({
  className,
  disabled,
  emptyText = "暂无可选成员",
  extraItems,
  members,
  onToggle,
  selectedIds
}: MemberCheckboxPickerProps) {
  const [keyword, setKeyword] = useState("");
  const normalizedKeyword = keyword.trim().toLowerCase();
  const extraItemCount = Children.count(extraItems);
  const filteredMembers = useMemo(() => {
    if (!normalizedKeyword) {
      return members;
    }

    return members.filter((member) => {
      const name = getMemberName(member).toLowerCase();
      const email = member.email.toLowerCase();

      return name.includes(normalizedKeyword) || email.includes(normalizedKeyword);
    });
  }, [members, normalizedKeyword]);

  return (
    <div className={`member-checkbox-picker ${className ?? ""}`}>
      <input
        aria-label="搜索负责人"
        className="member-checkbox-search"
        placeholder="搜索成员"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <div className="checkbox-list member-checkbox-list">
        {filteredMembers.map((member) => (
          <label className="checkbox-row" key={member.id}>
            <input
              className="member-checkbox-input"
              type="checkbox"
              checked={selectedIds.includes(member.id)}
              disabled={disabled}
              onChange={(event) => onToggle(member.id, event.target.checked)}
            />
            <span className="member-checkbox-box" aria-hidden="true" />
            <UserAvatar user={getMemberUser(member)} size="xs" />
            <span>{getMemberName(member)}</span>
            <small>{member.email}</small>
          </label>
        ))}
        {extraItems}
        {filteredMembers.length === 0 && extraItemCount === 0 ? (
          <span className="muted">{members.length === 0 ? emptyText : "没有匹配的成员"}</span>
        ) : null}
      </div>
    </div>
  );
}

export function MemberCheckboxDropdown({
  triggerLabel = "选择负责人",
  ...pickerProps
}: MemberCheckboxDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedNames = pickerProps.members
    .filter((member) => pickerProps.selectedIds.includes(member.id))
    .map(getMemberName);
  const summary =
    selectedNames.length === 0
      ? triggerLabel
      : selectedNames.length > 2
        ? `${selectedNames.slice(0, 2).join(", ")} 等 ${selectedNames.length} 人`
        : selectedNames.join(", ");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className="assignee-dropdown member-checkbox-dropdown" ref={rootRef}>
      <button
        className="assignee-dropdown-trigger"
        type="button"
        aria-expanded={isOpen}
        disabled={pickerProps.disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{summary}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {isOpen ? (
        <MemberCheckboxPicker
          {...pickerProps}
          className={`assignee-dropdown-menu ${pickerProps.className ?? ""}`}
        />
      ) : null}
    </div>
  );
}
