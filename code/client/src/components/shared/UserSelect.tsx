import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "../../types/api";
import { UserAvatar } from "./UserAvatar";

type UserSelectProps = {
  disabled?: boolean;
  emptyText?: string;
  onChange: (userId: string) => void;
  placeholder: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  users: User[];
  value: string;
};

export function UserSelect({
  disabled,
  emptyText = "暂无可选成员",
  onChange,
  placeholder,
  searchable,
  searchPlaceholder = "搜索成员",
  users,
  value
}: UserSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedUser = useMemo(() => users.find((user) => user.id === value) ?? null, [users, value]);
  const filteredUsers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return users;
    }

    return users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(normalizedKeyword)
    );
  }, [keyword, users]);

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

  return (
    <div className="user-select" ref={rootRef}>
      <button
        className="user-select-trigger"
        type="button"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        {selectedUser ? (
          <span className="user-select-value">
            <UserAvatar user={selectedUser} size="xs" />
            <span>{selectedUser.name}</span>
          </span>
        ) : (
          <span className="user-select-placeholder">{placeholder}</span>
        )}
        <span aria-hidden="true">⌄</span>
      </button>
      {isOpen ? (
        <div className="user-select-menu" role="listbox">
          {searchable ? (
            <input
              className="user-select-search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
            />
          ) : null}
          {filteredUsers.length > 0 ? (
            filteredUsers.map((user) => (
              <button
                className={user.id === value ? "user-select-option selected" : "user-select-option"}
                key={user.id}
                type="button"
                role="option"
                aria-selected={user.id === value}
                onClick={() => {
                  onChange(user.id);
                  setIsOpen(false);
                  setKeyword("");
                }}
              >
                <UserAvatar user={user} size="sm" />
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </span>
              </button>
            ))
          ) : (
            <span className="user-select-empty">{emptyText}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
