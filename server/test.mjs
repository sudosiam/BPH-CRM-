import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./index.mjs";
import { shouldSendDigest, digestCounts, digestLine, nextCustomerName, hasLocalBook, membershipMatches } from "../shared/book.mjs";

async function boot() {
  const dataFile = path.join(mkdtempSync(path.join(tmpdir(), "bph-")), "book.json");
  const started = await startServer({ port: 0, dataFile });
  const base = `http://127.0.0.1:${started.port}`;
  return { ...started, base };
}

async function json(base, pathName, { method = "GET", token, body } = {}) {
  const response = await fetch(base + pathName, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

test("accounts, invite, sync, and conflict", async () => {
  const { server, base } = await boot();
  try {
    const owner = await json(base, "/api/auth/signup", {
      method: "POST",
      body: { email: "rafi@bph.example", password: "password1", displayName: "Rafi" },
    });
    assert.equal(owner.status, 200);
    const created = await json(base, "/api/orgs", {
      method: "POST",
      token: owner.data.token,
      body: { name: "BPH", displayName: "Rafi", timezone: "UTC" },
    });
    assert.equal(created.status, 200);
    assert.match(created.data.org.inviteCode, /^[A-HJ-NP-Z2-9]{8}$/);

    const mate = await json(base, "/api/auth/signup", {
      method: "POST",
      body: { email: "nadia@bph.example", password: "password1", displayName: "Nadia" },
    });
    const joined = await json(base, "/api/orgs/join", {
      method: "POST",
      token: mate.data.token,
      body: { code: created.data.org.inviteCode, displayName: "Nadia", timezone: "UTC" },
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.profile.role, "member");

    const leadId = crypto.randomUUID();
    const pushed = await json(base, "/api/leads", {
      method: "POST",
      token: owner.data.token,
      body: {
        baseVersion: null,
        lead: {
          id: leadId,
          name: "Bright Home",
          phone: "+880 1819 220 441",
          notes: "Quote",
          status: "lead",
          followUpOn: "2026-09-25",
          closedOn: null,
          ownerId: owner.data.user.id,
        },
      },
    });
    assert.equal(pushed.status, 200);
    assert.equal(pushed.data.lead.version, 1);

    const seen = await json(base, "/api/sync/pull", { token: mate.data.token });
    assert.equal(seen.data.leads.length, 1);
    assert.equal(seen.data.leads[0].name, "Bright Home");

    const sold = await json(base, "/api/leads", {
      method: "POST",
      token: owner.data.token,
      body: {
        baseVersion: 1,
        lead: { ...pushed.data.lead, status: "sold", followUpOn: null, closedOn: "2026-09-25" },
      },
    });
    assert.equal(sold.status, 200);
    assert.equal(sold.data.lead.status, "sold");
    assert.equal(sold.data.lead.ownerId, owner.data.user.id);

    const kept = await json(base, "/api/leads", {
      method: "POST",
      token: mate.data.token,
      body: {
        baseVersion: sold.data.lead.version,
        lead: { ...sold.data.lead, name: "Bright Home", ownerId: mate.data.user.id },
      },
    });
    assert.equal(kept.status, 200);
    assert.equal(kept.data.lead.ownerId, owner.data.user.id);
    assert.equal(kept.data.lead.createdBy, owner.data.user.id);

    const conflict = await json(base, "/api/leads", {
      method: "POST",
      token: mate.data.token,
      body: {
        baseVersion: 1,
        lead: { ...pushed.data.lead, name: "Old name", ownerId: owner.data.user.id },
      },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.lead.status, "sold");

    const again = await json(base, "/api/orgs/join", {
      method: "POST",
      token: mate.data.token,
      body: { code: "AAAAAAAA", displayName: "Nadia" },
    });
    assert.equal(again.status, 400);
  } finally {
    server.close();
  }
});

test("digest stays quiet until the chosen time and when nothing is due", () => {
  const morning = new Date("2026-09-25T08:00:00Z");
  assert.equal(
    shouldSendDigest({
      notifyEnabled: true,
      notifyMinute: 8 * 60,
      timeZone: "UTC",
      lastDigestOn: null,
      now: morning,
      dueCount: 2,
    }),
    true,
  );
  assert.equal(
    shouldSendDigest({
      notifyEnabled: true,
      notifyMinute: 9 * 60,
      timeZone: "UTC",
      lastDigestOn: null,
      now: morning,
      dueCount: 2,
    }),
    false,
  );
  assert.equal(
    shouldSendDigest({
      notifyEnabled: true,
      notifyMinute: 8 * 60,
      timeZone: "UTC",
      lastDigestOn: null,
      now: morning,
      dueCount: 0,
    }),
    false,
  );
  assert.deepEqual(
    digestCounts(
      [
        { status: "lead", followUpOn: "2026-09-25", ownerId: "a", deletedAt: null },
        { status: "lead", followUpOn: "2026-09-24", ownerId: "b", deletedAt: null },
        { status: "sold", followUpOn: null, ownerId: "c", deletedAt: null },
      ],
      "2026-09-25",
    ),
    { today: 1, overdue: 1 },
  );
  assert.equal(digestLine(1, 1), "1 due today · 1 overdue");
  assert.equal(digestLine(0, 0), "");
  assert.equal(hasLocalBook({ userId: "", hasProfile: true, hasOrg: true, fullSyncComplete: true, leadCount: 1 }), false);
  assert.equal(hasLocalBook({ userId: "u", hasProfile: true, hasOrg: true, fullSyncComplete: true, leadCount: 0 }), true);
  assert.equal(hasLocalBook({ userId: "u", hasProfile: true, hasOrg: false, fullSyncComplete: false, leadCount: 3 }), true);
  assert.equal(hasLocalBook({ userId: "u", hasProfile: true, hasOrg: false, fullSyncComplete: false, leadCount: 0 }), true);
  assert.equal(hasLocalBook({ userId: "u", hasProfile: true, hasOrg: true, fullSyncComplete: false, leadCount: 0 }), false);
  assert.equal(hasLocalBook({ userId: "u", hasProfile: false, hasOrg: false, fullSyncComplete: false, leadCount: 2 }), false);
  assert.equal(membershipMatches({ userId: "u", email: "a@b.c", orgId: "o", orgName: "Hub" }, "u", ""), true);
  assert.equal(membershipMatches({ userId: "u", email: "a@b.c", orgId: "o", orgName: "Hub" }, "other", "A@B.c"), true);
  assert.equal(membershipMatches({ userId: "u", email: "a@b.c", orgId: "o", orgName: "Hub" }, "other", "nope@b.c"), false);
  assert.equal(membershipMatches(null, "u", "a@b.c"), false);
  assert.equal(nextCustomerName([]), "Customer 1");
  assert.equal(nextCustomerName(["Ada", "Customer 2", "Customer 9"]), "Customer 10");
});
