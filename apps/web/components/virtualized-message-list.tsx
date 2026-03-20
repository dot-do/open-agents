"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

type VirtualizedMessageListProps = {
  itemCount: number;
  getItemKey: (index: number) => string;
  renderItem: (index: number) => ReactNode;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  estimateSize?: number;
  overscan?: number;
};

export function VirtualizedMessageList({
  itemCount,
  getItemKey,
  renderItem,
  scrollContainerRef,
  contentRef,
  footer = null,
  className,
  contentClassName,
  estimateSize = 240,
  overscan = 6,
}: VirtualizedMessageListProps) {
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimateSize,
    getItemKey,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollContainerRef}
      className={cn("h-full overflow-y-auto", className)}
    >
      <div
        ref={contentRef}
        className={cn("overflow-hidden py-8", contentClassName)}
      >
        <div style={{ height: totalSize, position: "relative", width: "100%" }}>
          {virtualItems.map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                left: 0,
                position: "absolute",
                top: 0,
                transform: `translateY(${item.start}px)`,
                width: "100%",
              }}
            >
              {renderItem(item.index)}
            </div>
          ))}
        </div>
        {footer}
      </div>
    </div>
  );
}
