import { useEffect, useRef, useState } from "react";
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
  Mark,
  SignupScreen,
  StartScreen,
  TodayScreen,
} from "./screens";

function useSystemBack(depth: number, onBack: () => void) {
  const onBackRef = useRef(onBack);
  const depthRef = useRef(depth);
  const tracked = useRef(0);
  const skip = useRef(0);
  onBackRef.current = onBack;
  depthRef.current = depth;

  useEffect(() => {
    const onPop = () => {
      if (skip.current > 0) {
        skip.current -= 1;
        return;
      }
      if (depthRef.current <= 0) return;
      tracked.current = Math.max(0, depthRef.current - 1);
      onBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const delta = depth - tracked.current;
    if (delta > 0) {
      for (let i = 0; i < delta; i += 1) history.pushState({ bph: true }, "");
      tracked.current = depth;
      return;
    }
    if (delta < 0) {
      skip.current += -delta;
      tracked.current = depth;
      history.go(delta);
    }
  }, [depth]);
}

function Shell() {
  const book = useBook();
  const bare = ["loading", "auth", "signup", "start", "join", "copy", "copy-error"].includes(book.phase);
  const tabbed = book.phase === "app" && ["today", "leads", "account"].includes(book.screen);
  const showFab = book.screen === "today" || book.screen === "leads";
  const mine = book.me ? digestCounts(book.leads, book.me.id, todayISO(book.me.timezone)) : { today: 0, overdue: 0 };
  const badge = mine.today + mine.overdue;
  const syncLabel = book.sync === "syncing" ? "Syncing…" : book.sync === "saved" ? "Saved on this phone" : "Synced";
  const lead = book.leads.find((item) => item.id === book.detailId);
  const [shift, setShift] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const shiftRef = useRef(0);

  useSystemBack(book.phase === "app" ? book.navDepth : 0, () => {
    if (book.sheet) book.setSheet(null);
    else book.back();
  });

  function moveShift(next: number) {
    shiftRef.current = next;
    setShift(next);
  }

  return (
    <div
      id="app"
      onTouchStart={(event) => {
        const installed =
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true;
        if (!installed || book.navDepth < 1) return;
        const touch = event.changedTouches[0];
        if (!touch || touch.clientX > 28) return;
        drag.current = { x: touch.clientX, y: touch.clientY };
        setDragging(true);
      }}
      onTouchMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
          drag.current = null;
          setDragging(false);
          moveShift(0);
          return;
        }
        moveShift(Math.max(0, Math.min(dx, 160)));
      }}
      onTouchEnd={() => {
        const gone = shiftRef.current > 72;
        drag.current = null;
        setDragging(false);
        moveShift(0);
        if (gone) {
          if (book.sheet) book.setSheet(null);
          else book.back();
        }
      }}
      onTouchCancel={() => {
        drag.current = null;
        setDragging(false);
        moveShift(0);
      }}
    >
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
            <Mark />
            <button className="sync-btn" type="button" onClick={() => book.goTab("account")}>
              {syncLabel}
            </button>
          </>
        )}
      </header>
      <main
        id="view"
        className={`${tabbed ? "with-tabs" : ""} ${tabbed && showFab ? "with-fab" : ""}`}
        style={{
          transform: shift ? `translate3d(${shift}px, 0, 0)` : undefined,
          transition: dragging ? "none" : "transform 180ms ease",
        }}
      >
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
            Settings
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
