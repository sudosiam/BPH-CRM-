import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

function todayISO(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localMinutes(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

function dayDiff(iso: string, today: string) {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:reminders@bph.local",
    Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
  );

  const now = new Date();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, org_id, timezone, notify_minute, last_digest_on")
    .eq("notify_enabled", true)
    .is("removed_at", null);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const profile of profiles ?? []) {
    const timeZone = profile.timezone || "UTC";
    const today = todayISO(timeZone, now);
    if (profile.last_digest_on === today) continue;
    if (localMinutes(timeZone, now) < profile.notify_minute) continue;

    const { data: leads } = await supabase
      .from("leads")
      .select("follow_up_on, status, deleted_at, owner_id")
      .eq("org_id", profile.org_id)
      .eq("status", "lead")
      .is("deleted_at", null);

    const open = (leads ?? []).filter((lead) => lead.follow_up_on);
    const dueToday = open.filter((lead) => dayDiff(lead.follow_up_on, today) === 0).length;
    const overdue = open.filter((lead) => dayDiff(lead.follow_up_on, today) < 0).length;
    if (dueToday + overdue === 0) continue;

    const parts = [];
    if (dueToday) parts.push(`${dueToday} due today`);
    if (overdue) parts.push(`${overdue} overdue`);
    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", profile.id);
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: "Follow-ups", body: parts.join(" · ") }),
        );
        sent += 1;
      } catch (pushError) {
        const status = (pushError as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
    await supabase.from("profiles").update({ last_digest_on: today }).eq("id", profile.id);
  }

  return new Response(JSON.stringify({ sent }), { headers: { "content-type": "application/json" } });
});
