export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function safeTimeZone(timeZone) {
  const zone = String(timeZone || "UTC");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

export function todayISO(timeZone = "UTC", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(iso, amount) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function dayDiff(iso, today) {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

export function localMinutes(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

export function digestLine(dueToday, overdue) {
  const parts = [];
  if (dueToday) parts.push(`${dueToday} due today`);
  if (overdue) parts.push(`${overdue} overdue`);
  return parts.join(" · ");
}

export function digestCounts(leads, today, ownerId) {
  const rows = leads.filter((lead) => {
    if (lead.deletedAt || lead.status !== "lead" || !lead.followUpOn) return false;
    if (!ownerId) return true;
    return (lead.createdBy || lead.ownerId) === ownerId;
  });
  return {
    overdue: rows.filter((lead) => dayDiff(lead.followUpOn, today) < 0).length,
    today: rows.filter((lead) => dayDiff(lead.followUpOn, today) === 0).length,
  };
}

export function shouldSendDigest({ notifyEnabled, notifyMinute, timeZone, lastDigestOn, now, dueCount }) {
  if (!notifyEnabled || dueCount <= 0) return false;
  const today = todayISO(timeZone, now);
  if (lastDigestOn === today) return false;
  return localMinutes(timeZone, now) >= notifyMinute;
}

export function prettyDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function longDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function dueMeta(iso, today) {
  if (!iso) return { text: "No follow-up", className: "quiet" };
  const diff = dayDiff(iso, today);
  if (diff === 0) return { text: "Due today", className: "today-due" };
  if (diff === 1) return { text: "Due tomorrow", className: "later" };
  if (diff === -1) return { text: "1 day overdue", className: "overdue" };
  if (diff < 0) return { text: `${-diff} days overdue`, className: "overdue" };
  return { text: `Due ${prettyDate(iso)}`, className: "later" };
}

export function initials(name) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

export function nextCustomerName(names) {
  let max = 0;
  for (const name of names) {
    const match = /^Customer (\d+)$/.exec(String(name ?? "").trim());
    if (!match) continue;
    const number = Number(match[1]);
    if (number > max) max = number;
  }
  return `Customer ${max + 1}`;
}

export function assignCustomerName(requested, names) {
  const trimmed = String(requested ?? "").trim();
  const taken = names.map((name) => String(name ?? "").trim());
  if (trimmed && !/^Customer \d+$/.test(trimmed)) return trimmed;
  if (trimmed && !taken.includes(trimmed)) return trimmed;
  return nextCustomerName(taken);
}

export function pullSince(cursor, overlapMs = 5 * 60 * 1000) {
  if (!cursor) return null;
  const time = Date.parse(cursor);
  if (!Number.isFinite(time)) return null;
  return new Date(time - overlapMs).toISOString();
}

export function newId() {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === "function") cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function phoneKey(phone) {
  return String(phone ?? "").replace(/\D/g, "");
}

export function duplicatePhone(leads, phone, exceptId) {
  const key = phoneKey(phone);
  if (key.length < 6) return null;
  return leads.find((lead) => lead.id !== exceptId && !lead.deletedAt && phoneKey(lead.phone) === key) ?? null;
}

export function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function leadsCsv(leads) {
  const lines = [["Name", "Phone", "Notes", "Status", "Tags", "Follow-up", "Closed", "Added by", "Updated"].join(",")];
  for (const lead of leads) {
    lines.push(
      [lead.name, lead.phone, lead.notes, lead.status, normalizeTags(lead.tags).join(" · "), lead.followUpOn || "", lead.closedOn || "", lead.addedBy || "", lead.updatedAt || ""]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function hasLocalBook(input) {
  if (!input.userId || !input.hasProfile) return false;
  return Boolean(input.fullSyncComplete || input.leadCount > 0 || input.hasOrg || input.hasProfile);
}

export function membershipMatches(record, userId, email) {
  if (!record?.orgName || !record?.orgId) return false;
  if (userId && record.userId === userId) return true;
  const savedEmail = String(record.email || "").trim().toLowerCase();
  const nextEmail = String(email || "").trim().toLowerCase();
  return Boolean(savedEmail && savedEmail === nextEmail);
}

export const LOST_REASONS = ["Price", "No response", "Bought elsewhere", "Not needed"];
export const LEAD_SOURCES = ["Walk-in", "Phone", "WhatsApp", "Referral"];
export const CUSTOMER_TAGS = ["Scooty", "Lithium battery", "Acid battery", "Parts"];

export function normalizeTags(value) {
  const picked = new Set(Array.isArray(value) ? value : []);
  return CUSTOMER_TAGS.filter((tag) => picked.has(tag));
}

export function mergeLead(server, local) {
  return {
    ...server,
    name: local.name,
    phone: local.phone,
    notes: local.notes,
    status: local.status,
    followUpOn: local.followUpOn,
    closedOn: local.closedOn,
    soldAmount: local.soldAmount,
    lostReason: local.lostReason,
    source: local.source ?? null,
    tags: normalizeTags(local.tags),
    lastContactAt: local.lastContactAt ?? null,
    contactCount: Number(local.contactCount) || 0,
    history: String(local.history ?? ""),
    deletedAt: local.deletedAt,
    updatedBy: local.updatedBy,
  };
}

export function customerMatches(lead, filter = {}) {
  if (!lead || lead.deletedAt) return false;
  const status = filter.status || "all";
  if (status !== "all" && lead.status !== status) return false;
  const wanted = normalizeTags(filter.tags);
  const tags = normalizeTags(lead.tags);
  if (wanted.length && !wanted.some((tag) => tags.includes(tag))) return false;
  const query = String(filter.query || "").trim().toLowerCase();
  if (!query) return true;
  return `${lead.name || ""} ${lead.phone || ""} ${lead.notes || ""} ${tags.join(" ")}`.toLowerCase().includes(query);
}

export function followUpResult(kind, today, currentFollowUp) {
  if (kind === "no-answer") return { status: "lead", followUpOn: addDays(today, 1), closedOn: null, label: "No answer" };
  if (kind === "later") return { status: "lead", followUpOn: addDays(today, 3), closedOn: null, label: "Call later" };
  if (kind === "quoted") return { status: "lead", followUpOn: currentFollowUp || null, closedOn: null, label: "Quoted" };
  if (kind === "not-interested") return { status: "lost", followUpOn: null, closedOn: today, label: "Not interested" };
  return null;
}

export function appendHistory(history, today, line) {
  const next = `${today} · ${line}`;
  const prev = String(history || "").trim();
  const combined = prev ? `${prev}\n${next}` : next;
  return combined.slice(-4000);
}

export function quietDays(lastContactAt, today) {
  if (!lastContactAt) return null;
  const iso = String(lastContactAt).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return -dayDiff(iso, today);
}

export function soldThisMonth(leads, today) {
  const month = String(today).slice(0, 7);
  const rows = leads.filter((lead) => lead.status === "sold" && !lead.deletedAt && String(lead.closedOn || "").startsWith(month));
  const amount = rows.reduce((sum, lead) => sum + (Number(lead.soldAmount) || 0), 0);
  return { count: rows.length, amount };
}

export function syncStatusLabel(sync, syncedAt, now = Date.now()) {
  if (sync === "syncing") return "Syncing";
  if (sync === "saved") return "On phone";
  if (!syncedAt) return "Synced";
  const when = relativeTime(syncedAt, now);
  return when === "Just now" ? "Synced" : `Synced ${when}`;
}

export function relativeTime(iso, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}
