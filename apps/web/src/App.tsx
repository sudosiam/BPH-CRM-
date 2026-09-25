import { BookProvider, useBook } from "./book";
import { IconBack, IconLeads, IconPlus, IconToday, IconYou } from "./icons";
import { digestCounts, todayISO } from "@shared/book.mjs";
import {
  AccountScreen,
  AuthScreen,
  CopyScreen,
  DetailScreen,
  EditScreen,
  JoinScreen,
  LeadsScreen,
  SignupScreen,
  StartScreen,
  TodayScreen,
} from "./screens";

function Shell() {
  const book = useBook();
  const bare = ["loading", "auth", "signup", "start", "join", "copy", "copy-error"].includes(book.phase);
  const tabbed = book.phase === "app" && ["today", "leads", "account"].includes(book.screen);
  const showFab = book.screen === "today" || book.screen === "leads";
  const mine = book.me ? digestCounts(book.leads, book.me.id, todayISO(book.me.timezone)) : { today: 0, overdue: 0 };
  const badge = mine.today + mine.overdue;
  const syncLabel = book.sync === "syncing" ? "Syncing…" : book.sync === "saved" ? "Saved on this phone" : "Synced";
  const lead = book.leads.find((item) => item.id === book.detailId);

  return (
    <div id="app">
      <header id="header" className={bare ? "bare" : ""}>
        {bare ? null : book.screen === "detail" || book.screen === "edit" ? (
          <>
            <button className="icon-btn header-side" type="button" aria-label="Back" onClick={book.back}>
              <IconBack />
            </button>
            <p className="header-title">{book.screen === "edit" ? (book.detailId ? "Edit lead" : "New lead") : "Lead"}</p>
            {book.screen === "detail" ? (
              <button className="text-btn header-side" type="button" onClick={book.editCurrent}>
                Edit
              </button>
            ) : (
              <span className="header-side" />
            )}
          </>
        ) : (
          <>
            <p className="brand">BPH</p>
            <button className="sync-btn" type="button" onClick={() => book.goTab("account")}>
              {syncLabel}
            </button>
          </>
        )}
      </header>
      <main id="view" className={`${tabbed ? "with-tabs" : ""} ${tabbed && showFab ? "with-fab" : ""}`}>
        {book.phase === "loading" ? <p className="meta">Opening BPH…</p> : null}
        {book.phase === "auth" ? <AuthScreen /> : null}
        {book.phase === "signup" ? <SignupScreen /> : null}
        {book.phase === "start" ? <StartScreen /> : null}
        {book.phase === "join" ? <JoinScreen /> : null}
        {book.phase === "copy" || book.phase === "copy-error" ? <CopyScreen /> : null}
        {book.phase === "app" && book.screen === "today" ? <TodayScreen /> : null}
        {book.phase === "app" && book.screen === "leads" ? <LeadsScreen /> : null}
        {book.phase === "app" && book.screen === "account" ? <AccountScreen /> : null}
        {book.phase === "app" && book.screen === "detail" ? <DetailScreen /> : null}
        {book.phase === "app" && book.screen === "edit" ? <EditScreen /> : null}
      </main>
      {tabbed ? (
        <nav id="tabbar">
          <button className={`tab ${book.screen === "today" ? "on" : ""}`} type="button" onClick={() => book.goTab("today")}>
            {badge ? <span className={`badge ${mine.overdue ? "overdue" : "today-due"}`}>{badge}</span> : null}
            <IconToday />
            Today
          </button>
          <button className={`tab ${book.screen === "leads" ? "on" : ""}`} type="button" onClick={() => book.goTab("leads")}>
            <IconLeads />
            Leads
          </button>
          <button className={`tab ${book.screen === "account" ? "on" : ""}`} type="button" onClick={() => book.goTab("account")}>
            <IconYou />
            You
          </button>
        </nav>
      ) : null}
      {tabbed && showFab ? (
        <button id="fab" type="button" aria-label="New lead" onClick={book.startDraft}>
          <IconPlus />
        </button>
      ) : null}
      {book.toast ? <div id="toast" className={tabbed ? "" : "low"}>{book.toast}</div> : null}
      {book.sheet === "delete" && lead ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>Delete {lead.name}?</h2>
            <p>It disappears for the whole team.</p>
            <button className="danger" type="button" onClick={() => void book.deleteLead()}>
              Delete lead
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {book.sheet === "signout" ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>Changes are still on this phone</h2>
            <p>Sign out clears this copy. Wait for sync if the team should see them.</p>
            <button className="danger" type="button" onClick={() => void book.confirmSignOut()}>
              Sign out anyway
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  return (
    <BookProvider>
      <div id="stage">
        <Shell />
      </div>
    </BookProvider>
  );
}
