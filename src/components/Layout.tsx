import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { Badge } from "./ui";
import { useToast } from "./Toast";
import { useAuth } from "../features/auth/AuthProvider";
import { useCurrentCycle } from "../features/cycles/useCycle";
import { useRealtimeInvalidate } from "../hooks/useRealtime";
import { cycleKeys } from "../features/cycles/useCycle";
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushSupported,
} from "../lib/push";
import { t, toggleLanguage } from "../i18n/strings";
import type { CycleStatus } from "../lib/database.types";

const STATUS_COLOR: Record<CycleStatus, "gray" | "green" | "amber" | "blue"> = {
  OPEN: "green",
  ORDERED: "amber",
  PURCHASED: "blue",
  IN_DELIVERY: "blue",
  COMPLETED: "gray",
};

/** 🔔 bell: enable/disable Web Push for this device. Hidden if unsupported. */
function NotificationBell() {
  const { profile } = useAuth();
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isPushEnabled().then(setEnabled);
  }, []);

  if (!pushSupported() || !profile) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.success(t.notificationsOff);
      } else {
        const result = await enablePush(profile!.id);
        if (result === "denied") {
          toast.error(t.notificationsDenied);
        } else {
          setEnabled(true);
          toast.success(t.notificationsOn);
        }
      }
    } catch {
      toast.error(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void toggle()}
      disabled={busy}
      className="flex h-10 w-10 items-center justify-center rounded-full text-lg active:bg-gray-100 disabled:opacity-50"
      aria-label={t.enableNotifications}
      title={enabled ? t.notificationsOn : t.enableNotifications}
    >
      {enabled ? "🔔" : "🔕"}
    </button>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function Layout() {
  const { profile, signOut } = useAuth();
  const { data: cycle } = useCurrentCycle();
  const online = useOnline();

  // Everyone stays in sync with cycle status changes, live.
  useRealtimeInvalidate("layout-cycle", ["order_cycles"], [cycleKeys.current]);

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-20">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🥬</span>
            <div>
              <div className="text-sm font-bold leading-tight text-brand-800">
                {t.appName}
              </div>
              <div className="text-xs text-gray-500">
                {profile?.username ?? ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {cycle && cycle.status !== "COMPLETED" && (
              <Badge color={STATUS_COLOR[cycle.status]}>
                {t.cycleStatus[cycle.status]}
              </Badge>
            )}
            <NotificationBell />
            <button
              onClick={toggleLanguage}
              className="flex h-10 min-w-10 items-center justify-center rounded-full px-1 text-xs font-bold text-gray-500 active:bg-gray-100"
              title={t.switchLang}
            >
              {t.switchLang}
            </button>
            <button
              onClick={() => void signOut()}
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 active:bg-gray-100"
              aria-label={t.logout}
              title={t.logout}
            >
              ⏻
            </button>
          </div>
        </div>
        {!online && (
          <div className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800">
            {t.offline}
          </div>
        )}
      </header>

      <main className="p-4">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
