import { CloudOff, RefreshCw, CheckCircle2, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { cn } from "@/lib/utils";

/**
 * Slim status banner pinned under the status bar that surfaces offline
 * state and background sync progress. Auto-hides shortly after a
 * successful sync so it doesn't clutter the UI.
 * Shows count of study packs available offline when no internet.
 */
export const OfflineBanner = () => {
  const { online, pending, syncing, offlinePackCount } = useOfflineSync();
  const [showSynced, setShowSynced] = useState(false);
  const [prevPending, setPrevPending] = useState(pending);

  useEffect(() => {
    if (prevPending > 0 && pending === 0 && online) {
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), 2200);
      return () => clearTimeout(t);
    }
    setPrevPending(pending);
  }, [pending, online, prevPending]);

  const visible = !online || pending > 0 || syncing || showSynced;
  if (!visible) return null;

  let icon = <CloudOff className="h-3.5 w-3.5" />;
  let label = "You're offline — changes will sync later";
  let tone = "bg-muted text-muted-foreground";

  if (!online && offlinePackCount > 0) {
    icon = <WifiOff className="h-3.5 w-3.5" />;
    label = `Offline · ${offlinePackCount} study pack${offlinePackCount === 1 ? "" : "s"} available`;
    tone = "bg-muted text-muted-foreground";
  } else if (!online && pending > 0) {
    label = `Offline — ${pending} change${pending === 1 ? "" : "s"} queued`;
  } else if (online && (pending > 0 || syncing)) {
    icon = <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />;
    label = syncing
      ? `Syncing ${pending || ""} change${pending === 1 ? "" : "s"}…`
      : `${pending} change${pending === 1 ? "" : "s"} pending`;
    tone = "bg-primary-soft text-primary";
  } else if (showSynced) {
    icon = <CheckCircle2 className="h-3.5 w-3.5" />;
    label = "All changes synced";
    tone = "bg-success/15 text-success";
  }

  return (
    <div className={cn(
      "mx-5 mt-1 mb-2 px-3 py-1.5 rounded-full flex items-center gap-2 text-[11px] font-medium animate-fade-in",
      tone
    )}>
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
};
