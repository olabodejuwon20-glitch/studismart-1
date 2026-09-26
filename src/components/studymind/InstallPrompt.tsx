import { useEffect, useState } from "react";
import { Download, X, Sparkles } from "lucide-react";

const DISMISSED_KEY = "studymind-install-dismissed";
const DISMISS_DAYS = 7;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  // iOS Safari
  (window.navigator as any).standalone === true;

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

const isInIframe = () => {
  try { return window.self !== window.top; } catch { return true; }
};

const recentlyDismissed = () => {
  const v = localStorage.getItem(DISMISSED_KEY);
  if (!v) return false;
  const ts = Number(v);
  if (!ts) return false;
  return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
};

export const InstallPrompt = () => {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    if (isInIframe() || isStandalone() || recentlyDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari: no beforeinstallprompt — show manual hint after delay
    const t = isIOS() ? window.setTimeout(() => setShowIOS(true), 4000) : 0;

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (t) window.clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setShow(false);
    setShowIOS(false);
  };

  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") {
      setShow(false);
    } else {
      dismiss();
    }
  };

  if (!show && !showIOS) return null;

  return (
    <div
      role="dialog"
      aria-label="Install StudyMind"
      className="fixed left-1/2 -translate-x-1/2 bottom-20 z-[60] w-[calc(100%-1.5rem)] max-w-sm animate-slide-up"
    >
      <div className="rounded-2xl bg-card border border-border shadow-elevated p-4 flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl gradient-primary flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Install StudyMind</p>
          {showIOS ? (
            <p className="text-xs text-muted-foreground mt-1">
              Tap <span className="font-semibold">Share</span> then{" "}
              <span className="font-semibold">Add to Home Screen</span> to study offline.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              Install for a faster experience — <span className="font-semibold text-primary">works offline</span> too!
            </p>
          )}
          {!showIOS && (
            <button
              onClick={install}
              className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl gradient-primary text-white text-xs font-semibold tap-scale"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          className="h-8 w-8 rounded-full hover:bg-secondary flex items-center justify-center text-muted-foreground tap-scale"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
