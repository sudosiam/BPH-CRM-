import { useEffect, useRef } from "react";
import { BookProvider, useBook } from "./book";
import { IconBack, IconCustomers, IconLeads, IconPerson, IconPlus, IconSettings, IconToday } from "./icons";
import { digestCounts, syncStatusLabel, todayISO } from "@shared/book.mjs";
import {
  AccountScreen,
  AuthScreen,
  PasswordScreen,
  ResetScreen,
  CopyScreen,
  CustomersScreen,
  DetailScreen,
  EditScreen,
  JoinScreen,
  LeadsScreen,
  MemberScreen,
  MessageScreen,
  OpeningScreen,
  SignupScreen,
  StartScreen,
  TodayScreen,
} from "./screens";

const TONES = ["#E7EFEA", "#F3E8DC", "#E8E6F2", "#F6E4E2", "#E4EEF2"];

function tone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % TONES.length;
  return TONES[hash];
}

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
  const bare = ["loading", "auth", "signup", "reset", "password", "start", "join", "copy", "copy-error"].includes(book.phase);
  const tabbed = book.phase === "app" && (book.screen === "today" || book.screen === "leads" || book.screen === "customers");
  const showFab = book.screen === "today" || book.screen === "leads" || book.screen === "customers";
  const dueCounts = book.me ? digestCounts(book.leads, todayISO(book.me.timezone), book.me.id) : { today: 0, overdue: 0 };
  const badge = dueCounts.today + dueCounts.overdue;
  const syncLabel = syncStatusLabel(book.sync, book.syncedAt);
  const lead = book.leads.find((item) => item.id === book.detailId);
  const me = book.me;
  const drag = useRef<{ x: number; y: number; pointerId: number; armed: boolean } | null>(null);
  const shiftRef = useRef(0);
  const swipeLock = useRef(false);
  const edgeRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const backRef = useRef(book.back);
  const sheetOpen = useRef(Boolean(book.sheet));
  backRef.current = book.back;
  sheetOpen.current = Boolean(book.sheet);

  useSystemBack(book.phase === "app" ? book.navDepth : 0, () => {
    if (book.sheet) book.setSheet(null);
    else book.back();
  });

  function paintShift(next: number, animate: boolean) {
    shiftRef.current = next;
    const page = pageRef.current;
    if (!page) return;
    page.style.transition = animate ? "transform 120ms ease" : "none";
    page.style.transform = next > 0 ? `translate3d(${next}px,0,0)` : "";
  }

  useEffect(() => {
    viewRef.current?.scrollTo(0, 0);
    paintShift(0, false);
  }, [book.screen, book.phase]);

  useEffect(() => {
    const edge = edgeRef.current;
    if (!edge || book.navDepth < 1) return;
    const finish = (commit: boolean) => {
      const gone = commit && shiftRef.current >= 96;
      drag.current = null;
      paintShift(0, true);
      if (!gone || swipeLock.current) return;
      swipeLock.current = true;
      if (sheetOpen.current) book.setSheet(null);
      else backRef.current();
      window.setTimeout(() => {
        swipeLock.current = false;
      }, 240);
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || swipeLock.current) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, a, button")) return;
      drag.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, armed: false };
    };
    const onMove = (event: PointerEvent) => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.armed) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
          drag.current = null;
          paintShift(0, false);
          return;
        }
        if (dx < 12 || Math.abs(dx) <= Math.abs(dy)) return;
        start.armed = true;
      }
      paintShift(Math.max(0, Math.min(dx, 168)), false);
    };
    const onUp = (event: PointerEvent) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      finish(true);
    };
    const onCancel = () => finish(false);
    edge.addEventListener("pointerdown", onDown, { passive: true });
    edge.addEventListener("pointermove", onMove, { passive: true });
    edge.addEventListener("pointerup", onUp, { passive: true });
    edge.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      edge.removeEventListener("pointerdown", onDown);
      edge.removeEventListener("pointermove", onMove);
      edge.removeEventListener("pointerup", onUp);
      edge.removeEventListener("pointercancel", onCancel);
    };
  }, [book.navDepth, book.setSheet]);

  return (
    <div id="app">
      <header id="header" className={bare ? "bare" : ""}>
        {bare ? null : book.screen === "detail" || book.screen === "edit" ? (
          <>
            <button className="icon-btn header-side" type="button" aria-label="Back" onClick={book.back}>
              <IconBack />
            </button>
            <p className="header-title">
              {book.screen === "edit"
                ? `${book.detailId ? "Edit" : "New"} ${book.root === "customers" ? "customer" : "lead"}`
                : lead?.name || "Lead"}
            </p>
            {book.screen === "detail" ? (
              <button className="text-btn header-side" type="button" onClick={book.editCurrent}>
                Edit
              </button>
            ) : (
              <span className="header-side" />
            )}
          </>
        ) : book.screen === "account" || book.screen === "member" || book.screen === "message" ? (
          <>
            <button className="icon-btn header-side" type="button" aria-label="Back" onClick={book.back}>
              <IconBack />
            </button>
            <p className="header-title">
              {book.screen === "member" ? "Profile" : book.screen === "message" ? "WhatsApp Message" : "Settings"}
            </p>
            <span className="header-side" />
          </>
        ) : (
          <>
            <h1 className="header-heading">{book.screen === "leads" ? "Leads" : book.screen === "customers" ? "Customers" : "Today"}</h1>
            <div className="header-tools">
              <span className={`sync-label ${book.sync}`}>{syncLabel}</span>
              <button className="settings-btn" type="button" aria-label="Settings" onClick={book.openSettings}>
                <IconSettings />
              </button>
              {me ? (
                <button
                  className="profile-btn"
                  type="button"
                  aria-label="Profile"
                  style={{ background: tone(me.displayName) }}
                  onClick={() => book.openMember(me.id)}
                >
                  <IconPerson />
                </button>
              ) : null}
            </div>
          </>
        )}
      </header>
      {book.navDepth > 0 ? <div className="edge-swipe" ref={edgeRef} /> : null}
      <main ref={viewRef} id="view" className={`${tabbed ? "with-tabs" : ""} ${tabbed && showFab ? "with-fab" : ""}`}>
        <div id="page" ref={pageRef}>
        {book.phase === "loading" ? <OpeningScreen /> : null}
        {book.phase === "auth" ? <AuthScreen /> : null}
        {book.phase === "signup" ? <SignupScreen /> : null}
        {book.phase === "reset" ? <ResetScreen /> : null}
        {book.phase === "password" ? <PasswordScreen /> : null}
        {book.phase === "start" ? <StartScreen /> : null}
        {book.phase === "join" ? <JoinScreen /> : null}
        {book.phase === "copy" || book.phase === "copy-error" ? <CopyScreen /> : null}
        {book.phase === "app" && book.screen === "today" ? <TodayScreen /> : null}
        {book.phase === "app" && book.screen === "leads" ? <LeadsScreen /> : null}
        {book.phase === "app" && book.screen === "customers" ? <CustomersScreen /> : null}
        {book.phase === "app" && book.screen === "account" ? <AccountScreen /> : null}
        {book.phase === "app" && book.screen === "member" ? <MemberScreen /> : null}
        {book.phase === "app" && book.screen === "message" ? <MessageScreen /> : null}
        {book.phase === "app" && book.screen === "detail" ? <DetailScreen /> : null}
        {book.phase === "app" && book.screen === "edit" ? <EditScreen key={book.detailId ?? "new"} /> : null}
        </div>
      </main>
      {tabbed ? (
        <nav id="tabbar">
          <button className={`tab ${book.screen === "today" ? "on" : ""}`} type="button" onClick={() => book.goTab("today")}>
            {badge ? <span className={`badge ${dueCounts.overdue ? "overdue" : "today-due"}`}>{badge}</span> : null}
            <IconToday />
            Today
          </button>
          <button className={`tab ${book.screen === "leads" ? "on" : ""}`} type="button" onClick={() => book.goTab("leads")}>
            <IconLeads />
            Leads
          </button>
          <button className={`tab ${book.screen === "customers" ? "on" : ""}`} type="button" onClick={() => book.goTab("customers")}>
            <IconCustomers />
            Customers
          </button>
        </nav>
      ) : null}
      {tabbed && showFab ? (
        <button id="fab" type="button" aria-label="New lead" onClick={book.startDraft}>
          <IconPlus />
        </button>
      ) : null}
      {book.undo ? (
        <div id="toast" className={tabbed ? "" : "low"} role="status">
          <span>{book.undo}</span>
          <button className="undo-btn" type="button" onClick={() => void book.undoLast()}>
            Undo
          </button>
        </div>
      ) : book.toast ? (
        <div id="toast" className={tabbed ? "" : "low"}>{book.toast}</div>
      ) : null}
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
      {book.updateReady ? (
        <button className="update-banner" type="button" onClick={book.applyUpdate}>
          Update ready — refresh
        </button>
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
      {book.sheet === "remove" ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>Remove {book.profiles.find((profile) => profile.id === book.pendingMemberId)?.displayName || "this person"}?</h2>
            <p>They lose access. They can join again with a current invite code.</p>
            <button className="danger" type="button" onClick={() => void book.confirmRemove()}>
              Remove from team
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {book.sheet === "transfer" ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>Make {book.profiles.find((profile) => profile.id === book.pendingMemberId)?.displayName || "them"} the owner?</h2>
            <p>You become a member. They can remove people and change the invite code.</p>
            <button className="primary" type="button" onClick={() => void book.confirmTransfer()}>
              Transfer ownership
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {book.sheet === "discard" ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>Leave without saving?</h2>
            <p>The changes on this screen will be dropped.</p>
            <button className="danger" type="button" onClick={book.confirmDiscard}>
              Discard
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Keep editing
            </button>
          </div>
        </div>
      ) : null}
      {book.sheet === "code" ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>New invite code?</h2>
            <p>The current code stops working for anyone who has not joined yet.</p>
            <button className="primary" type="button" onClick={() => void book.confirmRegenerate()}>
              Replace code
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {book.sheet === "duplicate" ? (
        <div id="sheet" onClick={(event) => event.currentTarget === event.target && book.setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>This number is already on {book.duplicateLeadName}</h2>
            <p>Save this lead anyway, or go back and check.</p>
            <button className="primary" type="button" onClick={() => void book.confirmDuplicate()}>
              Save anyway
            </button>
            <button className="ghost wide" type="button" onClick={() => book.setSheet(null)}>
              Go back
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
