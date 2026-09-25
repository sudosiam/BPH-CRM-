# BPH CRM

A mobile CRM for one shared book of leads. Each lead is **Lead**, **Sold**, or **Lost**. Follow-up is a date. The owner of a lead gets a morning alert when something is overdue or due today.

Open the app, create an account, and start a business. Teammates join with the invite code on the You tab. The first sign-in copies the whole book onto the phone. After that, Today opens from that copy and syncs in the background.

## Run it

```bash
npm install
npm start
```

`npm start` builds the app and serves it with the shared book on port 8787. Accounts, invites, lead sync, and morning web-push digests all live in that process. Data is stored in `server/data/book.json`.

`npm test` checks accounts, invites, sync, conflicts, and the digest rules. `npm run dev` runs the API and the Vite app together.

## Supabase

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then rebuild. The app uses Supabase Auth, the SQL in `supabase/migrations`, and Realtime instead of the included server. Schedule `supabase/functions/followup-digest` hourly with the service role and the same VAPID keys the app uses.

## Vercel

Import this repo in Vercel with the root directory as the repository root. `vercel.json` builds `apps/web` and publishes `apps/web/dist`. Add these environment variables before the first deploy, then redeploy:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

In the Supabase dashboard, add the Vercel address under Authentication → URL configuration so sign-up confirmation can return to the site.

## Design

The visual spec and product rules are in [docs/DESIGN.md](docs/DESIGN.md). The clickable prototype in `prototype/` is the earlier design pass.
