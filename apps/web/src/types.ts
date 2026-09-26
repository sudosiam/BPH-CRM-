export type LeadStatus = "lead" | "sold" | "lost";

export type Lead = {
  id: string;
  orgId: string;
  name: string;
  phone: string;
  notes: string;
  status: LeadStatus;
  followUpOn: string | null;
  closedOn: string | null;
  ownerId: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Profile = {
  id: string;
  orgId: string;
  displayName: string;
  role: "owner" | "member";
  timezone: string;
  notifyEnabled: boolean;
  notifyMinute: number;
  removedAt: string | null;
};

export type Org = {
  id: string;
  name: string;
  inviteCode: string | null;
};

export type Account = {
  user: { id: string; email: string; displayName: string };
  profile: Profile | null;
  org: Org | null;
  removed?: boolean;
};

export type Pull = {
  serverTime: string;
  leads: Lead[];
  profiles: Profile[];
  org: Org;
};

export type PushResult =
  | { ok: true; lead: Lead }
  | { ok: false; lead: Lead | null; deleted: boolean };

export type OutboxItem = {
  id: string;
  baseVersion: number | null;
  rev: number;
};

export type Meta = {
  id: "local";
  token: string;
  userId: string;
  email: string;
  fullSyncComplete: boolean;
  cursor: string | null;
  org: Org | null;
};
