import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = "https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_KEY = "sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;

type Profile = {
  hotel_code: string;
  hotel_name: string;
  google_spreadsheet_id: string | null;
  active_year_tab: string;
  status: string;
};

type SourceRoom = { name: string; rooms: number };
type SheetSource = {
  name: string;
  rooms?: number;
  days?: Array<{ day: number; rooms: number }>;
};
type SheetData = {
  success?: boolean;
  error?: string;
  hotelName?: string;
  totalRooms?: number;
  days?: Array<{ day: number; occupied?: number; roomsSold?: number }>;
  sources?: SheetSource[];
  dailySources?: Array<{ day: number; rooms: SourceRoom[] }>;
  functions?: number;
  allotment?: number;
  lastUpdatedDate?: string;
  lastUpdatedTime?: string;
};

type SnapshotRow = {
  hotel_code: string;
  stay_date: string;
  total_rooms: number;
  rooms_sold: number;
  available_rooms: number;
  occupancy_percent: number;
  source_breakdown: SourceRoom[] | null;
  functions: number | null;
  allotment: number | null;
  source_updated_at: string | null;
  last_checked_at: string;
};

function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
  return { start, end, days };
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayNumber(date: string) {
  return Number(date.slice(8, 10));
}

function dailySourceRooms(sheet: SheetData, day: number) {
  const direct = sheet.dailySources?.find((entry) => entry.day === day)?.rooms;
  if (direct)
    return direct
      .map((entry) => ({ name: String(entry.name).trim(), rooms: Number(entry.rooms || 0) }))
      .filter((entry) => entry.name && entry.rooms > 0);

  return (sheet.sources ?? [])
    .map((source) => ({
      name: String(source.name).trim(),
      rooms: Number(source.days?.find((entry) => entry.day === day)?.rooms ?? 0),
    }))
    .filter((entry) => entry.name && entry.rooms > 0);
}

function snapshotPayload(rows: SnapshotRow[], profile: Profile, year: number, month: number) {
  const sorted = [...rows].sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const sourceTotals = new Map<string, number>();
  const dailySources = sorted.map((row) => {
    const rooms = Array.isArray(row.source_breakdown) ? row.source_breakdown : [];
    for (const source of rooms)
      sourceTotals.set(source.name, (sourceTotals.get(source.name) ?? 0) + Number(source.rooms || 0));
    return { day: dayNumber(row.stay_date), rooms };
  });
  const latestCheck = sorted.reduce(
    (latest, row) => Math.max(latest, new Date(row.last_checked_at).getTime()),
    0,
  );
  const oldestCheck = sorted.reduce(
    (oldest, row) => Math.min(oldest, new Date(row.last_checked_at).getTime()),
    Number.POSITIVE_INFINITY,
  );
  const expectedDays = new Date(year, month, 0).getDate();
  const complete = sorted.length === expectedDays;
  const fresh = complete && Number.isFinite(oldestCheck) && Date.now() - oldestCheck <= CACHE_MAX_AGE_MS;
  const sourceUpdated = sorted.find((row) => row.source_updated_at)?.source_updated_at ?? "";

  return {
    success: true,
    source: "supabase",
    cacheState: fresh ? "fresh" : "stale",
    syncNeeded: !fresh,
    hotelName: profile.hotel_name,
    totalRooms: Number(sorted[0]?.total_rooms || 0),
    days: sorted.map((row) => ({ day: dayNumber(row.stay_date), occupied: Number(row.rooms_sold || 0) })),
    sources: [...sourceTotals.entries()].map(([name, rooms]) => ({ name, rooms })),
    dailySources,
    functions: Number(sorted[0]?.functions || 0),
    allotment: Number(sorted[0]?.allotment || 0),
    lastUpdatedDate: sourceUpdated || "Cached snapshot",
    lastUpdatedTime: "",
    lastSyncedAt: latestCheck ? new Date(latestCheck).toISOString() : null,
  };
}

async function readSnapshots(
  db: SupabaseClient,
  hotelCode: string,
  year: number,
  month: number,
) {
  const { start, end } = monthRange(year, month);
  const { data, error } = await db
    .from("yield_occupancy_snapshots")
    .select(
      "hotel_code,stay_date,total_rooms,rooms_sold,available_rooms,occupancy_percent,source_breakdown,functions,allotment,source_updated_at,last_checked_at",
    )
    .eq("hotel_code", hotelCode)
    .gte("stay_date", start)
    .lte("stay_date", end)
    .order("stay_date");
  if (error) throw error;
  return (data ?? []) as SnapshotRow[];
}

async function readSheet(profile: Profile, year: number, month: number, timeout: number) {
  const scriptUrl = process.env.OCCUPANCY_SCRIPT_URL;
  const token = process.env.OCCUPANCY_API_TOKEN;
  if (!scriptUrl || !token) throw new Error("Sheet reader is not configured");
  if (!profile.google_spreadsheet_id) throw new Error("Google Sheet ID is missing");

  const target = new URL(scriptUrl);
  target.searchParams.set("action", "read");
  target.searchParams.set("token", token);
  target.searchParams.set("sheetId", profile.google_spreadsheet_id);
  target.searchParams.set("year", String(year));
  target.searchParams.set("month", String(month));

  const response = await fetch(target, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Reader returned ${response.status}`);
  const sheet = (await response.json()) as SheetData;
  if (!sheet.success) throw new Error(sheet.error ?? "Sheet reader failed");

  const { days } = monthRange(year, month);
  const totalRooms = Number(sheet.totalRooms || 0);
  const byDay = new Map((sheet.days ?? []).map((entry) => [Number(entry.day), entry]));
  if (totalRooms <= 0) throw new Error("Total Rooms is missing");
  if (Array.from({ length: days }, (_, index) => index + 1).some((day) => !byDay.has(day)))
    throw new Error("Sheet response is incomplete; last good data was preserved");
  return sheet;
}

async function saveSnapshots(
  db: SupabaseClient,
  profile: Profile,
  year: number,
  month: number,
  sheet: SheetData,
) {
  const { days } = monthRange(year, month);
  const totalRooms = Number(sheet.totalRooms || 0);
  const byDay = new Map((sheet.days ?? []).map((entry) => [Number(entry.day), entry]));
  const checkedAt = new Date().toISOString();
  const sourceUpdatedAt = `${sheet.lastUpdatedDate ?? ""} ${sheet.lastUpdatedTime ?? ""}`.trim();
  const rows = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const sheetDay = byDay.get(day)!;
    const sold = Number(sheetDay.occupied ?? sheetDay.roomsSold ?? 0);
    return {
      hotel_code: profile.hotel_code,
      stay_date: isoDate(year, month, day),
      total_rooms: totalRooms,
      rooms_sold: sold,
      available_rooms: totalRooms - sold,
      occupancy_percent: totalRooms > 0 ? Number(((sold / totalRooms) * 100).toFixed(2)) : 0,
      source_breakdown: dailySourceRooms(sheet, day),
      functions: Number(sheet.functions || 0),
      allotment: Number(sheet.allotment || 0),
      source_updated_at: sourceUpdatedAt,
      last_checked_at: checkedAt,
    };
  });
  const { error } = await db
    .from("yield_occupancy_snapshots")
    .upsert(rows, { onConflict: "hotel_code,stay_date" });
  if (error) throw error;
}

async function requestContext(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return { error: NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 }) };

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    cache: "no-store",
    headers: { apikey: SUPABASE_KEY, Authorization: authorization },
  });
  if (!userResponse.ok)
    return { error: NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 }) };

  const code = (request.nextUrl.searchParams.get("hotel") ?? "").toUpperCase();
  const yearText = request.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear());
  const monthText = request.nextUrl.searchParams.get("month") ?? String(new Date().getMonth() + 1);
  if (!/^[A-Z0-9]{2,6}$/.test(code) || !/^[0-9]{4}$/.test(yearText) || !/^([1-9]|1[0-2])$/.test(monthText))
    return { error: NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 }) };

  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/occupancy_profiles?hotel_code=eq.${encodeURIComponent(code)}&select=hotel_code,hotel_name,google_spreadsheet_id,active_year_tab,status`,
    { cache: "no-store", headers: { apikey: SUPABASE_KEY, Authorization: authorization } },
  );
  if (!profileResponse.ok)
    return { error: NextResponse.json({ success: false, error: "Hotel access denied" }, { status: 403 }) };
  const profiles = (await profileResponse.json()) as Profile[];
  const profile = profiles[0];
  if (!profile || profile.status !== "Active")
    return { error: NextResponse.json({ success: false, error: "Hotel is unavailable" }, { status: 404 }) };

  return {
    authorization,
    profile,
    year: Number(yearText),
    month: Number(monthText),
    groupRequest: request.nextUrl.searchParams.get("group") === "1",
  };
}

async function syncAndRespond(
  profile: Profile,
  year: number,
  month: number,
  groupRequest: boolean,
  db: SupabaseClient | null,
) {
  const sheet = await readSheet(profile, year, month, groupRequest ? 45000 : 30000);
  let savedToSupabase = false;
  if (db) {
    try {
      await saveSnapshots(db, profile, year, month, sheet);
      savedToSupabase = true;
    } catch {
      // A cache write must never prevent valid Sheet data from reaching users.
    }
  }
  return NextResponse.json({
    ...sheet,
    source: "google_sheet",
    cacheState: "fresh",
    syncNeeded: false,
    savedToSupabase,
    lastSyncedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  const context = await requestContext(request);
  if ("error" in context) return context.error;
  const { profile, year, month, groupRequest } = context;
  const cacheEnabled = process.env.OCCUPANCY_CACHE_ENABLED !== "false";
  const db = cacheEnabled ? adminClient() : null;

  if (db) {
    try {
      const rows = await readSnapshots(db, profile.hotel_code, year, month);
      if (rows.length)
        return NextResponse.json(snapshotPayload(rows, profile, year, month), {
          headers: { "Cache-Control": "private, no-store" },
        });
    } catch {
      // Safe rollout: missing migration or a temporary database issue falls
      // back to the existing read-only Google Sheet path.
    }
  }

  try {
    return await syncAndRespond(profile, year, month, groupRequest, db);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Sheet reader failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await requestContext(request);
  if ("error" in context) return context.error;
  const { profile, year, month, groupRequest } = context;
  const cacheEnabled = process.env.OCCUPANCY_CACHE_ENABLED !== "false";
  const db = cacheEnabled ? adminClient() : null;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  let lockClaimed = false;

  try {
    if (db) {
      const { data: claimed, error: lockError } = await db.rpc("claim_occupancy_sync", {
        requested_hotel: profile.hotel_code,
        requested_month: monthStart,
        lock_seconds: groupRequest ? 120 : 75,
      });
      if (!lockError) {
        lockClaimed = claimed === true;
        if (!lockClaimed) {
          const rows = await readSnapshots(db, profile.hotel_code, year, month);
          if (rows.length)
            return NextResponse.json(
              { ...snapshotPayload(rows, profile, year, month), syncInProgress: true },
              { headers: { "Cache-Control": "private, no-store" } },
            );
        }
      }
    }
    return await syncAndRespond(profile, year, month, groupRequest, db);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Sheet reader failed" },
      { status: 502 },
    );
  } finally {
    if (db && lockClaimed)
      await db
        .from("occupancy_sync_locks")
        .delete()
        .eq("hotel_code", profile.hotel_code)
        .eq("month_start", monthStart);
  }
}
