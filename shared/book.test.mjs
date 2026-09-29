import test from "node:test";
import assert from "node:assert/strict";
import { customerMatches, digestCounts, followUpResult, isOpenStatus, leadEditPatch, mergeLead, mergeLeadFields, normalizeTags, qualifiedSchemaError, encodeQualifiedLead, decodeQualifiedLead, historyMarksQualified, soldThisMonth, quietDays, appendHistory, syncStatusLabel, todayISO, addedRecently, conflictDraftFrom, membershipRecord, shouldEncodeQualified, leadFromRow, leadToRow } from "./book.mjs";

test("follow-up results, monthly sold total, and a bad time zone", () => {
  assert.equal(leadEditPatch({ status: "lead", ownerId: "a" }, { phone: " 017 ", notes: " hi ", source: "Phone", tags: ["Scooty", "Nope"], followUpOn: "2026-10-01" }, " Rina ").followUpOn, "2026-10-01");
  assert.equal(leadEditPatch({ status: "lead", ownerId: "a" }, { phone: "", notes: "", source: null, tags: [], followUpOn: "" }, "Rina").followUpOn, null);
  assert.equal("followUpOn" in leadEditPatch({ status: "sold", ownerId: "a" }, { phone: "", notes: "", tags: [], followUpOn: "2026-10-01" }, "Rina"), false);
  assert.equal(leadEditPatch({ status: "qualified", ownerId: "a" }, { phone: "", notes: "", source: null, tags: [], followUpOn: "2026-10-01" }, "Rina").followUpOn, "2026-10-01");
  assert.equal(isOpenStatus("qualified"), true);
  assert.equal(isOpenStatus("sold"), false);
  assert.equal(qualifiedSchemaError('invalid input value for enum lead_status: "qualified"'), true);
  assert.equal(qualifiedSchemaError('new row for relation "leads" violates check constraint "follow_up_only_for_leads"'), true);
  assert.equal(qualifiedSchemaError('new row for relation "leads" violates check constraint "open_leads_are_not_closed"'), true);
  assert.equal(qualifiedSchemaError("Could not sync."), false);
  const encoded = encodeQualifiedLead({ status: "qualified", closedOn: "2026-09-01", history: "2026-09-01 · Added", followUpOn: "2026-09-02" });
  assert.equal(encoded.status, "lead");
  assert.equal(encoded.closedOn, null);
  assert.equal(encoded.followUpOn, "2026-09-02");
  assert.equal(historyMarksQualified(encoded.history), true);
  assert.equal(historyMarksQualified(encodeQualifiedLead(encoded).history), true);
  const decoded = decodeQualifiedLead(encoded);
  assert.equal(decoded.status, "qualified");
  assert.equal(decoded.closedOn, null);
  assert.equal(decoded.history, "2026-09-01 · Added");
  assert.equal(decodeQualifiedLead({ status: "sold", history: encoded.history, closedOn: "2026-09-03" }).status, "sold");
  assert.equal(decodeQualifiedLead({ status: "lead", history: "2026-09-01 · Added" }).status, "lead");
  assert.equal(followUpResult("no-answer", "2026-09-26", "2026-09-20").followUpOn, "2026-09-27");
  assert.equal(followUpResult("no-answer", "2026-09-26", "2026-09-20", "qualified").status, "qualified");
  assert.equal(followUpResult("not-interested", "2026-09-26", "2026-09-27", "qualified").status, "lost");
  assert.equal(digestCounts([{ status: "qualified", followUpOn: "2026-09-26", deletedAt: null }], "2026-09-26").today, 1);
  assert.equal(followUpResult("later", "2026-09-26", null).followUpOn, "2026-09-29");
  assert.equal(followUpResult("quoted", "2026-09-26", "2026-10-01").followUpOn, "2026-10-01");
  assert.equal(followUpResult("not-interested", "2026-09-26", "2026-09-27").status, "lost");
  assert.deepEqual(
    soldThisMonth(
      [
        { status: "sold", closedOn: "2026-09-02", soldAmount: 100, deletedAt: null },
        { status: "sold", closedOn: "2026-08-02", soldAmount: 50, deletedAt: null },
      ],
      "2026-09-26",
    ),
    { count: 1, amount: 100 },
  );
  assert.equal(quietDays("2026-09-01T00:00:00.000Z", "2026-09-26"), 25);
  const noon = Date.parse("2026-09-27T12:00:00Z");
  assert.equal(addedRecently("2026-09-27T11:00:00Z", noon), true);
  assert.equal(addedRecently("2026-09-26T12:00:00Z", noon), false);
  assert.equal(addedRecently("2026-09-26T12:00:01Z", noon), true);
  assert.equal(addedRecently("not-a-date", noon), false);
  assert.equal(appendHistory("2026-09-01 · Added", "2026-09-26", "No answer"), "2026-09-01 · Added\n2026-09-26 · No answer");
  assert.equal(todayISO("Not/AZone", new Date("2026-09-26T00:00:00Z")), "2026-09-26");
  const now = Date.parse("2026-09-26T12:00:00Z");
  assert.equal(syncStatusLabel("synced", "2026-09-26T12:00:00Z", now), "Synced");
  assert.equal(syncStatusLabel("synced", "2026-09-26T11:55:00Z", now), "Synced 5m ago");
  assert.equal(syncStatusLabel("syncing", "2026-09-26T12:00:00Z", now), "Syncing");
  assert.equal(syncStatusLabel("saved", null, now), "On phone");
  assert.deepEqual(normalizeTags(["Parts", "Nope", "Scooty", "Scooty"]), ["Scooty", "Parts"]);
  const people = [
    { name: "Karim", phone: "900", notes: "", status: "lead", tags: ["Scooty"], deletedAt: null },
    { name: "Mina", phone: "901", notes: "battery", status: "sold", tags: ["Acid battery", "Parts"], deletedAt: null },
  ];
  assert.equal(customerMatches(people[0], { tags: ["Scooty", "Parts"] }), true);
  assert.equal(customerMatches(people[0], { status: "sold" }), false);
  assert.equal(customerMatches(people[1], { status: "sold", tags: ["Parts"], query: "mina" }), true);
  assert.equal(customerMatches(people[1], { tags: ["Lithium battery"] }), false);
  const merged = mergeLead(
    { name: "Server", source: "Phone", history: "old", contactCount: 1, lastContactAt: "a", tags: [], version: 4, status: "lead" },
    {
      name: "Local",
      phone: "9",
      notes: "n",
      status: "sold",
      followUpOn: null,
      closedOn: "2026-09-26",
      soldAmount: 10,
      lostReason: null,
      source: "Walk-in",
      tags: ["Scooty", "Nope"],
      lastContactAt: "b",
      contactCount: 3,
      history: "2026-09-26 · Called",
      deletedAt: null,
      updatedBy: "me",
      version: 1,
    },
  );
  assert.equal(merged.name, "Local");
  assert.equal(merged.source, "Walk-in");
  assert.equal(merged.history, "2026-09-26 · Called");
  assert.equal(merged.contactCount, 3);
  assert.equal(merged.lastContactAt, "b");
  assert.deepEqual(merged.tags, ["Scooty"]);
  assert.equal(merged.version, 4);
  const combined = mergeLeadFields(
    { name: "Ada", notes: "old", phone: "1", tags: [] },
    { name: "Ada", notes: "called", phone: "1", tags: ["Scooty"] },
    { name: "Ada Khan", notes: "old", phone: "1", tags: [], version: 3 },
  );
  assert.deepEqual(combined.conflicts, []);
  assert.equal(combined.lead.name, "Ada Khan");
  assert.equal(combined.lead.notes, "called");
  assert.deepEqual(combined.lead.tags, ["Scooty"]);
  const clash = mergeLeadFields(
    { name: "Ada", notes: "old" },
    { name: "Local", notes: "old" },
    { name: "Server", notes: "old" },
  );
  assert.deepEqual(clash.conflicts, ["name"]);
  assert.equal(clash.lead.name, "Server");
});

test("qualified upload, owner digest, conflict draft, and invite storage", () => {
  assert.equal(shouldEncodeQualified(true, null), false);
  assert.equal(shouldEncodeQualified(false, null), true);
  assert.equal(shouldEncodeQualified(true, 'invalid input value for enum lead_status: "qualified"'), true);
  assert.equal(shouldEncodeQualified(true, "Could not sync."), false);
  const row = leadToRow(
    { id: "1", orgId: "o", name: "Ada", phone: "", notes: "", status: "qualified", followUpOn: "2026-09-26", closedOn: null, ownerId: "a", createdBy: "a", history: "note", contactCount: 2, tags: ["Scooty"] },
    "a",
  );
  assert.equal(row.status, "qualified");
  assert.equal(String(row.history).length <= 4000, true);
  const stored = leadFromRow({ ...row, status: "lead", history: encodeQualifiedLead({ status: "qualified", history: "note" }).history });
  assert.equal(stored.status, "qualified");
  assert.equal(stored.history, "note");
  assert.deepEqual(
    digestCounts(
      [
        { status: "lead", followUpOn: "2026-09-26", ownerId: "owner", deletedAt: null },
        { status: "qualified", followUpOn: "2026-09-25", ownerId: "mate", deletedAt: null },
      ],
      "2026-09-26",
      "owner",
    ),
    { today: 1, overdue: 0 },
  );
  const draft = conflictDraftFrom({
    id: "1",
    name: "Ada",
    phone: "9",
    notes: "n",
    followUpOn: null,
    ownerId: "a",
    source: "Phone",
    tags: ["Scooty"],
    status: "sold",
    soldAmount: 40,
    lostReason: null,
    history: "2026-09-26 · Called",
    contactCount: 3,
    lastContactAt: "2026-09-26T00:00:00.000Z",
    closedOn: "2026-09-26",
  });
  const patch = leadEditPatch({ status: "lead", ownerId: "a" }, draft, "Ada");
  assert.equal(patch.status, "sold");
  assert.equal(patch.soldAmount, 40);
  assert.equal(patch.history, "2026-09-26 · Called");
  assert.equal(patch.contactCount, 3);
  assert.equal(patch.closedOn, "2026-09-26");
  assert.equal(patch.followUpOn, null);
  const remembered = membershipRecord(
    { userId: "m", email: "m@bph.example", orgId: "o", orgName: "BPH", inviteCode: "ABCD2345", displayName: "Mina" },
    { userId: "owner", inviteCode: "ZZZZ2345", displayName: "Rafi" },
  );
  assert.equal(remembered.inviteCode, null);
  assert.equal(remembered.displayName, "Mina");
});
