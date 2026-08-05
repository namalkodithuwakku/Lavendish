"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import { hotels, type HotelData } from "./dashboard-data";

type ViewMode = "numbers" | "percentage";
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const MOBILE_WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
});
const wait = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));
function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
function heatClass(value: number, total: number) {
  const percent = pct(value, total);
  if (percent >= 100) return "soldout";
  if (percent >= 80) return "strong";
  if (percent >= 50) return "medium";
  if (percent >= 25) return "soft";
  return "quiet";
}
function sourceGroup(name: string): HotelData["sources"][number]["group"] {
  return /booking|agoda|expedia|trip/i.test(name)
    ? "ota"
    : /fit|website|direct/i.test(name)
      ? "direct"
      : /foc/i.test(name)
        ? "other"
        : "agent";
}
function savedHotel() {
  return typeof window !== "undefined"
    ? window.localStorage.getItem("occupancy:lastHotel") || hotels[0].code
    : hotels[0].code;
}
function savedView(): ViewMode {
  return typeof window !== "undefined" &&
    window.localStorage.getItem("occupancy:viewMode") === "percentage"
    ? "percentage"
    : "numbers";
}
function savedMonth() {
  const fallback = new Date(),
    value =
      typeof window !== "undefined"
        ? window.localStorage.getItem("occupancy:lastMonth")
        : null,
    match = value?.match(/^(\d{4})-(\d{1,2})$/);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date(fallback.getFullYear(), fallback.getMonth(), 1);
}

export default function Home() {
  const { access, session, signOut } = useAuth();
  const now = new Date();
  const hasFullPortfolioAccess = Boolean(
    access?.hotel_codes.includes("ALL") ||
      hotels.every((item) => access?.hotel_codes.includes(item.code)),
  );
  const accessibleHotels = useMemo(
    () =>
      access?.hotel_codes.includes("ALL")
        ? hotels
        : hotels.filter((item) => access?.hotel_codes.includes(item.code)),
    [access],
  );
  const [hotelCode, setHotelCode] = useState(savedHotel),
    [viewMode, setViewMode] = useState<ViewMode>(savedView),
    [monthCursor, setMonthCursor] = useState(savedMonth),
    [liveHotel, setLiveHotel] = useState<HotelData | null>(null),
    [liveMessage, setLiveMessage] = useState("Connecting to Google Sheet…"),
    [refreshing, setRefreshing] = useState(false),
    [lastSuccess, setLastSuccess] = useState(0),
    [selectedDay, setSelectedDay] = useState<number | null>(null),
    [hotelPickerOpen, setHotelPickerOpen] = useState(false),
    [monthPickerOpen, setMonthPickerOpen] = useState(false),
    [pickerYear, setPickerYear] = useState(() => savedMonth().getFullYear()),
    [sidebarOpen, setSidebarOpen] = useState(false);
  const cache = useRef(new Map<string, HotelData>());
  const hotelPickerRef = useRef<HTMLDivElement>(null);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const baseHotel =
    accessibleHotels.find((item) => item.code === hotelCode) ??
    accessibleHotels[0] ??
    hotels[0];
  const year = monthCursor.getFullYear(),
    month = monthCursor.getMonth() + 1,
    daysInMonth = new Date(year, month, 0).getDate(),
    cacheKey = `${baseHotel.code}-${year}-${month}`;
  const emptyHotel = useMemo<HotelData>(
    () => ({
      ...baseHotel,
      occupied: Array(daysInMonth).fill(0),
      sources: [],
      functions: 0,
      allotment: 0,
      updated: "Waiting for Sheet",
      updatedState: "old",
    }),
    [baseHotel, daysInMonth],
  );
  const hasLive = Boolean(
    liveHotel && cache.current.get(cacheKey) === liveHotel,
  );
  const hotel = hasLive && liveHotel ? liveHotel : emptyHotel;
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1;
  const focusDay = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : 1,
    focusIndex = focusDay - 1;
  const monthLabel = monthFormatter.format(monthCursor),
    monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
      monthCursor,
    ),
    shortMonth = shortMonthFormatter.format(monthCursor).toUpperCase();
  const mobileMonthStartOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  const loadLive = useCallback(
    async (manual = false) => {
      if (!session) return;
      const cached = cache.current.get(cacheKey);
      if (cached && !manual) setLiveHotel(cached);
      setRefreshing(true);
      setLiveMessage(
        manual ? "Refreshing from Google Sheet…" : "Loading saved occupancy…",
      );
      const applyData = (
        data: {
          hotelName?: string;
          totalRooms?: number;
          days?: { day: number; occupied?: number }[];
          sources?: { name: string; rooms: number; days?: { day: number; rooms: number }[] }[];
          dailySources?: { day: number; rooms: { name: string; rooms: number }[] }[];
          functions?: number;
          allotment?: number;
          lastUpdatedDate?: string;
          lastUpdatedTime?: string;
        },
      ) => {
        const occupied = Array.from({ length: daysInMonth }, (_, index) =>
          Number(data.days?.find((day) => day.day === index + 1)?.occupied ?? 0),
        );
        const next: HotelData = {
          ...baseHotel,
          name: data.hotelName || baseHotel.name,
          rooms: Number(data.totalRooms || baseHotel.rooms),
          occupied,
          sources: (data.sources ?? []).map((source) => ({
            name: source.name,
            rooms: Number(source.rooms || 0),
            group: sourceGroup(source.name),
            daily: Array.from({ length: daysInMonth }, (_, index) =>
              Number(
                data.dailySources
                  ?.find((entry) => entry.day === index + 1)
                  ?.rooms.find((entry) => entry.name === source.name)?.rooms ??
                  source.days?.find((entry) => entry.day === index + 1)?.rooms ??
                  0,
              ),
            ),
          })),
          functions: Number(data.functions || 0),
          allotment: Number(data.allotment || 0),
          updated:
            `${data.lastUpdatedDate || "Saved data"} ${data.lastUpdatedTime || ""}`.trim(),
          updatedState: "current",
        };
        cache.current.set(cacheKey, next);
        setLiveHotel(next);
        setLastSuccess(Date.now());
      };
      let finalError = "Live Sheet is unavailable";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(
              `/api/occupancy?hotel=${encodeURIComponent(baseHotel.code)}&year=${year}&month=${month}`,
              {
                method: manual ? "POST" : "GET",
                cache: "no-store",
                headers: { Authorization: `Bearer ${session.access_token}` },
              },
            ),
            data = await response.json();
          if (!response.ok || !data.success)
            throw new Error(data.error ?? "Live Sheet is unavailable");
          applyData(data);
          if (!manual && data.syncNeeded) {
            setLiveMessage("Saved data shown • updating from Google Sheet…");
            setRefreshing(false);
            void fetch(
              `/api/occupancy?hotel=${encodeURIComponent(baseHotel.code)}&year=${year}&month=${month}`,
              {
                method: "POST",
                cache: "no-store",
                headers: { Authorization: `Bearer ${session.access_token}` },
              },
            )
              .then(async (syncResponse) => {
                const freshData = await syncResponse.json();
                if (!syncResponse.ok || !freshData.success)
                  throw new Error(freshData.error ?? "Background refresh failed");
                applyData(freshData);
                setLiveMessage(
                  freshData.savedToSupabase === false
                    ? "Live Google Sheet • cache unavailable"
                    : "Live Google Sheet • saved to Supabase",
                );
              })
              .catch((error) =>
                setLiveMessage(
                  `Last successful data kept • ${error instanceof Error ? error.message : "Background refresh failed"}`,
                ),
              );
            return;
          }
          setLiveMessage(
            data.source === "supabase"
              ? "Fast saved data • recently synchronized"
              : data.savedToSupabase === false
                ? "Live Google Sheet • cache unavailable"
                : "Live Google Sheet • saved to Supabase",
          );
          setRefreshing(false);
          return;
        } catch (error) {
          finalError = error instanceof Error ? error.message : finalError;
          if (attempt < 2) await wait(600 * (attempt + 1));
        }
      }
      setLiveMessage(
        cached ? `Last good data kept • ${finalError}` : finalError,
      );
      setRefreshing(false);
    },
    [baseHotel, cacheKey, daysInMonth, month, session, year],
  );

  useEffect(() => {
    setLiveHotel(cache.current.get(cacheKey) ?? null);
    void loadLive();
  }, [cacheKey, loadLive]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadLive(), AUTO_REFRESH_MS);
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastSuccess > 60000
      )
        void loadLive();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [lastSuccess, loadLive]);
  useEffect(() => {
    if (
      accessibleHotels.length &&
      !accessibleHotels.some((item) => item.code === hotelCode)
    )
      setHotelCode(accessibleHotels[0].code);
  }, [accessibleHotels, hotelCode]);
  useEffect(() => {
    if (accessibleHotels.some((item) => item.code === hotelCode))
      window.localStorage.setItem("occupancy:lastHotel", hotelCode);
  }, [accessibleHotels, hotelCode]);
  useEffect(() => {
    window.localStorage.setItem("occupancy:viewMode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    window.localStorage.setItem("occupancy:lastMonth", `${year}-${month}`);
  }, [month, year]);
  useEffect(() => {
    if (!session || !hasFullPortfolioAccess) return;
    const warmKey = `occupancy:portfolioWarm:${year}-${month}`;
    const lastWarm = Number(window.localStorage.getItem(warmKey) || 0);
    if (Date.now() - lastWarm < 10 * 60 * 1000) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (let index = 0; index < hotels.length && !cancelled; index += 2) {
          const batch = hotels.slice(index, index + 2);
          await Promise.all(
            batch.map(async (item) => {
              try {
                const url = `/api/occupancy?hotel=${encodeURIComponent(item.code)}&year=${year}&month=${month}&group=1`;
                const cachedResponse = await fetch(url, {
                  cache: "no-store",
                  headers: { Authorization: `Bearer ${session.access_token}` },
                });
                const cachedData = await cachedResponse.json();
                if (!cancelled && cachedResponse.ok && cachedData.success && cachedData.syncNeeded)
                  await fetch(url, {
                    method: "POST",
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${session.access_token}` },
                  });
              } catch {
                // Background warming is best-effort and never interrupts the
                // selected hotel's dashboard.
              }
            }),
          );
        }
        if (!cancelled) window.localStorage.setItem(warmKey, String(Date.now()));
      })();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasFullPortfolioAccess, month, session, year]);
  useEffect(() => {
    setSelectedDay(null);
  }, [cacheKey]);
  useEffect(() => {
    if (selectedDay === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedDay(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedDay]);
  useEffect(() => {
    const closePickers = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!hotelPickerRef.current?.contains(target)) setHotelPickerOpen(false);
      if (!monthPickerRef.current?.contains(target)) setMonthPickerOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHotelPickerOpen(false);
        setMonthPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", closePickers);
    window.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePickers);
      window.removeEventListener("keydown", closeWithKeyboard);
    };
  }, []);

  const stats = useMemo(() => {
    const selected = hotel.occupied[focusIndex] ?? 0,
      nextSeven = hotel.occupied.slice(focusIndex, focusIndex + 7),
      sevenSold = nextSeven.reduce((sum, value) => sum + value, 0),
      sevenCapacity = nextSeven.length * hotel.rooms,
      monthSold = hotel.occupied.reduce((sum, value) => sum + value, 0);
    return {
      selected,
      available: hotel.rooms - selected,
      tomorrow: hotel.occupied[focusIndex + 1] ?? 0,
      sevenSold,
      sevenCapacity,
      monthSold,
      monthCapacity: hotel.rooms * daysInMonth,
    };
  }, [daysInMonth, focusIndex, hotel]);
  const display = (value: number, total = hotel.rooms) =>
      viewMode === "numbers" ? value : `${pct(value, total)}%`,
    sourceTotal = hotel.sources.reduce((sum, item) => sum + item.rooms, 0);
  const daySources = useMemo(
    () =>
      selectedDay === null
        ? []
        : hotel.sources
            .map((source) => ({
              name: source.name,
              rooms: Number(source.daily?.[selectedDay - 1] ?? 0),
              group: source.group,
            }))
            .filter((source) => source.rooms > 0)
            .sort((a, b) => b.rooms - a.rooms),
    [hotel.sources, selectedDay],
  );
  const daySourceTotal = daySources.reduce(
    (sum, source) => sum + source.rooms,
    0,
  );
  const selectedDayTotal =
    selectedDay === null ? 0 : Number(hotel.occupied[selectedDay - 1] ?? 0);
  const unclassifiedRooms = Math.max(0, selectedDayTotal - daySourceTotal);
  const moveMonth = (direction: number) =>
    setMonthCursor(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  const profileName = String(
      session?.user.user_metadata?.full_name ??
        session?.user.user_metadata?.name ??
        "",
    ).trim(),
    firstName =
      profileName.split(/\s+/)[0] ||
      session?.user.email?.split("@")[0] ||
      "User";

  return (
    <main className={`app ${sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <aside
        className={`rail ${sidebarOpen ? "expanded" : "collapsed"}`}
        onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) setSidebarOpen(true); }}
        onMouseLeave={() => { if (window.matchMedia("(hover: hover)").matches) setSidebarOpen(false); }}
      >
        <div className="rail-brand">
          <div className="logo">LI</div>
          <div className="rail-brand-copy"><b>Lavendish</b><span>Intelligence</span></div>
        </div>
        <nav aria-label="Main navigation">
          <Link className="rail-nav-link active" href="/"><span>HV</span><b>Hotel view</b></Link>
          {hasFullPortfolioAccess && <Link className="rail-nav-link" href="/group-overview"><span>GO</span><b>Group overview</b></Link>}
          {access?.role === "MASTER_ADMIN" && <Link className="rail-nav-link" href="/alerts/ota"><span>OTA</span><b>OTA alerts</b></Link>}
          {access?.role === "MASTER_ADMIN" && <Link className="rail-nav-link" href="/alerts/yield"><span>YM</span><b>Yield alerts</b></Link>}
          {access?.role === "MASTER_ADMIN" && <Link className="rail-nav-link" href="/admin"><span>AD</span><b>Administration</b></Link>}
        </nav>
        <div className="nkh-authority"><span>NKH</span><div><b>System by</b><strong>N K Hotels</strong></div></div>
      </aside>
      {sidebarOpen && <button className="rail-backdrop" aria-label="Close navigation menu" onClick={() => setSidebarOpen(false)} />}
      <div className="page">
        <header className="page-header">
          <button className="mobile-menu-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label="Open navigation menu">☰</button>
          <div className="hotel-select-wrap hotel-picker" ref={hotelPickerRef}>
            <span className="hotel-monogram">{hotel.code}</span>
            <div className="hotel-picker-content">
              <span>SELECT HOTEL</span>
              <button
                type="button"
                className="hotel-picker-trigger"
                aria-haspopup="listbox"
                aria-expanded={hotelPickerOpen}
                onClick={() => setHotelPickerOpen((open) => !open)}
              >
                <b>{hotel.name}</b><i>{hotelPickerOpen ? "⌃" : "⌄"}</i>
              </button>
              {hotelPickerOpen && (
                <div className="hotel-picker-menu" role="listbox" aria-label="Hotels">
                  {accessibleHotels.map((item) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.code === hotelCode}
                      className={item.code === hotelCode ? "selected" : ""}
                      key={item.code}
                      onClick={() => { setHotelCode(item.code); setHotelPickerOpen(false); }}
                    >
                      <span>{item.code}</span>
                      <div><b>{item.name}</b><small>{item.location}</small></div>
                      <i>{item.code === hotelCode ? "✓" : ""}</i>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="header-tools">
            <div className="mode-switch" aria-label="Display format">
              <button
                className={viewMode === "numbers" ? "active" : ""}
                onClick={() => setViewMode("numbers")}
              >
                Numbers
              </button>
              <button
                className={viewMode === "percentage" ? "active" : ""}
                onClick={() => setViewMode("percentage")}
              >
                Percentage
              </button>
            </div>
            <button className="user-button" onClick={signOut} title="Sign out">
              {firstName} <span>↗</span>
            </button>
          </div>
        </header>
        <section className="title-row">
          <div>
            <p className="breadcrumb">
              OCCUPANCY OVERVIEW <span>/</span> {hotel.location.toUpperCase()}
            </p>
            <h1>{hotel.name}</h1>
            <p className="subtext">
              Live rooms sold, rooms remaining and business sources—read
              automatically from the hotel Sheet.
            </p>
          </div>
          <div className="month-jump-wrap" ref={monthPickerRef}>
            <div className="month-control">
              <button aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
              <button className="month-jump-trigger" onClick={() => { setPickerYear(year); setMonthPickerOpen((open) => !open); }} aria-expanded={monthPickerOpen}>
                <strong>{monthLabel}</strong><span>⌄</span>
              </button>
              <button aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
            </div>
            {monthPickerOpen && (
              <div className="month-jump-panel">
                <header><b>Jump to month</b><select aria-label="Select year" value={pickerYear} onChange={(event) => setPickerYear(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => now.getFullYear() - 2 + index).map((optionYear) => <option key={optionYear}>{optionYear}</option>)}</select></header>
                <div>{MONTH_NAMES.map((name, index) => <button type="button" className={pickerYear === year && index + 1 === month ? "active" : ""} key={name} onClick={() => { setMonthCursor(new Date(pickerYear, index, 1)); setMonthPickerOpen(false); }}>{name}</button>)}</div>
              </div>
            )}
          </div>
        </section>
        <section className="number-cards">
          <article className="number-card primary">
            <div className="card-top">
              <span>
                {isCurrentMonth ? "ROOMS SOLD TODAY" : "ROOMS SOLD DAY 1"}
              </span>
              <i>
                {focusDay} {shortMonth}
              </i>
            </div>
            <div className="main-number">
              {display(stats.selected)}
              {viewMode === "numbers" && <small>/ {hotel.rooms}</small>}
            </div>
            <div className="meter">
              <span
                style={{
                  width: `${Math.min(100, pct(stats.selected, hotel.rooms))}%`,
                }}
              />
            </div>
            <p>{pct(stats.selected, hotel.rooms)}% occupancy</p>
          </article>
          <article className="number-card">
            <div className="card-top">
              <span>ROOMS AVAILABLE</span>
              <i className="soft-icon">○</i>
            </div>
            <div className="main-number">{display(stats.available)}</div>
            <p>
              Available to sell for {focusDay} {shortMonth}
            </p>
          </article>
          <article className="number-card">
            <div className="card-top">
              <span>NEXT DAY SOLD</span>
              <i className="soft-icon">→</i>
            </div>
            <div className="main-number">{display(stats.tomorrow)}</div>
            <p>
              {Math.max(0, hotel.rooms - stats.tomorrow)} rooms still available
            </p>
          </article>
          <article className="number-card">
            <div className="card-top">
              <span>NEXT 7 DAYS</span>
              <i className="soft-icon">7D</i>
            </div>
            <div className="main-number">
              {viewMode === "numbers"
                ? stats.sevenSold
                : `${pct(stats.sevenSold, stats.sevenCapacity)}%`}{" "}
              {viewMode === "numbers" && <small>room nights</small>}
            </div>
            <p>Out of {stats.sevenCapacity} room nights</p>
          </article>
          <article className="number-card">
            <div className="card-top">
              <span>{monthName.toUpperCase()} TOTAL</span>
              <i className="soft-icon">M</i>
            </div>
            <div className="main-number">
              {viewMode === "numbers"
                ? stats.monthSold
                : `${pct(stats.monthSold, stats.monthCapacity)}%`}{" "}
              {viewMode === "numbers" && <small>room nights</small>}
            </div>
            <p>
              {pct(stats.monthSold, stats.monthCapacity)}% monthly occupancy
            </p>
          </article>
        </section>
        <section className="main-grid">
          <article className="calendar-panel">
            <div className="panel-header">
              <div>
                <h2>Daily room position</h2>
                <p>
                  Automatically refreshes every 5 minutes and whenever the app
                  is reopened.
                </p>
              </div>
              <button
                className={`update-chip refresh-chip ${liveHotel ? "current" : "old"}`}
                disabled={refreshing}
                onClick={() => void loadLive(true)}
                title="Refresh now"
              >
                <span />
                {refreshing ? "Refreshing…" : liveMessage} ↻
              </button>
            </div>
            <div className="calendar-weekdays desktop-calendar-weekdays">
              {MOBILE_WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-weekdays mobile-calendar-weekdays">
              {MOBILE_WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: mobileMonthStartOffset }, (_, index) => (
                <span
                  className="mobile-calendar-spacer"
                  aria-hidden="true"
                  key={`mobile-spacer-${index}`}
                />
              ))}
              {hotel.occupied.map((value, index) => {
                const available = hotel.rooms - value,
                  isToday = isCurrentMonth && index === focusIndex;
                return (
                  <button
                    type="button"
                    key={index}
                    className={`day-cell ${heatClass(value, hotel.rooms)} ${isToday ? "today" : ""}`}
                    onClick={() => setSelectedDay(index + 1)}
                    aria-label={`View source summary for ${index + 1} ${monthName}`}
                  >
                    <div className="day-head">
                      <span>{index + 1}</span>
                      {isToday && <b>TODAY</b>}
                    </div>
                    <strong>{display(value)}</strong>
                    <small>
                      {available < 0
                        ? `${Math.abs(available)} over`
                        : `${available} available`}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="calendar-legend">
              <span>
                <i className="quiet" />
                Low
              </span>
              <span>
                <i className="soft" />
                Building
              </span>
              <span>
                <i className="medium" />
                Good
              </span>
              <span>
                <i className="strong" />
                Strong
              </span>
              <span>
                <i className="soldout" />
                Full / over
              </span>
            </div>
          </article>
          <aside className="side-stack">
            <article className="snapshot-panel">
              <div className="panel-header">
                <div>
                  <h2>
                    {isCurrentMonth
                      ? `Today, ${focusDay} ${monthName}`
                      : `${focusDay} ${monthName}`}
                  </h2>
                  <p>Room position at a glance</p>
                </div>
                <span className="calendar-icon">{focusDay}</span>
              </div>
              <div className="snapshot-row">
                <span>Hotel capacity</span>
                <b>{hotel.rooms}</b>
              </div>
              <div className="snapshot-row purple">
                <span>Rooms sold</span>
                <b>{stats.selected}</b>
              </div>
              <div className="snapshot-row">
                <span>Rooms available</span>
                <b>{stats.available}</b>
              </div>
              <div className="snapshot-row">
                <span>Monthly functions</span>
                <b>{hotel.functions || "—"}</b>
              </div>
              <div className="snapshot-row">
                <span>Monthly allotment</span>
                <b>{hotel.allotment || "—"}</b>
              </div>
              <div className="snapshot-total">
                <span>Occupancy</span>
                <strong>{pct(stats.selected, hotel.rooms)}%</strong>
              </div>
            </article>
            <article className="note-panel">
              <span className="note-icon">↻</span>
              <div>
                <b>Self-updating connection</b>
                <p>
                  The last successful figures stay visible if Google is
                  temporarily unavailable. The app retries automatically.
                </p>
              </div>
            </article>
          </aside>
        </section>
        <section className="source-panel">
          <div className="panel-header">
            <div>
              <h2>{monthName} business mix</h2>
              <p>Room nights recorded by source in the occupancy Sheet</p>
            </div>
            <div className="source-total">
              <span>TOTAL SOURCE ROOM NIGHTS</span>
              <b>{sourceTotal}</b>
            </div>
          </div>
          <div className="source-table">
            <div className="source-heading">
              <span>Source</span>
              <span>Type</span>
              <span>Room nights</span>
              <span>Share</span>
              <span>Contribution</span>
            </div>
            {[...hotel.sources]
              .sort((a, b) => b.rooms - a.rooms)
              .map((source) => (
                <div className="source-row" key={source.name}>
                  <b>{source.name}</b>
                  <span className={`type-tag ${source.group}`}>
                    {source.group}
                  </span>
                  <strong>{source.rooms}</strong>
                  <span>{pct(source.rooms, sourceTotal)}%</span>
                  <div className="source-bar">
                    <i
                      style={{ width: `${pct(source.rooms, sourceTotal)}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>
        <footer>
          <span>Read-only dashboard • Auto-refresh every 5 minutes</span>
          <span>Source: Google Sheets occupancy charts</span>
        </footer>
      </div>
      {selectedDay !== null && (
        <div
          className="day-source-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedDay(null);
          }}
        >
          <section
            className="day-source-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="day-source-title"
          >
            <header>
              <div>
                <p>DAILY SOURCE SUMMARY</p>
                <h2 id="day-source-title">
                  {selectedDay} {monthName} {year}
                </h2>
                <span>{hotel.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                aria-label="Close source summary"
              >
                ×
              </button>
            </header>
            <div className="day-source-total">
              <span>How the rooms sold were created</span>
              <strong>{selectedDayTotal}</strong>
            </div>
            <div className="day-source-list">
              {daySources.length ? (
                daySources.map((source) => (
                  <div key={source.name}>
                    <span className={`source-dot ${source.group}`} />
                    <b>{source.name}</b>
                    <strong>{source.rooms}</strong>
                  </div>
                ))
              ) : (
                <p>No source entries are recorded for this day.</p>
              )}
              {unclassifiedRooms > 0 && (
                <div className="day-source-unclassified">
                  <span className="source-dot other" />
                  <b>Not classified in source rows</b>
                  <strong>{unclassifiedRooms}</strong>
                </div>
              )}
            </div>
            <div
              className={`day-source-check ${unclassifiedRooms ? "warning" : "complete"}`}
            >
              <span>Source breakdown</span>
              <b>
                {daySourceTotal + unclassifiedRooms} of {selectedDayTotal} rooms
              </b>
            </div>
            <button
              className="day-source-close"
              type="button"
              onClick={() => setSelectedDay(null)}
            >
              Close
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
