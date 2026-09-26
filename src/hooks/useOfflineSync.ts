import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { flushQueue, getQueueSize, subscribe } from "@/lib/offlineCache";
import { getOfflinePackCount } from "@/lib/studyPackCache";
import { getCurrentUser } from "@/lib/authUser";

/**
 * Tracks online/offline state, the size of the pending sync queue, and
 * automatically flushes queued operations whenever the device comes back
 * online (or when the tab becomes visible again).
 * Also exposes the number of study packs available offline.
 */
export const useOfflineSync = () => {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pending, setPending] = useState(() => getQueueSize());
  const [syncing, setSyncing] = useState(false);
  const [offlinePackCount, setOfflinePackCount] = useState(0);

  // Load offline pack count once on mount
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await getCurrentUser();
        if (user) {
          const count = await getOfflinePackCount(user.id);
          setOfflinePackCount(count);
        }
      } catch { /* noop */ }
    })();
  }, []);

  const refreshOfflineCount = useCallback(async () => {
    try {
      const { data: { user } } = await getCurrentUser();
      if (user) {
        const count = await getOfflinePackCount(user.id);
        setOfflinePackCount(count);
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const updatePending = () => setPending(getQueueSize());
    const unsub = subscribe(updatePending);

    const flush = async () => {
      if (!navigator.onLine) return;
      if (getQueueSize() === 0) return;
      setSyncing(true);
      try {
        await flushQueue(supabase as never);
      } finally {
        setSyncing(false);
        setPending(getQueueSize());
      }
    };

    const onOnline = () => { setOnline(true); flush(); };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    // Attempt an initial flush in case the app launched with pending ops.
    flush();

    return () => {
      unsub();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { online, pending, syncing, offlinePackCount, refreshOfflineCount };
};
