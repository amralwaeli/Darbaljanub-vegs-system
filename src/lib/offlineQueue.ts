// ============================================================================
// Offline queue for the driver's checklist ticks.
//
// Market connectivity is flaky. Checklist ticks are tiny, idempotent updates
// (checked=true/false keyed by check id), so they queue safely in
// localStorage and replay when the connection returns. The UI updates
// optimistically; the server-side guard trigger still validates everything
// when the tick finally lands.
//
// (Photos are NOT queued to localStorage — they are megabyte blobs. Photo
// uploads retry with backoff while the app is open; the "Loaded" button
// stays disabled until the upload has genuinely succeeded, so proof can
// never be silently lost.)
// ============================================================================

import { supabase } from "./supabase";
import { isNative } from "./native/index";
import { onNetworkRestored } from "./native/shell";

const KEY = "vegs.offline.checks.v1";

interface QueuedCheck {
  checkId: string;
  checked: boolean;
  ts: number;
}

function readQueue(): QueuedCheck[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedCheck[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedCheck[]) {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

/** Latest tick per check id wins; older entries for the same id are dropped. */
export function enqueueCheck(checkId: string, checked: boolean) {
  const queue = readQueue().filter((q) => q.checkId !== checkId);
  queue.push({ checkId, checked, ts: Date.now() });
  writeQueue(queue);
}

export function dequeueCheck(checkId: string) {
  writeQueue(readQueue().filter((q) => q.checkId !== checkId));
}

export function pendingCount(): number {
  return readQueue().length;
}

let flushing = false;

/** Replay every queued tick. Safe to call repeatedly. */
export async function flushCheckQueue(): Promise<void> {
  // navigator.onLine inside the Android WebView is frequently stale — it can
  // report "online" on a phone with no signal. Native connectivity is driven
  // by the Network plugin instead (see initOfflineQueue), and a genuinely
  // failed request simply leaves the tick queued for the next attempt.
  if (flushing) return;
  if (!isNative && !navigator.onLine) return;
  flushing = true;
  try {
    for (const q of readQueue()) {
      const { error } = await supabase
        .from("delivery_item_checks")
        .update({ checked: q.checked })
        .eq("id", q.checkId);
      // Success OR a definitive server rejection (e.g. checklist frozen)
      // both remove the entry; only network-ish failures keep it queued.
      if (!error || !isNetworkError(error.message)) {
        dequeueCheck(q.checkId);
      } else {
        break; // still offline — stop and retry later
      }
    }
  } finally {
    flushing = false;
  }
}

function isNetworkError(message: string): boolean {
  return /fetch|network|failed|abort|timeout/i.test(message);
}

/** Wire the queue to connectivity events once at app start. */
export function initOfflineQueue() {
  window.addEventListener("online", () => void flushCheckQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushCheckQueue();
  });
  // In the APK, the OS tells us the truth about connectivity. This is what
  // actually gets a market-day tick to land once the driver regains signal.
  void onNetworkRestored(() => void flushCheckQueue());
  void flushCheckQueue();
}
