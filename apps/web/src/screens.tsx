import { useState } from "react";
import { addDays, dayDiff, digestCounts, digestLine, dueMeta, initials, longDate, prettyDate, relativeTime, todayISO } from "@shared/book.mjs";
import { useBook, type Draft } from "./book";
import type { Lead, Profile } from "./types";
import { APP_VERSION } from "./version";

export function Mark({ large = false }: { large?: boolean }) {
  return <img className={large ? "brand-mark large" : "brand-mark"} src="/logo.png" alt="BPH CRM" />;
}

const TONES = ["#E7EFEA", "#F3E8DC", "#E8E6F2", "#F6E4E2", "#E4EEF2"];

function tone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % TONES.length;
  return TONES[hash];
}

function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function waHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function labelStatus(status: Lead["status"]) {
  if (status === "sold") return "Sold";
  if (status === "lost") return "Lost";
  return "Lead";
}

function ownerName(profiles: Profile[], id: string, me: Profile | null) {
  if (me?.id === id) return me.displayName;
  return profiles.find((profile) => profile.id === id)?.displayName ?? "Teammate";
}

export function AuthScreen() {
  const book = useBook();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section className="auth">
      <Mark large />
      <h1>Sign in</h1>
      <p className="lede">Your leads stay on this phone and sync with the team.</p>
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.signIn(email, password)}>
          Sign in
        </button>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("signup")}>
        Create an account
      </button>
    </section>
  );
}

export function SignupScreen() {
  const book = useBook();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section className="auth">
      <Mark large />
      <h1>Create an account</h1>
      <p className="lede">Then start a business or join one with a code.</p>
      <label className="field">
        <span>Your name</span>
        <input maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.signUp(email, password, displayName)}>
          Create account
        </button>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("auth")}>
        Back to sign in
      </button>
    </section>
  );
}

export function StartScreen() {
  const book = useBook();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(book.me?.displayName || "");
  return (
    <section className="auth">
      <Mark large />
      <h1>Start a business</h1>
      <p className="lede">You become the owner of a shared book. Teammates join with a code.</p>
      <label className="field">
        <span>Business name</span>
        <input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Your name</span>
        <input maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.createOrg(name, displayName)}>
          Create business
        </button>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("join")}>
        Join with a code
      </button>
    </section>
  );
}

export function JoinScreen() {
  const book = useBook();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(book.me?.displayName || "");
  return (
    <section className="auth">
      <Mark large />
      <h1>Join with a code</h1>
      <p className="lede">The code is on a teammate's You tab.</p>
      <label className="field">
        <span>Invite code</span>
        <input maxLength={12} autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <label className="field">
        <span>Your name</span>
        <input maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.joinOrg(code, displayName)}>
          Join
        </button>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("start")}>
        Start a business
      </button>
    </section>
  );
}

export function CopyScreen() {
  const book = useBook();
  const failed = book.phase === "copy-error";
  return (
    <section className="boot" aria-busy={!failed}>
      <Mark large />
      <h1>{failed ? "Couldn't finish" : "Copying the full book onto this phone"}</h1>
      <p className="lede">
        {failed
          ? "Check your connection and try again."
          : "BPH opens from this copy so the app stays instant. This happens once on each phone."}
      </p>
      {failed ? null : (
        <div className="track" aria-hidden="true">
          <div id="boot-bar" style={{ width: `${book.copyPct}%` }} />
        </div>
      )}
      <p className="meta">{failed ? "" : book.copyLabel}</p>
      {failed ? (
        <div className="form-actions">
          <button className="primary" type="button" onClick={() => void book.retryCopy()}>
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function TodayScreen() {
  const book = useBook();
  const today = todayISO(book.me?.timezone);
  const scoped = book.leads.filter(
    (lead) => lead.status === "lead" && (book.scope === "all" || lead.ownerId === book.me?.id),
  );
  const overdue = scoped.filter((lead) => lead.followUpOn && dayDiff(lead.followUpOn, today) < 0).sort(compareFollow);
  const due = scoped.filter((lead) => lead.followUpOn && dayDiff(lead.followUpOn, today) === 0).sort(compareFollow);
  const later = scoped
    .filter((lead) => lead.followUpOn && dayDiff(lead.followUpOn, today) > 0 && dayDiff(lead.followUpOn, today) <= 7)
    .sort(compareFollow);
  const beyond = scoped.filter((lead) => lead.followUpOn && dayDiff(lead.followUpOn, today) > 7).length;
  const showReminder = book.me && !book.me.notifyEnabled && overdue.length + due.length + later.length > 0;
  return (
    <>
      <p className="date-line">{longDate(today)}</p>
      <h1>Today</h1>
      {due.length || overdue.length ? (
        <p className="summary">
          {due.length ? <span className="today-due">{due.length} due today</span> : null}
          {due.length && overdue.length ? " · " : null}
          {overdue.length ? <span className="overdue">{overdue.length} overdue</span> : null}
        </p>
      ) : null}
      <div className="scope">
        <button type="button" className={book.scope === "mine" ? "on" : ""} onClick={() => book.setScope("mine")}>
          Mine
        </button>
        <button type="button" className={book.scope === "all" ? "on" : ""} onClick={() => book.setScope("all")}>
          All
        </button>
      </div>
      {showReminder ? (
        <div className="reminder-card">
          <div>
            <strong>Reminders are off</strong>
            <p className="meta">Get a morning alert for overdue leads and anything due today.</p>
          </div>
          <button type="button" onClick={() => void book.setReminders(true)}>
            Turn on
          </button>
        </div>
      ) : null}
      <LeadSection title="Overdue" className="overdue" rows={overdue} today={today} />
      <LeadSection title="Due today" className="today-due" rows={due} today={today} />
      <LeadSection title="Later" className="" rows={later} today={today} />
      {!overdue.length && !due.length ? (
        <div className="empty">
          <h2>Nothing overdue or due today</h2>
          <p className="meta">Follow-ups you own show up here.</p>
        </div>
      ) : null}
      {beyond ? (
        <button className="linkish" type="button" onClick={() => book.goTab("leads")}>
          {beyond} later follow-up{beyond === 1 ? "" : "s"} in Leads
        </button>
      ) : null}
    </>
  );
}

function compareFollow(a: Lead, b: Lead) {
  if (a.followUpOn !== b.followUpOn) return (a.followUpOn ?? "") < (b.followUpOn ?? "") ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function LeadSection({ title, className, rows, today }: { title: string; className: string; rows: Lead[]; today: string }) {
  const book = useBook();
  if (!rows.length) return null;
  return (
    <>
      <h2 className={`section-label ${className}`}>{title}</h2>
      <div className="group">
        {rows.map((lead) => {
          const due = dueMeta(lead.followUpOn, today);
          const call = telHref(lead.phone);
          return (
            <div className="row" key={lead.id}>
              <button className="row-open" type="button" onClick={() => book.openLead(lead.id)}>
                <span className="avatar" style={{ background: tone(lead.name) }}>
                  {initials(lead.name)}
                </span>
                <span className="row-copy">
                  <span className="row-name">{lead.name}</span>
                  <span className={`row-sub ${due.className}`}>{due.text}</span>
                  {lead.ownerId !== book.me?.id ? <span className="row-owner">{ownerName(book.profiles, lead.ownerId, book.me)}</span> : null}
                </span>
              </button>
              {call ? (
                <a className="call" href={call}>
                  Call
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function LeadsScreen() {
  const book = useBook();
  const today = todayISO(book.me?.timezone);
  const counts = {
    lead: book.leads.filter((lead) => lead.status === "lead").length,
    sold: book.leads.filter((lead) => lead.status === "sold").length,
    lost: book.leads.filter((lead) => lead.status === "lost").length,
  };
  const query = book.query.trim().toLowerCase();
  const rows = book.leads
    .filter((lead) => lead.status === book.segment)
    .filter((lead) => !query || `${lead.name} ${lead.phone}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (book.segment === "lead") {
        if (!a.followUpOn && !b.followUpOn) return a.name.localeCompare(b.name);
        if (!a.followUpOn) return 1;
        if (!b.followUpOn) return -1;
        return compareFollow(a, b);
      }
      if (a.closedOn !== b.closedOn) return (a.closedOn ?? "") < (b.closedOn ?? "") ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  const emptyTitle = query
    ? "No matches"
    : book.segment === "sold"
      ? "No sold leads yet"
      : book.segment === "lost"
        ? "No lost leads yet"
        : "No open leads yet";
  return (
    <>
      <h1>Leads</h1>
      <div className="segments">
        {(["lead", "sold", "lost"] as const).map((status) => (
          <button key={status} type="button" className={book.segment === status ? "on" : ""} onClick={() => book.setSegment(status)}>
            {labelStatus(status)} · {counts[status]}
          </button>
        ))}
      </div>
      <input
        className="search"
        type="search"
        placeholder="Search name or phone"
        value={book.query}
        autoComplete="off"
        onChange={(event) => book.setQuery(event.target.value)}
      />
      <div style={{ height: 14 }} />
      {rows.length ? (
        <div className="group">
          {rows.map((lead) => {
            const sub =
              lead.status === "sold"
                ? { text: `Sold · ${prettyDate(lead.closedOn || today)}`, className: "quiet" }
                : lead.status === "lost"
                  ? { text: `Lost · ${prettyDate(lead.closedOn || today)}`, className: "quiet" }
                  : dueMeta(lead.followUpOn, today);
            return (
              <div className="row" key={lead.id}>
                <button className="row-open" type="button" onClick={() => book.openLead(lead.id)}>
                  <span className="avatar" style={{ background: tone(lead.name) }}>
                    {initials(lead.name)}
                  </span>
                  <span className="row-copy">
                    <span className="row-name">{lead.name}</span>
                    <span className={`row-sub ${sub.className}`}>{sub.text}</span>
                    {lead.ownerId !== book.me?.id ? (
                      <span className="row-owner">{ownerName(book.profiles, lead.ownerId, book.me)}</span>
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <h2>{emptyTitle}</h2>
          <p className="meta">{query ? "Try another name or phone number." : "They'll show up here."}</p>
        </div>
      )}
    </>
  );
}

export function DetailScreen() {
  const book = useBook();
  const lead = book.leads.find((item) => item.id === book.detailId);
  if (!lead || !book.me) {
    return (
      <div className="empty">
        <h2>This lead is gone</h2>
      </div>
    );
  }
  const today = todayISO(book.me.timezone);
  const due = dueMeta(lead.followUpOn, today);
  const active = book.profiles.filter((profile) => !profile.removedAt);
  return (
    <>
      <h1>{lead.name}</h1>
      <div className="status-switch" role="group" aria-label="Status">
        {(["lead", "sold", "lost"] as const).map((status) => (
          <button key={status} type="button" className={lead.status === status ? "on" : ""} onClick={() => void book.setStatus(status)}>
            {labelStatus(status)}
          </button>
        ))}
      </div>
      {lead.status === "lead" ? (
        <div className="card-block">
          <h2>Follow-up</h2>
          <p className={due.className} style={{ fontWeight: 700 }}>
            {due.text}
          </p>
          <FollowChips selected={lead.followUpOn} today={today} onPick={(iso) => void book.setFollowUp(iso)} />
          <label className="field">
            <span>Date</span>
            <input type="date" value={lead.followUpOn || ""} onChange={(event) => void book.setFollowUp(event.target.value || null)} />
          </label>
        </div>
      ) : (
        <div className="card-block">
          <h2>{labelStatus(lead.status)}</h2>
          <p className="meta">Closed {prettyDate(lead.closedOn || today)}. Reminders are off.</p>
        </div>
      )}
      {lead.phone ? (
        <>
          <p className="detail-phone">{lead.phone}</p>
          <div className="pair">
            <a className="ghost wide" href={telHref(lead.phone)}>
              Call
            </a>
            <a className="ghost wide" href={waHref(lead.phone)} target="_blank" rel="noopener">
              WhatsApp
            </a>
          </div>
        </>
      ) : null}
      {lead.notes ? (
        <div className="card-block">
          <h2>Notes</h2>
          <p className="notes">{lead.notes}</p>
        </div>
      ) : null}
      <label className="field">
        <span>Owner</span>
        <select value={lead.ownerId} onChange={(event) => void book.setOwner(event.target.value)}>
          {active.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.displayName}
            </option>
          ))}
        </select>
      </label>
      <p className="meta">
        Last change · {ownerName(book.profiles, lead.updatedBy, book.me)} · {relativeTime(lead.updatedAt)}
      </p>
      <button className="delete-link" type="button" onClick={() => book.setSheet("delete")}>
        Delete lead
      </button>
    </>
  );
}

function FollowChips({ selected, today, onPick }: { selected: string | null; today: string; onPick: (iso: string | null) => void }) {
  const options = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["In 3 days", addDays(today, 3)],
    ["Next week", addDays(today, 7)],
    ["No date", ""],
  ] as const;
  return (
    <div className="chips">
      {options.map(([label, value]) => (
        <button key={label} type="button" className={`chip ${(selected || "") === value ? "on" : ""}`} onClick={() => onPick(value || null)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function EditScreen() {
  const book = useBook();
  const existing = book.detailId ? book.leads.find((lead) => lead.id === book.detailId) : null;
  const today = todayISO(book.me?.timezone);
  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? {
          id: existing.id,
          name: existing.name,
          phone: existing.phone,
          notes: existing.notes,
          followUpOn: existing.followUpOn,
          ownerId: existing.ownerId,
        }
      : {
          id: null,
          name: "",
          phone: "",
          notes: "",
          followUpOn: addDays(today, 1),
          ownerId: book.me?.id || "",
        },
  );
  const [formError, setFormError] = useState("");
  const active = book.profiles.filter((profile) => !profile.removedAt);
  return (
    <>
      <label className="field">
        <span>Name</span>
        <input maxLength={120} value={draft.name} placeholder="Optional" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <p className="hint">Leave the name blank and BPH saves them as Customer 1, Customer 2, and so on.</p>
      <label className="field">
        <span>Phone</span>
        <input maxLength={40} inputMode="tel" value={draft.phone} placeholder="+880…" onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
      </label>
      {draft.id ? null : (
        <>
          <span className="field">
            <span>Follow-up</span>
          </span>
          <FollowChips selected={draft.followUpOn} today={today} onPick={(iso) => setDraft({ ...draft, followUpOn: iso })} />
          <label className="field">
            <span>Date</span>
            <input type="date" value={draft.followUpOn || ""} onChange={(event) => setDraft({ ...draft, followUpOn: event.target.value || null })} />
          </label>
          <p className="hint">Without a date, BPH will not remind anyone.</p>
        </>
      )}
      <label className="field">
        <span>Notes</span>
        <textarea maxLength={2000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
      </label>
      <label className="field">
        <span>Owner</span>
        <select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}>
          {active.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.displayName}
            </option>
          ))}
        </select>
      </label>
      {formError ? <p className="form-error">{formError}</p> : null}
      <div className="form-actions">
        <button
          className="primary"
          type="button"
          onClick={() => {
            void book.saveDraft(draft).catch((reason) => setFormError(reason instanceof Error ? reason.message : "Could not save."));
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

export function AccountScreen() {
  const book = useBook();
  if (!book.me || !book.org) return null;
  const today = todayISO(book.me.timezone);
  const counts = digestCounts(book.leads, book.me.id, today);
  const line = digestLine(counts.today, counts.overdue);
  const time = `${String(Math.floor(book.me.notifyMinute / 60)).padStart(2, "0")}:${String(book.me.notifyMinute % 60).padStart(2, "0")}`;
  const code = book.org.inviteCode;
  return (
    <>
      <h1>Settings</h1>
      <section className="part">
        <p className="part-label">You</p>
        <div className="card-block settings-hero">
          <Mark />
          <div>
            <h2>{book.me.displayName}</h2>
            <p className="meta">
              {book.me.role === "owner" ? "Owner" : "Member"} · {book.org.name}
            </p>
          </div>
        </div>
      </section>
      <section className="part">
        <p className="part-label">Team</p>
        <div className="card-block">
          {book.profiles
            .filter((profile) => !profile.removedAt)
            .map((profile) => (
              <div className="team-row" key={profile.id}>
                <strong>{profile.displayName}</strong>
                <span>
                  {profile.id === book.me?.id ? "You · " : ""}
                  {profile.role === "owner" ? "Owner" : "Member"}
                  {book.me?.role === "owner" && profile.id !== book.me.id ? (
                    <>
                      {" "}
                      <button className="text-btn" type="button" onClick={() => void book.removeMember(profile.id)}>
                        Remove
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          {book.me.role === "owner" && code ? (
            <div className="code">
              <span>
                {code.slice(0, 4)} {code.slice(4)}
              </span>
              <button
                className="text-btn"
                type="button"
                onClick={() => {
                  const write = navigator.clipboard?.writeText(code);
                  if (!write) {
                    book.showToast(`Code ${code}`);
                    return;
                  }
                  void write.then(
                    () => book.showToast("Code copied"),
                    () => book.showToast(`Code ${code}`),
                  );
                }}
              >
                Copy
              </button>
            </div>
          ) : null}
          {book.me.role === "owner" ? (
            <button className="linkish" type="button" onClick={() => void book.regenerateCode()}>
              New invite code
            </button>
          ) : (
            <p className="meta">Ask the owner for a new code if this one stops working.</p>
          )}
        </div>
      </section>
      <section className="part">
        <p className="part-label">Reminders</p>
        <div className="card-block">
          <h2>Morning alert</h2>
          <p className="meta">One alert for your overdue follow-ups and anything due today.</p>
          <label className="switch-row">
            <span>Alerts</span>
            <input type="checkbox" checked={book.me.notifyEnabled} onChange={(event) => void book.setReminders(event.target.checked)} />
          </label>
          <label className="field">
            <span>Time</span>
            <select
              value={String(book.me.notifyMinute)}
              onChange={(event) => void book.setReminderTime(Number(event.target.value))}
            >
              {[420, 480, 540, 1080].map((minute) => (
                <option key={minute} value={minute}>
                  {`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Install BPH to your home screen so alerts can arrive while the app is closed.</p>
          <div className="push-preview">
            <div className="push-top">
              <span>BPH</span>
              <span>{time}</span>
            </div>
            <p className="push-title">Follow-ups</p>
            <p className="push-body">{line || "No alert that morning. BPH stays quiet when nothing is due."}</p>
          </div>
        </div>
      </section>
      <section className="part">
        <p className="part-label">This phone</p>
        <div className="card-block">
          <h2>{book.sync === "syncing" ? "Syncing…" : book.sync === "saved" ? "Saved on this phone" : "Synced"}</h2>
          <p className="meta">The full book stays on this phone. Your changes show up right away, then sync to the team. A teammate’s new customer shows up here too.</p>
          <p className="meta">{book.leads.length} leads on this phone</p>
        </div>
      </section>
      <section className="part">
        <p className="part-label">About</p>
        <div className="card-block about-block">
          <Mark large />
          <p className="version">Version {APP_VERSION}</p>
          <p className="meta">Biswajit Power Hub</p>
        </div>
        <button className="linkish" type="button" onClick={() => void book.signOut()}>
          Sign out
        </button>
      </section>
    </>
  );
}
