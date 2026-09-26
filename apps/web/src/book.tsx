import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, assignCustomerName, duplicatePhone, hasLocalBook, leadsCsv, newId, todayISO } from "@shared/book.mjs";
import { db, logActivity, resetLocal } from "./db";
import { matchingMembership, saveMembership } from "./membership";
import { getHttpToken, setHttpToken } from "./httpRemote";
import { enableNotifications, maybeLocalDigest, syncBadge } from "./notify";
import { remote, usingSupabase } from "./remote";
import { enqueueSync, flushOutbox, queueLead, runFullSync, runIncremental, saveMeta } from "./sync";
import type { Account, Lead, Meta, Org, Profile } from "./types";

type Phase = "loading" | "auth" | "signup" | "reset" | "start" | "join" | "copy" | "copy-error" | "app";
type Screen = "today" | "leads" | "account" | "detail" | "edit";
type SyncWord = "synced" | "syncing" | "saved";

export type Draft = {
  id: string | null;
  name: string;
  phone: string;
  notes: string;
  followUpOn: string | null;
  ownerId: string;
};

type BookValue = {
  phase: Phase;
  screen: Screen;
  leads: Lead[];
  profiles: Profile[];
  me: Profile | null;
  org: Org | null;
  email: string;
  sync: SyncWord;
  copyPct: number;
  copyLabel: string;
  error: string;
  toast: string;
  sheet: "delete" | "signout" | "remove" | "transfer" | "duplicate" | null;
  pendingMemberId: string | null;
  duplicateLeadName: string;
  pushReady: boolean;
  updateReady: boolean;
  detailId: string | null;
  segment: Lead["status"];
  query: string;
  setPhase: (phase: Phase) => void;
  setQuery: (query: string) => void;
  setSegment: (segment: Lead["status"]) => void;
  clearError: () => void;
  goTab: (screen: "today" | "leads") => void;
  openSettings: () => void;
  openLead: (id: string) => void;
  back: () => void;
  startDraft: () => void;
  editCurrent: () => void;
  setSheet: (sheet: BookValue["sheet"]) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  createOrg: (name: string, displayName: string) => Promise<void>;
  joinOrg: (code: string, displayName: string) => Promise<void>;
  remembered: { orgName: string; inviteCode: string | null } | null;
  reopenBook: () => Promise<void>;
  retryCopy: () => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignOut: () => Promise<void>;
  saveDraft: (draft: Draft, force?: boolean) => Promise<void>;
  setStatus: (status: Lead["status"]) => Promise<void>;
  setFollowUp: (iso: string | null) => Promise<void>;
  deleteLead: () => Promise<void>;
  setReminders: (enabled: boolean) => Promise<void>;
  setReminderTime: (minute: number) => Promise<void>;
  waTemplate: string;
  setWaTemplate: (value: string) => void;
  regenerateCode: () => Promise<void>;
  removeMember: (id: string) => void;
  confirmRemove: () => Promise<void>;
  transferOwner: (id: string) => void;
  confirmTransfer: () => Promise<void>;
  confirmDuplicate: () => Promise<void>;
  usePhoneZone: () => Promise<void>;
  exportCsv: () => void;
  requestPasswordReset: (email: string) => Promise<void>;
  noteActivity: (leadId: string, text: string) => void;
  applyUpdate: () => void;
  showToast: (text: string) => void;
  navDepth: number;
};

const BookContext = createContext<BookValue | null>(null);
const WA_KEY = "bph-wa-template";
export const DEFAULT_WA_TEMPLATE = "Hi {name}, this is Biswajit Power Hub. Just following up.";

function readWaTemplate() {
  try {
    return localStorage.getItem(WA_KEY) ?? DEFAULT_WA_TEMPLATE;
  } catch {
    return DEFAULT_WA_TEMPLATE;
  }
}

function zone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function BookProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [stack, setStack] = useState<Screen[]>(["today"]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [segment, setSegment] = useState<Lead["status"]>("lead");
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<BookValue["sheet"]>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [duplicateLeadName, setDuplicateLeadName] = useState("");
  const [pushReady, setPushReady] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [held, setHeld] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [copyPct, setCopyPct] = useState(8);
  const [copyLabel, setCopyLabel] = useState("Copying leads…");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [pushActive, setPushActive] = useState(false);
  const [waTemplate, setWaTemplateState] = useState(readWaTemplate);
  const leads = (useLiveQuery(() => db.leads.toArray(), [], []) ?? []).filter((lead) => !lead.deletedAt);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []) ?? [];
  const outboxCount = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0;
  const meta = useLiveQuery(() => db.meta.get("local"), []);
  const me = profiles.find((profile) => profile.id === userId && !profile.removedAt) ?? null;
  const org = meta?.org ?? null;
  const screen = stack.at(-1) ?? "today";

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? "" : current)), 2200);
  }

  async function tokenFor(accountUserId: string, accountEmail: string, nextOrg: Org | null, flags?: { fullSyncComplete?: boolean; cursor?: string | null }) {
    const token = usingSupabase ? "" : getHttpToken();
    await saveMeta({
      token,
      userId: accountUserId,
      email: accountEmail,
      org: nextOrg,
      fullSyncComplete: flags?.fullSyncComplete,
      cursor: flags?.cursor,
    });
    if (nextOrg) {
      saveMembership({
        userId: accountUserId,
        email: accountEmail,
        orgId: nextOrg.id,
        orgName: nextOrg.name,
        inviteCode: nextOrg.inviteCode,
      });
    }
    setUserId(accountUserId);
    setEmail(accountEmail);
  }

  async function copyBook() {
    setCopyPct(8);
    setCopyLabel("Copying leads…");
    await runFullSync((pct, label) => {
      setCopyPct(pct);
      setCopyLabel(label);
    });
  }

  function syncNow() {
    return enqueueSync(async () => {
      setSyncing(true);
      try {
        if (!navigator.onLine) {
          setHeld(true);
          return;
        }
        await flushOutbox(showToast);
        await runIncremental();
        setHeld(false);
      } catch {
        setHeld(true);
      } finally {
        setSyncing(false);
      }
    });
  }

  async function clearPhoneCopy() {
    await db.leads.clear();
    await db.outbox.clear();
    await db.profiles.clear();
    await db.activity.clear();
  }

  async function flushBeforeSwitch() {
    if ((await db.outbox.count()) === 0) return;
    if (!navigator.onLine) throw new Error("This phone still has changes. Connect, wait until it says Synced, then sign in.");
    await flushOutbox(showToast);
    if ((await db.outbox.count()) > 0) throw new Error("Some changes are still on this phone. Wait until it says Synced, then sign in.");
  }

  async function openAccount(account: Account, forceCopy: boolean) {
    const saved = await db.meta.get("local");
    if (saved && saved.userId && saved.userId !== account.user.id) await clearPhoneCopy();
    const same =
      !forceCopy &&
      saved?.fullSyncComplete &&
      saved.userId === account.user.id &&
      saved.org?.id === account.org?.id;
    if (account.removed || !account.profile || !account.org) {
      if (account.removed) {
        try {
          await flushOutbox(() => {});
        } catch {
          /* A removed person can no longer push. */
        }
        await clearPhoneCopy();
      }
      await tokenFor(account.user.id, account.user.email, null, { fullSyncComplete: false, cursor: null });
      setUserId(account.user.id);
      setEmail(account.user.email);
      setPhase("start");
      return;
    }
    if (same) {
      await tokenFor(account.user.id, account.user.email, account.org);
      setPhase("app");
      void syncNow();
      return;
    }
    await db.leads.clear();
    await db.outbox.clear();
    await db.profiles.clear();
    await tokenFor(account.user.id, account.user.email, account.org, { fullSyncComplete: false, cursor: null });
    await db.profiles.put(account.profile);
    setPhase("copy");
    try {
      await copyBook();
      setPhase("app");
      setStack(["today"]);
    } catch {
      setPhase("copy-error");
    }
  }

  async function keepSavedBook(saved: Meta | undefined, profiles: Profile[], leadCount: number) {
    const me = profiles.find((profile) => profile.id === saved?.userId && !profile.removedAt);
    const ready = hasLocalBook({
      userId: saved?.userId ?? "",
      hasProfile: Boolean(me),
      hasOrg: Boolean(saved?.org),
      fullSyncComplete: Boolean(saved?.fullSyncComplete),
      leadCount,
    });
    if (!ready || !saved || !me) return false;
    const org = saved.org ?? { id: me.orgId, name: "Your book", inviteCode: null };
    if (!saved.org || !saved.fullSyncComplete) {
      await saveMeta({
        token: saved.token,
        userId: saved.userId,
        email: saved.email,
        org,
        fullSyncComplete: true,
        cursor: saved.cursor,
      });
    }
    saveMembership({
      userId: saved.userId,
      email: saved.email,
      orgId: org.id,
      orgName: org.name,
      inviteCode: org.inviteCode,
      displayName: me.displayName,
    });
    return true;
  }

  useEffect(() => {
    let cancel = false;
    let opened = false;
    (async () => {
      const saved = await db.meta.get("local");
      if (!usingSupabase) setHttpToken(saved?.token ?? "");
      const profiles = await db.profiles.toArray();
      const leadCount = await db.leads.count();
      opened = await keepSavedBook(saved, profiles, leadCount);
      if (cancel) return;
      if (opened && saved) {
        setUserId(saved.userId);
        setEmail(saved.email);
        setHeld(true);
        setPhase("app");
      }
      let account: Account | null = null;
      try {
        account = await remote.session();
      } catch {
        if (cancel || opened) {
          if (opened) setHeld(true);
          return;
        }
        setPhase("auth");
        return;
      }
      if (cancel) return;
      if (!account) {
        if (opened) return;
        setPhase("auth");
        return;
      }
      if (account.removed) {
        await openAccount(account, false);
        return;
      }
      if (opened && saved) {
        if (saved.userId === account.user.id && account.profile && account.org) {
          await tokenFor(account.user.id, account.user.email, account.org);
          void syncNow();
        }
        return;
      }
      await openAccount(account, false);
    })().catch(() => {
      if (!cancel && !opened) setPhase("auth");
    });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "app") return;
    const stop = remote.subscribe(() => {
      void syncNow();
    });
    const onOnline = () => {
      if (!navigator.onLine) return;
      setOnline(true);
      void syncNow();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onOnline);
    const poll = window.setInterval(() => void syncNow(), 30000);
    return () => {
      stop();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onOnline);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    syncBadge(leads, me);
    if (phase === "app") void maybeLocalDigest(leads, me, pushActive);
  }, [leads, me, phase, pushActive]);

  useEffect(() => {
    if (!org?.id) return;
    try {
      setWaTemplateState(localStorage.getItem(`${WA_KEY}:${org.id}`) ?? DEFAULT_WA_TEMPLATE);
    } catch {
      setWaTemplateState(DEFAULT_WA_TEMPLATE);
    }
  }, [org?.id]);

  useEffect(() => {
    void remote.vapidPublicKey().then((key) => setPushReady(Boolean(key))).catch(() => setPushReady(false));
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("bph-sw-update", onUpdate);
    return () => window.removeEventListener("bph-sw-update", onUpdate);
  }, []);

  async function changeLead(patch: Partial<Lead>) {
    const current = detailId ? await db.leads.get(detailId) : null;
    if (!current || !me) return;
    await queueLead({ ...current, ...patch, updatedBy: me.id, updatedAt: new Date().toISOString() }, current.version);
    void syncNow();
  }

  const value: BookValue = {
    phase,
    screen,
    leads,
    profiles,
    me,
    org,
    email,
    sync: syncing ? "syncing" : !online || held || outboxCount > 0 ? "saved" : "synced",
    copyPct,
    copyLabel,
    error,
    toast,
    sheet,
    detailId,
    segment,
    query,
    navDepth: Math.max(0, stack.length - 1) + (sheet ? 1 : 0),
    setPhase: (next) => {
      setError("");
      setPhase(next);
    },
    setQuery,
    setSegment,
    clearError: () => setError(""),
    goTab(next) {
      setStack([next]);
      setSheet(null);
    },
    openSettings() {
      setStack((current) => {
        const root = current.find((screen) => screen === "today" || screen === "leads") ?? "today";
        return [root, "account"];
      });
      setSheet(null);
    },
    openLead(id) {
      setDetailId(id);
      setStack((current) => [...current, "detail"]);
    },
    back() {
      setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
      setSheet(null);
    },
    startDraft() {
      setDetailId(null);
      setStack((current) => [...current, "edit"]);
    },
    editCurrent() {
      setStack((current) => [...current, "edit"]);
    },
    setSheet,
    async signIn(emailAddress, password) {
      setError("");
      try {
        await flushBeforeSwitch();
        await openAccount(await remote.signIn(emailAddress, password), false);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not sign in.");
      }
    },
    async signUp(emailAddress, password, displayName) {
      setError("");
      try {
        const account = await remote.signUp(emailAddress, password, displayName);
        await tokenFor(account.user.id, account.user.email, null, { fullSyncComplete: false, cursor: null });
        setPhase("start");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not create the account.");
      }
    },
    async createOrg(name, displayName) {
      setError("");
      try {
        const created = await remote.createOrg(name, displayName, zone());
        await db.profiles.put(created.profile);
        await tokenFor(created.profile.id, email, created.org, { fullSyncComplete: false, cursor: null });
        setUserId(created.profile.id);
        setPhase("copy");
        try {
          await copyBook();
          setPhase("app");
          setStack(["today"]);
        } catch {
          setPhase("copy-error");
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not create the business.");
      }
    },
    async joinOrg(code, displayName) {
      setError("");
      try {
        const joined = await remote.joinOrg(code, displayName, zone());
        await db.profiles.put(joined.profile);
        await tokenFor(joined.profile.id, email, joined.org, { fullSyncComplete: false, cursor: null });
        if (!joined.org.inviteCode) {
          saveMembership({
            userId: joined.profile.id,
            email,
            orgId: joined.org.id,
            orgName: joined.org.name,
            inviteCode: code.trim(),
            displayName: displayName.trim(),
          });
        }
        setPhase("copy");
        try {
          await copyBook();
          setPhase("app");
          setStack(["today"]);
        } catch {
          setPhase("copy-error");
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not join.");
      }
    },
    remembered: (() => {
      const match = matchingMembership(userId, email);
      return match ? { orgName: match.orgName, inviteCode: match.inviteCode } : null;
    })(),
    async reopenBook() {
      setError("");
        const saved = matchingMembership(userId, email);
        try {
        const account = await remote.session();
        if (account?.profile && account.org) {
          await openAccount(account, false);
          return;
        }
        if (!saved?.inviteCode) {
          setError("This account is already in that book. Open it again when you are online.");
          return;
        }
        const joined = await remote.joinOrg(saved.inviteCode, saved.displayName || me?.displayName || "Teammate", zone());
        await db.profiles.put(joined.profile);
        await tokenFor(joined.profile.id, email || saved.email, joined.org, { fullSyncComplete: false, cursor: null });
        setPhase("copy");
        try {
          await copyBook();
          setPhase("app");
          setStack(["today"]);
        } catch {
          setPhase("copy-error");
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Could not open the book.";
        if (/already/i.test(message)) {
          try {
            const again = await remote.session();
            if (again?.profile && again.org) {
              await openAccount(again, false);
              return;
            }
          } catch {
            /* The message below explains the next step. */
          }
        }
        setError(message);
      }
    },
    async retryCopy() {
      setPhase("copy");
      try {
        await copyBook();
        setPhase("app");
      } catch {
        setPhase("copy-error");
      }
    },
    async signOut() {
      if ((await db.outbox.count()) > 0) {
        setSheet("signout");
        return;
      }
      await finishSignOut();
    },
    confirmSignOut: finishSignOut,
    async saveDraft(next, force = false) {
      const typed = next.name.trim();
      const name =
        typed ||
        assignCustomerName(
          "",
          leads.filter((lead) => lead.id !== next.id).map((lead) => lead.name),
        );
      if (!org || !me) return;
      if (!force) {
        const existing = duplicatePhone(leads, next.phone, next.id);
        if (existing) {
          setPendingDraft({ ...next, name });
          setDuplicateLeadName(leads.find((lead) => lead.id === existing.id)?.name || "another lead");
          setSheet("duplicate");
          return;
        }
      }
      if (next.id) {
        const current = await db.leads.get(next.id);
        if (!current) return;
        await queueLead(
          {
            ...current,
            name,
            phone: next.phone.trim(),
            notes: next.notes.trim(),
            ownerId: current.ownerId,
            updatedBy: me.id,
            updatedAt: new Date().toISOString(),
          },
          current.version,
        );
        showToast("Saved");
        void logActivity(current.id, "Edited");
        setStack((current) => current.slice(0, -1));
      } else {
        const lead: Lead = {
          id: newId(),
          orgId: org.id,
          name,
          phone: next.phone.trim(),
          notes: next.notes.trim(),
          status: "lead",
          followUpOn: next.followUpOn,
          closedOn: null,
          ownerId: me.id,
          createdBy: me.id,
          updatedBy: me.id,
          version: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        };
        await queueLead(lead, null);
        void logActivity(lead.id, "Added");
        setDetailId(lead.id);
        setStack((current) => [current[0] ?? "today", "detail"]);
        showToast("Lead saved");
      }
      void syncNow();
    },
    async setStatus(status) {
      const current = detailId ? await db.leads.get(detailId) : null;
      if (!current || current.status === status) return;
      const today = todayISO(me?.timezone || zone());
      await changeLead(
        status === "lead"
          ? { status, closedOn: null, followUpOn: current.followUpOn || addDays(today, 1) }
          : { status, followUpOn: null, closedOn: today },
      );
      const label = status === "sold" ? "Marked sold" : status === "lost" ? "Marked lost" : "Back to Lead";
      if (detailId) void logActivity(detailId, label);
      showToast(label);
    },
    async setFollowUp(iso) {
      await changeLead({ followUpOn: iso });
      if (detailId) void logActivity(detailId, iso ? "Follow-up changed" : "Follow-up cleared");
      showToast(iso ? "Follow-up saved" : "Follow-up cleared");
    },
    async deleteLead() {
      await changeLead({ deletedAt: new Date().toISOString() });
      setSheet(null);
      setStack((current) => current.slice(0, -1));
      showToast("Lead deleted");
    },
    async setReminders(enabled) {
      if (!me) return;
      if (enabled) {
        const result = await enableNotifications();
        if (result === "denied") {
          showToast("Reminders stay off until you allow alerts.");
          return;
        }
        setPushActive(result === "push");
      }
      const profile = await remote.updateProfile({ ...me, notifyEnabled: enabled });
      await db.profiles.put(profile);
      showToast(enabled ? "Reminders on" : "Reminders off");
    },
    async setReminderTime(minute) {
      if (!me) return;
      const next = Math.max(0, Math.min(1439, Math.round(minute)));
      const profile = await remote.updateProfile({ ...me, notifyMinute: next });
      await db.profiles.put(profile);
    },
    waTemplate,
    setWaTemplate(value) {
      const next = value.slice(0, 500);
      setWaTemplateState(next);
      try {
        localStorage.setItem(org?.id ? `${WA_KEY}:${org.id}` : WA_KEY, next);
      } catch {
        /* Private browsing can block storage. The template still applies until refresh. */
      }
    },
    async regenerateCode() {
      const inviteCode = await remote.regenerateCode();
      const current = await db.meta.get("local");
      if (current?.org) await db.meta.put({ ...current, org: { ...current.org, inviteCode } });
      showToast("New code ready");
    },
    removeMember(id) {
      setPendingMemberId(id);
      setSheet("remove");
    },
    async confirmRemove() {
      if (!pendingMemberId) return;
      await remote.removeMember(pendingMemberId);
      const profile = await db.profiles.get(pendingMemberId);
      if (profile) await db.profiles.put({ ...profile, removedAt: new Date().toISOString() });
      setSheet(null);
      setPendingMemberId(null);
      showToast("Removed from the team");
      void syncNow();
    },
    transferOwner(id) {
      setPendingMemberId(id);
      setSheet("transfer");
    },
    async confirmTransfer() {
      if (!pendingMemberId || !me) return;
      await remote.transferOwner(pendingMemberId);
      const nextOwner = await db.profiles.get(pendingMemberId);
      const self = await db.profiles.get(me.id);
      if (self) await db.profiles.put({ ...self, role: "member" });
      if (nextOwner) await db.profiles.put({ ...nextOwner, role: "owner" });
      setSheet(null);
      setPendingMemberId(null);
      showToast("They are the owner now");
      void syncNow();
    },
    async confirmDuplicate() {
      const draft = pendingDraft;
      setSheet(null);
      setPendingDraft(null);
      if (draft) await this.saveDraft(draft, true);
    },
    async usePhoneZone() {
      if (!me) return;
      const profile = await remote.updateProfile({ ...me, timezone: zone() });
      await db.profiles.put(profile);
      showToast("Time zone saved");
    },
    exportCsv() {
      const names = new Map(profiles.map((profile) => [profile.id, profile.displayName]));
      const csv = leadsCsv(
        leads.map((lead) => ({
          name: lead.name,
          phone: lead.phone,
          notes: lead.notes,
          status: lead.status,
          followUpOn: lead.followUpOn,
          closedOn: lead.closedOn,
          addedBy: names.get(lead.createdBy || lead.ownerId) || "",
          updatedAt: lead.updatedAt,
        })),
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "bph-leads.csv";
      link.click();
      URL.revokeObjectURL(url);
    },
    async requestPasswordReset(emailAddress) {
      setError("");
      try {
        const result = await remote.requestPasswordReset(emailAddress);
        showToast(result.message);
        setPhase("auth");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not send the reset email.");
      }
    },
    noteActivity(leadId, text) {
      void logActivity(leadId, text);
    },
    applyUpdate() {
      window.dispatchEvent(new Event("bph-apply-update"));
    },
    pendingMemberId,
    duplicateLeadName,
    pushReady,
    updateReady,
    showToast,
  };

  async function finishSignOut() {
    try {
      await enqueueSync(() => flushOutbox(() => {}));
    } catch {
      /* Clearing the phone copy is still the right next step. */
    }
    try {
      await remote.signOut();
    } catch {
      /* The phone copy is cleared either way. */
    }
    await resetLocal();
    setHttpToken("");
    setUserId("");
    setEmail("");
    setStack(["today"]);
    setSheet(null);
    setPhase("auth");
  }

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook() {
  const value = useContext(BookContext);
  if (!value) throw new Error("Book missing");
  return value;
}
