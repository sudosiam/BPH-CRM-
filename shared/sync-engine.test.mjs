import test from "node:test";
import assert from "node:assert/strict";
import { applyPull, flushOutbox } from "./sync-engine.mjs";

function memoryDb() {
  const tables = {
    leads: new Map(),
    profiles: new Map(),
    outbox: new Map(),
    meta: new Map(),
  };
  function table(name) {
    const map = tables[name];
    return {
      async toArray() {
        return [...map.values()];
      },
      async get(id) {
        return map.get(id);
      },
      async put(row) {
        map.set(row.id, structuredClone(row));
      },
      async delete(id) {
        map.delete(id);
      },
      async clear() {
        map.clear();
      },
      async bulkPut(rows) {
        for (const row of rows) map.set(row.id, structuredClone(row));
      },
    };
  }
  return {
    leads: table("leads"),
    profiles: table("profiles"),
    outbox: table("outbox"),
    meta: table("meta"),
    async transaction(...args) {
      return args[args.length - 1]();
    },
  };
}

function lead(patch) {
  return {
    id: "lead-1",
    orgId: "org",
    name: "Ada",
    phone: "1",
    notes: "",
    status: "lead",
    followUpOn: "2026-09-26",
    closedOn: null,
    ownerId: "owner",
    createdBy: "owner",
    updatedBy: "owner",
    soldAmount: null,
    lostReason: null,
    source: null,
    tags: [],
    lastContactAt: null,
    contactCount: 0,
    history: "",
    version: 1,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    deletedAt: null,
    ...patch,
  };
}

test("flushOutbox waits for a full copy and applyPull skips a pending lead", async () => {
  const db = memoryDb();
  await db.meta.put({ id: "local", fullSyncComplete: false, userId: "owner" });
  await db.leads.put(lead({ name: "Mine" }));
  await db.outbox.put({ id: "lead-1", baseVersion: 1, rev: 1, base: null });
  let pushes = 0;
  await flushOutbox(db, { async pushLead() { pushes += 1; return { ok: true, lead: lead() }; } }, () => {}, () => {});
  assert.equal(pushes, 0);
  assert.equal((await db.outbox.get("lead-1")).rev, 1);

  await applyPull(
    db,
    {
      serverTime: "2026-09-26T01:00:00.000Z",
      org: { id: "org", name: "BPH" },
      profiles: [{ id: "owner", displayName: "Rafi" }],
      leads: [lead({ name: "Server", version: 4 })],
      expiredIds: [],
    },
    true,
  );
  assert.equal((await db.leads.get("lead-1")).name, "Mine");

  await db.outbox.delete("lead-1");
  await db.leads.put(lead({ id: "gone", name: "Local only" }));
  await applyPull(
    db,
    {
      serverTime: "2026-09-26T02:00:00.000Z",
      org: { id: "org", name: "BPH" },
      profiles: [{ id: "owner", displayName: "Rafi" }],
      leads: [lead({ name: "Server", version: 4 })],
      expiredIds: [],
    },
    true,
  );
  assert.equal((await db.leads.get("lead-1")).name, "Server");
  assert.equal(await db.leads.get("gone"), undefined);
});

test("flushOutbox merges a clean edit and keeps a conflicting draft", async () => {
  const db = memoryDb();
  await db.meta.put({ id: "local", fullSyncComplete: true, userId: "me" });
  await db.profiles.put({ id: "ada", displayName: "Nadia" });
  const local = lead({
    name: "Ada",
    notes: "called",
    status: "qualified",
    soldAmount: 12,
    lostReason: null,
    history: "2026-09-26 · Called",
    contactCount: 2,
    version: 2,
    updatedBy: "me",
  });
  await db.leads.put(local);
  await db.outbox.put({
    id: "lead-1",
    baseVersion: 1,
    rev: 1,
    base: { ...local, name: "Ada", notes: "", status: "lead", soldAmount: null, history: "", contactCount: 0, version: 1 },
  });
  const server = lead({ name: "Ada Khan", notes: "", version: 3, updatedBy: "ada" });
  const pushed = [];
  const remote = {
    async pushLead(row, baseVersion) {
      pushed.push({ name: row.name, notes: row.notes, status: row.status, baseVersion });
      if (pushed.length === 1) return { ok: false, lead: server, deleted: false };
      return { ok: true, lead: { ...row, version: 4, updatedBy: "me" } };
    },
  };
  const notices = [];
  await flushOutbox(db, remote, (message) => notices.push(message), () => {});
  assert.equal(pushed.length, 2);
  assert.equal(pushed[1].notes, "called");
  assert.equal(pushed[1].status, "qualified");
  assert.equal(pushed[1].baseVersion, 3);
  assert.equal(await db.outbox.get("lead-1"), undefined);
  assert.equal((await db.leads.get("lead-1")).notes, "called");
  assert.deepEqual(notices, []);

  const clashLocal = lead({ name: "Local", notes: "mine", version: 2, updatedBy: "me" });
  await db.leads.put(clashLocal);
  await db.outbox.put({
    id: "lead-1",
    baseVersion: 1,
    rev: 2,
    base: { ...clashLocal, name: "Ada", notes: "" },
  });
  const clashServer = lead({ name: "Server", notes: "theirs", version: 5, updatedBy: "ada" });
  const conflicts = [];
  await flushOutbox(
    db,
    {
      async pushLead() {
        return { ok: false, lead: clashServer, deleted: false };
      },
    },
    (message) => notices.push(message),
    (mine, theirs) => conflicts.push([mine.name, theirs.name]),
  );
  assert.deepEqual(conflicts, [["Local", "Server"]]);
  assert.match(notices.at(-1), /Nadia/);
  assert.match(notices.at(-1), /kept in the editor/);
  assert.equal((await db.leads.get("lead-1")).name, "Server");
  assert.equal(await db.outbox.get("lead-1"), undefined);
});

test("a failed upload stays in the outbox", async () => {
  const db = memoryDb();
  await db.meta.put({ id: "local", fullSyncComplete: true });
  await db.leads.put(lead({ status: "qualified" }));
  await db.outbox.put({ id: "lead-1", baseVersion: 1, rev: 1, base: null });
  await flushOutbox(
    db,
    {
      async pushLead() {
        throw new Error('invalid input value for enum lead_status: "qualified"');
      },
    },
    () => {},
    () => {},
  );
  assert.equal((await db.outbox.get("lead-1")).rev, 1);
  assert.equal((await db.leads.get("lead-1")).status, "qualified");
});
