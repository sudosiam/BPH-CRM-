import type { Account, Lead, Org, Profile, Pull, PushResult } from "./types";

let token = "";

export function setHttpToken(value: string) {
  token = value;
}

export function getHttpToken() {
  return token;
}

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function account(data: {
  token?: string;
  user: Account["user"];
  profile: Profile | null;
  org: Org | null;
}): Account {
  if (data.token) token = data.token;
  return { user: data.user, profile: data.profile, org: data.org };
}

export function createHttpRemote() {
  return {
    async signUp(email: string, password: string, displayName: string) {
      const { response, data } = await request("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      });
      if (!response.ok) throw new Error(data.error || "Could not create the account.");
      return account(data);
    },
    async signIn(email: string, password: string) {
      const { response, data } = await request("/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      return account(data);
    },
    async signOut() {
      await request("/api/auth/signout", { method: "POST" });
      token = "";
    },
    async session(): Promise<Account | null> {
      if (!token) return null;
      const { response, data } = await request("/api/auth/session");
      if (!response.ok) return null;
      return account(data);
    },
    async createOrg(name: string, displayName: string, timezone: string) {
      const { response, data } = await request("/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name, displayName, timezone }),
      });
      if (!response.ok) throw new Error(data.error || "Could not create the business.");
      return data as { org: Org; profile: Profile };
    },
    async joinOrg(code: string, displayName: string, timezone: string) {
      const { response, data } = await request("/api/orgs/join", {
        method: "POST",
        body: JSON.stringify({ code, displayName, timezone }),
      });
      if (!response.ok) throw new Error(data.error || "Could not join.");
      return data as { org: Org; profile: Profile };
    },
    async regenerateCode() {
      const { response, data } = await request("/api/orgs/invite/regenerate", { method: "POST" });
      if (!response.ok) throw new Error(data.error || "Could not change the code.");
      return data.inviteCode as string;
    },
    async removeMember(memberId: string) {
      const { response, data } = await request("/api/orgs/members/remove", {
        method: "POST",
        body: JSON.stringify({ memberId }),
      });
      if (!response.ok) throw new Error(data.error || "Could not remove them.");
    },
    async updateProfile(patch: Partial<Profile>) {
      const { response, data } = await request("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: patch.displayName,
          timezone: patch.timezone,
          notifyEnabled: patch.notifyEnabled,
          notifyMinute: patch.notifyMinute,
        }),
      });
      if (!response.ok) throw new Error(data.error || "Could not save.");
      return data.profile as Profile;
    },
    async pull(cursor: string | null): Promise<Pull> {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const { response, data } = await request(`/api/sync/pull${query}`);
      if (!response.ok) throw new Error(data.error || "Could not copy the book.");
      return data as Pull;
    },
    async pushLead(lead: Lead, baseVersion: number | null): Promise<PushResult> {
      const { response, data } = await request("/api/leads", {
        method: "POST",
        body: JSON.stringify({ lead, baseVersion }),
      });
      if (response.status === 409) {
        return { ok: false, lead: data.lead ?? null, deleted: Boolean(data.deleted) };
      }
      if (!response.ok) throw new Error(data.error || "Could not sync.");
      return { ok: true, lead: data.lead as Lead };
    },
    async vapidPublicKey() {
      const { response, data } = await request("/api/push/vapid");
      if (!response.ok) return null;
      return (data.publicKey as string) || null;
    },
    async saveSubscription(subscription: PushSubscriptionJSON) {
      const { response, data } = await request("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error(data.error || "Could not save reminders.");
    },
    subscribe(onChange: () => void) {
      if (!token) return () => {};
      const source = new EventSource(`/api/sync/stream?token=${encodeURIComponent(token)}`);
      source.onmessage = () => onChange();
      return () => source.close();
    },
  };
}
