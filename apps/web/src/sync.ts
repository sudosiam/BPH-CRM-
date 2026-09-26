import { db } from "./db";
import { remote } from "./remote";
import type { Lead, Org } from "./types";

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
  await new Promise((resolve) => window.setTimeout(resolve, 320));
}

export async function runIncremental() {
  const current = await db.meta.get("local");
  if (!current?.fullSyncComplete) return;
  const payload = await remote.pull(current.cursor);
  await applyPull(payload, false);
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

export async function flushOutbox(onNotice: (message: string) => void) {
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
        if (!result.deleted && result.lead) {
          const merged = {
            ...result.lead,
            name: lead.name,
            phone: lead.phone,
            notes: lead.notes,
            status: lead.status,
            followUpOn: lead.followUpOn,
            closedOn: lead.closedOn,
            deletedAt: lead.deletedAt,
            updatedBy: lead.updatedBy,
          };
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
          const actor = (await db.profiles.get(kept.updatedBy))?.displayName ?? "someone";
          onNotice(`This lead was updated by ${actor}. Your change was not saved.`);
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
  });
}
