import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Account, Lead, Org, Profile, Pull, PushResult } from "./types";

export function resolveSupabaseUrl(value: string | undefined) {
  const raw = String(value ?? "").trim().replace(/\/$/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}.supabase.co`;
}

function mapLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    name: String(row.name),
    phone: String(row.phone ?? ""),
    notes: String(row.notes ?? ""),
    status: row.status as Lead["status"],
    followUpOn: (row.follow_up_on as string | null) ?? null,
    closedOn: (row.closed_on as string | null) ?? null,
    ownerId: String(row.owner_id),
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: (row.deleted_at as string | null) ?? null,
  };
}

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    displayName: String(row.display_name),
    role: row.role as Profile["role"],
    timezone: String(row.timezone || "UTC"),
    notifyEnabled: Boolean(row.notify_enabled),
    notifyMinute: Number(row.notify_minute ?? 480),
    removedAt: (row.removed_at as string | null) ?? null,
  };
}

function mapOrg(row: Record<string, unknown>, role: Profile["role"] | undefined): Org {
  return {
    id: String(row.id),
    name: String(row.name),
    inviteCode: role === "owner" ? String(row.invite_code) : null,
  };
}

function toRow(lead: Lead, userId: string) {
  return {
    id: lead.id,
    org_id: lead.orgId,
    name: lead.name,
    phone: lead.phone || null,
    notes: lead.notes,
    status: lead.status,
    follow_up_on: lead.followUpOn,
    closed_on: lead.closedOn,
    owner_id: lead.ownerId,
    created_by: lead.createdBy || userId,
    updated_by: userId,
    deleted_at: lead.deletedAt,
  };
}

async function loadAccount(supabase: SupabaseClient): Promise<Account | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  const { data: profileRow } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  const profile = profileRow && !profileRow.removed_at ? mapProfile(profileRow) : null;
  let org: Org | null = null;
  if (profile) {
    const { data: orgRow } = await supabase.from("orgs").select("*").eq("id", profile.orgId).maybeSingle();
    org = orgRow ? mapOrg(orgRow, profile.role) : null;
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? "",
      displayName: profile?.displayName || String(session.user.user_metadata?.display_name ?? ""),
    },
    profile,
    org,
  };
}

export function createSupabaseRemote() {
  const supabase = createClient(resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL), import.meta.env.VITE_SUPABASE_ANON_KEY || "", {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  return {
    async signUp(email: string, password: string, displayName: string) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("Check your email to confirm the account, then sign in.");
      const account = await loadAccount(supabase);
      if (!account) throw new Error("Could not create the account.");
      account.user.displayName = displayName;
      return account;
    },
    async signIn(email: string, password: string) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const account = await loadAccount(supabase);
      if (!account) throw new Error("Could not sign in.");
      return account;
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    session() {
      return loadAccount(supabase);
    },
    async createOrg(name: string, displayName: string, timezone: string) {
      const { error } = await supabase.rpc("create_org", { org_name: name, display_name: displayName });
      if (error) throw new Error(error.message);
      const { error: profileError } = await supabase.from("profiles").update({ timezone, display_name: displayName }).eq("id", (await supabase.auth.getUser()).data.user?.id);
      if (profileError) throw new Error(profileError.message);
      const account = await loadAccount(supabase);
      if (!account?.org || !account.profile) throw new Error("Could not create the business.");
      return { org: account.org, profile: account.profile };
    },
    async joinOrg(code: string, displayName: string, timezone: string) {
      const { error } = await supabase.rpc("join_org", { code, display_name: displayName });
      if (error) throw new Error(error.message);
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const { error: profileError } = await supabase.from("profiles").update({ timezone, display_name: displayName }).eq("id", userId);
      if (profileError) throw new Error(profileError.message);
      const account = await loadAccount(supabase);
      if (!account?.org || !account.profile) throw new Error("Could not join.");
      return { org: account.org, profile: account.profile };
    },
    async regenerateCode() {
      const { data, error } = await supabase.rpc("regenerate_invite_code");
      if (error) throw new Error(error.message);
      return String(data);
    },
    async removeMember(memberId: string) {
      const { error } = await supabase.rpc("remove_member", { member_id: memberId });
      if (error) throw new Error(error.message);
    },
    async updateProfile(patch: Partial<Profile>) {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const row: Record<string, unknown> = {};
      if (patch.displayName != null) row.display_name = patch.displayName;
      if (patch.timezone != null) row.timezone = patch.timezone;
      if (patch.notifyEnabled != null) row.notify_enabled = patch.notifyEnabled;
      if (patch.notifyMinute != null) row.notify_minute = patch.notifyMinute;
      const { data, error } = await supabase.from("profiles").update(row).eq("id", userId).select("*").single();
      if (error) throw new Error(error.message);
      return mapProfile(data);
    },
    async pull(cursor: string | null): Promise<Pull> {
      const { data: serverTime, error: timeError } = await supabase.rpc("server_now");
      if (timeError) throw new Error(timeError.message);
      let leadQuery = supabase.from("leads").select("*").order("updated_at");
      if (cursor) leadQuery = leadQuery.gt("updated_at", cursor);
      const [{ data: leadRows, error: leadError }, { data: profileRows, error: profileError }, account] = await Promise.all([
        leadQuery,
        supabase.from("profiles").select("*"),
        loadAccount(supabase),
      ]);
      if (leadError) throw new Error(leadError.message);
      if (profileError) throw new Error(profileError.message);
      if (!account?.org) throw new Error("Join a business first.");
      return {
        serverTime: String(serverTime),
        leads: (leadRows ?? []).map((row) => mapLead(row)),
        profiles: (profileRows ?? []).map((row) => mapProfile(row)),
        org: account.org,
      };
    },
    async pushLead(lead: Lead, baseVersion: number | null): Promise<PushResult> {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? lead.updatedBy;
      const row = toRow(lead, userId);
      if (baseVersion == null) {
        const { data, error } = await supabase.from("leads").insert(row).select("*").single();
        if (error) throw new Error(error.message);
        return { ok: true, lead: mapLead(data) };
      }
      const { data, error } = await supabase.from("leads").update(row).eq("id", lead.id).eq("version", baseVersion).select("*").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        const current = await supabase.from("leads").select("*").eq("id", lead.id).maybeSingle();
        return {
          ok: false,
          lead: current.data ? mapLead(current.data) : null,
          deleted: Boolean(current.data?.deleted_at) || !current.data,
        };
      }
      return { ok: true, lead: mapLead(data) };
    },
    async vapidPublicKey() {
      return import.meta.env.VITE_VAPID_PUBLIC_KEY || null;
    },
    async saveSubscription(subscription: PushSubscriptionJSON) {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys?.p256dh,
          auth: subscription.keys?.auth,
        },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
    },
    subscribe(onChange: () => void) {
      let orgId = "";
      const channel = supabase.channel("bph-book");
      void loadAccount(supabase).then((account) => {
        orgId = account?.org?.id ?? "";
        if (!orgId) return;
        channel
          .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `org_id=eq.${orgId}` }, () => onChange())
          .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `org_id=eq.${orgId}` }, () => onChange())
          .subscribe();
      });
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
