const site = process.env.BPH_SITE || "https://biswajitpowerhub.in/crm";

function anonKey(source) {
  const keys = source.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) ?? [];
  for (const key of keys) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
      if (payload.role === "anon" && payload.iss === "supabase") return { key, ref: payload.ref };
    } catch {
      /* The next token may be the public database key. */
    }
  }
  return null;
}

async function credentials() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return { url: process.env.SUPABASE_URL.replace(/\/$/, ""), key: process.env.SUPABASE_ANON_KEY };
  }
  const page = await fetch(site);
  if (!page.ok) throw new Error("The website did not open.");
  const html = await page.text();
  const file = html.match(/assets\/index-[^"]+\.js/)?.[0];
  if (!file) throw new Error("The website has no app file.");
  const base = page.url.endsWith("/") ? page.url : `${page.url}/`;
  const bundleUrl = new URL(file, base);
  const bundle = await fetch(bundleUrl);
  if (!bundle.ok) throw new Error("The app file did not open.");
  const source = await bundle.text();
  const found = anonKey(source);
  const url = source.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  if (!found || !url) throw new Error("The app file has no database address.");
  if (found.ref && !url.includes(found.ref)) throw new Error("The database address does not match the key.");
  return { url, key: found.key };
}

const { url, key } = await credentials();
const response = await fetch(`${url}/rest/v1/rpc/server_now`, {
  method: "POST",
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body: "{}",
});
if (!response.ok) {
  console.error(`Database did not answer (${response.status}).`);
  process.exit(1);
}
const time = await response.json();
if (typeof time !== "string" || Number.isNaN(Date.parse(time))) {
  console.error("Database answered without a time.");
  process.exit(1);
}
console.log(`Database is awake. Server time ${time}`);
