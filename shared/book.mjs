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

export function isOpenStatus(status) {
  return status === "lead" || status === "qualified";
}

// The live book is a Postgres enum. Until `qualified` is added there, a save
// with that status is rejected and the change stays on the phone forever.
export function qualifiedSchemaError(message) {
  const text = String(message || "");
  return /invalid input value for enum lead_status/i.test(text)
    || /follow_up_only_for_leads/i.test(text)
    || /open_leads_are_not_closed/i.test(text);
}

// The live book may not have `qualified` in its status list yet. A hidden
// history line keeps the status while the saved row stays a normal lead.
export const QUALIFIED_MARK = "§qualified";

export function historyMarksQualified(history) {
  return String(history || "").split("\n").includes(QUALIFIED_MARK);
}

export function markQualifiedHistory(history) {
  const lines = String(history || "").split("\n").filter((line) => line && line !== QUALIFIED_MARK);
  return [QUALIFIED_MARK, ...lines].join("\n");
}

export function unmarkQualifiedHistory(history) {
  return String(history || "")
    .split("\n")
    .filter((line) => line !== QUALIFIED_MARK)
    .join("\n");
}

export function encodeQualifiedLead(lead) {
  if (!lead || lead.status !== "qualified") return lead;
  return {
    ...lead,
    status: "lead",
    closedOn: null,
    history: markQualifiedHistory(lead.history),
  };
}

export function decodeQualifiedLead(lead) {
  if (!lead || !historyMarksQualified(lead.history)) return lead;
  const history = unmarkQualifiedHistory(lead.history);
  if (lead.status !== "lead") return { ...lead, history };
  return { ...lead, status: "qualified", closedOn: null, history };
}

export function digestCounts(leads, today, ownerId) {
  const rows = leads.filter((lead) => {
    if (lead.deletedAt || !isOpenStatus(lead.status) || !lead.followUpOn) return false;
    if (ownerId && lead.ownerId !== ownerId) return false;
    return true;
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

const MERGE_FIELDS = [
  "name",
  "phone",
  "notes",
  "status",
  "followUpOn",
  "closedOn",
  "soldAmount",
  "lostReason",
  "source",
  "tags",
  "lastContactAt",
  "contactCount",
  "history",
  "deletedAt",
];

function mergeValue(field, value) {
  if (field === "tags") return normalizeTags(value).join("\0");
  if (field === "soldAmount") {
    if (value == null || value === "") return "";
    const amount = Number(value);
    return Number.isFinite(amount) ? String(amount) : "";
  }
  if (field === "contactCount") return String(Number(value) || 0);
  if (value == null) return "";
  return String(value);
}

/** Keeps a field this phone changed when the server copy of that field is unchanged. Same-field edits stay on the server and are listed in conflicts. */
export function mergeLeadFields(base, local, server) {
  const lead = { ...server };
  const conflicts = [];
  if (!base || !local || !server) return { lead, conflicts: ["lead"] };
  for (const field of MERGE_FIELDS) {
    const before = mergeValue(field, base[field]);
    const mine = mergeValue(field, local[field]);
    const theirs = mergeValue(field, server[field]);
    if (mine === theirs || mine === before) continue;
    if (theirs === before) {
      lead[field] = field === "tags" ? normalizeTags(local.tags) : local[field];
      continue;
    }
    conflicts.push(field);
  }
  return { lead, conflicts };
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

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/** Fields kept when someone presses Save on an existing lead. A lead still open keeps its follow-up date. Outcome fields are copied only when the draft still has them, so a conflict save can put them back. */
export function leadEditPatch(current, next, name) {
  const status = hasOwn(next, "status") && next.status ? next.status : current?.status;
  const patch = {
    name: String(name ?? "").trim(),
    phone: String(next?.phone ?? "").trim(),
    notes: String(next?.notes ?? "").trim(),
    source: next?.source ?? null,
    tags: normalizeTags(next?.tags),
    ownerId: current?.ownerId,
  };
  if (hasOwn(next, "status") && next.status) patch.status = next.status;
  if (isOpenStatus(status)) patch.followUpOn = next?.followUpOn || null;
  if (patch.status && !isOpenStatus(patch.status)) {
    patch.followUpOn = null;
    patch.closedOn = hasOwn(next, "closedOn") ? next.closedOn || null : current?.closedOn || null;
  } else if (patch.status && isOpenStatus(patch.status)) {
    patch.closedOn = null;
  }
  if (hasOwn(next, "soldAmount")) {
    const amount = next.soldAmount == null || next.soldAmount === "" ? null : Number(next.soldAmount);
    patch.soldAmount = Number.isFinite(amount) ? amount : null;
  }
  if (hasOwn(next, "lostReason")) patch.lostReason = next.lostReason ?? null;
  if (hasOwn(next, "history")) patch.history = String(next.history ?? "").slice(-4000);
  if (hasOwn(next, "contactCount")) patch.contactCount = Number(next.contactCount) || 0;
  if (hasOwn(next, "lastContactAt")) patch.lastContactAt = next.lastContactAt ?? null;
  return patch;
}

/** Local fields kept on screen when the server copy replaces the stored lead. */
export function conflictDraftFrom(local) {
  return {
    id: local?.id ?? null,
    name: String(local?.name ?? ""),
    phone: String(local?.phone ?? ""),
    notes: String(local?.notes ?? ""),
    followUpOn: local?.followUpOn ?? null,
    ownerId: String(local?.ownerId ?? ""),
    source: local?.source ?? null,
    tags: normalizeTags(local?.tags),
    status: local?.status,
    soldAmount: local?.soldAmount ?? null,
    lostReason: local?.lostReason ?? null,
    history: String(local?.history ?? ""),
    contactCount: Number(local?.contactCount) || 0,
    lastContactAt: local?.lastContactAt ?? null,
    closedOn: local?.closedOn ?? null,
  };
}

/** Invite codes stay in the signed-in book, not in the phone's shared membership record. */
export function membershipRecord(input, existing) {
  const sameUser = existing?.userId && existing.userId === input?.userId;
  return {
    userId: input?.userId,
    email: input?.email,
    orgId: input?.orgId,
    orgName: input?.orgName,
    inviteCode: null,
    displayName: input?.displayName || (sameUser ? existing?.displayName : undefined),
  };
}

/** A missing Qualified status is stored as a normal lead. Any other failure stays queued. */
export function shouldEncodeQualified(ready, errorMessage) {
  if (!errorMessage) return !ready;
  return qualifiedSchemaError(errorMessage);
}

export function leadFromRow(row) {
  const lead = {
    id: String(row?.id ?? ""),
    orgId: String(row?.org_id ?? ""),
    name: String(row?.name ?? ""),
    phone: String(row?.phone ?? ""),
    notes: String(row?.notes ?? ""),
    status: row?.status,
    followUpOn: row?.follow_up_on ?? null,
    closedOn: row?.closed_on ?? null,
    ownerId: String(row?.owner_id ?? ""),
    createdBy: String(row?.created_by ?? ""),
    updatedBy: String(row?.updated_by ?? ""),
    version: Number(row?.version),
    createdAt: String(row?.created_at ?? ""),
    updatedAt: String(row?.updated_at ?? ""),
    deletedAt: row?.deleted_at ?? null,
    soldAmount: row?.sold_amount == null ? null : Number(row.sold_amount),
    lostReason: row?.lost_reason ?? null,
    source: row?.source ?? null,
    tags: normalizeTags(row?.tags),
    lastContactAt: row?.last_contact_at ?? null,
    contactCount: Number(row?.contact_count ?? 0),
    history: String(row?.history ?? ""),
  };
  return decodeQualifiedLead(lead);
}

export function leadToRow(lead, userId) {
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
    history: String(lead.history || "").slice(-4000),
  };
}

export function followUpResult(kind, today, currentFollowUp, currentStatus) {
  const open = currentStatus === "qualified" ? "qualified" : "lead";
  if (kind === "no-answer") return { status: open, followUpOn: addDays(today, 1), closedOn: null, label: "No answer" };
  if (kind === "later") return { status: open, followUpOn: addDays(today, 3), closedOn: null, label: "Call later" };
  if (kind === "quoted") return { status: open, followUpOn: currentFollowUp || null, closedOn: null, label: "Quoted" };
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** True for the first 24 hours after a contact is added, whoever added it. */
export function addedRecently(createdAt, now = Date.now()) {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age < DAY_MS && age > -60 * 60 * 1000;
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
