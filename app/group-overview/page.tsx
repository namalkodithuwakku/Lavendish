"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth-provider";
import { hotels } from "../dashboard-data";
import "./group-overview.css";

type ViewMode = "numbers" | "percentage";
type LoadState = "waiting" | "loading" | "ready" | "error";
type PortfolioHotel = {
  code: string;
  name: string;
  location: string;
  rooms: number;
  occupied: number[];
  state: LoadState;
  error?: string;
  updated?: string;
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const HOTEL_CODES = hotels.map((hotel) => hotel.code);
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
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

export default function GroupOverviewPage() {
  const { access, session, signOut } = useAuth();
  const now = new Date();
  const [monthCursor, setMonthCursor] = useState(initialMonth);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioHotel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
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

  const updateHotel = useCallback((code: string, update: Partial<PortfolioHotel>) => {
    setPortfolio((current) =>
      current.map((hotel) => (hotel.code === code ? { ...hotel, ...update } : hotel)),
    );
  }, []);

  const readHotel = useCallback(
    async (hotel: (typeof hotels)[number]) => {
      if (!session) return;
      updateHotel(hotel.code, { state: "loading", error: undefined });
      let lastError = "Sheet could not be read";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(
            `/api/occupancy?hotel=${encodeURIComponent(hotel.code)}&year=${year}&month=${month}`,
            {
              cache: "no-store",
              headers: { Authorization: `Bearer ${session.access_token}` },
            },
          );
          const data = await response.json();
          if (!response.ok || !data.success)
            throw new Error(data.error ?? "Sheet could not be read");
          updateHotel(hotel.code, {
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
          });
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError;
        }
      }
      updateHotel(hotel.code, { state: "error", error: lastError });
    },
    [daysInMonth, month, session, updateHotel, year],
  );

  const loadPortfolio = useCallback(async () => {
    if (!session || !hasFullPortfolioAccess) return;
    setRefreshing(true);
    setPortfolio(emptyPortfolio(daysInMonth));
    for (let index = 0; index < hotels.length; index += 3) {
      await Promise.all(hotels.slice(index, index + 3).map((hotel) => readHotel(hotel)));
    }
    setLastUpdated(new Date());
    setRefreshing(false);
  }, [daysInMonth, hasFullPortfolioAccess, readHotel, session]);

  useEffect(() => {
    setSelectedDay(null);
    void loadPortfolio();
  }, [loadPortfolio]);
  useEffect(() => {
    if (!hasFullPortfolioAccess) return;
    const timer = window.setInterval(() => void loadPortfolio(), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasFullPortfolioAccess, loadPortfolio]);
  useEffect(() => {
    window.localStorage.setItem("occupancy:groupMonth", `${year}-${month}`);
  }, [month, year]);
  useEffect(() => {
    window.localStorage.setItem("occupancy:groupView", viewMode);
  }, [viewMode]);

  const readyHotels = portfolio.filter((hotel) => hotel.state === "ready");
  const failedHotels = portfolio.filter((hotel) => hotel.state === "error");
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
          <span>LH</span>
          <h1>Full portfolio access required</h1>
          <p>Group Overview is available only to users who can view all 10 hotels.</p>
          <Link href="/">Return to hotel dashboard</Link>
        </section>
      </main>
    );

  return (
    <main className="group-shell">
      <header className="group-topbar">
        <Link className="group-brand" href="/">
          <span>LH</span>
          <div><b>Lavendish Intelligence</b><small>N K Hotels</small></div>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">Hotel view</Link>
          <Link className="active" href="/group-overview">Group overview</Link>
          {access?.role === "MASTER_ADMIN" && <Link href="/alerts/ota">OTA alerts</Link>}
          {access?.role === "MASTER_ADMIN" && <Link href="/alerts/yield">Yield alerts</Link>}
        </nav>
        <button onClick={signOut}>{firstName} ↗</button>
      </header>

      <section className="group-page">
        <header className="group-title-row">
          <div>
            <p>PORTFOLIO PERFORMANCE</p>
            <h1>Lavendish Group Overview</h1>
            <span>Combined occupancy performance across all 10 hotels.</span>
          </div>
          <div className="group-title-actions">
            <div className="group-view-switch" aria-label="Display format">
              <button className={viewMode === "numbers" ? "active" : ""} onClick={() => setViewMode("numbers")}>Numbers</button>
              <button className={viewMode === "percentage" ? "active" : ""} onClick={() => setViewMode("percentage")}>Percentage</button>
            </div>
            <div className="group-month-control">
              <button aria-label="Previous month" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>‹</button>
              <strong>{monthLabel}</strong>
              <button aria-label="Next month" onClick={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>›</button>
            </div>
          </div>
        </header>

        <section className="group-status-bar">
          <div>
            <span className={failedHotels.length ? "partial" : readyHotels.length === 10 ? "live" : "loading"} />
            <b>{readyHotels.length} of 10 hotels loaded</b>
            <small>{failedHotels.length ? ` • ${failedHotels.length} need attention` : " • Live Google Sheet data"}</small>
          </div>
          <button disabled={refreshing} onClick={() => void loadPortfolio()}>{refreshing ? "Refreshing…" : "Refresh all hotels"}</button>
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

        <section className="group-hotel-panel">
          <header><div><h2>Hotel performance</h2><p>Room position for {focusDay} {monthLabel}, ranked by occupancy.</p></div></header>
          <div className="group-hotel-table">
            <div className="group-hotel-head"><span>Hotel</span><span>Rooms</span><span>Sold</span><span>Available</span><span>Occupancy</span></div>
            {[...portfolio].sort((a, b) => percentage(b.occupied[focusIndex] ?? 0, b.rooms) - percentage(a.occupied[focusIndex] ?? 0, a.rooms)).map((hotel) => {
              const sold = hotel.occupied[focusIndex] ?? 0;
              const occupancy = percentage(sold, hotel.rooms);
              return <article className={hotel.state === "error" ? "read-error" : ""} key={hotel.code}><div className="group-hotel-name"><span>{hotel.code}</span><div><b>{hotel.name}</b><small>{hotel.state === "error" ? hotel.error : hotel.location}</small></div></div><strong>{hotel.rooms}</strong><strong>{hotel.state === "ready" ? sold : "—"}</strong><strong>{hotel.state === "ready" ? Math.max(0, hotel.rooms - sold) : "—"}</strong><div className="hotel-occupancy"><b>{hotel.state === "ready" ? `${occupancy}%` : hotel.state === "error" ? "Read failed" : "Loading"}</b><span><i style={{ width: hotel.state === "ready" ? `${Math.min(100, occupancy)}%` : "0%" }} /></span></div></article>;
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
