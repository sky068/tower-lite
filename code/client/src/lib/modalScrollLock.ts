import { useEffect } from "react";

let modalLockCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";

export function useModalScrollLock(active = true) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    if (modalLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      previousHtmlOverflow = document.documentElement.style.overflow;
      document.documentElement.classList.add("modal-scroll-lock");
      document.body.classList.add("modal-scroll-lock");
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }

    modalLockCount += 1;

    return () => {
      modalLockCount = Math.max(0, modalLockCount - 1);

      if (modalLockCount === 0) {
        document.documentElement.classList.remove("modal-scroll-lock");
        document.body.classList.remove("modal-scroll-lock");
        document.documentElement.style.overflow = previousHtmlOverflow;
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [active]);
}
