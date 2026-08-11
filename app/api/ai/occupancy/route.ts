import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SUPABASE_URL = "https://otiiioaazkanroyzvlkg.supabase.co";
const HOTEL_CODES = ["GTL", "LTL", "LWS", "LOH", "LLG", "LBR", "LWW", "MLR", "LCR", "LHK"];
const MAX_DAYS = 93;

type Snapshot = {
  hotel_code: string;
  stay_date: string;
  total_rooms: number;
  rooms_sold: number;
  available_rooms: number;
  occupancy_percent: number;
  functions: number | null;
  allotment: number | null;
  source_breakdown?: unknown;
  suggested_rates?: unknown;
  source_updated_at: string | null;
  last_checked_at: string;
};

function secureMatch(received: string, expected: string) {
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string | null, fallback: Date) {
  const text = value ?? iso(fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || iso(date) !== text ? null : date;
}

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
}

function requestedHotels(request: NextRequest) {
  const configured = (process.env.AI_OCCUPANCY_ALLOWED_HOTELS ?? "ALL")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const allowed = configured.includes("ALL")
    ? HOTEL_CODES
    : HOTEL_CODES.filter((code) => configured.includes(code));
  const value = (request.nextUrl.searchParams.get("hotels") ?? "ALL").toUpperCase();
  const requested = value === "ALL"
    ? allowed
    : [...new Set(value.split(",").map((code) => code.trim()).filter(Boolean))];
  if (!requested.length || requested.some((code) => !allowed.includes(code))) return null;
  return requested;
}

export async function GET(request: NextRequest) {
  const expected = process.env.AI_OCCUPANCY_API_KEY ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!expected || !received || !secureMatch(received, expected)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = new Date();
  const defaultTo = new Date(now);
  defaultTo.setUTCDate(defaultTo.getUTCDate() + 30);
  const fromDate = parseDate(request.nextUrl.searchParams.get("from"), now);
  const toDate = parseDate(request.nextUrl.searchParams.get("to"), defaultTo);
  const hotels = requestedHotels(request);
  if (!fromDate || !toDate || !hotels) {
    return NextResponse.json({ success: false, error: "Invalid hotel or date parameter" }, { status: 400 });
  }
  const rangeDays = daysBetween(fromDate, toDate);
  if (rangeDays < 1 || rangeDays > MAX_DAYS) {
    return NextResponse.json(
      { success: false, error: `Date range must be between 1 and ${MAX_DAYS} days` },
      { status: 400 },
    );
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ success: false, error: "Occupancy service is not configured" }, { status: 503 });
  }
  const include = new Set((request.nextUrl.searchParams.get("include") ?? "").split(","));
  const optionalColumns = [include.has("sources") ? "source_breakdown" : "", include.has("rates") ? "suggested_rates" : ""].filter(Boolean);
  const columns = [
    "hotel_code", "stay_date", "total_rooms", "rooms_sold", "available_rooms",
    "occupancy_percent", "functions", "allotment", "source_updated_at", "last_checked_at",
    ...optionalColumns,
  ].join(",");
  const db = createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: snapshots, error }, { data: profiles }] = await Promise.all([
    db.from("yield_occupancy_snapshots").select(columns).in("hotel_code", hotels).gte("stay_date", iso(fromDate)).lte("stay_date", iso(toDate)).order("stay_date").order("hotel_code"),
    db.from("occupancy_profiles").select("hotel_code,hotel_name").in("hotel_code", hotels),
  ]);
  if (error) return NextResponse.json({ success: false, error: "Occupancy data could not be read" }, { status: 500 });

  const names = new Map((profiles ?? []).map((profile) => [profile.hotel_code, profile.hotel_name]));
  const rows = (snapshots ?? []) as unknown as Snapshot[];
  const generatedAt = new Date().toISOString();
  const staleBefore = Date.now() - 30 * 60 * 1000;
  const data = rows.map((row) => ({
    hotelCode: row.hotel_code,
    hotelName: names.get(row.hotel_code) ?? row.hotel_code,
    date: row.stay_date,
    totalRooms: Number(row.total_rooms),
    roomsSold: Number(row.rooms_sold),
    availableRooms: Number(row.available_rooms),
    occupancyPercent: Number(row.occupancy_percent),
    functions: Number(row.functions ?? 0),
    allotment: Number(row.allotment ?? 0),
    ...(include.has("sources") ? { sources: Array.isArray(row.source_breakdown) ? row.source_breakdown : [] } : {}),
    ...(include.has("rates") ? { suggestedRates: Array.isArray(row.suggested_rates) ? row.suggested_rates : [] } : {}),
    sourceUpdatedAt: row.source_updated_at,
    syncedAt: row.last_checked_at,
    freshness: new Date(row.last_checked_at).getTime() < staleBefore ? "stale" : "fresh",
  }));

  const hotelSummary = hotels.map((code) => {
    const hotelRows = data.filter((row) => row.hotelCode === code);
    const roomNights = hotelRows.reduce((sum, row) => sum + row.totalRooms, 0);
    const soldRoomNights = hotelRows.reduce((sum, row) => sum + row.roomsSold, 0);
    return {
      hotelCode: code,
      hotelName: names.get(code) ?? code,
      datesReturned: hotelRows.length,
      roomNights,
      soldRoomNights,
      availableRoomNights: roomNights - soldRoomNights,
      averageOccupancyPercent: roomNights ? Number(((soldRoomNights / roomNights) * 100).toFixed(2)) : null,
      staleDates: hotelRows.filter((row) => row.freshness === "stale").length,
    };
  });

  return NextResponse.json(
    {
      success: true,
      apiVersion: "1.0",
      source: "supabase_occupancy_cache",
      generatedAt,
      range: { from: iso(fromDate), to: iso(toDate), days: rangeDays },
      hotelsRequested: hotels,
      summary: hotelSummary,
      data,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
