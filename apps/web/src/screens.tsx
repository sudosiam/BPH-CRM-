import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, dayDiff, digestCounts, digestLine, dueMeta, initials, LEAD_SOURCES, LOST_REASONS, longDate, prettyDate, quietDays, relativeTime, soldThisMonth, todayISO } from "@shared/book.mjs";
import { useBook, type Draft } from "./book";
import { db } from "./db";
import type { Lead, Profile } from "./types";
import { APP_VERSION } from "./version";

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

function waHref(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  const text = message.trim();
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}

function fillTemplate(template: string, name: string) {
  return template.replaceAll("{name}", name.trim() || "there");
}

function phoneZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function labelStatus(status: Lead["status"]) {
  if (status === "sold") return "Sold";
  if (status === "lost") return "Lost";
  return "Lead";
}

function ownerName(profiles: Profile[], id: string, me: Profile | null) {
  if (me?.id === id) return "You";
  return profiles.find((profile) => profile.id === id)?.displayName ?? "Teammate";
}

export function AuthScreen() {
  const book = useBook();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section className="auth">
      <h1>Sign in</h1>
      <p className="lede">Your leads stay on this phone and sync with the team.</p>
      <div className="panel">
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" placeholder="you@email.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.signIn(email, password)}>
          Sign in
        </button>
      </div>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("signup")}>
        Create an account
      </button>
      <button className="linkish" type="button" onClick={() => book.setPhase("reset")}>
        Forgot password
      </button>
    </section>
  );
}

export function ResetScreen() {
  const book = useBook();
  const [email, setEmail] = useState("");
  return (
    <section className="auth">
      <h1>Reset password</h1>
      <p className="lede">We will email a link if this address has an account.</p>
      <div className="panel">
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" placeholder="you@email.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.requestPasswordReset(email)}>
          Send reset link
        </button>
      </div>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("auth")}>
        Back to sign in
      </button>
    </section>
  );
}

export function PasswordScreen() {
  const book = useBook();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [localError, setLocalError] = useState("");
  const message = localError || book.error;
  return (
    <section className="auth">
      <h1>New password</h1>
      <p className="lede">Choose a password for this account.</p>
      <div className="panel">
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="new-password" placeholder="At least 6 characters" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <label className="field">
        <span>Again</span>
        <input type="password" autoComplete="new-password" placeholder="Repeat the password" value={again} onChange={(event) => setAgain(event.target.value)} />
      </label>
      {message ? <p className="form-error">{message}</p> : null}
      <div className="form-actions">
        <button
          className="primary"
          type="button"
          onClick={() => {
            if (password.length < 6) {
              setLocalError("Use at least 6 characters.");
              return;
            }
            if (password !== again) {
              setLocalError("Those passwords do not match.");
              return;
            }
            setLocalError("");
            void book.choosePassword(password);
          }}
        >
          Save password
        </button>
      </div>
      </div>
      <button className="linkish" type="button" onClick={() => void book.signOut()}>
        Back to sign in
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
      <h1>Create an account</h1>
      <p className="lede">Then start a business or join one with a code.</p>
      <div className="panel">
      <label className="field">
        <span>Your name</span>
        <input maxLength={80} placeholder="Your name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" placeholder="you@email.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="new-password" placeholder="At least 6 characters" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.signUp(email, password, displayName)}>
          Create account
        </button>
      </div>
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
  if (book.remembered) {
    return (
      <section className="auth">
        <h1>Open {book.remembered.orgName}</h1>
        <p className="lede">This account is already in that shared book. You do not need a new code.</p>
        {book.error ? <p className="form-error">{book.error}</p> : null}
        <div className="form-actions">
          <button className="primary" type="button" onClick={() => void book.reopenBook()}>
            Open shared book
          </button>
        </div>
        <button className="linkish" type="button" onClick={() => book.setPhase("join")}>
          Use a different code
        </button>
      </section>
    );
  }
  return (
    <section className="auth">
      <h1>Start a business</h1>
      <p className="lede">You become the owner of a shared book. Teammates join with a code.</p>
      <div className="panel">
      <label className="field">
        <span>Business name</span>
        <input maxLength={80} placeholder="Shop or company" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Your name</span>
        <input maxLength={80} placeholder="Your name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.createOrg(name, displayName)}>
          Create business
        </button>
      </div>
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
      <h1>Join with a code</h1>
      <p className="lede">The code is in a teammate's Settings.</p>
      <div className="panel">
      <label className="field">
        <span>Invite code</span>
        <input maxLength={12} autoCapitalize="characters" placeholder="ABCD1234" value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      <label className="field">
        <span>Your name</span>
        <input maxLength={80} placeholder="Your name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      {book.error ? <p className="form-error">{book.error}</p> : null}
      <div className="form-actions">
        <button className="primary" type="button" onClick={() => void book.joinOrg(code, displayName)}>
          Join
        </button>
      </div>
      </div>
      <button className="linkish" type="button" onClick={() => book.setPhase("start")}>
        Start a business
      </button>
    </section>
  );
}

export function OpeningScreen() {
  return (
    <section className="boot" aria-busy="true">
      <div className="boot-mark" aria-hidden="true">
        <span />
      </div>
      <h1>Opening your book</h1>
      <p className="lede">Your leads are already on this phone.</p>
    </section>
  );
}

export function CopyScreen() {
  const book = useBook();
  const failed = book.phase === "copy-error";
  return (
    <section className="boot" aria-busy={!failed}>
      {failed ? null : (
        <div className="boot-mark" aria-hidden="true">
          <span />
        </div>
      )}
      <h1>{failed ? "The copy didn't finish" : "Saving the book on this phone"}</h1>
      <p className="lede">
        {failed
          ? "The connection dropped before every lead arrived. Nothing was lost on the team."
          : "This happens once on each phone. After that, Today opens straight away."}
      </p>
      {failed ? null : (
        <div className="copy-card">
          <div className="track" aria-hidden="true">
            <div id="boot-bar" style={{ width: `${book.copyPct}%` }} />
          </div>
          <p className="meta">
            {book.copyLabel} · {Math.round(book.copyPct)}%
          </p>
        </div>
      )}
      {failed ? (
        <div className="form-actions">
          <button className="primary" type="button" onClick={() => void book.retryCopy()}>
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function TodayScreen() {
  const book = useBook();
  const [everyone, setEveryone] = useState(true);
  const today = todayISO(book.me?.timezone);
  const mine = (lead: Lead) => (lead.createdBy || lead.ownerId) === book.me?.id;
  const open = book.leads.filter((lead): lead is Lead & { followUpOn: string } => lead.status === "lead" && Boolean(lead.followUpOn) && (everyone || mine(lead)));
  const undated = book.leads.filter((lead) => lead.status === "lead" && !lead.followUpOn && (everyone || mine(lead)));
  const overdue = open.filter((lead) => dayDiff(lead.followUpOn, today) < 0).sort(compareFollow);
  const due = open.filter((lead) => dayDiff(lead.followUpOn, today) === 0).sort(compareFollow);
  const later = open
    .filter((lead) => lead.followUpOn && dayDiff(lead.followUpOn, today) > 0 && dayDiff(lead.followUpOn, today) <= 7)
    .sort(compareFollow);
  const beyond = open.filter((lead) => lead.followUpOn && dayDiff(lead.followUpOn, today) > 7).length;
  const showReminder = book.me && !book.me.notifyEnabled && !book.snoozed && overdue.length + due.length + later.length > 0;
  return (
    <>
      <p className="date-line">{longDate(today)}</p>
      <div className="segments">
        <button type="button" className={everyone ? "on" : ""} onClick={() => setEveryone(true)}>
          Everyone
        </button>
        <button type="button" className={everyone ? "" : "on"} onClick={() => setEveryone(false)}>
          My leads
        </button>
      </div>
      {due.length || overdue.length ? (
        <p className="summary">
          {due.length ? <span className="today-due">{due.length} due today</span> : null}
          {overdue.length ? <span className="overdue">{overdue.length} overdue</span> : null}
        </p>
      ) : null}
      {showReminder ? (
        <div className="reminder-card">
          <div>
            <strong>Reminders are off</strong>
            <p className="meta">Get an alert for every follow-up that is overdue or due today.</p>
          </div>
          <button type="button" onClick={() => void book.setReminders(true)}>
            Turn on
          </button>
          <button className="linkish" type="button" onClick={book.snoozeReminder}>
            Not now
          </button>
        </div>
      ) : null}
      <LeadSection title="Overdue" className="overdue" rows={overdue} today={today} />
      <LeadSection title="Due today" className="today-due" rows={due} today={today} />
      <LeadSection title="Later" className="" rows={later} today={today} />
      <LeadSection title="Needs a date" className="" rows={undated} today={today} />
      {!overdue.length && !due.length ? (
        <div className="empty">
          <h2>Nothing overdue or due today</h2>
          <p className="meta">Every follow-up on the team shows up here, no matter who added it.</p>
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
                  <span className="row-owner">{ownerName(book.profiles, lead.createdBy || lead.ownerId, book.me)}</span>
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
  const [mine, setMine] = useState(false);
  const query = book.query.trim().toLowerCase();
  const rows = book.leads
    .filter((lead) => lead.status === book.segment)
    .filter((lead) => !mine || (lead.createdBy || lead.ownerId) === book.me?.id)
    .filter((lead) => !query || `${lead.name} ${lead.phone} ${lead.notes}`.toLowerCase().includes(query))
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
        placeholder="Search name, phone, or notes"
        value={book.query}
        autoComplete="off"
        onChange={(event) => book.setQuery(event.target.value)}
      />
      <div className="chips">
        <button type="button" className={`chip ${mine ? "" : "on"}`} onClick={() => setMine(false)}>
          All
        </button>
        <button type="button" className={`chip ${mine ? "on" : ""}`} onClick={() => setMine(true)}>
          Mine
        </button>
      </div>
      {rows.length ? (
        <div className="group">
          {rows.map((lead) => {
            const sub =
              lead.status === "sold"
                ? { text: `Sold · ${prettyDate(lead.closedOn || today)}${lead.soldAmount ? ` · ৳${lead.soldAmount}` : ""}`, className: "quiet" }
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
                    {(quietDays(lead.lastContactAt || lead.createdAt, today) ?? 0) >= 14 ? (
                      <span className="meta">Quiet {quietDays(lead.lastContactAt || lead.createdAt, today)}d</span>
                    ) : null}
                    {(lead.createdBy || lead.ownerId) !== book.me?.id ? (
                      <span className="row-owner">{ownerName(book.profiles, lead.createdBy || lead.ownerId, book.me)}</span>
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
          <p className="meta">{query ? "Try another name, phone, or note." : mine ? "None of these were added by you." : "They'll show up here."}</p>
        </div>
      )}
    </>
  );
}

export function DetailScreen() {
  const book = useBook();
  const leadId = book.detailId ?? "";
  const activity = useLiveQuery(() => (leadId ? db.activity.where("leadId").equals(leadId).sortBy("at") : []), [leadId], []) ?? [];
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
  const adder = ownerName(book.profiles, lead.createdBy || lead.ownerId, book.me);
  const recent = activity.slice(-8).reverse();
  return (
    <div className="detail">
      <div className="detail-hero">
        <span className="avatar" style={{ background: tone(lead.name) }}>
          {initials(lead.name)}
        </span>
        <div>
          <h1>{lead.name}</h1>
          <p className="meta">Owner · {adder}</p>
        </div>
      </div>
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
          <p className={`due-line ${due.className}`}>{due.text}</p>
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
          {lead.status === "sold" ? (
            <label className="field">
              <span>Amount</span>
              <input
                inputMode="decimal"
                placeholder="Optional"
                value={lead.soldAmount ?? ""}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  void book.setSoldAmount(raw ? Number(raw) : null);
                }}
              />
            </label>
          ) : (
            <div className="chips">
              {LOST_REASONS.map((reason) => (
                <button key={reason} type="button" className={`chip ${lead.lostReason === reason ? "on" : ""}`} onClick={() => void book.setLostReason(reason)}>
                  {reason}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {lead.phone ? (
        <div className="card-block">
          <p className="detail-phone">{lead.phone}</p>
          <div className="pair">
            <a className="ghost wide call-btn" href={telHref(lead.phone)} onClick={() => book.noteActivity(lead.id, "Called")}>
              Call
            </a>
            <a
              className="ghost wide wa"
              href={waHref(lead.phone, fillTemplate(book.waTemplate, lead.name))}
              target="_blank"
              rel="noopener"
              onClick={() => book.noteActivity(lead.id, "Opened WhatsApp")}
            >
              WhatsApp
            </a>
          </div>
          {lead.status === "lead" ? (
            <div className="chips">
              <button type="button" className="chip" onClick={() => void book.recordResult("no-answer")}>
                No answer
              </button>
              <button type="button" className="chip" onClick={() => void book.recordResult("later")}>
                Call later
              </button>
              <button type="button" className="chip" onClick={() => void book.recordResult("quoted")}>
                Quoted
              </button>
              <button type="button" className="chip" onClick={() => void book.recordResult("not-interested")}>
                Not interested
              </button>
            </div>
          ) : null}
          {lead.lastContactAt ? (
            <p className="meta">
              Last call {relativeTime(lead.lastContactAt)} · Called {lead.contactCount || 0}×
            </p>
          ) : null}
        </div>
      ) : null}
      {lead.notes ? (
        <div className="card-block">
          <h2>Notes</h2>
          <p className="notes">{lead.notes}</p>
        </div>
      ) : null}
      {(lead.history || recent.length) ? (
        <div className="card-block">
          <h2>History</h2>
          {(lead.history || "")
            .split("\n")
            .filter(Boolean)
            .slice(-8)
            .reverse()
            .map((line, index) => (
              <p className="meta" key={`${index}-${line}`}>
                {line}
              </p>
            ))}
          {!lead.history
            ? recent.map((item) => (
                <p className="meta" key={item.id}>
                  {relativeTime(item.at)} · {item.text}
                </p>
              ))
            : null}
        </div>
      ) : null}
      <div className="detail-lines">
        <p>
          Last change · {ownerName(book.profiles, lead.updatedBy, book.me)} · {relativeTime(lead.updatedAt)}
        </p>
      </div>
      <button className="delete-link" type="button" onClick={() => book.setSheet("delete")}>
        Delete lead
      </button>
    </div>
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
  const preset = book.conflictDraft && book.conflictDraft.id === (existing?.id ?? null) ? book.conflictDraft : null;
  const [draft, setDraft] = useState<Draft>(() => {
    const base = preset || existing;
    return base
      ? {
          id: base.id,
          name: base.name,
          phone: base.phone,
          notes: base.notes,
          followUpOn: base.followUpOn,
          ownerId: "ownerId" in base ? base.ownerId : existing?.ownerId || "",
          source: base.source ?? null,
        }
      : {
          id: null,
          name: "",
          phone: "",
          notes: "",
          followUpOn: addDays(today, 1),
          ownerId: book.me?.id || "",
          source: null,
        };
  });
  const [formError, setFormError] = useState("");
  function update(next: Draft) {
    setDraft(next);
    book.setEditorDirty(true);
  }
  return (
    <div className="editor">
      <label className="field">
        <span>Name</span>
        <input maxLength={120} value={draft.name} placeholder="Optional" onChange={(event) => update({ ...draft, name: event.target.value })} />
      </label>
      <p className="hint">Leave the name blank and BPH saves them as Customer 1, Customer 2, and so on.</p>
      <label className="field">
        <span>Phone</span>
        <input maxLength={40} inputMode="tel" value={draft.phone} placeholder="+880…" onChange={(event) => update({ ...draft, phone: event.target.value })} />
      </label>
      <span className="field">
        <span>Source</span>
      </span>
      <div className="chips">
        {LEAD_SOURCES.map((source) => (
          <button key={source} type="button" className={`chip ${draft.source === source ? "on" : ""}`} onClick={() => update({ ...draft, source })}>
            {source}
          </button>
        ))}
      </div>
      {(existing?.status ?? "lead") === "lead" ? (
        <>
          <span className="field">
            <span>Follow-up</span>
          </span>
          <FollowChips selected={draft.followUpOn} today={today} onPick={(iso) => update({ ...draft, followUpOn: iso })} />
          <label className="field">
            <span>Date</span>
            <input type="date" value={draft.followUpOn || ""} onChange={(event) => update({ ...draft, followUpOn: event.target.value || null })} />
          </label>
          <p className="hint">Without a date, BPH will not remind anyone.</p>
        </>
      ) : null}
      {book.conflictDraft ? <p className="meta">Someone else saved this lead. Your typing is still here.</p> : null}
      <label className="field">
        <span>Notes</span>
        <textarea maxLength={2000} placeholder="Optional" value={draft.notes} onChange={(event) => update({ ...draft, notes: event.target.value })} />
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
    </div>
  );
}

const REMINDER_SHORTCUTS = [420, 480, 540, 1080];

function clock(minute: number) {
  const safe = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function teamMembers(profiles: Profile[], meId: string) {
  return profiles
    .filter((profile) => !profile.removedAt)
    .sort((a, b) => {
      if (a.id === meId) return -1;
      if (b.id === meId) return 1;
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

export function AccountScreen() {
  const book = useBook();
  if (!book.me || !book.org) return null;
  const me = book.me;
  const org = book.org;
  const today = todayISO(me.timezone);
  const code = org.inviteCode;
  const preview = fillTemplate(book.waTemplate, "Customer");
  return (
    <div className="settings">
      <section className="part">
        <p className="part-label">You</p>
        <button className="card-block settings-hero member-open" type="button" onClick={() => book.openMember(me.id)}>
          <span className="avatar settings-avatar round" style={{ background: tone(me.displayName) }}>
            {initials(me.displayName)}
          </span>
          <div>
            <h2>{me.displayName}</h2>
            <p className="meta">
              {me.role === "owner" ? "Owner" : "Member"} · {org.name}
            </p>
            {book.email ? <p className="meta">{book.email}</p> : null}
            <p className="meta">
              This month: {soldThisMonth(book.leads, today).count} sold · ৳{soldThisMonth(book.leads, today).amount}
            </p>
          </div>
        </button>
      </section>
      <section className="part">
        <p className="part-label">Team</p>
        <div className="card-block">
          <div className="team-scroll">
            {teamMembers(book.profiles, me.id).map((profile) => (
              <button className="team-person" key={profile.id} type="button" onClick={() => book.openMember(profile.id)}>
                <span className="avatar round" style={{ background: tone(profile.displayName) }}>
                  {initials(profile.displayName)}
                </span>
                <strong>{profile.id === me.id ? "You" : profile.displayName}</strong>
                <em>{profile.role === "owner" ? "Owner" : "Member"}</em>
              </button>
            ))}
          </div>
          {me.role === "owner" && code ? (
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
          {me.role === "owner" ? (
            <button className="linkish" type="button" onClick={() => void book.regenerateCode()}>
              New invite code
            </button>
          ) : (
            <p className="meta">You are already in this book. A new code is only for someone new.</p>
          )}
        </div>
      </section>
      <section className="part">
        <p className="part-label">WhatsApp</p>
        <div className="card-block">
          <h2>Message template</h2>
          <p className="meta">Used when you open WhatsApp from a lead. {"{name}"} becomes their name.</p>
          <label className="field">
            <span>Template</span>
            <textarea
              maxLength={500}
              value={book.waTemplate}
              onChange={(event) => book.setWaTemplate(event.target.value)}
            />
          </label>
          <p className="hint">Preview: {preview}</p>
        </div>
      </section>
      <section className="part">
        <p className="part-label">This phone</p>
        <div className="card-block">
          <h2>{book.sync === "syncing" ? "Syncing…" : book.sync === "saved" ? "Saved on this phone" : "Synced"}</h2>
          <p className="meta">The full book stays on this phone. Changes show up here right away, then reach the rest of the team.</p>
          <p className="meta">{book.leads.length} leads on this phone</p>
          <button className="linkish" type="button" onClick={book.exportCsv}>
            Download a backup
          </button>
          {book.updateReady ? (
            <button className="linkish" type="button" onClick={book.applyUpdate}>
              Update ready
            </button>
          ) : null}
        </div>
      </section>
      <section className="part">
        <p className="part-label">About</p>
        <div className="card-block about-block">
          <p className="version">Version {APP_VERSION}</p>
          <p className="meta">Biswajit Power Hub</p>
        </div>
        <button className="ghost wide signout" type="button" onClick={() => void book.signOut()}>
          Sign out
        </button>
      </section>
    </div>
  );
}

export function MemberScreen() {
  const book = useBook();
  if (!book.me) return null;
  const me = book.me;
  const person = book.profiles.find((profile) => profile.id === book.memberId && !profile.removedAt);
  if (!person) {
    return (
      <div className="settings">
        <section className="part">
          <div className="card-block">
            <h2>This person is no longer on the team.</h2>
          </div>
        </section>
      </div>
    );
  }
  const mine = person.id === me.id;
  const owned = book.leads.filter((lead) => !lead.deletedAt && lead.ownerId === person.id);
  const today = todayISO(person.timezone || me.timezone);
  const open = owned.filter((lead) => lead.status === "lead").length;
  const counts = digestCounts(owned, today);
  const sold = soldThisMonth(owned, today);
  const lost = owned.filter((lead) => lead.status === "lost").length;
  const time = clock(person.notifyMinute);
  const teamCounts = digestCounts(book.leads, todayISO(me.timezone));
  const line = digestLine(teamCounts.today, teamCounts.overdue);
  return (
    <div className="settings">
      <section className="part">
        <div className="card-block profile-hero">
          <span className="avatar round" style={{ background: tone(person.displayName) }}>
            {initials(person.displayName)}
          </span>
          <h2>{person.displayName}</h2>
          <p className="meta">
            {person.role === "owner" ? "Owner" : "Member"}
            {mine && book.email ? ` · ${book.email}` : ""}
          </p>
        </div>
      </section>
      <section className="part">
        <p className="part-label">Stats</p>
        <div className="stat-grid">
          <div className="stat">
            <b>{open}</b>
            <span>Open</span>
          </div>
          <div className="stat">
            <b>{counts.today}</b>
            <span>Due today</span>
          </div>
          <div className="stat">
            <b>{counts.overdue}</b>
            <span>Overdue</span>
          </div>
          <div className="stat">
            <b>{sold.count}</b>
            <span>Sold this month</span>
          </div>
          <div className="stat">
            <b>৳{sold.amount}</b>
            <span>Sold amount</span>
          </div>
          <div className="stat">
            <b>{lost}</b>
            <span>Lost</span>
          </div>
        </div>
      </section>
      <section className="part">
        <p className="part-label">Reminders</p>
        <div className="card-block">
          <h2>Daily alert</h2>
          {mine ? (
            <>
              <p className="meta">One alert for the team's overdue follow-ups and anything due that day.</p>
              <label className="switch-row">
                <span>Alerts</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={person.notifyEnabled}
                  onChange={(event) => void book.setReminders(event.target.checked)}
                />
              </label>
              <label className="field">
                <span>Time</span>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => {
                    const [hour, minute] = event.target.value.split(":").map(Number);
                    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
                    void book.setReminderTime(hour * 60 + minute);
                  }}
                />
              </label>
              <div className="chips">
                {REMINDER_SHORTCUTS.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    className={`chip ${person.notifyMinute === minute ? "on" : ""}`}
                    onClick={() => void book.setReminderTime(minute)}
                  >
                    {clock(minute)}
                  </button>
                ))}
              </div>
              <p className="hint">
                {book.pushReady
                  ? "Add BPH to your home screen so the alert can arrive while the app is closed."
                  : "Alerts show while BPH is open. Closed-app alerts are not set up on this server yet."}
              </p>
              <p className="meta">Time zone · {person.timezone}</p>
              {phoneZone() !== person.timezone ? (
                <button className="linkish" type="button" onClick={() => void book.usePhoneZone()}>
                  Use this phone's time zone
                </button>
              ) : null}
              <div className="push-preview">
                <div className="push-top">
                  <span>BPH</span>
                  <span>{time}</span>
                </div>
                <p className="push-title">Follow-ups</p>
                <p className="push-body">{line || "Quiet that day. Nothing is due."}</p>
              </div>
            </>
          ) : (
            <>
              <p className="meta">{person.notifyEnabled ? "Alerts on" : "Alerts off"} · {time}</p>
              <p className="meta">Time zone · {person.timezone}</p>
            </>
          )}
        </div>
      </section>
      {me.role === "owner" && !mine ? (
        <section className="part">
          <p className="part-label">Owner</p>
          <div className="card-block">
            <button className="linkish" type="button" onClick={() => book.transferOwner(person.id)}>
              Make owner
            </button>
            <button className="delete-link" type="button" onClick={() => book.removeMember(person.id)}>
              Remove from team
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
