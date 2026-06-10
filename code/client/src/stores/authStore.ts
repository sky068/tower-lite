import { create } from "zustand";
import type { CurrentUser, User } from "../types/api";

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: CurrentUser | User | null;
  setSession: (session: { accessToken: string; refreshToken: string; user: CurrentUser | User }) => void;
  updateUser: (user: CurrentUser | User) => void;
  clearSession: () => void;
};

const storedSession = (() => {
  try {
    return {
      accessToken: localStorage.getItem("tower.accessToken"),
      refreshToken: localStorage.getItem("tower.refreshToken"),
      user: JSON.parse(localStorage.getItem("tower.user") ?? "null") as CurrentUser | User | null
    };
  } catch {
    return {
      accessToken: null,
      refreshToken: null,
      user: null
    };
  }
})();

export const useAuthStore = create<AuthState>((set) => ({
  ...storedSession,
  setSession: (session) => {
    localStorage.setItem("tower.accessToken", session.accessToken);
    localStorage.setItem("tower.refreshToken", session.refreshToken);
    localStorage.setItem("tower.user", JSON.stringify(session.user));
    set(session);
  },
  updateUser: (user) => {
    localStorage.setItem("tower.user", JSON.stringify(user));
    set({ user });
  },
  clearSession: () => {
    localStorage.removeItem("tower.accessToken");
    localStorage.removeItem("tower.refreshToken");
    localStorage.removeItem("tower.user");
    set({
      accessToken: null,
      refreshToken: null,
      user: null
    });
  }
}));
