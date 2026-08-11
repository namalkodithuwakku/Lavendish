"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth-provider";
import { hotels } from "../dashboard-data";
import { masterNavigation, NavigationIcon } from "../navigation-icons";
import { hasPageAccess, pageCodeForHref } from "../page-access";
import "./group-overview.css";

type ViewMode = "numbers" | "percentage";
type LoadState = "waiting" | "loading" | "ready" | "stale" | "error";
type PortfolioHotel = {
  code: string;
  name: string;
  location: string;
  rooms: number;
  occupied: number[];
  state: LoadState;
  error?: string;
  updated?: string;
  needsSync?: boolean;
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const READ_BATCH_SIZE = 5;
const HOTEL_CODES = hotels.map((hotel) => hotel.code);
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function heatClass(value: number, total: number) {
  const result = percentage(value, total);
  if (result >= 100) return "soldout";
  if (result >= 80) return "strong";
  if (result >= 50) return "medium";
  if (result >= 25) return "soft";
  return "quiet";
}

function initialMonth() {
  const current = new Date();
  if (typeof window === "undefined")
    return new Date(current.getFullYear(), current.getMonth(), 1);
  const stored = window.localStorage.getItem("occupancy:groupMonth");
  const match = stored?.match(/^(\d{4})-(\d{1,2})$/);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date(current.getFullYear(), current.getMonth(), 1);
}

function initialView(): ViewMode {
  return typeof window !== "undefined" &&
    window.localStorage.getItem("occupancy:groupView") === "percentage"
    ? "percentage"
    : "numbers";
}

function emptyPortfolio(days: number): PortfolioHotel[] {
  return hotels.map((hotel) => ({
    code: hotel.code,
    name: hotel.name,
    location: hotel.location,
    rooms: hotel.rooms,
    occupied: Array(days).fill(0),
    state: "waiting",
  }));
}

function cacheKey(year: number, month: number) {
  return `occupancy:groupCache:${year}-${month}`;
}

function readBrowserCache(year: number, month: number, days: number) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(year, month));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; hotels: PortfolioHotel[] };
    if (!Array.isArray(parsed.hotels) || !Number.isFinite(parsed.savedAt)) return null;
    const byCode = new Map(parsed.hotels.map((hotel) => [hotel.code, hotel]));
    return {
      savedAt: parsed.savedAt,
      fresh: Date.now() - parsed.savedAt < CACHE_TTL_MS,
      hotels: hotels.map((hotel) => {
        const cached = byCode.get(hotel.code);
        return cached && cached.state !== "error"
          ? {
              ...cached,
              name: cached.name || hotel.name,
              location: cached.location || hotel.location,
              rooms: Number(cached.rooms || hotel.rooms),
              occupied: Array.from({ length: days }, (_, index) =>
                Number(cached.occupied?.[index] ?? 0),
              ),
              state: "ready" as LoadState,
              error: undefined,
            }
          : {
              code: hotel.code,
              name: hotel.name,
              location: hotel.location,
              rooms: hotel.rooms,
              occupied: Array(days).fill(0),
              state: "waiting" as LoadState,
            };
      }),
    };
  } catch {
    return null;
  }
}

function saveBrowserCache(year: number, month: number, portfolio: PortfolioHotel[]) {
  if (typeof window === "undefined") return;
  const cacheable = portfolio.map((hotel) =>
    hotel.state === "ready" || hotel.state === "stale"
      ? { ...hotel, state: "ready" as LoadState, error: undefined }
      : { ...hotel, state: "error" as LoadState },
  );
  window.localStorage.setItem(
    cacheKey(year, month),
    JSON.stringify({ savedAt: Date.now(), hotels: cacheable }),
  );
}

export default function GroupOverviewPage() {
  const { access, session, signOut } = useAuth();
  const now = new Date();
  const [monthCursor, setMonthCursor] = useState(initialMonth);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioHotel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => initialMonth().getFullYear());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const backgroundSyncKey = useRef("");
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1;
  const focusDay = selectedDay ?? (isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : 1);
  const focusIndex = focusDay - 1;
  const hasFullPortfolioAccess = Boolean(
    access?.hotel_codes.includes("ALL") ||
      HOTEL_CODES.every((code) => access?.hotel_codes.includes(code)),
  );

  const readHotel = useCallback(
    async (
      hotel: (typeof hotels)[number],
      previous: PortfolioHotel | undefined,
      forceFresh: boolean,
    ): Promise<PortfolioHotel> => {
      const fallback = previous ?? {
        code: hotel.code,
        name: hotel.name,
        location: hotel.location,
        rooms: hotel.rooms,
        occupied: Array(daysInMonth).fill(0),
        state: "waiting" as LoadState,
      };
      if (!session) return { ...fallback, state: "error", error: "Session unavailable" };
      let lastError = "Sheet could not be read";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(
            `/api/occupancy?hotel=${encodeURIComponent(hotel.code)}&year=${year}&month=${month}&group=1`,
            {
              method: forceFresh ? "POST" : "GET",
              cache: "no-store",
              headers: { Authorization: `Bearer ${session.access_token}` },
            },
          );
          const data = await response.json();
          if (!response.ok || !data.success)
            throw new Error(data.error ?? "Sheet could not be read");
          return {
            ...fallback,
            name: data.hotelName || hotel.name,
            rooms: Number(data.totalRooms || hotel.rooms),
            occupied: Array.from({ length: daysInMonth }, (_, index) =>
              Number(
                data.days?.find((day: { day: number }) => day.day === index + 1)
                  ?.occupied ?? 0,
              ),
            ),
            updated: `${data.lastUpdatedDate || "Sheet"} ${data.lastUpdatedTime || ""}`.trim(),
            state: "ready",
            error: undefined,
            needsSync: Boolean(data.syncNeeded),
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError;
        }
      }
      const hasLastGoodData =
        previous &&
        (previous.state === "ready" || previous.state === "stale") &&
        previous.occupied.length === daysInMonth &&
        previous.occupied.every((value) => Number.isFinite(value));
      return {
        ...fallback,
        state: hasLastGoodData ? "stale" : "error",
        error: lastError,
        needsSync: true,
      };
    },
    [daysInMonth, month, session, year],
  );

  const loadPortfolio = useCallback(async (forceFresh = false) => {
    if (!session || !hasFullPortfolioAccess) return;
    const cached = readBrowserCache(year, month, daysInMonth);
    let working = cached?.hotels ?? emptyPortfolio(daysInMonth);
    setPortfolio(working);
    if (cached) setLastUpdated(new Date(cached.savedAt));
    setRefreshing(true);
    for (let index = 0; index < hotels.length; index += READ_BATCH_SIZE) {
      const batch = hotels.slice(index, index + READ_BATCH_SIZE);
      setPortfolio((current) =>
        current.map((entry) =>
          batch.some((hotel) => hotel.code === entry.code) && entry.state === "waiting"
            ? { ...entry, state: "loading" }
            : entry,
        ),
      );
      const results = await Promise.all(
        batch.map((hotel) =>
          readHotel(
            hotel,
            working.find((entry) => entry.code === hotel.code),
            forceFresh,
          ),
        ),
      );
      const updates = new Map(results.map((entry) => [entry.code, entry]));
      working = working.map((entry) => updates.get(entry.code) ?? entry);
      setPortfolio(working);
    }
    saveBrowserCache(year, month, working);
    setLastUpdated(new Date());
    setRefreshing(false);
  }, [daysInMonth, hasFullPortfolioAccess, month, readHotel, session, year]);

  useEffect(() => {
    setSelectedDay(null);
    void loadPortfolio(false);
  }, [loadPortfolio]);
  useEffect(() => {
    if (!hasFullPortfolioAccess) return;
    const timer = window.setInterval(() => void loadPortfolio(false), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasFullPortfolioAccess, loadPortfolio]);
  useEffect(() => {
    if (!session || !hasFullPortfolioAccess || portfolio.length !== hotels.length) return;
    if (portfolio.some((hotel) => hotel.state === "waiting" || hotel.state === "loading")) return;
    const pending = portfolio.filter((hotel) => hotel.needsSync);
    const key = `${year}-${month}`;
    if (!pending.length || backgroundSyncKey.current === key) return;
    backgroundSyncKey.current = key;
    setBackgroundRefreshing(true);
    let cancelled = false;

    void (async () => {
      let working = portfolio;
      for (let index = 0; index < pending.length; index += READ_BATCH_SIZE) {
        const batch = pending.slice(index, index + READ_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((entry) => {
            const hotel = hotels.find((item) => item.code === entry.code)!;
            return readHotel(hotel, entry, true);
          }),
        );
        if (cancelled) return;
        const updates = new Map(results.map((entry) => [entry.code, entry]));
        working = working.map((entry) => updates.get(entry.code) ?? entry);
        setPortfolio(working);
      }
      if (!cancelled) {
        saveBrowserCache(year, month, working);
        setLastUpdated(new Date());
        setBackgroundRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
      setBackgroundRefreshing(false);
    };
  }, [hasFullPortfolioAccess, month, readHotel, refreshing, session, year]);
  useEffect(() => {
    window.localStorage.setItem("occupancy:groupMonth", `${year}-${month}`);
  }, [month, year]);
  useEffect(() => {
    window.localStorage.setItem("occupancy:groupView", viewMode);
  }, [viewMode]);
  useEffect(() => {
    const closePicker = (event: PointerEvent) => {
      if (!monthPickerRef.current?.contains(event.target as Node)) setMonthPickerOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMonthPickerOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    window.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePicker);
      window.removeEventListener("keydown", closeWithKeyboard);
    };
  }, []);

  const readyHotels = portfolio.filter((hotel) => hotel.state === "ready" || hotel.state === "stale");
  const failedHotels = portfolio.filter((hotel) => hotel.state === "error" || hotel.state === "stale");
  const inventory = portfolio.reduce((sum, hotel) => sum + hotel.rooms, 0);
  const dailySold = Array.from({ length: daysInMonth }, (_, index) =>
    readyHotels.reduce((sum, hotel) => sum + Number(hotel.occupied[index] ?? 0), 0),
  );
  const dailyCapacity = Array.from({ length: daysInMonth }, () =>
    readyHotels.reduce((sum, hotel) => sum + hotel.rooms, 0),
  );
  const selectedSold = dailySold[focusIndex] ?? 0;
  const selectedCapacity = dailyCapacity[focusIndex] ?? 0;
  const selectedAvailable = Math.max(0, selectedCapacity - selectedSold);
  const tomorrowSold = dailySold[focusIndex + 1] ?? 0;
  const nextSeven = dailySold.slice(focusIndex, focusIndex + 7);
  const nextSevenSold = nextSeven.reduce((sum, value) => sum + value, 0);
  const nextSevenCapacity = dailyCapacity
    .slice(focusIndex, focusIndex + 7)
    .reduce((sum, value) => sum + value, 0);
  const monthSold = dailySold.reduce((sum, value) => sum + value, 0);
  const monthCapacity = dailyCapacity.reduce((sum, value) => sum + value, 0);
  const monthLabel = monthFormatter.format(monthCursor);
  const shortMonth = shortMonthFormatter.format(monthCursor).toUpperCase();
  const monthOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const display = (value: number, total: number) =>
    viewMode === "numbers" ? value.toLocaleString() : `${percentage(value, total)}%`;
  const profileName = String(
    session?.user.user_metadata?.full_name ??
      session?.user.user_metadata?.name ??
      session?.user.email?.split("@")[0] ??
      "User",
  );
  const firstName = profileName.trim().split(/\s+/)[0];

  if (!hasFullPortfolioAccess)
    return (
      <main className="group-access-blocked">
        <section>
          <span>NKH</span>
          <h1>Full portfolio access required</h1>
          <p>Group Overview is available only to users who can view all 10 hotels.</p>
          <Link href="/">Return to hotel dashboard</Link>
        </section>
      </main>
    );

  return (
    <main className={`group-shell ${sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <aside
        className={`rail group-rail ${sidebarOpen ? "expanded" : "collapsed"}`}
        onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) setSidebarOpen(true); }}
        onMouseLeave={() => { if (window.matchMedia("(hover: hover)").matches) setSidebarOpen(false); }}
      >
        <div className="rail-brand">
          <div className="logo">NKH</div>
          <div className="rail-brand-copy"><b>Performance Hub</b><span>N K Hotels</span></div>
        </div>
        <nav aria-label="Main navigation">
          {hasPageAccess(access?.page_codes,"HOTEL_OCCUPANCY")&&<Link className="rail-nav-link" href="/"><span><NavigationIcon name="hotel"/></span><b>Hotel Occupancy</b></Link>}
          <Link className="rail-nav-link active" href="/group-overview"><span><NavigationIcon name="group"/></span><b>Group Occupancy</b></Link>
          {masterNavigation.filter(item=>{const code=pageCodeForHref(item.href);return code&&hasPageAccess(access?.page_codes,code)}).map(item=><Link className="rail-nav-link" href={item.href} key={item.href}><span><NavigationIcon name={item.icon}/></span><b>{item.label}</b></Link>)}
        </nav>
        <div className="nkh-authority"><span>NKH</span><div><b>System by</b><strong>N K Hotels</strong></div></div>
      </aside>
      {sidebarOpen && <button className="rail-backdrop" aria-label="Close navigation menu" onClick={() => setSidebarOpen(false)} />}
      <header className="group-topbar">
        <button className="mobile-menu-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label="Open navigation menu">☰</button>
        <Link className="group-brand" href="/">
          <span>ALL</span>
          <div><small>ACTIVE PORTFOLIO</small><b>Lavendish Leisure</b></div>
        </Link>
        <div className="header-tools">
          <div className="mode-switch" aria-label="Display format">
            <button className={viewMode === "numbers" ? "active" : ""} onClick={() => setViewMode("numbers")}>Numbers</button>
            <button className={viewMode === "percentage" ? "active" : ""} onClick={() => setViewMode("percentage")}>Percentage</button>
          </div>
          <button className="user-button" onClick={signOut} title="Sign out">{firstName} <span>↗</span></button>
        </div>
      </header>

      <section className="group-page">
        <header className="group-title-row">
          <div>
            <p>PORTFOLIO PERFORMANCE</p>
            <h1>Lavendish Group Overview</h1>
            <span>Combined occupancy performance across all 10 hotels.</span>
          </div>
          <div className="group-title-actions">
            <div className="month-jump-wrap" ref={monthPickerRef}>
              <div className="group-month-control">
                <button aria-label="Previous month" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</button>
                <button className="month-jump-trigger" onClick={() => { setPickerYear(year); setMonthPickerOpen((open) => !open); }} aria-expanded={monthPickerOpen}><strong>{monthLabel}</strong></button>
                <button aria-label="Next month" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</button>
              </div>
              {monthPickerOpen && (
                <div className="month-jump-panel">
                  <header><select aria-label="Select year" value={pickerYear} onChange={(event) => setPickerYear(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => now.getFullYear() - 2 + index).map((optionYear) => <option key={optionYear}>{optionYear}</option>)}</select></header>
                  <div>{MONTH_NAMES.map((name, index) => <button type="button" className={pickerYear === year && index + 1 === month ? "active" : ""} key={name} onClick={() => { setMonthCursor(new Date(pickerYear, index, 1)); setMonthPickerOpen(false); }}>{name}</button>)}</div>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="group-status-bar">
          <div>
            <span className={failedHotels.length ? "partial" : readyHotels.length === 10 ? "live" : "loading"} />
            <b>{readyHotels.length} of 10 hotels loaded</b>
            <small>{backgroundRefreshing ? " • Updating from Sheets in background…" : failedHotels.length ? ` • ${failedHotels.length} need attention` : " • Supabase data ready"}</small>
          </div>
          <button disabled={refreshing || backgroundRefreshing} onClick={() => void loadPortfolio(true)}>{refreshing || backgroundRefreshing ? "Refreshing…" : "Refresh all hotels"}</button>
        </section>

        <section className="group-kpis">
          <article className="inventory"><span>TOTAL ROOM INVENTORY</span><b>{inventory}</b><small>Across 10 hotels</small></article>
          <article className="primary"><span>ROOMS SOLD — {focusDay} {shortMonth}</span><b>{display(selectedSold, selectedCapacity)}{viewMode === "numbers" && <small> / {selectedCapacity}</small>}</b><div><i style={{ width: `${Math.min(100, percentage(selectedSold, selectedCapacity))}%` }} /></div><small>{percentage(selectedSold, selectedCapacity)}% group occupancy</small></article>
          <article><span>ROOMS AVAILABLE</span><b>{display(selectedAvailable, selectedCapacity)}</b><small>Available across loaded hotels</small></article>
          <article><span>NEXT DAY SOLD</span><b>{display(tomorrowSold, dailyCapacity[focusIndex + 1] ?? 0)}</b><small>{Math.max(0, (dailyCapacity[focusIndex + 1] ?? 0) - tomorrowSold)} rooms available</small></article>
          <article><span>NEXT 7 DAYS</span><b>{display(nextSevenSold, nextSevenCapacity)}</b><small>{nextSevenSold.toLocaleString()} of {nextSevenCapacity.toLocaleString()} room nights</small></article>
          <article><span>{monthLabel.toUpperCase()}</span><b>{display(monthSold, monthCapacity)}</b><small>{monthSold.toLocaleString()} room nights sold</small></article>
        </section>

        <section className="group-content-grid">
          <article className="group-calendar-panel">
            <header><div><h2>Group room position</h2><p>Select a date to compare all 10 hotels.</p></div><span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading live data…"}</span></header>
            <div className="group-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="group-calendar-grid">
              {Array.from({ length: monthOffset }, (_, index) => <span className="calendar-spacer" key={`space-${index}`} />)}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const day = index + 1;
                const sold = dailySold[index] ?? 0;
                const capacity = dailyCapacity[index] ?? 0;
                return <button className={`${heatClass(sold, capacity)} ${focusDay === day ? "selected" : ""}`} key={day} onClick={() => setSelectedDay(day)}><span>{day}</span><b>{viewMode === "numbers" ? sold : `${percentage(sold, capacity)}%`}</b><small>{Math.max(0, capacity - sold)} available</small></button>;
              })}
            </div>
          </article>

          <aside className="group-day-summary">
            <header><div><p>SELECTED DATE</p><h2>{focusDay} {monthLabel}</h2></div><span>{percentage(selectedSold, selectedCapacity)}%</span></header>
            <dl><div><dt>Group inventory</dt><dd>{selectedCapacity}</dd></div><div><dt>Rooms sold</dt><dd>{selectedSold}</dd></div><div><dt>Rooms available</dt><dd>{selectedAvailable}</dd></div><div><dt>Hotels reporting</dt><dd>{readyHotels.length}/10</dd></div></dl>
          </aside>
        </section>

        <section className="group-performance-breakdowns">
          <section className="group-hotel-panel">
            <header><div><h2>Day Performance Breakdown</h2><p>Hotel position for {focusDay} {monthLabel}, ranked by occupancy.</p></div></header>
            <div className="group-hotel-table">
              <div className="group-hotel-head"><span>Hotel</span><span>Rooms</span><span>Sold</span><span>Available</span><span>Occupancy</span></div>
              {[...portfolio].sort((a, b) => percentage(b.occupied[focusIndex] ?? 0, b.rooms) - percentage(a.occupied[focusIndex] ?? 0, a.rooms)).map((hotel) => {
                const sold = hotel.occupied[focusIndex] ?? 0;
                const occupancy = percentage(sold, hotel.rooms);
                const hasData = hotel.state === "ready" || hotel.state === "stale";
                return <article className={hotel.state === "error" || hotel.state === "stale" ? "read-error" : ""} key={hotel.code}><div className="group-hotel-name"><span>{hotel.code}</span><div><b>{hotel.name}</b><small>{hotel.state === "error" || hotel.state === "stale" ? `${hotel.state === "stale" ? "Last good data • " : ""}${hotel.error}` : hotel.location}</small></div></div><strong>{hotel.rooms}</strong><strong>{hasData ? sold : "—"}</strong><strong>{hasData ? Math.max(0, hotel.rooms - sold) : "—"}</strong><div className="hotel-occupancy"><b>{hasData ? `${occupancy}%${hotel.state === "stale" ? " cached" : ""}` : hotel.state === "error" ? "Read failed" : "Loading"}</b><span><i style={{ width: hasData ? `${Math.min(100, occupancy)}%` : "0%" }} /></span></div></article>;
              })}
            </div>
          </section>
          <section className="group-hotel-panel month-breakdown">
            <header><div><h2>Month Performance Breakdown</h2><p>Room-night performance for {monthLabel}, ranked by occupancy.</p></div></header>
            <div className="group-hotel-table">
              <div className="group-hotel-head"><span>Hotel</span><span>Inventory</span><span>Sold</span><span>Available</span><span>Occupancy</span></div>
              {[...portfolio].sort((a, b) => {
                const bSold = b.occupied.reduce((sum, value) => sum + Number(value || 0), 0);
                const aSold = a.occupied.reduce((sum, value) => sum + Number(value || 0), 0);
                return percentage(bSold, b.rooms * daysInMonth) - percentage(aSold, a.rooms * daysInMonth);
              }).map((hotel) => {
                const sold = hotel.occupied.reduce((sum, value) => sum + Number(value || 0), 0);
                const capacity = hotel.rooms * daysInMonth;
                const occupancy = percentage(sold, capacity);
                const hasData = hotel.state === "ready" || hotel.state === "stale";
                return <article className={hotel.state === "error" || hotel.state === "stale" ? "read-error" : ""} key={hotel.code}><div className="group-hotel-name"><span>{hotel.code}</span><div><b>{hotel.name}</b><small>{hotel.state === "error" || hotel.state === "stale" ? `${hotel.state === "stale" ? "Last good data • " : ""}${hotel.error}` : hotel.location}</small></div></div><strong>{capacity.toLocaleString()}</strong><strong>{hasData ? sold.toLocaleString() : "—"}</strong><strong>{hasData ? Math.max(0, capacity - sold).toLocaleString() : "—"}</strong><div className="hotel-occupancy"><b>{hasData ? `${occupancy}%${hotel.state === "stale" ? " cached" : ""}` : hotel.state === "error" ? "Read failed" : "Loading"}</b><span><i style={{ width: hasData ? `${Math.min(100, occupancy)}%` : "0%" }} /></span></div></article>;
              })}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
