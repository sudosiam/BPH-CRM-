import Dexie, { type EntityTable } from "dexie";
import type { Lead, Meta, OutboxItem, Profile } from "./types";

export type Activity = {
  id?: number;
  leadId: string;
  at: string;
  text: string;
};

class BphDB extends Dexie {
  leads!: EntityTable<Lead, "id">;
  profiles!: EntityTable<Profile, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  meta!: EntityTable<Meta, "id">;
  activity!: EntityTable<Activity, "id">;

  constructor() {
    super("bph");
    this.version(1).stores({
      leads: "id, orgId, updatedAt",
      profiles: "id, orgId",
      outbox: "id",
      meta: "id",
    });
    this.version(2).stores({
      activity: "++id, leadId, at",
    });
  }
}

export const db = new BphDB();

export async function resetLocal() {
  await db.leads.clear();
  await db.profiles.clear();
  await db.outbox.clear();
  await db.meta.clear();
  await db.activity.clear();
}

export async function logActivity(leadId: string, text: string) {
  await db.activity.add({ leadId, at: new Date().toISOString(), text });
}
