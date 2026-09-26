import test from "node:test";
import assert from "node:assert/strict";
import { customerMatches, followUpResult, normalizeTags, soldThisMonth, quietDays, appendHistory, todayISO } from "./book.mjs";

test("follow-up results, monthly sold total, and a bad time zone", () => {
  assert.equal(followUpResult("no-answer", "2026-09-26", "2026-09-20").followUpOn, "2026-09-27");
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
  assert.equal(appendHistory("2026-09-01 · Added", "2026-09-26", "No answer"), "2026-09-01 · Added\n2026-09-26 · No answer");
  assert.equal(todayISO("Not/AZone", new Date("2026-09-26T00:00:00Z")), "2026-09-26");
  assert.deepEqual(normalizeTags(["Parts", "Nope", "Scooty", "Scooty"]), ["Scooty", "Parts"]);
  const people = [
    { name: "Karim", phone: "900", notes: "", status: "lead", tags: ["Scooty"], deletedAt: null },
    { name: "Mina", phone: "901", notes: "battery", status: "sold", tags: ["Acid battery", "Parts"], deletedAt: null },
  ];
  assert.equal(customerMatches(people[0], { tags: ["Scooty", "Parts"] }), true);
  assert.equal(customerMatches(people[0], { status: "sold" }), false);
  assert.equal(customerMatches(people[1], { status: "sold", tags: ["Parts"], query: "mina" }), true);
  assert.equal(customerMatches(people[1], { tags: ["Lithium battery"] }), false);
});
