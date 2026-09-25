const KEY = "bph-crm-prototype-v1";
const TONES = ["#E7EFEA", "#F3E8DC", "#E8E6F2", "#F6E4E2", "#E4EEF2"];

const state = {
  screen: "auth",
  stack: ["auth"],
  sync: "synced",
  query: "",
  segment: "lead",
  scope: "mine",
  detailId: null,
  draft: null,
  formError: "",
  toast: "",
  sheet: null,
  notify: false,
  notifyTime: "08:00",
  orgName: "BPH",
  meName: "Rafi",
  leads: [],
  bootPct: 0,
};

let bootTimer = 0;
let bootGeneration = 0;
let toastTimer = 0;
let syncTimer = 0;

const ICONS = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  today: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`,
  leads: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 7h11M8 12h11M8 17h11"/><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01"/></svg>`,
  you: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5 19c1.4-3 3.8-4.5 7-4.5S17.6 16 19 19"/></svg>`,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  const data = {
    migrated: true,
    notify: state.notify,
    notifyTime: state.notifyTime,
    orgName: state.orgName,
    meName: state.meName,
    leads: state.leads,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* The in-memory book still works for this session. */
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(iso, amount) {
  const date = parseDate(iso);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function prettyDate(iso) {
  return parseDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function longDate(iso) {
  return parseDate(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function dayDiff(iso) {
  return Math.round((parseDate(iso) - parseDate(todayISO())) / 86400000);
}

function dueMeta(iso) {
  if (!iso) return { text: "No follow-up", className: "quiet" };
  const diff = dayDiff(iso);
  if (diff === 0) return { text: "Due today", className: "today-due" };
  if (diff === 1) return { text: "Due tomorrow", className: "later" };
  if (diff === -1) return { text: "1 day overdue", className: "overdue" };
  if (diff < 0) return { text: `${-diff} days overdue`, className: "overdue" };
  return { text: `Due ${prettyDate(iso)}`, className: "later" };
}

function digestLine(dueToday, overdue) {
  const parts = [];
  if (dueToday) parts.push(`${dueToday} due today`);
  if (overdue) parts.push(`${overdue} overdue`);
  return parts.join(" · ");
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function relativeTime(iso) {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

function tone(name) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % TONES.length;
  return TONES[hash];
}

function ownerName(id) {
  if (id === "me") return state.meName;
  if (id === "nadia") return "Nadia";
  return "Teammate";
}

function telHref(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function waHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function activeLeads() {
  return state.leads.filter((lead) => !lead.deleted);
}

function seedLeads() {
  const today = todayISO();
  return [
    lead("jamal", "Jamal Uddin", "+880 1712 448 190", "Asked for a site visit this week.", "lead", addDays(today, -1), null, "me", 5),
    lead("bright", "Bright Home Co.", "+880 1819 220 441", "Wants the revised quote before noon.", "lead", today, null, "me", 8),
    lead("lina", "Lina Ortega", "+880 1611 903 228", "", "lead", addDays(today, 1), null, "me", 26),
    lead("oak", "Oak Street Studio", "+880 1552 774 019", "Send the revised price.", "lead", addDays(today, 5), null, "me", 3),
    lead("rupa", "Rupa Designs", "+880 1790 331 864", "", "lead", null, null, "me", 50),
    lead("amina", "Amina Rahman", "+880 1678 114 903", "Waiting on approval from her partner.", "lead", addDays(today, -2), null, "nadia", 6),
    lead("north", "Northwind Supplies", "+880 1913 660 275", "", "lead", today, null, "nadia", 4),
    lead("farhan", "Farhan Kabir", "+880 1722 508 640", "Paid in full.", "sold", null, addDays(today, -1), "me", 30),
    lead("metro", "Metro Print", "+880 1833 219 557", "Went with someone else.", "lost", null, addDays(today, -6), "nadia", 70),
  ];
}

function lead(id, name, phone, notes, status, followUpOn, closedOn, ownerId, ageHours) {
  return {
    id,
    name,
    phone,
    notes,
    status,
    followUpOn,
    closedOn,
    ownerId,
    updatedBy: ownerId,
    updatedAt: hoursAgo(ageHours),
    deleted: false,
  };
}

function countsFor(ownerId) {
  const rows = activeLeads().filter((row) => row.status === "lead" && row.followUpOn && (!ownerId || row.ownerId === ownerId));
  return {
    overdue: rows.filter((row) => dayDiff(row.followUpOn) < 0).length,
    today: rows.filter((row) => dayDiff(row.followUpOn) === 0).length,
  };
}

function queueSync() {
  state.sync = "syncing";
  paintChrome();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    state.sync = "synced";
    paintChrome();
  }, 700);
}

function showToast(text) {
  state.toast = text;
  paintToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    paintToast();
  }, 2200);
}

function goTab(screen) {
  state.stack = [screen];
  state.screen = screen;
  state.sheet = null;
  paint();
}

function push(screen) {
  state.stack.push(screen);
  state.screen = screen;
  state.sheet = null;
  paint();
}

function pop() {
  if (state.stack.length > 1) state.stack.pop();
  state.screen = state.stack.at(-1);
  state.sheet = null;
  state.formError = "";
  paint();
}

function startBoot() {
  const generation = ++bootGeneration;
  clearInterval(bootTimer);
  state.screen = "boot";
  state.stack = ["boot"];
  state.bootPct = 8;
  paint();
  const steps = [24, 47, 69, 86, 100];
  let index = 0;
  bootTimer = setInterval(() => {
    if (generation !== bootGeneration) return;
    state.bootPct = steps[index++];
    const bar = document.getElementById("boot-bar");
    const label = document.getElementById("boot-count");
    if (bar) bar.style.width = `${state.bootPct}%`;
    if (label && state.bootPct === 100) label.textContent = `${seedLeads().length} leads on this phone`;
    if (state.bootPct >= 100) {
      clearInterval(bootTimer);
      window.setTimeout(() => {
        if (generation === bootGeneration) finishBoot();
      }, 380);
    }
  }, 260);
}

function finishBoot() {
  state.leads = seedLeads();
  state.notify = false;
  state.screen = "today";
  state.stack = ["today"];
  persist();
  paint();
}

function blankDraft() {
  return {
    id: null,
    name: "",
    phone: "",
    notes: "",
    followUpOn: addDays(todayISO(), 1),
    ownerId: "me",
  };
}

function currentLead() {
  return activeLeads().find((row) => row.id === state.detailId) || null;
}

function touch(row, patch) {
  Object.assign(row, patch, { updatedBy: "me", updatedAt: new Date().toISOString() });
  persist();
  queueSync();
}

function setStatus(row, status) {
  if (status === "lead") {
    touch(row, { status: "lead", closedOn: null, followUpOn: row.followUpOn || addDays(todayISO(), 1) });
    showToast("Back to Lead");
  } else {
    touch(row, { status, followUpOn: null, closedOn: todayISO() });
    showToast(status === "sold" ? "Marked sold" : "Marked lost");
  }
  paint();
}

function saveDraft() {
  const draft = state.draft;
  const name = draft.name.trim();
  if (!name) {
    state.formError = "Add a name.";
    paint();
    return;
  }
  if (draft.id) {
    const row = state.leads.find((item) => item.id === draft.id);
    if (!row) return;
    touch(row, {
      name,
      phone: draft.phone.trim(),
      notes: draft.notes.trim(),
      ownerId: draft.ownerId,
    });
    showToast("Saved");
    pop();
    return;
  }
  const row = {
    id: crypto.randomUUID(),
    name,
    phone: draft.phone.trim(),
    notes: draft.notes.trim(),
    status: "lead",
    followUpOn: draft.followUpOn,
    closedOn: null,
    ownerId: draft.ownerId,
    updatedBy: "me",
    updatedAt: new Date().toISOString(),
    deleted: false,
  };
  state.leads.unshift(row);
  persist();
  queueSync();
  state.detailId = row.id;
  state.stack = [state.stack[0] || "today", "detail"];
  state.screen = "detail";
  showToast("Lead saved");
  paint();
}

function chipKey(iso) {
  if (!iso) return "none";
  const diff = dayDiff(iso);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === 3) return "3";
  if (diff === 7) return "week";
  return "";
}

function paint() {
  const app = document.getElementById("app");
  const tabbed = ["today", "leads", "account"].includes(state.screen);
  const showFab = state.screen === "today" || state.screen === "leads";
  app.innerHTML = `
    <header id="header"></header>
    <main id="view" class="${tabbed ? "with-tabs" : ""} ${showFab ? "with-fab" : ""}"></main>
    <nav id="tabbar" hidden></nav>
    <button id="fab" type="button" data-action="add" aria-label="New lead" hidden>${ICONS.plus}</button>
    <div id="toast" hidden></div>
    <div id="sheet" hidden></div>
  `;
  paintChrome();
  paintView();
  paintToast();
  paintSheet();
}

function paintChrome() {
  const header = document.getElementById("header");
  const tabbar = document.getElementById("tabbar");
  const fab = document.getElementById("fab");
  if (!header || !tabbar || !fab) return;

  const bare = ["auth", "start", "join", "boot"].includes(state.screen);
  header.classList.toggle("bare", bare);
  const stackScreen = state.screen === "detail" || state.screen === "edit";
  if (bare) {
    header.innerHTML = "";
  } else if (stackScreen) {
    const title = state.screen === "edit" ? (state.draft?.id ? "Edit lead" : "New lead") : "Lead";
    const action = state.screen === "detail"
      ? `<button class="text-btn header-side" type="button" data-action="edit">Edit</button>`
      : "";
    header.innerHTML = `
      <button class="icon-btn header-side" type="button" data-action="back" aria-label="Back">${ICONS.back}</button>
      <p class="header-title">${title}</p>
      ${action || `<span class="header-side"></span>`}
    `;
  } else {
    const syncLabel = state.sync === "syncing" ? "Syncing…" : "Synced";
    header.innerHTML = `
      <p class="brand">BPH</p>
      <button class="sync-btn" type="button" data-action="tab" data-screen="account">${syncLabel}</button>
    `;
  }

  const tabbed = ["today", "leads", "account"].includes(state.screen);
  tabbar.hidden = !tabbed;
  fab.hidden = !(state.screen === "today" || state.screen === "leads");
  if (tabbed) {
    const mine = countsFor("me");
    const badgeCount = mine.overdue + mine.today;
    const badgeClass = mine.overdue ? "overdue" : "today-due";
    const badge = badgeCount
      ? `<span class="badge ${badgeClass}">${badgeCount}</span>`
      : "";
    tabbar.innerHTML = [
      ["today", "Today", ICONS.today, badge],
      ["leads", "Leads", ICONS.leads, ""],
      ["account", "You", ICONS.you, ""],
    ].map(([id, label, icon, extra]) => `
      <button class="tab ${state.screen === id ? "on" : ""}" type="button" data-action="tab" data-screen="${id}" aria-current="${state.screen === id ? "page" : "false"}">
        ${extra}
        ${icon}
        ${label}
      </button>
    `).join("");
  }
}

function paintView() {
  const view = document.getElementById("view");
  if (!view) return;
  const screens = {
    auth: authScreen,
    start: startScreen,
    join: joinScreen,
    boot: bootScreen,
    today: todayScreen,
    leads: leadsScreen,
    account: accountScreen,
    detail: detailScreen,
    edit: editScreen,
  };
  view.innerHTML = (screens[state.screen] || todayScreen)();
  const bar = document.getElementById("boot-bar");
  if (bar) bar.style.width = `${state.bootPct}%`;
}

function authScreen() {
  return `
    <section class="auth">
      <p class="brand">BPH</p>
      <h1>Sign in</h1>
      <p class="lede">Your leads stay on this phone and sync with the team.</p>
      <label class="field"><span>Email</span><input id="email" type="email" autocomplete="username" value="rafi@bph.example"></label>
      <label class="field"><span>Password</span><input id="password" type="password" autocomplete="current-password" value="password"></label>
      <div class="form-actions"><button class="primary" type="button" data-action="sign-in">Sign in</button></div>
      <button class="linkish" type="button" data-action="go" data-screen="start">Start a business</button>
      <button class="linkish" type="button" data-action="go" data-screen="join">Join with a code</button>
    </section>
  `;
}

function startScreen() {
  return `
    <section class="auth">
      <p class="brand">BPH</p>
      <h1>Start a business</h1>
      <p class="lede">You become the owner of a shared book. Teammates join with a code.</p>
      <label class="field"><span>Business name</span><input id="org-name" maxlength="80" value="${esc(state.orgName)}"></label>
      <label class="field"><span>Your name</span><input id="your-name" maxlength="80" value="${esc(state.meName)}"></label>
      <div class="form-actions"><button class="primary" type="button" data-action="create-org">Create business</button></div>
      <button class="linkish" type="button" data-action="go" data-screen="auth">Back to sign in</button>
    </section>
  `;
}

function joinScreen() {
  return `
    <section class="auth">
      <p class="brand">BPH</p>
      <h1>Join with a code</h1>
      <p class="lede">The code is on a teammate's You tab.</p>
      <label class="field"><span>Invite code</span><input id="invite-code" maxlength="8" autocapitalize="characters" value="7K2MQP9A"></label>
      <label class="field"><span>Your name</span><input id="your-name" maxlength="80" value="${esc(state.meName)}"></label>
      <div class="form-actions"><button class="primary" type="button" data-action="join-org">Join</button></div>
      <button class="linkish" type="button" data-action="go" data-screen="auth">Back to sign in</button>
    </section>
  `;
}

function bootScreen() {
  return `
    <section class="boot" aria-busy="true">
      <p class="brand">BPH</p>
      <h1>Copying the full book onto this phone</h1>
      <p class="lede">BPH opens from this copy so the app stays instant. This happens once on each phone.</p>
      <div class="track" aria-hidden="true"><div id="boot-bar"></div></div>
      <p class="meta" id="boot-count">Copying leads…</p>
    </section>
  `;
}

function todayScreen() {
  const scoped = activeLeads().filter((row) => row.status === "lead" && (state.scope === "all" || row.ownerId === "me"));
  const overdue = scoped.filter((row) => row.followUpOn && dayDiff(row.followUpOn) < 0).sort(compareFollow);
  const today = scoped.filter((row) => row.followUpOn && dayDiff(row.followUpOn) === 0).sort(compareFollow);
  const later = scoped.filter((row) => row.followUpOn && dayDiff(row.followUpOn) > 0 && dayDiff(row.followUpOn) <= 7).sort(compareFollow);
  const beyond = scoped.filter((row) => row.followUpOn && dayDiff(row.followUpOn) > 7).length;
  const line = digestLine(today.length, overdue.length);
  const reminder = !state.notify && (overdue.length + today.length + later.length > 0)
    ? `<div class="reminder-card"><div><strong>Reminders are off</strong><p class="meta">Get a morning alert for overdue leads and anything due today.</p></div><button type="button" data-action="enable-notify">Turn on</button></div>`
    : "";
  return `
    <p class="date-line">${esc(longDate(todayISO()))}</p>
    <h1>Today</h1>
    ${line ? `<p class="summary">${summaryHtml(today.length, overdue.length)}</p>` : ""}
    <div class="scope">
      <button type="button" data-action="scope" data-scope="mine" class="${state.scope === "mine" ? "on" : ""}">Mine</button>
      <button type="button" data-action="scope" data-scope="all" class="${state.scope === "all" ? "on" : ""}">All</button>
    </div>
    ${reminder}
    ${section("Overdue", "overdue", overdue)}
    ${section("Due today", "today-due", today)}
    ${section("Later", "", later)}
    ${!overdue.length && !today.length ? `<div class="empty"><h2>Nothing overdue or due today</h2><p class="meta">Follow-ups you own show up here.</p></div>` : ""}
    ${beyond ? `<button class="linkish" type="button" data-action="tab" data-screen="leads">${beyond} later follow-up${beyond === 1 ? "" : "s"} in Leads</button>` : ""}
  `;
}

function summaryHtml(dueToday, overdue) {
  const parts = [];
  if (dueToday) parts.push(`<span class="today-due">${dueToday} due today</span>`);
  if (overdue) parts.push(`<span class="overdue">${overdue} overdue</span>`);
  return parts.join(" · ");
}

function section(title, className, rows) {
  if (!rows.length) return "";
  return `
    <h2 class="section-label ${className}">${title}</h2>
    <div class="group">${rows.map((row) => todayRow(row)).join("")}</div>
  `;
}

function todayRow(row) {
  const due = dueMeta(row.followUpOn);
  const owner = row.ownerId === "me" ? "" : `<div class="row-owner">${esc(ownerName(row.ownerId))}</div>`;
  const call = telHref(row.phone);
  return `
    <div class="row">
      <button class="row-open" type="button" data-action="open" data-id="${esc(row.id)}">
        <span class="avatar" style="background:${tone(row.name)}">${esc(initials(row.name))}</span>
        <span class="row-copy">
          <span class="row-name">${esc(row.name)}</span>
          <span class="row-sub ${due.className}">${esc(due.text)}</span>
          ${owner}
        </span>
      </button>
      ${call ? `<a class="call" href="${esc(call)}">Call</a>` : ""}
    </div>
  `;
}

function compareFollow(a, b) {
  if (a.followUpOn !== b.followUpOn) return a.followUpOn < b.followUpOn ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function leadListHtml() {
  const rows = filteredLeads();
  if (!rows.length) {
    const searching = Boolean(state.query.trim());
    const title = searching ? "No matches" : {
      lead: "No open leads yet",
      sold: "No sold leads yet",
      lost: "No lost leads yet",
    }[state.segment];
    const body = searching ? "Try another name or phone number." : "They'll show up here.";
    return `<div class="empty" id="lead-list"><h2>${title}</h2><p class="meta">${body}</p></div>`;
  }
  return `<div class="group" id="lead-list">${rows.map(leadRow).join("")}</div>`;
}

function leadsScreen() {
  const counts = {
    lead: activeLeads().filter((row) => row.status === "lead").length,
    sold: activeLeads().filter((row) => row.status === "sold").length,
    lost: activeLeads().filter((row) => row.status === "lost").length,
  };
  return `
    <h1>Leads</h1>
    <div class="segments">
      ${["lead", "sold", "lost"].map((id) => `
        <button type="button" data-action="segment" data-segment="${id}" class="${state.segment === id ? "on" : ""}">${labelStatus(id)} · ${counts[id]}</button>
      `).join("")}
    </div>
    <input class="search" id="search" type="search" placeholder="Search name or phone" value="${esc(state.query)}" autocomplete="off">
    <div style="height:14px"></div>
    ${leadListHtml()}
  `;
}

function labelStatus(status) {
  if (status === "sold") return "Sold";
  if (status === "lost") return "Lost";
  return "Lead";
}

function filteredLeads() {
  const query = state.query.trim().toLowerCase();
  return activeLeads()
    .filter((row) => row.status === state.segment)
    .filter((row) => !query || `${row.name} ${row.phone}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (state.segment === "lead") {
        if (!a.followUpOn && !b.followUpOn) return a.name.localeCompare(b.name);
        if (!a.followUpOn) return 1;
        if (!b.followUpOn) return -1;
        return compareFollow(a, b);
      }
      if (a.closedOn !== b.closedOn) return a.closedOn < b.closedOn ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

function leadRow(row) {
  let sub = dueMeta(row.followUpOn);
  if (row.status === "sold") sub = { text: `Sold · ${prettyDate(row.closedOn)}`, className: "quiet" };
  if (row.status === "lost") sub = { text: `Lost · ${prettyDate(row.closedOn)}`, className: "quiet" };
  const owner = row.ownerId === "me" ? "" : `<div class="row-owner">${esc(ownerName(row.ownerId))}</div>`;
  return `
    <div class="row">
      <button class="row-open" type="button" data-action="open" data-id="${esc(row.id)}">
        <span class="avatar" style="background:${tone(row.name)}">${esc(initials(row.name))}</span>
        <span class="row-copy">
          <span class="row-name">${esc(row.name)}</span>
          <span class="row-sub ${sub.className}">${esc(sub.text)}</span>
          ${owner}
        </span>
      </button>
    </div>
  `;
}

function paintLeadList() {
  const host = document.getElementById("lead-list");
  if (!host) {
    paint();
    return;
  }
  host.outerHTML = leadListHtml();
}

function detailScreen() {
  const row = currentLead();
  if (!row) return `<div class="empty"><h2>This lead is gone</h2></div>`;
  const due = dueMeta(row.followUpOn);
  const phone = row.phone
    ? `<p class="detail-phone">${esc(row.phone)}</p><div class="pair"><a class="ghost wide" href="${esc(telHref(row.phone))}">Call</a><a class="ghost wide" href="${esc(waHref(row.phone))}" target="_blank" rel="noopener">WhatsApp</a></div>`
    : "";
  const follow = row.status === "lead"
    ? `<div class="card-block"><h2>Follow-up</h2><p class="${due.className}" style="font-weight:700">${esc(due.text)}</p>${chips(row.followUpOn)}<label class="field"><span>Date</span><input id="detail-date" type="date" value="${esc(row.followUpOn || "")}"></label></div>`
    : `<div class="card-block"><h2>${labelStatus(row.status)}</h2><p class="meta">Closed ${esc(prettyDate(row.closedOn))}. Reminders are off.</p></div>`;
  return `
    <h1>${esc(row.name)}</h1>
    <div class="status-switch" role="group" aria-label="Status">
      ${["lead", "sold", "lost"].map((status) => `
        <button type="button" data-action="status" data-status="${status}" class="${row.status === status ? "on" : ""}">${labelStatus(status)}</button>
      `).join("")}
    </div>
    ${follow}
    ${phone}
    ${row.notes ? `<div class="card-block"><h2>Notes</h2><p class="notes">${esc(row.notes)}</p></div>` : ""}
    <label class="field"><span>Owner</span>
      <select id="detail-owner">
        <option value="me" ${row.ownerId === "me" ? "selected" : ""}>${esc(state.meName)}</option>
        <option value="nadia" ${row.ownerId === "nadia" ? "selected" : ""}>Nadia</option>
      </select>
    </label>
    <p class="meta">Last change · ${esc(ownerName(row.updatedBy))} · ${esc(relativeTime(row.updatedAt))}</p>
    <button class="delete-link" type="button" data-action="ask-delete">Delete lead</button>
  `;
}

function chips(selected) {
  const options = [
    ["today", "Today", todayISO()],
    ["tomorrow", "Tomorrow", addDays(todayISO(), 1)],
    ["3", "In 3 days", addDays(todayISO(), 3)],
    ["week", "Next week", addDays(todayISO(), 7)],
    ["none", "No date", ""],
  ];
  const active = chipKey(selected);
  return `<div class="chips">${options.map(([key, label, value]) => `
    <button type="button" class="chip ${active === key ? "on" : ""}" data-action="follow" data-date="${value}">${label}</button>
  `).join("")}</div>`;
}

function editScreen() {
  const draft = state.draft || blankDraft();
  const follow = draft.id ? "" : `
    <span class="field"><span>Follow-up</span></span>
    ${chips(draft.followUpOn)}
    <label class="field"><span>Date</span><input id="draft-date" type="date" value="${esc(draft.followUpOn || "")}"></label>
    <p class="hint">Without a date, BPH will not remind anyone.</p>
  `;
  return `
    <label class="field"><span>Name</span><input id="draft-name" maxlength="120" value="${esc(draft.name)}" placeholder="Person or business"></label>
    <label class="field"><span>Phone</span><input id="draft-phone" maxlength="40" value="${esc(draft.phone)}" inputmode="tel" placeholder="+880…"></label>
    ${follow}
    <label class="field"><span>Notes</span><textarea id="draft-notes" maxlength="2000">${esc(draft.notes)}</textarea></label>
    <label class="field"><span>Owner</span>
      <select id="draft-owner">
        <option value="me" ${draft.ownerId === "me" ? "selected" : ""}>${esc(state.meName)}</option>
        <option value="nadia" ${draft.ownerId === "nadia" ? "selected" : ""}>Nadia</option>
      </select>
    </label>
    ${state.formError ? `<p class="form-error">${esc(state.formError)}</p>` : ""}
    <div class="form-actions"><button class="primary" type="button" data-action="save">Save</button></div>
  `;
}

function accountScreen() {
  const mine = countsFor("me");
  const line = digestLine(mine.today, mine.overdue);
  const previewBody = line || "No alert that morning. BPH stays quiet when nothing is due.";
  return `
    <h1>You</h1>
    <div class="card-block">
      <h2>${esc(state.meName)}</h2>
      <p class="meta">Owner · ${esc(state.orgName)}</p>
      <div class="team-row"><strong>${esc(state.meName)}</strong><span>You · Owner</span></div>
      <div class="team-row"><strong>Nadia</strong><span>Member</span></div>
      <div class="code"><span>7K2M QP9A</span><button class="text-btn" type="button" data-action="copy-code">Copy</button></div>
    </div>
    <div class="card-block">
      <h2>Reminders</h2>
      <p class="meta">One morning alert for your overdue follow-ups and anything due today.</p>
      <label class="switch-row"><span>Alerts</span><input id="notify" type="checkbox" ${state.notify ? "checked" : ""}></label>
      <label class="field"><span>Time</span>
        <select id="notify-time">
          ${["07:00", "08:00", "09:00", "18:00"].map((time) => `<option ${state.notifyTime === time ? "selected" : ""}>${time}</option>`).join("")}
        </select>
      </label>
      <p class="hint">On iPhone, install BPH to your home screen so alerts can arrive while the app is closed.</p>
      <div class="push-preview">
        <div class="push-top"><span>BPH</span><span>${esc(state.notifyTime)}</span></div>
        <p class="push-title">Follow-ups</p>
        <p class="push-body">${esc(previewBody)}</p>
      </div>
    </div>
    <div class="card-block">
      <h2>On this phone</h2>
      <p class="meta">BPH keeps the full book on this phone. Changes show up right away, then sync to the rest of the team.</p>
      <p class="meta">${activeLeads().length} leads · ${state.sync === "syncing" ? "Syncing…" : "Synced"}</p>
    </div>
    <button class="linkish" type="button" data-action="sign-out">Sign out</button>
  `;
}

function paintToast() {
  const toast = document.getElementById("toast");
  if (!toast) return;
  const tabbed = ["today", "leads", "account"].includes(state.screen);
  toast.hidden = !state.toast;
  toast.textContent = state.toast;
  toast.classList.toggle("low", !tabbed);
}

function paintSheet() {
  const sheet = document.getElementById("sheet");
  if (!sheet) return;
  if (state.sheet !== "delete") {
    sheet.hidden = true;
    sheet.innerHTML = "";
    return;
  }
  const row = currentLead();
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">Delete ${esc(row?.name || "this lead")}?</h2>
      <p>It disappears for the whole team.</p>
      <button class="danger" type="button" data-action="confirm-delete">Delete lead</button>
      <button class="ghost wide" type="button" data-action="close-sheet">Cancel</button>
    </div>
  `;
}

function readDraftInputs() {
  if (state.screen !== "edit" || !state.draft) return;
  const name = document.getElementById("draft-name");
  const phone = document.getElementById("draft-phone");
  const notes = document.getElementById("draft-notes");
  const owner = document.getElementById("draft-owner");
  const date = document.getElementById("draft-date");
  if (name) state.draft.name = name.value;
  if (phone) state.draft.phone = phone.value;
  if (notes) state.draft.notes = notes.value;
  if (owner) state.draft.ownerId = owner.value;
  if (date) state.draft.followUpOn = date.value || null;
}

function onClick(event) {
  if (event.target.id === "sheet") {
    state.sheet = null;
    paintSheet();
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target || !document.getElementById("app").contains(target)) return;
  const action = target.dataset.action;

  if (action === "tab") {
    goTab(target.dataset.screen);
    return;
  }
  if (action === "go") {
    state.screen = target.dataset.screen;
    state.stack = [state.screen];
    paint();
    return;
  }
  if (action === "back") {
    pop();
    return;
  }
  if (action === "sign-in" || action === "create-org" || action === "join-org") {
    const org = document.getElementById("org-name");
    const your = document.getElementById("your-name");
    if (org?.value.trim()) state.orgName = org.value.trim();
    if (your?.value.trim()) state.meName = your.value.trim();
    startBoot();
    return;
  }
  if (action === "add") {
    state.draft = blankDraft();
    state.formError = "";
    push("edit");
    return;
  }
  if (action === "open") {
    state.detailId = target.dataset.id;
    push("detail");
    return;
  }
  if (action === "edit") {
    const row = currentLead();
    if (!row) return;
    state.draft = {
      id: row.id,
      name: row.name,
      phone: row.phone,
      notes: row.notes,
      followUpOn: row.followUpOn,
      ownerId: row.ownerId,
    };
    state.formError = "";
    push("edit");
    return;
  }
  if (action === "save") {
    readDraftInputs();
    saveDraft();
    return;
  }
  if (action === "scope") {
    state.scope = target.dataset.scope;
    paint();
    return;
  }
  if (action === "segment") {
    state.segment = target.dataset.segment;
    document.querySelectorAll("[data-segment]").forEach((button) => {
      button.classList.toggle("on", button.dataset.segment === state.segment);
    });
    paintLeadList();
    return;
  }
  if (action === "status") {
    const row = currentLead();
    if (!row || row.status === target.dataset.status) return;
    setStatus(row, target.dataset.status);
    return;
  }
  if (action === "follow") {
    const row = state.screen === "detail" ? currentLead() : null;
    const iso = target.dataset.date || null;
    if (row) {
      touch(row, { followUpOn: iso });
      showToast(iso ? "Follow-up saved" : "Follow-up cleared");
      paint();
      return;
    }
    if (state.draft) {
      state.draft.followUpOn = iso;
      const input = document.getElementById("draft-date");
      if (input) input.value = iso || "";
      document.querySelectorAll(".chip").forEach((chip) => {
        chip.classList.toggle("on", chip.dataset.date === (iso || ""));
      });
    }
    return;
  }
  if (action === "ask-delete") {
    state.sheet = "delete";
    paintSheet();
    return;
  }
  if (action === "close-sheet") {
    state.sheet = null;
    paintSheet();
    return;
  }
  if (action === "confirm-delete") {
    const row = currentLead();
    if (row) {
      row.deleted = true;
      persist();
      queueSync();
      showToast("Lead deleted");
    }
    pop();
    return;
  }
  if (action === "enable-notify") {
    state.notify = true;
    persist();
    showToast(`Reminders on at ${state.notifyTime}`);
    paint();
    return;
  }
  if (action === "copy-code") {
    const write = navigator.clipboard?.writeText("7K2MQP9A");
    if (write) write.then(() => showToast("Code copied")).catch(() => showToast("Code 7K2MQP9A"));
    else showToast("Code 7K2MQP9A");
    return;
  }
  if (action === "sign-out") {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    state.leads = [];
    state.stack = ["auth"];
    state.screen = "auth";
    state.meName = "Rafi";
    state.orgName = "BPH";
    state.notify = false;
    paint();
  }
}

function onInput(event) {
  if (event.target.id === "search") {
    state.query = event.target.value;
    paintLeadList();
    return;
  }
  readDraftInputs();
}

function onChange(event) {
  if (event.target.id === "notify") {
    state.notify = event.target.checked;
    persist();
    paint();
    showToast(state.notify ? "Reminders on" : "Reminders off");
    return;
  }
  if (event.target.id === "notify-time") {
    state.notifyTime = event.target.value;
    persist();
    paint();
    return;
  }
  if (event.target.id === "detail-owner") {
    const row = currentLead();
    if (!row) return;
    touch(row, { ownerId: event.target.value });
    showToast(`Owner is ${ownerName(row.ownerId)}`);
    paint();
    return;
  }
  if (event.target.id === "detail-date") {
    const row = currentLead();
    if (!row) return;
    touch(row, { followUpOn: event.target.value || null });
    showToast(event.target.value ? "Follow-up saved" : "Follow-up cleared");
    paint();
    return;
  }
  if (event.target.id === "draft-date" && state.draft) {
    state.draft.followUpOn = event.target.value || null;
    const iso = state.draft.followUpOn || "";
    document.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("on", (chip.dataset.date || "") === iso);
    });
  }
  if (event.target.id === "draft-owner" && state.draft) state.draft.ownerId = event.target.value;
}

function bootFromStorage() {
  const params = new URLSearchParams(location.search);
  if (params.get("replay") === "1" || location.hash === "#replay") {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    history.replaceState(null, "", location.pathname);
  }
  const saved = load();
  if (saved?.migrated && Array.isArray(saved.leads)) {
    state.leads = saved.leads;
    state.notify = Boolean(saved.notify);
    state.notifyTime = saved.notifyTime || "08:00";
    state.orgName = saved.orgName || "BPH";
    state.meName = saved.meName || "Rafi";
    state.screen = "today";
    state.stack = ["today"];
  }
}

function init() {
  bootFromStorage();
  const app = document.getElementById("app");
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.sheet) {
      state.sheet = null;
      paintSheet();
    }
  });
  paint();
}

init();
