import Dexie, { type EntityTable } from "dexie";
import type { Lead, Meta, OutboxItem, Profile } from "./types";

class BphDB extends Dexie {
  leads!: EntityTable<Lead, "id">;
  profiles!: EntityTable<Profile, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  meta!: EntityTable<Meta, "id">;

  constructor() {
    super("bph");
    this.version(1).stores({
      leads: "id, orgId, updatedAt",
      profiles: "id, orgId",
      outbox: "id",
      meta: "id",
    });
  }
}

export const db = new BphDB();

export async function resetLocal() {
  await db.leads.clear();
  await db.profiles.clear();
  await db.outbox.clear();
  await db.meta.clear();
}
