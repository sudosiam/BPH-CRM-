import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "node:crypto";
import webpush from "npm:web-push@3.6.7";
import { digestCounts, digestLine, shouldSendDigest, todayISO } from "../../../shared/book.mjs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function authorized(req: Request) {
  const expected = Deno.env.get("BPH_FUNCTION_KEY") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const header = req.headers.get("authorization") ?? "";
  const matched = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const bearer = matched?.[1] ?? "";
  if (!expected || !bearer) return false;
  if (anon && safeEqual(bearer, anon)) return false;
  return safeEqual(bearer, expected);
}

Deno.serve(async (req) => {
  if (!authorized(req)) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  if (!publicKey || !privateKey) return json({ error: "Could not send reminders." }, 500);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:reminders@bph.local", publicKey, privateKey);

  const purged = await supabase.rpc("purge_tombstones");
  if (purged.error) return json({ error: "Could not send reminders." }, 500);

  const now = new Date();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, org_id, timezone, notify_minute, last_digest_on")
    .eq("notify_enabled", true)
    .is("removed_at", null);
  if (error) return json({ error: "Could not send reminders." }, 500);

  let sent = 0;
  for (const profile of profiles ?? []) {
    const timeZone = profile.timezone || "UTC";
    const today = todayISO(timeZone, now);
    const { data: leads, error: leadError } = await supabase
      .from("leads")
      .select("follow_up_on, status, deleted_at, owner_id")
      .eq("org_id", profile.org_id)
      .eq("owner_id", profile.id)
      .in("status", ["lead", "qualified"])
      .is("deleted_at", null);
    if (leadError) return json({ error: "Could not send reminders." }, 500);

    const counts = digestCounts(
      (leads ?? []).map((lead) => ({
        followUpOn: lead.follow_up_on,
        status: lead.status,
        deletedAt: lead.deleted_at,
        ownerId: lead.owner_id,
      })),
      today,
      profile.id,
    );
    const dueCount = counts.today + counts.overdue;
    if (
      !shouldSendDigest({
        notifyEnabled: true,
        notifyMinute: profile.notify_minute,
        timeZone,
        lastDigestOn: profile.last_digest_on,
        now,
        dueCount,
      })
    ) {
      continue;
    }

    const body = digestLine(counts.today, counts.overdue);
    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", profile.id);
    let delivered = 0;
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: "Follow-ups", body }),
        );
        delivered += 1;
        sent += 1;
      } catch (pushError) {
        const status = (pushError as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
    if (delivered > 0) {
      await supabase.from("profiles").update({ last_digest_on: today }).eq("id", profile.id);
    }
  }

  return json({ sent });
});
