import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type UseScrollToBottomOptions<T extends HTMLElement> = {
  containerRef?: RefObject<T | null>;
  contentRef?: RefObject<HTMLElement | null>;
};

export function useScrollToBottom<T extends HTMLElement>(
  options?: UseScrollToBottomOptions<T>,
) {
  const internalContainerRef = useRef<T>(null);
  const containerRef = options?.containerRef ?? internalContainerRef;
  const contentRef = options?.contentRef;
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      if (behavior === "auto") {
        container.scrollTop = container.scrollHeight;
        return;
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
    },
    [containerRef],
  );

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 10;
    const atBottom = scrollHeight - scrollTop - clientHeight < threshold;

    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observedContent = contentRef?.current ?? container.firstElementChild;

    container.addEventListener("scroll", handleScroll, { passive: true });
    scrollToBottom();
    handleScroll();

    const resizeObserver = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        scrollToBottom();
        return;
      }

      handleScroll();
    });

    resizeObserver.observe(container);
    if (observedContent instanceof HTMLElement) {
      resizeObserver.observe(observedContent);
    }

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [containerRef, contentRef, handleScroll, scrollToBottom]);

  return {
    containerRef,
    isAtBottom,
    scrollToBottom,
  };
}
