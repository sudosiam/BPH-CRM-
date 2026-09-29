import { normalizeTags, pullSince } from "@shared/book.mjs";
import { applyPull as applyPullRecords, flushOutbox as flushOutboxRecords, tombstoneFresh } from "@shared/sync-engine.mjs";
import { db } from "./db";
import { remote } from "./remote";
import type { Lead, LeadBase, Org, Profile } from "./types";

export { tombstoneFresh };

function leadBase(lead: Lead): LeadBase {
  return {
    name: lead.name,
    phone: lead.phone,
    notes: lead.notes,
    status: lead.status,
    followUpOn: lead.followUpOn,
    closedOn: lead.closedOn,
    soldAmount: lead.soldAmount,
    lostReason: lead.lostReason,
    source: lead.source,
    tags: normalizeTags(lead.tags),
    lastContactAt: lead.lastContactAt,
    contactCount: Number(lead.contactCount) || 0,
    history: lead.history || "",
    deletedAt: lead.deletedAt,
  };
}

export type ProfilePatch = {
  timezone?: string;
  notifyEnabled?: boolean;
  notifyMinute?: number;
};

export async function applyPull(payload: Awaited<ReturnType<typeof remote.pull>>, replaceAll: boolean) {
  await applyPullRecords(db, payload, replaceAll);
}

export async function runFullSync(onProgress?: (pct: number, label: string) => void) {
  onProgress?.(24, "Copying leads…");
  const first = await remote.pull(null);
  onProgress?.(68, "Copying leads…");
  await applyPull(first, true);
  const second = await remote.pull(first.serverTime);
  await applyPull(second, false);
  const current = await db.meta.get("local");
  if (current) await db.meta.put({ ...current, fullSyncComplete: true, cursor: second.serverTime, org: second.org });
  const count = await db.leads.filter((lead) => !lead.deletedAt).count();
  onProgress?.(100, `${count} ${count === 1 ? "lead" : "leads"} on this phone`);
}

export async function runIncremental() {
  const current = await db.meta.get("local");
  if (!current?.fullSyncComplete) return;
  const payload = await remote.pull(current.cursor);
  await applyPull(payload, pullSince(current.cursor) == null);
}

export async function queueProfile(userId: string, patch: ProfilePatch) {
  await writeStrict([db.profiles, db.meta], async () => {
    const profile = await db.profiles.get(userId);
    if (profile) await db.profiles.put({ ...profile, ...patch });
    const current = await db.meta.get("local");
    if (!current) return;
    await db.meta.put({
      ...current,
      profilePending: { ...(current.profilePending ?? {}), ...patch },
    });
  });
}

function samePatch(left: ProfilePatch | null | undefined, right: ProfilePatch | null | undefined) {
  if (!left || !right) return false;
  return left.timezone === right.timezone && left.notifyEnabled === right.notifyEnabled && left.notifyMinute === right.notifyMinute;
}

export async function flushProfile() {
  const current = await db.meta.get("local");
  const pending = current?.profilePending;
  if (!current || !pending || !Object.keys(pending).length) return;
  const profile = await db.profiles.get(current.userId);
  if (!profile) return;
  let saved: Profile;
  try {
    saved = await remote.updateProfile({ ...profile, ...pending });
  } catch {
    return;
  }
  const latest = await db.meta.get("local");
  if (!latest) return;
  if (samePatch(latest.profilePending, pending)) {
    await db.profiles.put(saved);
    await db.meta.put({ ...latest, profilePending: null });
    return;
  }
  const row = await db.profiles.get(current.userId);
  if (row && latest.profilePending) await db.profiles.put({ ...saved, ...latest.profilePending });
}

type Durability = "default" | "strict" | "relaxed";

let allowStrict = true;
let strictDepth = 0;
let savedDurability: Durability | undefined;

function durabilityOptions() {
  return (db as unknown as { _options: { chromeTransactionDurability?: Durability } })._options;
}

function beginStrict() {
  if (!allowStrict) return;
  const options = durabilityOptions();
  if (strictDepth === 0) savedDurability = options.chromeTransactionDurability;
  strictDepth += 1;
  options.chromeTransactionDurability = "strict";
}

function endStrict() {
  strictDepth = Math.max(0, strictDepth - 1);
  if (strictDepth === 0) durabilityOptions().chromeTransactionDurability = savedDurability;
}

function isDurabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /durability/i.test(message);
}

function writeStrict<T>(
  tables: [typeof db.leads, typeof db.outbox] | [typeof db.profiles, typeof db.meta],
  scope: () => Promise<T> | T,
): Promise<T> {
  const start = (strict: boolean) => {
    if (strict) beginStrict();
    try {
      const pending = db.transaction("rw", tables[0], tables[1], scope);
      return pending.finally(() => {
        if (strict) endStrict();
      });
    } catch (error) {
      if (strict) endStrict();
      throw error;
    }
  };
  if (!allowStrict) return start(false);
  return start(true).catch((error: unknown) => {
    if (!isDurabilityError(error)) throw error;
    allowStrict = false;
    return start(false);
  });
}

export function queueLead(next: Lead, baseVersion: number | null, before?: Lead | null) {
  return writeStrict([db.leads, db.outbox], async () => {
    const existing = await db.outbox.get(next.id);
    await db.leads.put(next);
    await db.outbox.put({
      id: next.id,
      baseVersion: existing ? existing.baseVersion : baseVersion,
      base: existing?.base ?? (before ? leadBase(before) : null),
      rev: (existing?.rev ?? 0) + 1,
    });
  });
}

/** Writes the sold amount with a native transaction started in the same turn as pagehide, before the phone can freeze Dexie's microtask. */
export function commitSoldDurable(id: string, amount: number | null, actorId: string) {
  const idb = db.backendDB();
  if (!idb) return;
  let tx: IDBTransaction;
  try {
    tx = idb.transaction(["leads", "outbox"], "readwrite", { durability: "strict" });
  } catch {
    try {
      tx = idb.transaction(["leads", "outbox"], "readwrite");
    } catch {
      return;
    }
  }
  const leads = tx.objectStore("leads");
  const outbox = tx.objectStore("outbox");
  const row = leads.get(id);
  row.onsuccess = () => {
    const current = row.result as Lead | undefined;
    if (!current) return;
    leads.put({ ...current, soldAmount: amount, updatedBy: actorId, updatedAt: new Date().toISOString() });
    const queued = outbox.get(id);
    queued.onsuccess = () => {
      const existing = queued.result as { baseVersion: number | null; rev?: number; base?: LeadBase | null } | undefined;
      outbox.put({
        id,
        baseVersion: existing ? existing.baseVersion : current.version,
        base: existing?.base ?? leadBase(current),
        rev: (existing?.rev ?? 0) + 1,
      });
    };
  };
}

/** Applies a patch inside one durable transaction. */
export function patchLeadNow(id: string, revise: (current: Lead) => Partial<Lead> | null, actorId: string) {
  return writeStrict([db.leads, db.outbox], async () => {
    const current = await db.leads.get(id);
    if (!current) return false;
    const patch = revise(current);
    if (!patch) return false;
    const existing = await db.outbox.get(id);
    const next: Lead = {
      ...current,
      ...patch,
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    };
    await db.leads.put(next);
    await db.outbox.put({
      id,
      baseVersion: existing ? existing.baseVersion : current.version,
      base: existing?.base ?? leadBase(current),
      rev: (existing?.rev ?? 0) + 1,
    });
    return true;
  });
}

/** Puts a deleted lead back, even after sync has removed the local row. */
export function restoreLeadNow(snapshot: Lead, actorId: string) {
  return writeStrict([db.leads, db.outbox], async () => {
    const current = await db.leads.get(snapshot.id);
    const existing = await db.outbox.get(snapshot.id);
    const next: Lead = {
      ...snapshot,
      deletedAt: null,
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
      version: current?.version ?? snapshot.version,
    };
    await db.leads.put(next);
    await db.outbox.put({
      id: snapshot.id,
      baseVersion: existing ? existing.baseVersion : (current?.version ?? snapshot.version),
      base: existing?.base ?? leadBase(current ?? snapshot),
      rev: (existing?.rev ?? 0) + 1,
    });
    return true;
  });
}

let syncChain: Promise<unknown> = Promise.resolve();

export function enqueueSync<T>(task: () => Promise<T>): Promise<T> {
  const run = syncChain.then(task, task);
  syncChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function flushOutbox(
  onNotice: (message: string) => void,
  onConflict?: (local: Lead, server: Lead) => void,
) {
  await flushOutboxRecords(db, remote, onNotice, onConflict);
}

export async function saveMeta(patch: {
  token: string;
  userId: string;
  email: string;
  org: Org | null;
  fullSyncComplete?: boolean;
  cursor?: string | null;
}) {
  const current = await db.meta.get("local");
  await db.meta.put({
    id: "local",
    token: patch.token,
    userId: patch.userId,
    email: patch.email,
    org: patch.org,
    fullSyncComplete: patch.fullSyncComplete ?? current?.fullSyncComplete ?? false,
    cursor: patch.cursor === undefined ? current?.cursor ?? null : patch.cursor,
    profilePending: current?.profilePending ?? null,
  });
}
