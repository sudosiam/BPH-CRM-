import { digestCounts, digestLine, shouldSendDigest, todayISO } from "@shared/book.mjs";
import type { Lead, Profile } from "./types";
import { remote } from "./remote";

function digestKey(me: Profile) {
  return `bph-local-digest:${me.id}`;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function pushRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  if (registration.active) return registration;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration | null>((resolve) => {
      setTimeout(() => resolve(registration.active ? registration : null), 4000);
    }),
  ]);
}

export async function subscribeToPush() {
  const registration = await pushRegistration();
  if (!registration) return false;
  const publicKey = await remote.vapidPublicKey();
  if (!publicKey) return false;
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

const TEST_TITLE = "BPH";
const TEST_BODY = "Test alert. Reminders can reach this phone.";

function withTimeout<T>(work: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function showLocalTest() {
  const options = { body: TEST_BODY, icon: "/icon-192.png", data: { url: "/" } };
  const registration = await pushRegistration();
  if (registration) {
    try {
      await registration.showNotification(TEST_TITLE, options);
      return;
    } catch {
      /* A page notification still proves alerts are allowed. */
    }
  }
  new Notification(TEST_TITLE, options);
}

export async function showTestNotification() {
  if (!("Notification" in window)) return "unsupported" as const;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "denied" as const;
  try {
    const pushed = await withTimeout(subscribeToPush(), 8000);
    if (pushed) {
      const sent = await withTimeout(remote.sendTestPush(), 8000);
      if (sent > 0) return "push" as const;
    }
  } catch {
    /* Show it on this phone when the server cannot deliver a closed-app alert. */
  }
  await showLocalTest();
  return "local" as const;
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
      lastDigestOn: localStorage.getItem(digestKey(me)),
      now,
      dueCount,
    })
  ) {
    return;
  }
  const body = digestLine(counts.today, counts.overdue);
  new Notification("Follow-ups", { body, icon: "/icon-192.png" });
  localStorage.setItem(digestKey(me), today);
}
