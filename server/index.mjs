import { createServer } from "node:http";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import {
  INVITE_ALPHABET,
  normalizeCode,
  todayISO,
  digestCounts,
  digestLine,
  shouldSendDigest,
} from "../shared/book.mjs";

const scryptAsync = promisify(scrypt);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "apps/web/dist");

export function createBook(dataFile) {
  mkdirSync(path.dirname(dataFile), { recursive: true });
  const state = existsSync(dataFile)
    ? JSON.parse(readFileSync(dataFile, "utf8"))
    : {
        users: [],
        sessions: [],
        orgs: [],
        profiles: [],
        leads: [],
        subscriptions: [],
        digests: {},
        vapid: null,
      };
  if (!state.digests) state.digests = {};
  if (!state.subscriptions) state.subscriptions = [];
  if (!state.vapid) {
    state.vapid = webpush.generateVAPIDKeys();
    persist();
  }
  webpush.setVapidDetails("mailto:reminders@bph.local", state.vapid.publicKey, state.vapid.privateKey);

  let chain = Promise.resolve();
  function mutate(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  function persist() {
    writeFileSync(dataFile, JSON.stringify(state));
  }

  const streams = new Set();
  function broadcast(orgId) {
    const payload = `data: ${JSON.stringify({ orgId })}\n\n`;
    for (const stream of streams) {
      if (stream.orgId === orgId) stream.res.write(payload);
    }
  }

  function publicProfile(profile) {
    return {
      id: profile.id,
      orgId: profile.orgId,
      displayName: profile.displayName,
      role: profile.role,
      timezone: profile.timezone,
      notifyEnabled: profile.notifyEnabled,
      notifyMinute: profile.notifyMinute,
      removedAt: profile.removedAt,
    };
  }

  function publicOrg(org, role) {
    return {
      id: org.id,
      name: org.name,
      inviteCode: role === "owner" ? org.inviteCode : null,
    };
  }

  function publicLead(lead) {
    return { ...lead };
  }

  function sessionUser(token) {
    const session = state.sessions.find((item) => item.token === token && item.expiresAt > Date.now());
    if (!session) return null;
    const user = state.users.find((item) => item.id === session.userId);
    if (!user) return null;
    const profile = state.profiles.find((item) => item.id === user.id) ?? null;
    if (profile?.removedAt) return { user, profile: null, org: null, session, removed: true };
    const org = profile ? state.orgs.find((item) => item.id === profile.orgId) ?? null : null;
    return { user, profile, org, session, removed: false };
  }

  function authFrom(req, url) {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = bearer || url.searchParams.get("token") || "";
    return sessionUser(token);
  }

  async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    const buf = await scryptAsync(password, salt, 32);
    return { salt, hash: Buffer.from(buf).toString("hex") };
  }

  function verifyPassword(password, user) {
    return hashPassword(password, user.salt).then(({ hash }) =>
      timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex")),
    );
  }

  function makeCode() {
    const bytes = randomBytes(8);
    let code = "";
    for (let i = 0; i < 8; i += 1) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
    return code;
  }

  function freshCode() {
    let code = makeCode();
    while (state.orgs.some((org) => org.inviteCode === code)) code = makeCode();
    return code;
  }

  const attempts = new Map();
  function limited(key, max) {
    const now = Date.now();
    const row = attempts.get(key) ?? { count: 0, reset: now + 15 * 60 * 1000 };
    if (row.reset < now) {
      row.count = 0;
      row.reset = now + 15 * 60 * 1000;
    }
    row.count += 1;
    attempts.set(key, row);
    return row.count > max;
  }

  function requireMember(auth) {
    if (!auth) return { status: 401, body: { error: "Sign in again." } };
    if (!auth.profile || !auth.org) return { status: 400, body: { error: "Join a business first." } };
    return null;
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
    });
  }

  function send(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(payload);
  }

  function accountBody(auth, token) {
    return {
      token,
      user: { id: auth.user.id, email: auth.user.email, displayName: auth.user.displayName },
      profile: auth.profile ? publicProfile(auth.profile) : null,
      org: auth.org ? publicOrg(auth.org, auth.profile?.role) : null,
    };
  }

  function validateLead(input, auth) {
    const name = String(input.name ?? "").trim();
    const phone = String(input.phone ?? "").trim();
    const notes = String(input.notes ?? "");
    const status = input.status;
    if (name.length < 1 || name.length > 120) return "Add a name.";
    if (phone.length > 40) return "Phone is too long.";
    if (notes.length > 2000) return "Notes are too long.";
    if (!["lead", "sold", "lost"].includes(status)) return "Unknown status.";
    if (status !== "lead" && input.followUpOn) return "Sold and lost leads cannot have a follow-up.";
    if (status === "lead" && input.closedOn) return "An open lead cannot have a closed date.";
    const owner = state.profiles.find(
      (profile) => profile.id === input.ownerId && profile.orgId === auth.org.id && !profile.removedAt,
    );
    if (!owner) return "Choose an owner on the team.";
    return null;
  }

  async function sendDueDigests(now = new Date()) {
    for (const profile of state.profiles) {
      if (!profile.notifyEnabled || profile.removedAt) continue;
      const leads = state.leads.filter((lead) => lead.orgId === profile.orgId);
      const today = todayISO(profile.timezone || "UTC", now);
      const counts = digestCounts(leads, profile.id, today);
      const dueCount = counts.today + counts.overdue;
      if (
        !shouldSendDigest({
          notifyEnabled: true,
          notifyMinute: profile.notifyMinute,
          timeZone: profile.timezone || "UTC",
          lastDigestOn: state.digests[profile.id] ?? null,
          now,
          dueCount,
        })
      ) {
        continue;
      }
      const body = digestLine(counts.today, counts.overdue);
      const subs = state.subscriptions.filter((item) => item.userId === profile.id);
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: "Follow-ups", body }),
          );
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            state.subscriptions = state.subscriptions.filter((item) => item.endpoint !== sub.endpoint);
          }
        }
      }
      state.digests[profile.id] = today;
      persist();
    }
  }

  async function handler(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, url);
      } catch (error) {
        console.error(error);
        if (!res.headersSent) send(res, 500, { error: "Something went wrong." });
      }
      return;
    }
    serveStatic(req, res, url);
  }

  async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/push/vapid") {
      send(res, 200, { publicKey: state.vapid.publicKey });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sync/stream") {
      const auth = authFrom(req, url);
      const denied = requireMember(auth);
      if (denied) {
        send(res, denied.status, denied.body);
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("\n");
      const stream = { res, orgId: auth.org.id };
      streams.add(stream);
      req.on("close", () => streams.delete(stream));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/signup") {
      const body = await readJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const displayName = String(body.displayName ?? "").trim();
      if (!email.includes("@") || email.length > 120) return send(res, 400, { error: "Enter a valid email." });
      if (password.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
      if (displayName.length < 1 || displayName.length > 80) return send(res, 400, { error: "Add your name." });
      if (state.users.some((user) => user.email === email)) return send(res, 400, { error: "That email is already registered." });
      const { salt, hash } = await hashPassword(password);
      const user = { id: crypto.randomUUID(), email, displayName, salt, hash };
      const token = randomBytes(24).toString("hex");
      await mutate(async () => {
        state.users.push(user);
        state.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
        persist();
      });
      send(res, 200, accountBody({ user, profile: null, org: null }, token));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/signin") {
      const body = await readJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (limited(`signin:${email}`, 20)) return send(res, 429, { error: "Too many tries. Wait a few minutes." });
      const user = state.users.find((item) => item.email === email);
      if (!user || !(await verifyPassword(password, user))) return send(res, 401, { error: "Email or password is wrong." });
      const token = randomBytes(24).toString("hex");
      await mutate(async () => {
        state.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
        persist();
      });
      const auth = sessionUser(token);
      if (auth?.removed) {
        await mutate(async () => {
          state.sessions = state.sessions.filter((item) => item.token !== token);
          persist();
        });
        return send(res, 403, { error: "You no longer have access to this business." });
      }
      send(res, 200, accountBody(auth, token));
      return;
    }

    const auth = authFrom(req, url);

    if (req.method === "POST" && url.pathname === "/api/auth/signout") {
      if (auth) {
        await mutate(async () => {
          state.sessions = state.sessions.filter((item) => item.token !== auth.session.token);
          persist();
        });
      }
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      if (!auth) return send(res, 401, { error: "Sign in again." });
      if (auth.removed) return send(res, 403, { error: "You no longer have access to this business." });
      send(res, 200, accountBody(auth, auth.session.token));
      return;
    }

    if (!auth) return send(res, 401, { error: "Sign in again." });

    if (req.method === "POST" && url.pathname === "/api/orgs") {
      if (state.profiles.some((item) => item.id === auth.user.id)) {
        return send(res, 400, { error: "You already belong to a business." });
      }
      const body = await readJson(req);
      const name = String(body.name ?? "").trim();
      const displayName = String(body.displayName ?? auth.user.displayName).trim();
      if (name.length < 1 || name.length > 80) return send(res, 400, { error: "Add a business name." });
      if (displayName.length < 1 || displayName.length > 80) return send(res, 400, { error: "Add your name." });
      const org = {
        id: crypto.randomUUID(),
        name,
        inviteCode: "",
        createdBy: auth.user.id,
        createdAt: new Date().toISOString(),
      };
      const profile = {
        id: auth.user.id,
        orgId: org.id,
        displayName,
        role: "owner",
        timezone: String(body.timezone || "UTC").slice(0, 64),
        notifyEnabled: false,
        notifyMinute: 480,
        removedAt: null,
      };
      await mutate(async () => {
        org.inviteCode = freshCode();
        auth.user.displayName = displayName;
        state.orgs.push(org);
        state.profiles.push(profile);
        persist();
      });
      send(res, 200, { org: publicOrg(org, "owner"), profile: publicProfile(profile) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orgs/join") {
      if (state.profiles.some((item) => item.id === auth.user.id)) {
        return send(res, 400, { error: "You already belong to a business." });
      }
      if (limited(`join:${auth.user.id}`, 10)) return send(res, 429, { error: "Too many tries. Wait a few minutes." });
      const body = await readJson(req);
      const code = normalizeCode(body.code);
      const displayName = String(body.displayName ?? auth.user.displayName).trim();
      const org = state.orgs.find((item) => item.inviteCode === code);
      if (!org) return send(res, 400, { error: "That code does not match a business." });
      if (displayName.length < 1 || displayName.length > 80) return send(res, 400, { error: "Add your name." });
      const profile = {
        id: auth.user.id,
        orgId: org.id,
        displayName,
        role: "member",
        timezone: String(body.timezone || "UTC").slice(0, 64),
        notifyEnabled: false,
        notifyMinute: 480,
        removedAt: null,
      };
      await mutate(async () => {
        auth.user.displayName = displayName;
        state.profiles.push(profile);
        persist();
      });
      broadcast(org.id);
      send(res, 200, { org: publicOrg(org, "member"), profile: publicProfile(profile) });
      return;
    }

    const denied = requireMember(auth);
    if (denied) return send(res, denied.status, denied.body);

    if (req.method === "POST" && url.pathname === "/api/orgs/invite/regenerate") {
      if (auth.profile.role !== "owner") return send(res, 403, { error: "Only the owner can change the code." });
      const code = freshCode();
      await mutate(async () => {
        auth.org.inviteCode = code;
        persist();
      });
      send(res, 200, { inviteCode: code });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orgs/members/remove") {
      if (auth.profile.role !== "owner") return send(res, 403, { error: "Only the owner can remove someone." });
      const body = await readJson(req);
      if (body.memberId === auth.user.id) return send(res, 400, { error: "You cannot remove yourself." });
      const member = state.profiles.find((item) => item.id === body.memberId && item.orgId === auth.org.id && !item.removedAt);
      if (!member) return send(res, 404, { error: "That person is not on the team." });
      const now = new Date().toISOString();
      await mutate(async () => {
        for (const lead of state.leads) {
          if (lead.orgId === auth.org.id && lead.ownerId === member.id && !lead.deletedAt) {
            lead.ownerId = auth.user.id;
            lead.updatedBy = auth.user.id;
            lead.version += 1;
            lead.updatedAt = now;
          }
        }
        member.removedAt = now;
        state.sessions = state.sessions.filter((item) => item.userId !== member.id);
        persist();
      });
      broadcast(auth.org.id);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/profile") {
      const body = await readJson(req);
      await mutate(async () => {
        if (body.displayName != null) {
          const displayName = String(body.displayName).trim();
          if (displayName.length < 1 || displayName.length > 80) throw Object.assign(new Error("Add your name."), { status: 400 });
          auth.profile.displayName = displayName;
          auth.user.displayName = displayName;
        }
        if (body.timezone != null) auth.profile.timezone = String(body.timezone).slice(0, 64) || "UTC";
        if (body.notifyEnabled != null) auth.profile.notifyEnabled = Boolean(body.notifyEnabled);
        if (body.notifyMinute != null) {
          const minute = Number(body.notifyMinute);
          if (!Number.isInteger(minute) || minute < 0 || minute > 1439) {
            throw Object.assign(new Error("Pick a reminder time."), { status: 400 });
          }
          auth.profile.notifyMinute = minute;
        }
        persist();
      }).catch((error) => {
        send(res, error.status || 500, { error: error.message || "Could not save." });
        throw new Error("sent");
      });
      if (res.headersSent) return;
      broadcast(auth.org.id);
      send(res, 200, { profile: publicProfile(auth.profile) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sync/pull") {
      const cursor = url.searchParams.get("cursor");
      const serverTime = new Date().toISOString();
      const leads = state.leads.filter((lead) => lead.orgId === auth.org.id && (!cursor || lead.updatedAt > cursor));
      const profiles = state.profiles.filter((profile) => profile.orgId === auth.org.id);
      send(res, 200, {
        serverTime,
        leads: leads.map(publicLead),
        profiles: profiles.map(publicProfile),
        org: publicOrg(auth.org, auth.profile.role),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/leads") {
      const body = await readJson(req);
      const input = body.lead ?? {};
      const problem = validateLead(input, auth);
      if (problem) return send(res, 400, { error: problem });
      const now = new Date().toISOString();
      const existing = state.leads.find((lead) => lead.id === input.id);
      if (!existing) {
        if (body.baseVersion != null) return send(res, 409, { error: "conflict", lead: null, deleted: true });
        const lead = {
          id: String(input.id),
          orgId: auth.org.id,
          name: String(input.name).trim(),
          phone: String(input.phone ?? "").trim(),
          notes: String(input.notes ?? ""),
          status: input.status,
          followUpOn: input.followUpOn || null,
          closedOn: input.closedOn || null,
          ownerId: input.ownerId,
          createdBy: auth.user.id,
          updatedBy: auth.user.id,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        await mutate(async () => {
          state.leads.push(lead);
          persist();
        });
        broadcast(auth.org.id);
        send(res, 200, { lead: publicLead(lead) });
        return;
      }
      if (existing.orgId !== auth.org.id) return send(res, 404, { error: "This lead is gone." });
      if (existing.deletedAt) return send(res, 409, { error: "conflict", lead: publicLead(existing), deleted: true });
      if (existing.version !== body.baseVersion) {
        return send(res, 409, { error: "conflict", lead: publicLead(existing), deleted: false });
      }
      await mutate(async () => {
        existing.name = String(input.name).trim();
        existing.phone = String(input.phone ?? "").trim();
        existing.notes = String(input.notes ?? "");
        existing.status = input.status;
        existing.followUpOn = input.followUpOn || null;
        existing.closedOn = input.closedOn || null;
        existing.ownerId = input.ownerId;
        existing.updatedBy = auth.user.id;
        existing.version += 1;
        existing.updatedAt = now;
        if (input.deletedAt) existing.deletedAt = now;
        persist();
      });
      broadcast(auth.org.id);
      send(res, 200, { lead: publicLead(existing) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/push/subscribe") {
      const body = await readJson(req);
      if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return send(res, 400, { error: "Missing push subscription." });
      }
      await mutate(async () => {
        state.subscriptions = state.subscriptions.filter((item) => item.endpoint !== body.endpoint && item.userId !== auth.user.id);
        state.subscriptions.push({
          userId: auth.user.id,
          endpoint: body.endpoint,
          keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
        });
        persist();
      });
      send(res, 200, { ok: true });
      return;
    }

    send(res, 404, { error: "Not found." });
  }

  function serveStatic(req, res, url) {
    if (!existsSync(distDir)) {
      send(res, 503, { error: "App build is missing. Run npm start from the repo root." });
      return;
    }
    const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = path.resolve(distDir, requested);
    const safe = filePath.startsWith(`${distDir}${path.sep}`) && existsSync(filePath) && statSync(filePath).isFile();
    const target = safe ? filePath : path.join(distDir, "index.html");
    const ext = path.extname(target);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".webmanifest": "application/manifest+json",
    };
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    createReadStream(target).pipe(res);
  }

  const timer = setInterval(() => {
    sendDueDigests().catch((error) => console.error(error));
  }, 30_000);
  timer.unref?.();

  return { handler, sendDueDigests, state };
}

export function startServer({ port = 8787, dataFile } = {}) {
  const file = dataFile || path.join(root, "server/data/book.json");
  const book = createBook(file);
  const server = createServer(book.handler);
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : port, book });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  startServer({ port }).then(({ port: listening }) => {
    console.log(`BPH listening on ${listening}`);
  });
}
