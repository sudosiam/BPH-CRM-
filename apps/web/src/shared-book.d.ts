declare module "@shared/book.mjs" {
  export const INVITE_ALPHABET: string;
  export function normalizeCode(value: string): string;
  export function todayISO(timeZone?: string, now?: Date): string;
  export function addDays(iso: string, amount: number): string;
  export function dayDiff(iso: string, today: string): number;
  export function localMinutes(timeZone: string, now?: Date): number;
  export function digestLine(dueToday: number, overdue: number): string;
  export function digestCounts(
    leads: Array<{ deletedAt?: string | null; status: string; followUpOn?: string | null }>,
    today: string,
  ): { overdue: number; today: number };
  export function shouldSendDigest(input: {
    notifyEnabled: boolean;
    notifyMinute: number;
    timeZone: string;
    lastDigestOn: string | null;
    now: Date;
    dueCount: number;
  }): boolean;
  export function prettyDate(iso: string): string;
  export function longDate(iso: string): string;
  export function dueMeta(iso: string | null, today: string): { text: string; className: string };
  export function initials(name: string): string;
  export function nextCustomerName(names: string[]): string;
  export function assignCustomerName(requested: string, names: string[]): string;
  export function pullSince(cursor: string | null, overlapMs?: number): string | null;
  export function newId(): string;
  export function phoneKey(phone: string): string;
  export function duplicatePhone(
    leads: Array<{ id: string; phone?: string; deletedAt?: string | null }>,
    phone: string,
    exceptId: string | null,
  ): { id: string; phone?: string; deletedAt?: string | null } | null;
  export function csvCell(value: unknown): string;
  export function leadsCsv(
    leads: Array<{
      name: string;
      phone?: string;
      notes?: string;
      status: string;
      followUpOn?: string | null;
      closedOn?: string | null;
      addedBy?: string;
      updatedAt?: string;
    }>,
  ): string;
  export function safeTimeZone(timeZone?: string): string;
  export function hasLocalBook(input: {
    userId: string;
    hasProfile: boolean;
    hasOrg: boolean;
    fullSyncComplete: boolean;
    leadCount: number;
  }): boolean;
  export function membershipMatches(
    record: { userId?: string; email?: string; orgId?: string; orgName?: string } | null,
    userId: string,
    email: string,
  ): boolean;
  export function relativeTime(iso: string, now?: number): string;
}
