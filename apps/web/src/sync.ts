import { mergeLead, pullSince } from "@shared/book.mjs";
import { db } from "./db";
import { remote } from "./remote";
import type { Lead, Org, Profile } from "./types";

export type ProfilePatch = {
  timezone?: string;
  notifyEnabled?: boolean;
  notifyMinute?: number;
};

export async function applyPull(payload: Awaited<ReturnType<typeof remote.pull>>, replaceAll: boolean) {
  const pending = new Set((await db.outbox.toArray()).map((item) => item.id));
  await db.transaction("rw", db.leads, db.profiles, db.meta, async () => {
    if (replaceAll) {
      const local = await db.leads.toArray();
      const remoteIds = new Set(payload.leads.map((lead) => lead.id));
      for (const lead of local) {
        if (!pending.has(lead.id) && !remoteIds.has(lead.id)) await db.leads.delete(lead.id);
      }
    }
    for (const lead of payload.leads) {
      if (pending.has(lead.id)) continue;
      if (lead.deletedAt) await db.leads.delete(lead.id);
      else await db.leads.put(lead);
    }
    await db.profiles.clear();
    await db.profiles.bulkPut(payload.profiles);
    const current = await db.meta.get("local");
    if (current?.profilePending && current.userId) {
      const self = await db.profiles.get(current.userId);
      if (self) await db.profiles.put({ ...self, ...current.profilePending });
    }
    if (current) await db.meta.put({ ...current, org: payload.org, cursor: payload.serverTime });
  });
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
  const profile = await db.profiles.get(userId);
  if (profile) await db.profiles.put({ ...profile, ...patch });
  const current = await db.meta.get("local");
  if (!current) return;
  await db.meta.put({
    ...current,
    profilePending: { ...(current.profilePending ?? {}), ...patch },
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

export async function queueLead(next: Lead, baseVersion: number | null) {
  const existing = await db.outbox.get(next.id);
  await db.leads.put(next);
  await db.outbox.put({
    id: next.id,
    baseVersion: existing ? existing.baseVersion : baseVersion,
    rev: (existing?.rev ?? 0) + 1,
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

async function settlePush(
  item: { id: string; rev: number },
  result: Awaited<ReturnType<typeof remote.pushLead>>,
) {
  const current = await db.outbox.get(item.id);
  if (!result.ok) return false;
  if (!current || current.rev === item.rev) {
    if (result.lead.deletedAt) await db.leads.delete(item.id);
    else await db.leads.put(result.lead);
    await db.outbox.delete(item.id);
  } else {
    await db.outbox.put({ ...current, baseVersion: result.lead.version });
  }
  return true;
}

export async function flushOutbox(
  onNotice: (message: string) => void,
  onConflict?: (local: Lead, server: Lead) => void,
) {
  const meta = await db.meta.get("local");
  if (!meta?.fullSyncComplete) return;
  for (let pass = 0; pass < 3; pass += 1) {
    const items = await db.outbox.toArray();
    if (!items.length) return;
    let progressed = false;
    for (const item of items) {
      try {
        const lead = await db.leads.get(item.id);
        if (!lead) {
          await db.outbox.delete(item.id);
          progressed = true;
          continue;
        }
        let result = await remote.pushLead(lead, item.baseVersion);
        if (await settlePush(item, result)) {
          progressed = true;
          continue;
        }
        if (result.ok) continue;
        const ownUndo = Boolean(result.lead?.deletedAt && !lead.deletedAt && result.lead.updatedBy === lead.updatedBy);
        if (result.lead && (!result.deleted || ownUndo)) {
          const merged = mergeLead(result.lead, lead);
          result = await remote.pushLead(merged, result.lead.version);
          if (await settlePush(item, result)) {
            progressed = true;
            continue;
          }
        }
        const kept = result.ok ? null : result.lead;
        if (!kept || kept.deletedAt || (!result.ok && result.deleted)) {
          await db.leads.delete(item.id);
          onNotice("This lead was deleted.");
        } else {
          await db.leads.put(kept);
          onConflict?.(lead, kept);
          const actor = (await db.profiles.get(kept.updatedBy))?.displayName ?? "someone";
          onNotice(`This lead was updated by ${actor}. Your change was kept in the editor.`);
        }
        await db.outbox.delete(item.id);
        progressed = true;
      } catch {
        /* Leave this change queued. The next ones still go out. */
      }
    }
    if (!progressed) return;
  }
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
