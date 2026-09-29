import { mergeLead, mergeLeadFields } from "./book.mjs";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function tombstoneFresh(deletedAt, now = Date.now()) {
  if (!deletedAt) return false;
  const at = Date.parse(deletedAt);
  return Number.isFinite(at) && now - at < RETENTION_MS;
}

export async function applyPull(db, payload, replaceAll) {
  await db.transaction("rw", db.leads, db.profiles, db.meta, db.outbox, async () => {
    const pending = new Set((await db.outbox.toArray()).map((item) => item.id));
    for (const lead of await db.leads.toArray()) {
      if (!pending.has(lead.id) && lead.deletedAt && !tombstoneFresh(lead.deletedAt)) await db.leads.delete(lead.id);
    }
    for (const id of payload.expiredIds ?? []) {
      if (!pending.has(id)) await db.leads.delete(id);
    }
    if (replaceAll) {
      const local = await db.leads.toArray();
      const remoteIds = new Set(payload.leads.map((lead) => lead.id));
      for (const lead of local) {
        if (!pending.has(lead.id) && !remoteIds.has(lead.id)) await db.leads.delete(lead.id);
      }
    }
    for (const lead of payload.leads) {
      if (pending.has(lead.id)) continue;
      if (lead.deletedAt && !tombstoneFresh(lead.deletedAt)) await db.leads.delete(lead.id);
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

async function settlePush(db, item, result) {
  const current = await db.outbox.get(item.id);
  if (!result.ok) return false;
  if (!current || current.rev === item.rev) {
    if (result.lead.deletedAt && !tombstoneFresh(result.lead.deletedAt)) await db.leads.delete(item.id);
    else await db.leads.put(result.lead);
    await db.outbox.delete(item.id);
  } else {
    await db.outbox.put({ ...current, baseVersion: result.lead.version });
  }
  return true;
}

export async function flushOutbox(db, remote, onNotice, onConflict) {
  const meta = await db.meta.get("local");
  if (!meta?.fullSyncComplete) return;
  for (let pass = 0; pass < 3; pass += 1) {
    const items = await db.outbox.toArray();
    if (!items.length) return;
    let progressed = false;
    for (const item of items) {
      let lead;
      try {
        lead = await db.leads.get(item.id);
        if (!lead) {
          await db.outbox.delete(item.id);
          progressed = true;
          continue;
        }
        let result = await remote.pushLead(lead, item.baseVersion);
        if (await settlePush(db, item, result)) {
          progressed = true;
          continue;
        }
        if (result.ok) continue;
        if (result.lead && !result.deleted && item.base) {
          const merged = mergeLeadFields(item.base, lead, result.lead);
          if (merged.conflicts.length === 0) {
            result = await remote.pushLead(merged.lead, result.lead.version);
            if (await settlePush(db, item, result)) {
              progressed = true;
              continue;
            }
          }
        }
        const ownUndo = Boolean(result.lead?.deletedAt && !lead.deletedAt && result.lead.updatedBy === lead.updatedBy);
        if (ownUndo && result.lead) {
          const merged = mergeLead(result.lead, lead);
          result = await remote.pushLead(merged, result.lead.version);
          if (await settlePush(db, item, result)) {
            progressed = true;
            continue;
          }
        }
        const kept = result.ok ? null : result.lead;
        if (!kept) {
          await db.leads.delete(item.id);
          onNotice("This lead was deleted.");
        } else if (kept.deletedAt) {
          if (tombstoneFresh(kept.deletedAt)) await db.leads.put(kept);
          else await db.leads.delete(item.id);
          if (!lead.deletedAt) onNotice("This lead was deleted.");
        } else if (lead.deletedAt && !kept.deletedAt) {
          await db.leads.put(kept);
          const actor = (await db.profiles.get(kept.updatedBy))?.displayName ?? "someone";
          onNotice(`${actor} updated this lead, so it was not deleted.`);
        } else {
          await db.leads.put(kept);
          onConflict?.(lead, kept);
          const actor = (await db.profiles.get(kept.updatedBy))?.displayName ?? "someone";
          onNotice(`This lead was updated by ${actor}. Your change was kept in the editor.`);
        }
        await db.outbox.delete(item.id);
        progressed = true;
      } catch {
        /* Leave this change queued. A missing status is not a permanent block. */
      }
    }
    if (!progressed) return;
  }
}
