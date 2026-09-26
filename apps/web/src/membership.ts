import { membershipMatches } from "@shared/book.mjs";

const KEY = "bph-membership";

export type Membership = {
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  inviteCode: string | null;
};

export function readMembership(): Membership | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Membership;
    if (!parsed?.orgId || !parsed.orgName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeMembership(record: Membership) {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* The book still opens. The phone may block storage. */
  }
}

export function matchingMembership(userId: string, email: string) {
  const record = readMembership();
  return record && membershipMatches(record, userId, email) ? record : null;
}
