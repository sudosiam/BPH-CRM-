import { digestCounts, digestLine, shouldSendDigest, todayISO } from "@shared/book.mjs";
import type { Lead, Profile } from "./types";
import { remote } from "./remote";

const LOCAL_KEY = "bph-local-digest";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const publicKey = await remote.vapidPublicKey();
  if (!publicKey) return false;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  await remote.saveSubscription(subscription.toJSON());
  return true;
}

export async function enableNotifications() {
  if (!("Notification" in window)) return "unsupported" as const;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied" as const;
  try {
    const pushed = await subscribeToPush();
    return pushed ? ("push" as const) : ("local" as const);
  } catch {
    return "local" as const;
  }
}

export function syncBadge(leads: Lead[], me: Profile | null) {
  if (!me || !("setAppBadge" in navigator)) return;
  const today = todayISO(me.timezone);
  const counts = digestCounts(leads, today);
  const total = counts.today + counts.overdue;
  if (total > 0) void navigator.setAppBadge(total);
  else void navigator.clearAppBadge();
}

export async function maybeLocalDigest(leads: Lead[], me: Profile | null, pushActive: boolean) {
  if (!me?.notifyEnabled || pushActive) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const today = todayISO(me.timezone, now);
  const counts = digestCounts(leads, today);
  const dueCount = counts.today + counts.overdue;
  if (
    !shouldSendDigest({
      notifyEnabled: true,
      notifyMinute: me.notifyMinute,
      timeZone: me.timezone,
      lastDigestOn: localStorage.getItem(LOCAL_KEY),
      now,
      dueCount,
    })
  ) {
    return;
  }
  const body = digestLine(counts.today, counts.overdue);
  new Notification("Follow-ups", { body, icon: "/icon-192.png" });
  localStorage.setItem(LOCAL_KEY, today);
}
