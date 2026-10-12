import { ReactNode, useEffect, useRef, useState, useCallback } from "react";
import { Loader2, ArrowDown, Check } from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";

interface Props {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  threshold?: number;
  disabled?: boolean;
  silent?: boolean;
  className?: string;
}

/**
 * Native-feeling pull-to-refresh that works smoothly across touch and desktop.
 * - Elastic bounce that physically pulls down the page content.
 * - Haptic feedback when the pull crosses the threshold.
 * - Distinct release-to-refresh indicator.
 * - Triggers an actual app refresh / reload.
 */
export const PullToRefresh = ({
  onRefresh,
  children,
  threshold = 68,
  disabled = false,
  silent = false,
  className = "",
}: Props) => {
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const isDragging = useRef(false);
  const refreshingRef = useRef(false);
  const readyRef = useRef(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const triggerRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
      setSuccess(true);
      if (!silent) toast.success("App refreshed", { duration: 1000 });
      setTimeout(() => setSuccess(false), 800);
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullDistance(0);
      readyRef.current = false;
      setIsPulling(false);
    }
  }, [onRefresh, silent]);

  useEffect(() => {
    if (disabled) return;

    const getScrollTop = () => {
      return (
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
      );
    };

    const findScrollableAncestor = (node: EventTarget | null): HTMLElement | null => {
      let el = node as HTMLElement | null;
      while (el && el !== document.body && el !== document.documentElement) {
        const s = getComputedStyle(el);
        const oy = s.overflowY;
        if (
          (oy === "auto" || oy === "scroll" || oy === "overlay") &&
          el.scrollHeight > el.clientHeight
        ) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    const handleStart = (clientX: number, clientY: number, target: EventTarget | null) => {
      if (refreshingRef.current) return;
      if (getScrollTop() > 2) return;

      const htmlTarget = target as HTMLElement | null;
      if (htmlTarget) {
        const tag = htmlTarget.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || htmlTarget.isContentEditable) {
          return;
        }
      }

      const inner = findScrollableAncestor(target);
      if (inner && inner.scrollTop > 2) return;

      startY.current = clientY;
      startX.current = clientX;
      isDragging.current = true;
      readyRef.current = false;
    };

    const handleMove = (clientX: number, clientY: number, e: TouchEvent | MouseEvent) => {
      if (!isDragging.current || startY.current == null || startX.current == null) return;
      if (refreshingRef.current) return;

      const dy = clientY - startY.current;
      const dx = clientX - startX.current;

      if (dy <= 0) {
        if (pullDistance !== 0) setPullDistance(0);
        setIsPulling(false);
        return;
      }

      // If user is clearly swiping horizontally, cancel vertical pull
      if (Math.abs(dx) > Math.abs(dy) && dy < 16) {
        isDragging.current = false;
        setIsPulling(false);
        setPullDistance(0);
        return;
      }

      if (getScrollTop() > 2) {
        isDragging.current = false;
        setIsPulling(false);
        setPullDistance(0);
        return;
      }

      if (dy > 6 && e.cancelable) {
        e.preventDefault();
      }

      setIsPulling(true);

      // Elastic dampening curve
      const dampened = Math.min(105, Math.pow(dy, 0.82) * 1.55);
      setPullDistance(dampened);

      const isReady = dampened >= threshold;
      if (isReady && !readyRef.current) {
        readyRef.current = true;
        haptic("light");
      } else if (!isReady && readyRef.current) {
        readyRef.current = false;
      }
    };

    const handleEnd = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      startY.current = null;
      startX.current = null;

      if (pullDistance >= threshold && !refreshingRef.current) {
        haptic("medium");
        triggerRefresh();
      } else {
        setIsPulling(false);
        setPullDistance(0);
        readyRef.current = false;
      }
    };

    // Touch event listeners
    const onTouchStart = (e: TouchEvent) => {
      handleStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
    };
    const onTouchMove = (e: TouchEvent) => {
      handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    const onTouchEnd = () => handleEnd();

    // Mouse event listeners for desktop testing (dragging down from top edge)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Left click only
      if (e.clientY <= 65 && getScrollTop() <= 0) {
        handleStart(e.clientX, e.clientY, e.target);
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        handleMove(e.clientX, e.clientY, e);
      }
    };
    const onMouseUp = () => {
      if (isDragging.current) handleEnd();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);

      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [disabled, threshold, triggerRefresh, pullDistance]);

  const ready = readyRef.current || pullDistance >= threshold;
  const contentTranslateY = refreshing
    ? 52
    : isPulling
    ? Math.min(75, pullDistance * 0.65)
    : 0;

  return (
    <div className={`relative ${className}`}>
      {/* Floating pull indicator pill */}
      <div
        className="pointer-events-none fixed left-0 right-0 z-50 flex items-center justify-center"
        style={{
          top: `calc(env(safe-area-inset-top, 0px) + ${
            refreshing ? 18 : Math.max(10, pullDistance * 0.5 - 20)
          }px)`,
          opacity: refreshing ? 1 : Math.min(1, pullDistance / (threshold * 0.7)),
          transform: `scale(${
            refreshing ? 1 : Math.min(1, 0.6 + (pullDistance / threshold) * 0.4)
          })`,
          transition: isPulling
            ? "none"
            : "top 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease, transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <div className="flex items-center gap-2 rounded-full bg-card/95 backdrop-blur-md px-3.5 py-1.5 shadow-lg border border-border text-xs font-medium text-foreground">
          {refreshing ? (
            <>
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
              <span>Refreshing app...</span>
            </>
          ) : success ? (
            <>
              <Check className="h-4 w-4 text-emerald-500" />
              <span>Updated!</span>
            </>
          ) : (
            <>
              <ArrowDown
                className={`h-4 w-4 transition-transform duration-200 ${
                  ready ? "rotate-180 text-primary" : "text-muted-foreground"
                }`}
              />
              <span className={ready ? "text-primary font-semibold" : "text-muted-foreground"}>
                {ready ? "Release to refresh" : "Pull to refresh"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Elastic content container */}
      <div
        style={{
          transform: `translate3d(0, ${contentTranslateY}px, 0)`,
          transition: isPulling
            ? "none"
            : "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          willChange: isPulling || refreshing ? "transform" : "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
};

