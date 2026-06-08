import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }

  return event.deltaY;
}

function useScrollListWheelChain() {
  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      if (!(event.target instanceof Element) || event.defaultPrevented || event.deltaY === 0) {
        return;
      }

      const scrollList = event.target.closest<HTMLElement>(
        ".dashboard-scroll-list, .settings-scroll-list"
      );

      if (!scrollList) {
        return;
      }

      const deltaY = normalizeWheelDelta(event);
      const maxListScrollTop = scrollList.scrollHeight - scrollList.clientHeight;
      const canListScroll = maxListScrollTop > 1;
      const isAtTop = scrollList.scrollTop <= 0;
      const isAtBottom = scrollList.scrollTop >= maxListScrollTop - 1;
      const wantsPageScroll =
        !canListScroll ||
        (deltaY < 0 && isAtTop) ||
        (deltaY > 0 && isAtBottom);

      if (!wantsPageScroll) {
        return;
      }

      const page = document.scrollingElement ?? document.documentElement;
      const maxPageScrollTop = page.scrollHeight - window.innerHeight;
      const canPageScroll =
        (deltaY < 0 && page.scrollTop > 0) ||
        (deltaY > 0 && page.scrollTop < maxPageScrollTop - 1);

      if (!canPageScroll) {
        return;
      }

      event.preventDefault();
      window.scrollBy({
        top: deltaY,
        left: event.deltaX,
        behavior: "auto"
      });
    }

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);
}

export function AppProviders({ children }: { children: ReactNode }) {
  useScrollListWheelChain();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
