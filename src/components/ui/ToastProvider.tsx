import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { ToastContext, type Toast, type ToastContextValue } from "./toastContext";
import { cn } from "@/lib/utils";

const TONE_STYLES = {
  success: { cls: "border-emerald-300 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
  error: { cls: "border-red-300 bg-red-50 text-red-900", Icon: AlertCircle },
  info: { cls: "border-shpe-blue bg-shpe-blue-soft text-shpe-navy", Icon: Info },
} as const;

const AUTO_DISMISS_MS = 6000;

/**
 * Toasts live in an aria-live region so a successful check-in or a failed save
 * is announced, not just drawn. Errors use `assertive` because the member needs
 * to know immediately that the thing they tried did not happen.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (title, detail) => push({ tone: "success", title, detail }),
      error: (title, detail) => push({ tone: "error", title, detail }),
      info: (title, detail) => push({ tone: "info", title, detail }),
    }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => {
          const { cls, Icon } = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              aria-live={toast.tone === "error" ? "assertive" : "polite"}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg",
                cls,
              )}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 opacity-90">{toast.detail}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={`Dismiss: ${toast.title}`}
                className="-m-1 shrink-0 rounded p-1 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
