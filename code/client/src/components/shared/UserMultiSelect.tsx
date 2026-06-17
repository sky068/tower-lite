import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "../../types/api";
import { UserAvatar } from "./UserAvatar";

type UserMultiSelectProps = {
  disabled?: boolean;
  emptyText?: string;
  onChange: (userIds: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  users: User[];
  value: string[];
};

export function UserMultiSelect({
  disabled,
  emptyText = "暂无可选成员",
  onChange,
  placeholder,
  searchPlaceholder = "搜索成员",
  users,
  value
}: UserMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedIds = useMemo(() => new Set(value), [value]);
  const selectedUsers = useMemo(
    () => users.filter((user) => selectedIds.has(user.id)),
    [selectedIds, users]
  );
  const filteredUsers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return users;
    }

    return users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(normalizedKeyword)
    );
  }, [keyword, users]);
  const filteredIds = filteredUsers.map((user) => user.id);
  const isAllFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((userId) => selectedIds.has(userId));
  const summary =
    selectedUsers.length === 0
      ? placeholder
      : selectedUsers.length === 1
        ? selectedUsers[0].name
        : `已选择 ${selectedUsers.length} 人`;

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

  useEffect(() => {
    if (!isOpen) {
      setKeyword("");
    }
  }, [isOpen]);

  function toggleUser(userId: string, checked: boolean) {
    const nextIds = new Set(value);

    if (checked) {
      nextIds.add(userId);
    } else {
      nextIds.delete(userId);
    }

    onChange(Array.from(nextIds));
  }

  function toggleFilteredUsers(checked: boolean) {
    const nextIds = new Set(value);

    for (const userId of filteredIds) {
      if (checked) {
        nextIds.add(userId);
      } else {
        nextIds.delete(userId);
      }
    }

    onChange(Array.from(nextIds));
  }

  return (
    <div className="user-select user-multi-select" ref={rootRef}>
      <button
        className="user-select-trigger"
        type="button"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={selectedUsers.length > 0 ? "user-select-value" : "user-select-placeholder"}>
          {selectedUsers.length === 1 ? <UserAvatar user={selectedUsers[0]} size="xs" /> : null}
          <span>{summary}</span>
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {isOpen ? (
        <div className="user-select-menu user-multi-select-menu" role="listbox" aria-multiselectable="true">
          <input
            className="user-select-search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
          />
          {filteredUsers.length > 0 ? (
            <>
              <label className="user-select-option user-multi-select-option select-all">
                <input
                  className="member-checkbox-input"
                  type="checkbox"
                  checked={isAllFilteredSelected}
                  onChange={(event) => toggleFilteredUsers(event.target.checked)}
                />
                <span className="member-checkbox-box" aria-hidden="true" />
                <span>
                  <strong>全选</strong>
                  <small>{keyword.trim() ? `当前筛选 ${filteredUsers.length} 人` : `全部 ${filteredUsers.length} 人`}</small>
                </span>
              </label>
              {filteredUsers.map((user) => (
                <label
                  className={
                    selectedIds.has(user.id)
                      ? "user-select-option user-multi-select-option selected"
                      : "user-select-option user-multi-select-option"
                  }
                  key={user.id}
                >
                  <input
                    className="member-checkbox-input"
                    type="checkbox"
                    checked={selectedIds.has(user.id)}
                    onChange={(event) => toggleUser(user.id, event.target.checked)}
                  />
                  <span className="member-checkbox-box" aria-hidden="true" />
                  <UserAvatar user={user} size="sm" />
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </span>
                </label>
              ))}
            </>
          ) : (
            <span className="user-select-empty">{emptyText}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
