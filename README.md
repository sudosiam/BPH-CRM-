# BPH CRM

A mobile CRM for one shared book of leads. Each lead is **Lead**, **Qualified**, **Sold**, or **Lost**. Follow-up is a date on an open lead (Lead or Qualified). The owner of a lead gets a morning alert when one of their own leads is overdue or due today.

Open the app, create an account, and start a business. Teammates join with the invite code on the You screen. The first sign-in copies the whole book onto the phone. After that, Today opens from that copy and syncs in the background.

Screens are Today, Leads (Lead, Qualified, Sold, Lost), and Customers. Profile, team, reminders, and sign-out are on You.

## Run it

```bash
npm install
npm start
```

`npm start` builds the app and serves it with the shared book on port 8787. Built files live under `apps/web/dist` and are served at `/crm/`, including `/crm/assets`. Accounts, invites, lead sync, and morning web-push digests all live in that process. Data is stored in `server/data/book.json`.

`npm test` checks accounts, invites, sync, conflicts, and the digest rules. `npm run dev` runs the API and the Vite app together.

When `BPH_SMTP_HOST` is unset, signup does not send or require a confirmation email, and password reset does not send mail. That is what local use and the tests rely on. The owner can set a teammate's password from their profile on this server. Set SMTP only when you want reset email, and do not turn on confirmation in a hosted auth provider unless mail is actually configured.

Password reset links use `BPH_PUBLIC_URL` (for example `https://example.com`). The server ignores `Host` and `X-Forwarded-Proto`. If that URL is missing, no reset link is sent. SMTP uses TLS (`requireTLS` on the usual ports, and implicit TLS on port 465).

`book.json`, its temp file, and its `.bak` are written mode 0600. Session tokens are stored as hashes. Prefer `BPH_VAPID_PUBLIC_KEY` and `BPH_VAPID_PRIVATE_KEY` (or `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`) so a new private key is not written into the book file.

The Node server sends `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and a content security policy. `script-src` is same-origin. `style-src` still allows inline styles because the boot screen and row colors use them. HSTS is not set on the Node server, because it may be plain HTTP. Vercel, which is HTTPS, sends HSTS.

## Supabase

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then rebuild. The app uses Supabase Auth, the SQL in `supabase/migrations`, and Realtime instead of the included server. Those migrations are the schema contract.

Schedule `supabase/functions/followup-digest` with the same VAPID keys the app uses. The function rejects callers that do not send `Authorization: Bearer <BPH_FUNCTION_KEY>`. Put that same value in Supabase Vault as `bph_function_key`, and set the edge function secret `BPH_FUNCTION_KEY` to match. The public anon key is not accepted.

The digest cron migration schedules the function only when `bph_function_key` is in the vault and the project URL is available as the database setting `app.supabase_url` or the vault secret `supabase_url`. If the job is not scheduled, set those values and run the latest migration again. Otherwise, in the Supabase dashboard, point the `followup-digest` cron at `https://<project-ref>.supabase.co/functions/v1/followup-digest` with that bearer. Do not call the function with the anon key.

Apply the migrations in the Supabase SQL editor or CLI for project `peokaompmxeoxidupvfs` (or your own project). `purge_tombstones` is executable only by `service_role`. `server_now` stays callable with the anon key so the keepalive cron can ping it.

On the included server, an owner can set a teammate's password. With Supabase that control is hidden. Ask the person to use Forgot password. There is no admin password takeover.

## Vercel

Set the Vercel project **Root Directory** to `apps/web`. That folder contains `vercel.json`. It builds the Vite app and publishes `dist`. Do not use the repository root as the Vercel root; there is no root `vercel.json`.

The production build reads the public Supabase URL and anon key from `apps/web/.env.production`.

The keepalive route is `/api/keepalive`. It returns 401 when `CRON_SECRET` is unset. Vercel Cron should send `Authorization: Bearer <CRON_SECRET>`.

In the Supabase dashboard, add the Vercel address under Authentication → URL configuration so password reset can return to the site.

## Design

The product rules are in [docs/DESIGN.md](docs/DESIGN.md).
