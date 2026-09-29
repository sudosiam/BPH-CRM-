export default async function handler(request, response) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    response.status(401).json({ ok: false });
    return;
  }
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    response.status(500).json({ ok: false });
    return;
  }
  const result = await fetch(`${url}/rest/v1/rpc/server_now`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!result.ok) {
    response.status(502).json({ ok: false });
    return;
  }
  response.status(200).json({ ok: true });
}
