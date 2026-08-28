import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { Badge, Button } from "./ui";
import { useToast } from "./Toast";
import { useAuth } from "../features/auth/AuthProvider";
import { useWorkingCycle } from "../features/cycles/useCycle";
import { useRealtimeInvalidate } from "../hooks/useRealtime";
import { cycleKeys } from "../features/cycles/useCycle";
import {
  autoEnablePush,
  disablePush,
  enablePush,
  ensurePushRegistered,
  isPushEnabled,
  pushSupported,
} from "../lib/push";
import { isNative } from "../lib/native/index";
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
        const result = await enablePush();
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
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-lg active:bg-gray-100 disabled:opacity-50"
      aria-label={t.enableNotifications}
      title={enabled ? t.notificationsOn : t.enableNotifications}
    >
      {enabled ? "🔔" : "🔕"}
      {/* A device that receives nothing looks identical to one that does,
          which is how everyone ended up unreachable. Make it visible. */}
      {!enabled && (
        <span className="absolute end-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
      )}
    </button>
  );
}

/**
 * Notifications are opt-in per DEVICE, and the browser will only grant them
 * from a real tap — there is no way to switch them on for someone remotely.
 * This card is therefore the closest thing to "on by default": every user who
 * is not yet reachable is asked, on every screen, until they answer.
 *
 * It appears only when silent registration has already failed, so anyone who
 * previously allowed notifications never sees it.
 */
const PUSH_PROMPT_KEY = "vegs.pushPromptSnoozedAt";
const SNOOZE_MS = 24 * 3600_000;

function NotificationPrompt() {
  const { profile } = useAuth();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported() || !profile) return;
    let cancelled = false;

    void (async () => {
      // Already allowed on this device? Register it and stay silent.
      if (await ensurePushRegistered()) return;
      if (cancelled) return;

      // APK: ask Android straight away rather than waiting for someone to
      // discover the bell. This is why every manager had zero registered
      // devices — see below for the other half of that story.
      if (isNative) {
        if ((await autoEnablePush()) === "enabled") return;
        if (cancelled) return;
      }

      // Blocked at OS level — the card cannot help, so don't nag.
      //
      // GUARDED, because `Notification` DOES NOT EXIST in Android's WebView.
      // pushSupported() short-circuits to true for native, so this line was
      // reached in the APK and threw, rejecting the whole async block before
      // setShow(true). The enable-notifications card had therefore never
      // appeared on a phone even once, leaving the bell — which was itself
      // failing on the token race — as the only way in.
      if (
        !isNative &&
        typeof Notification !== "undefined" &&
        Notification.permission === "denied"
      ) {
        return;
      }

      const snoozed = Number(localStorage.getItem(PUSH_PROMPT_KEY) ?? "0");
      if (snoozed && Date.now() - snoozed < SNOOZE_MS) return;
      setShow(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (!show || !profile) return null;

  function dismiss() {
    localStorage.setItem(PUSH_PROMPT_KEY, String(Date.now()));
    setShow(false);
  }

  async function enable() {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result === "denied") {
        toast.error(t.notificationsDenied);
      } else {
        toast.success(t.notificationsOn);
      }
      dismiss();
    } catch {
      toast.error(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-600/20">
      <p className="text-sm font-semibold text-brand-800">
        🔔 {t.enableNotifications}
      </p>
      <p className="mt-1 text-xs text-brand-700">{t.notificationsWhy}</p>
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" busy={busy} onClick={() => void enable()}>
          {t.notificationsEnableNow}
        </Button>
        <Button variant="secondary" onClick={dismiss}>
          {t.notificationsLater}
        </Button>
      </div>
    </div>
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
  // The badge tracks the order in flight. The OPEN cycle is always open, so
  // badging it would just show a permanent "OPEN" that tells nobody anything.
  const { data: cycle } = useWorkingCycle();
  const online = useOnline();

  // Everyone stays in sync with cycle status changes, live.
  useRealtimeInvalidate("layout-cycle", ["order_cycles"], [cycleKeys.all]);

  // Fixed shell: header and nav never move, only <main> scrolls. The document
  // itself is locked (index.css), so there is nothing else that can scroll.
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      <header className="z-30 shrink-0 border-b border-gray-200 bg-white/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
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

      <main className="scroll-pane flex-1 p-4">
        <NotificationPrompt />
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
