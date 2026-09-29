import { membershipMatches, membershipRecord } from "@shared/book.mjs";

const KEY = "bph-membership";

export type Membership = {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  inviteCode: string | null;
  displayName?: string;
};

export function readMembership(): Membership | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Membership;
    if (!parsed?.orgId || !parsed.orgName) return null;
    return { ...parsed, inviteCode: null };
  } catch {
    return null;
  }
}

export function writeMembership(record: Membership) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...record, inviteCode: null }));
  } catch {
    /* The book still opens. The phone may block storage. */
  }
}

export function clearMembership() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Sign-out still drops the signed-in copy. */
  }
}

export function matchingMembership(userId: string, email: string) {
  const record = readMembership();
  return record && membershipMatches(record, userId, email) ? record : null;
}

export function saveMembership(input: {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  inviteCode?: string | null;
  displayName?: string;
}) {
  const existing = readMembership();
  const next = membershipRecord(input, existing);
  if (!next.userId || !next.orgId || !next.orgName) return;
  writeMembership({
    userId: next.userId,
    email: next.email || "",
    orgId: next.orgId,
    orgName: next.orgName,
    inviteCode: null,
    displayName: next.displayName,
  });
}
