import { createServer } from "node:http";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, mkdirSync, existsSync, statSync, createReadStream, openSync, writeSync, fsyncSync, closeSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
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
  pullSince,
  assignCustomerName,
  safeTimeZone,
  LOST_REASONS,
  LEAD_SOURCES,
  normalizeTags,
} from "../shared/book.mjs";

const scryptAsync = promisify(scrypt);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "apps/web/dist");

function readBookFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function createBook(dataFile) {
  mkdirSync(path.dirname(dataFile), { recursive: true });
  const fresh = {
    users: [],
    sessions: [],
    orgs: [],
    profiles: [],
    leads: [],
    subscriptions: [],
    digests: {},
    resets: [],
    vapid: null,
  };
  let state = fresh;
  if (existsSync(dataFile)) {
    try {
      state = readBookFile(dataFile);
    } catch {
      const recovered = readBookFile(`${dataFile}.bak`) || readBookFile(`${dataFile}.tmp`);
      if (!recovered) throw new Error(`Could not read ${dataFile}. The book file is damaged.`);
      state = recovered;
    }
  }
  state = { ...fresh, ...state };
  if (!state.digests) state.digests = {};
  if (!state.subscriptions) state.subscriptions = [];
  if (!state.resets) state.resets = [];
  let lastPersisted = JSON.stringify(state);
  const lockPath = `${dataFile}.lock`;
  if (!state.vapid) {
    const fd = acquireLockSync();
    try {
      reload();
      if (!state.vapid) {
        state.vapid = webpush.generateVAPIDKeys();
        persist();
      }
    } finally {
      releaseLock(fd);
    }
  }
  webpush.setVapidDetails("mailto:reminders@bph.local", state.vapid.publicKey, state.vapid.privateKey);

  let chain = Promise.resolve();
  let inLock = false;

  function pause(ms) {
    const view = new Int32Array(new SharedArrayBuffer(4));
    try {
      Atomics.wait(view, 0, 0, ms);
    } catch {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* A short wait so two servers can share one book file. */
      }
    }
  }

  function tryLock() {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, String(process.pid));
      } catch {
        /* The file itself is the lock. */
      }
      return fd;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 20000) unlinkSync(lockPath);
      } catch {
        /* The other process released it, or still holds it. */
      }
      return null;
    }
  }

  function acquireLockSync() {
    const deadline = Date.now() + 8000;
    for (;;) {
      const fd = tryLock();
      if (fd) return fd;
      if (Date.now() > deadline) throw Object.assign(new Error("The book is busy. Try again."), { status: 503 });
      pause(20);
    }
  }

  async function acquireLock() {
    const deadline = Date.now() + 8000;
    for (;;) {
      const fd = tryLock();
      if (fd) return fd;
      if (Date.now() > deadline) throw Object.assign(new Error("The book is busy. Try again."), { status: 503 });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  function releaseLock(fd) {
    try {
      closeSync(fd);
    } catch {
      /* The lock file is removed next. */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* Already released. */
    }
  }

  function reload() {
    let disk = null;
    try {
      disk = readBookFile(dataFile);
    } catch {
      disk = null;
    }
    if (!disk) {
      try {
        disk = readBookFile(`${dataFile}.bak`) || readBookFile(`${dataFile}.tmp`);
      } catch {
        disk = null;
      }
    }
    if (!disk) return;
    state.users = disk.users || [];
    state.sessions = disk.sessions || [];
    state.orgs = disk.orgs || [];
    state.profiles = disk.profiles || [];
    state.leads = disk.leads || [];
    state.subscriptions = disk.subscriptions || [];
    state.digests = disk.digests || {};
    state.resets = disk.resets || [];
    if (disk.vapid) state.vapid = disk.vapid;
    lastPersisted = JSON.stringify(state);
  }

  function runLocked(fn) {
    if (inLock) return Promise.resolve().then(fn);
    const run = chain.then(async () => {
      const fd = await acquireLock();
      inLock = true;
      try {
        reload();
        const result = await fn();
        persist();
        return result;
      } finally {
        inLock = false;
        releaseLock(fd);
      }
    });
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  function mutate(fn) {
    if (inLock) return Promise.resolve().then(fn);
    return runLocked(fn);
  }
  function persist() {
    const payload = JSON.stringify(state);
    if (payload === lastPersisted) return;
    const tmp = `${dataFile}.tmp`;
    const bak = `${dataFile}.bak`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, payload);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(dataFile)) {
      try {
        copyFileSync(dataFile, bak);
      } catch {
        /* The next good write replaces the backup. */
      }
    }
    renameSync(tmp, dataFile);
    lastPersisted = payload;
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
      waTemplate: org.waTemplate || null,
    };
  }

  function leadExtras(input, current) {
    const rawAmount = input.soldAmount == null || input.soldAmount === "" ? null : Number(input.soldAmount);
    const soldAmount = Number.isFinite(rawAmount) && rawAmount >= 0 ? rawAmount : current?.soldAmount ?? null;
    const lostReason = LOST_REASONS.includes(input.lostReason) ? input.lostReason : input.lostReason == null ? current?.lostReason ?? null : null;
    const source = LEAD_SOURCES.includes(input.source) ? input.source : input.source == null ? current?.source ?? null : null;
    const tags = input.tags == null ? normalizeTags(current?.tags) : normalizeTags(input.tags);
    const contactCount = Number.isInteger(Number(input.contactCount)) ? Number(input.contactCount) : current?.contactCount || 0;
    return {
      soldAmount,
      lostReason,
      source,
      tags,
      lastContactAt: input.lastContactAt || current?.lastContactAt || null,
      contactCount,
      history: String(input.history ?? current?.history ?? "").slice(0, 4000),
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

  function authFrom(req) {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    return sessionUser(bearer);
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
    if (attempts.size > 200) {
      for (const [savedKey, saved] of attempts) {
        if (saved.reset < now) attempts.delete(savedKey);
      }
    }
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
      removed: Boolean(auth.removed),
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
    return null;
  }

  async function sendDueDigests(now = new Date()) {
    for (const profile of state.profiles) {
      if (!profile.notifyEnabled || profile.removedAt) continue;
      const leads = state.leads.filter((lead) => lead.orgId === profile.orgId);
      const today = todayISO(profile.timezone || "UTC", now);
      const counts = digestCounts(leads, today);
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
      let delivered = 0;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: "Follow-ups", body }),
          );
          delivered += 1;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            state.subscriptions = state.subscriptions.filter((item) => item.endpoint !== sub.endpoint);
          }
        }
      }
      if (delivered > 0) {
        state.digests[profile.id] = today;
        persist();
      }
    }
  }

  function hashToken(token) {
    return createHash("sha256").update(String(token)).digest("hex");
  }

  function publicOrigin(req) {
    const configured = String(process.env.BPH_PUBLIC_URL || "").replace(/\/$/, "");
    if (configured) return configured;
    const host = req.headers.host || "localhost";
    const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
    return `${proto}://${host}`;
  }

  async function sendResetEmail(to, link) {
    const host = process.env.BPH_SMTP_HOST;
    if (!host) return false;
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.BPH_SMTP_PORT || 587),
      secure: process.env.BPH_SMTP_SECURE === "1",
      auth: process.env.BPH_SMTP_USER ? { user: process.env.BPH_SMTP_USER, pass: process.env.BPH_SMTP_PASS || "" } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
    await transport.sendMail({
      from: process.env.BPH_SMTP_FROM || "BPH <reminders@bph.local>",
      to,
      subject: "Reset your BPH password",
      text: `Choose a new password:\n${link}\n\nThis link stops working in 30 minutes.`,
    });
    return true;
  }

  async function writePassword(user, password, keepToken) {
    const next = await hashPassword(password);
    user.salt = next.salt;
    user.hash = next.hash;
    state.sessions = state.sessions.filter((item) => item.userId !== user.id || item.token === keepToken);
    state.resets = (state.resets || []).filter((item) => item.userId !== user.id);
  }

  async function handler(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      serveStatic(req, res, url);
      return;
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/sync/stream") {
        const auth = await runLocked(() => authFrom(req));
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
        const beat = setInterval(() => {
          try {
            stream.res.write(":\n\n");
          } catch {
            clearInterval(beat);
          }
        }, 25000);
        req.on("close", () => {
          clearInterval(beat);
          streams.delete(stream);
        });
        return;
      }
      await runLocked(() => handleApi(req, res, url));
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof SyntaxError) {
        send(res, 400, { error: "That request was not valid JSON." });
        return;
      }
      console.error(error);
      send(res, error.status || 500, { error: error.status ? error.message : "Something went wrong." });
    }
  }

  async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/push/vapid") {
      send(res, 200, { publicKey: state.vapid.publicKey });
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
      send(res, 200, accountBody(auth, token));
      return;
    }

    const auth = authFrom(req);

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
      send(res, 200, accountBody(auth, auth.session.token));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/reset") {
      const body = await readJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const user = state.users.find((item) => item.email === email);
      if (!process.env.BPH_SMTP_HOST) {
        return send(res, 200, {
          ok: true,
          sent: false,
          message: "This server has no email. Ask the owner to set a new password for you.",
        });
      }
      if (user) {
        const token = randomBytes(24).toString("hex");
        const expiresAt = Date.now() + 30 * 60 * 1000;
        await mutate(async () => {
          state.resets = (state.resets || []).filter((item) => item.expiresAt > Date.now() && item.userId !== user.id);
          state.resets.push({ tokenHash: hashToken(token), userId: user.id, expiresAt });
          persist();
        });
        try {
          await sendResetEmail(email, `${publicOrigin(req)}/crm/?reset=${token}`);
        } catch (error) {
          console.error(error);
          return send(res, 200, {
            ok: true,
            sent: false,
            message: "The email did not send. Ask the owner to set a new password for you.",
          });
        }
      }
      send(res, 200, { ok: true, sent: true, message: "Check your email for a link to choose a new password." });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/reset/confirm") {
      const body = await readJson(req);
      const password = String(body.password ?? "");
      if (password.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
      const row = (state.resets || []).find((item) => item.tokenHash === hashToken(body.token) && item.expiresAt > Date.now());
      const user = row ? state.users.find((item) => item.id === row.userId) : null;
      if (!user) return send(res, 400, { error: "That link has expired. Ask for a new one." });
      const token = randomBytes(24).toString("hex");
      await mutate(async () => {
        await writePassword(user, password, token);
        state.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
        persist();
      });
      send(res, 200, accountBody(sessionUser(token), token));
      return;
    }

    if (!auth) return send(res, 401, { error: "Sign in again." });

    if (req.method === "POST" && url.pathname === "/api/auth/password") {
      const body = await readJson(req);
      const password = String(body.password ?? "");
      if (password.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
      if (!(await verifyPassword(String(body.currentPassword ?? ""), auth.user))) {
        return send(res, 400, { error: "The current password is wrong." });
      }
      await mutate(async () => {
        await writePassword(auth.user, password, auth.session.token);
        persist();
      });
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orgs") {
      const current = state.profiles.find((item) => item.id === auth.user.id);
      if (current && !current.removedAt) {
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
        waTemplate: null,
        createdBy: auth.user.id,
        createdAt: new Date().toISOString(),
      };
      const profile = current ?? {
        id: auth.user.id,
        orgId: org.id,
        displayName,
        role: "owner",
        timezone: safeTimeZone(body.timezone),
        notifyEnabled: false,
        notifyMinute: 480,
        removedAt: null,
      };
      await mutate(async () => {
        org.inviteCode = freshCode();
        auth.user.displayName = displayName;
        profile.orgId = org.id;
        profile.displayName = displayName;
        profile.role = "owner";
        profile.timezone = safeTimeZone(body.timezone);
        profile.removedAt = null;
        state.orgs.push(org);
        if (!current) state.profiles.push(profile);
        persist();
      });
      send(res, 200, { org: publicOrg(org, "owner"), profile: publicProfile(profile) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orgs/join") {
      const current = state.profiles.find((item) => item.id === auth.user.id);
      if (limited(`join:${auth.user.id}`, 10)) return send(res, 429, { error: "Too many tries. Wait a few minutes." });
      const body = await readJson(req);
      const code = normalizeCode(body.code);
      const typedName = String(body.displayName ?? "").trim();
      const org = state.orgs.find((item) => item.inviteCode === code);
      if (!org) return send(res, 400, { error: "That code does not match a business." });
      if (current && !current.removedAt && current.orgId !== org.id) {
        return send(res, 400, { error: "You are already in a business." });
      }
      const displayName = typedName || current?.displayName || String(auth.user.displayName ?? "").trim();
      if (displayName.length < 1 || displayName.length > 80) return send(res, 400, { error: "Add your name." });
      const alreadyHere = Boolean(current && !current.removedAt && current.orgId === org.id);
      const profile = current ?? {
        id: auth.user.id,
        orgId: org.id,
        displayName,
        role: "member",
        timezone: safeTimeZone(body.timezone),
        notifyEnabled: false,
        notifyMinute: 480,
        removedAt: null,
      };
      await mutate(async () => {
        auth.user.displayName = displayName;
        profile.displayName = displayName;
        profile.timezone = safeTimeZone(body.timezone);
        if (!alreadyHere) {
          profile.orgId = org.id;
          profile.role = "member";
          profile.removedAt = null;
        }
        if (!current) state.profiles.push(profile);
        persist();
      });
      broadcast(org.id);
      send(res, 200, { org: publicOrg(org, profile.role), profile: publicProfile(profile) });
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

    if (req.method === "POST" && url.pathname === "/api/orgs/template") {
      if (auth.profile.role !== "owner") return send(res, 403, { error: "Only the owner can change the message." });
      const body = await readJson(req);
      const template = String(body.template ?? "").slice(0, 500);
      await mutate(async () => {
        auth.org.waTemplate = template;
        persist();
      });
      send(res, 200, { waTemplate: template });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orgs/members/password") {
      if (auth.profile.role !== "owner") return send(res, 403, { error: "Only the owner can set a password." });
      const body = await readJson(req);
      const password = String(body.password ?? "");
      if (password.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
      if (body.memberId === auth.user.id) return send(res, 400, { error: "Change your own password from your profile." });
      const member = state.profiles.find((item) => item.id === body.memberId && item.orgId === auth.org.id && !item.removedAt);
      const user = state.users.find((item) => item.id === body.memberId);
      if (!member || !user) return send(res, 404, { error: "That person is not on the team." });
      await mutate(async () => {
        await writePassword(user, password, null);
        persist();
      });
      broadcast(auth.org.id);
      send(res, 200, { ok: true });
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
        member.removedAt = now;
        state.sessions = state.sessions.filter((item) => item.userId !== member.id);
        persist();
      });
      broadcast(auth.org.id);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orgs/transfer") {
      if (auth.profile.role !== "owner") return send(res, 403, { error: "Only the owner can transfer the business." });
      const body = await readJson(req);
      const member = state.profiles.find((item) => item.id === body.memberId && item.orgId === auth.org.id && !item.removedAt);
      if (!member || member.id === auth.user.id) return send(res, 404, { error: "That person is not on the team." });
      await mutate(async () => {
        auth.profile.role = "member";
        member.role = "owner";
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
        if (body.timezone != null) auth.profile.timezone = safeTimeZone(String(body.timezone).slice(0, 64));
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
      const since = pullSince(url.searchParams.get("cursor"));
      const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      await mutate(async () => {
        const before = state.leads.length;
        state.leads = state.leads.filter((lead) => !lead.deletedAt || lead.deletedAt > cutoff);
        if (state.leads.length !== before) persist();
      });
      const leads = state.leads.filter((lead) => lead.orgId === auth.org.id && (!since || lead.updatedAt > since));
      const profiles = state.profiles.filter((profile) => profile.orgId === auth.org.id);
      const serverTime = new Date().toISOString();
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
      const result = await mutate(async () => {
        const existing = state.leads.find((lead) => lead.id === input.id);
        if (!existing) {
          if (body.baseVersion != null) return { status: 409, body: { error: "conflict", lead: null, deleted: true } };
          const names = state.leads.filter((lead) => lead.orgId === auth.org.id && !lead.deletedAt).map((lead) => lead.name);
          const lead = {
            id: String(input.id),
            orgId: auth.org.id,
            name: assignCustomerName(String(input.name).trim(), names),
            phone: String(input.phone ?? "").trim(),
            notes: String(input.notes ?? ""),
            status: input.status,
            followUpOn: input.followUpOn || null,
            closedOn: input.closedOn || null,
            ownerId: auth.user.id,
            createdBy: auth.user.id,
            updatedBy: auth.user.id,
            ...leadExtras(input, null),
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
          state.leads.push(lead);
          persist();
          return { status: 200, body: { lead: publicLead(lead) }, orgId: auth.org.id };
        }
        if (existing.orgId !== auth.org.id) return { status: 404, body: { error: "This lead is gone." } };
        if (body.baseVersion == null) {
          return { status: 409, body: { error: "conflict", lead: publicLead(existing), deleted: Boolean(existing.deletedAt) } };
        }
        if (existing.deletedAt) return { status: 409, body: { error: "conflict", lead: publicLead(existing), deleted: true } };
        if (existing.version !== body.baseVersion) {
          return { status: 409, body: { error: "conflict", lead: publicLead(existing), deleted: false } };
        }
        existing.name = String(input.name).trim();
        existing.phone = String(input.phone ?? "").trim();
        existing.notes = String(input.notes ?? "");
        existing.status = input.status;
        existing.followUpOn = input.followUpOn || null;
        existing.closedOn = input.closedOn || null;
        Object.assign(existing, leadExtras(input, existing));
        existing.updatedBy = auth.user.id;
        existing.version += 1;
        existing.updatedAt = now;
        if (input.deletedAt) existing.deletedAt = now;
        persist();
        return { status: 200, body: { lead: publicLead(existing) }, orgId: auth.org.id };
      });
      if (result.orgId) broadcast(result.orgId);
      send(res, result.status, result.body);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/push/test") {
      const subs = state.subscriptions.filter((item) => item.userId === auth.user.id);
      let sent = 0;
      const dead = [];
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: "BPH", body: "Test alert. Reminders can reach this phone." }),
          );
          sent += 1;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) dead.push(sub.endpoint);
        }
      }
      if (dead.length) {
        await mutate(async () => {
          state.subscriptions = state.subscriptions.filter((item) => !dead.includes(item.endpoint));
          persist();
        });
      }
      send(res, 200, { sent });
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
    let requested = "";
    try {
      requested = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      send(res, 400, { error: "Bad path." });
      return;
    }
    if (!existsSync(distDir)) {
      send(res, 503, { error: "App build is missing. Run npm start from the repo root." });
      return;
    }
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
    runLocked(() => sendDueDigests()).catch((error) => console.error(error));
  }, 30_000);
  timer.unref?.();
  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, row] of attempts) {
      if (row.reset < now) attempts.delete(key);
    }
  }, 60 * 60 * 1000);
  pruneTimer.unref?.();

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
