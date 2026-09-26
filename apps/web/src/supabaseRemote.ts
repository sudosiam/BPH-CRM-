import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeTags, pullSince } from "@shared/book.mjs";
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
    soldAmount: row.sold_amount == null ? null : Number(row.sold_amount),
    lostReason: (row.lost_reason as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    tags: normalizeTags(row.tags),
    lastContactAt: (row.last_contact_at as string | null) ?? null,
    contactCount: Number(row.contact_count ?? 0),
    history: String(row.history ?? ""),
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
    waTemplate: row.wa_template ? String(row.wa_template) : null,
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
    sold_amount: lead.soldAmount,
    lost_reason: lead.lostReason,
    source: lead.source,
    tags: normalizeTags(lead.tags),
    last_contact_at: lead.lastContactAt,
    contact_count: lead.contactCount || 0,
    history: lead.history || "",
  };
}

const LEAD_EXTRAS = ["sold_amount", "lost_reason", "source", "tags", "last_contact_at", "contact_count", "history"] as const;

function withoutLeadExtras(row: Record<string, unknown>) {
  const slim = { ...row };
  for (const key of LEAD_EXTRAS) delete slim[key];
  return slim;
}

function missingColumn(error: { message?: string } | null) {
  return /column|schema cache/i.test(error?.message || "");
}

function appReturnUrl() {
  return new URL(import.meta.env.BASE_URL || "/", window.location.origin).href;
}

function isNetworkError(error: { message?: string } | null) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("fetch") || message.includes("network") || message.includes("offline") || message.includes("load failed");
}

async function everyRow(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>,
) {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Could not copy the book.");
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
    if (from >= 200_000) throw new Error("The book is too large to copy in one pass.");
  }
}

async function membershipFromBook(supabase: SupabaseClient, userId: string): Promise<{ profile: Profile; org: Org } | null> {
  const { data, error } = await supabase.rpc("my_book");
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row !== "object") return null;
  if (!row.org_id) return null;
  const role = row.role === "owner" ? "owner" : "member";
  return {
    profile: {
      id: userId,
      orgId: String(row.org_id),
      displayName: String(row.display_name || "Teammate"),
      role,
      timezone: String(row.timezone || "UTC"),
      notifyEnabled: row.notify_enabled !== false,
      notifyMinute: Number(row.notify_minute ?? 480),
      removedAt: null,
    },
    org: {
      id: String(row.org_id),
      name: String(row.org_name || "Your book"),
      inviteCode: role === "owner" && row.invite_code ? String(row.invite_code) : null,
      waTemplate: row.wa_template ? String(row.wa_template) : null,
    },
  };
}

async function loadAccount(supabase: SupabaseClient): Promise<Account | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const session = data.session;
  if (!session) return null;
  const profileResult = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (profileResult.error && isNetworkError(profileResult.error)) throw new Error(profileResult.error.message);
  const profileRow = profileResult.error ? null : profileResult.data;
  const removed = Boolean(profileRow && profileRow.removed_at);
  let profile = profileRow && !profileRow.removed_at ? mapProfile(profileRow) : null;
  let org: Org | null = null;
  if (profile) {
    let orgResult = await supabase.from("orgs_visible").select("id, name, invite_code").eq("id", profile.orgId).maybeSingle();
    if (orgResult.error) orgResult = await supabase.from("orgs").select("id, name, invite_code").eq("id", profile.orgId).maybeSingle();
    if (orgResult.error && isNetworkError(orgResult.error)) throw new Error(orgResult.error.message);
    org = !orgResult.error && orgResult.data ? mapOrg(orgResult.data, profile.role) : null;
  }
  if (!removed && (!profile || !org)) {
    const found = await membershipFromBook(supabase, session.user.id);
    if (found) {
      profile = profile ?? found.profile;
      org = org ?? found.org;
    }
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? "",
      displayName: profile?.displayName || String(session.user.user_metadata?.display_name ?? ""),
    },
    profile,
    org,
    removed,
  };
}

export function createSupabaseRemote() {
  const supabase = createClient(resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL), import.meta.env.VITE_SUPABASE_ANON_KEY || "", {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let recovery = false;
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") recovery = true;
  });

  return {
    async signUp(email: string, password: string, displayName: string) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: appReturnUrl(),
        },
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
      await supabase.auth.signOut({ scope: "local" });
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
      const name = displayName.trim();
      const { error } = await supabase.rpc("join_org", { code, display_name: name });
      if (error) throw new Error(error.message);
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const patch: Record<string, string> = { timezone };
      if (name) patch.display_name = name;
      await supabase.from("profiles").update(patch).eq("id", userId);
      const account = await loadAccount(supabase);
      if (!account?.org || !account.profile) throw new Error("Could not join. Check the code and try again.");
      return { org: account.org, profile: account.profile };
    },
    async setWaTemplate(template: string) {
      const { data, error } = await supabase.rpc("set_wa_template", { template });
      if (error) throw new Error(error.message);
      return String(data ?? "");
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
    async transferOwner(memberId: string) {
      const { error } = await supabase.rpc("transfer_owner", { member_id: memberId });
      if (error) throw new Error(error.message);
    },
    async requestPasswordReset(email: string) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appReturnUrl() });
      if (error) throw new Error(error.message);
      return { sent: true, message: "Check your email for a link to choose a new password." };
    },
    async passwordRecovery() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const inUrl = hash.get("type") === "recovery" || query.get("type") === "recovery";
      await supabase.auth.getSession();
      const pending = recovery || inUrl;
      if (pending) window.history.replaceState(null, "", window.location.pathname);
      return pending;
    },
    async updatePassword(password: string) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      recovery = false;
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
      const since = pullSince(cursor);
      const [leadRows, profileRows, account] = await Promise.all([
        everyRow((from, to) => {
          let query = supabase.from("leads").select("*").order("updated_at", { ascending: true }).order("id", { ascending: true });
          if (since) query = query.gt("updated_at", since);
          return query.range(from, to);
        }),
        everyRow((from, to) => supabase.from("profiles").select("*").order("id", { ascending: true }).range(from, to)),
        loadAccount(supabase),
      ]);
      if (!account?.org) throw new Error("Join a business first.");
      const { data: serverTime, error: timeError } = await supabase.rpc("server_now");
      if (timeError) throw new Error(timeError.message);
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
        let { data, error } = await supabase.from("leads").insert(row).select("*").single();
        if (error && missingColumn(error)) {
          const retry = await supabase.from("leads").insert(withoutLeadExtras(row)).select("*").single();
          data = retry.data;
          error = retry.error;
        }
        if (!error && data) return { ok: true, lead: mapLead(data) };
        const duplicate = error?.code === "23505" || /duplicate key/i.test(error?.message || "");
        if (duplicate) {
          const current = await supabase.from("leads").select("*").eq("id", lead.id).maybeSingle();
          if (current.error) throw new Error(current.error.message);
          if (current.data) {
            return { ok: false, lead: mapLead(current.data), deleted: Boolean(current.data.deleted_at) };
          }
        }
        throw new Error(error?.message || "Could not sync.");
      }
      let { data, error } = await supabase.from("leads").update(row).eq("id", lead.id).eq("version", baseVersion).select("*").maybeSingle();
      if (error && missingColumn(error)) {
        const retry = await supabase.from("leads").update(withoutLeadExtras(row)).eq("id", lead.id).eq("version", baseVersion).select("*").maybeSingle();
        data = retry.data;
        error = retry.error;
      }
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
    async sendTestPush() {
      const { data, error } = await supabase.functions.invoke("test-push", { body: {} });
      if (error) throw new Error(error.message || "Could not send a test alert.");
      const sent = data && typeof data === "object" && "sent" in data ? Number(data.sent) : 0;
      return Number.isFinite(sent) ? sent : 0;
    },
    async saveSubscription(subscription: PushSubscriptionJSON) {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const saved = await supabase.rpc("save_push_subscription", {
        p_endpoint: subscription.endpoint,
        p_p256dh: subscription.keys?.p256dh,
        p_auth: subscription.keys?.auth,
      });
      if (!saved.error) return;
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
      const channel = supabase.channel("bph-book");
      void loadAccount(supabase)
        .then((account) => {
          const orgId = account?.org?.id ?? "";
          const userId = account?.user.id ?? "";
          if (!orgId) return;
          channel
            .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `org_id=eq.${orgId}` }, (payload) => {
              const row = payload.new as { updated_by?: string } | null;
              if (row?.updated_by && row.updated_by === userId) return;
              onChange();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `org_id=eq.${orgId}` }, () => onChange())
            .subscribe();
        })
        .catch(() => {});
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
