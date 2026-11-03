import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://otiiioaazkanroyzvlkg.supabase.co";
const PUBLIC_KEY = "sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Authenticated read-only occupancy snapshots.
 * GET /api/occupancy-report?hotel=CODE&year=2026&month=11
 * Authorization: Bearer <existing Supabase user access token>
 * Never accepts service-role credentials from the caller.
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Authentication required" }, 401);

  const hotel = (request.nextUrl.searchParams.get("hotel") || "").toUpperCase();
  const year = request.nextUrl.searchParams.get("year") || "";
  const month = request.nextUrl.searchParams.get("month") || "";
  if (!/^[A-Z0-9]{2,6}$/.test(hotel) || !/^20\d{2}$/.test(year) ||
      !/^(?:[1-9]|1[0-2])$/.test(month)) {
    return json({ error: "Provide valid hotel, year and month" }, 400);
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return json({ error: "Reporting API not configured" }, 503);

  // Verify the user's identity and hotel permission through the existing RLS-protected profile endpoint.
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!userResponse.ok) return json({ error: "Invalid session" }, 401);

  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/occupancy_profiles?hotel_code=eq.${encodeURIComponent(hotel)}&select=hotel_code,hotel_name,status`,
    { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!profileResponse.ok) return json({ error: "Access denied" }, 403);
  const profiles = await profileResponse.json() as Array<{hotel_code:string;hotel_name:string;status:string}>;
  const profile = profiles.find(p => p.hotel_code === hotel && p.status === "Active");
  if (!profile) return json({ error: "Hotel not accessible" }, 403);

  const first = `${year}-${month.padStart(2, "0")}-01`;
  const last = `${year}-${month.padStart(2, "0")}-${new Date(Number(year), Number(month), 0).getDate()}`;
  const db = createClient(SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.from("yield_occupancy_snapshots")
    .select("stay_date,total_rooms,rooms_sold,available_rooms,occupancy_percent,source_breakdown,last_checked_at")
    .eq("hotel_code", hotel).gte("stay_date", first).lte("stay_date", last)
    .order("stay_date", { ascending: true });
  if (error) return json({ error: "Unable to retrieve occupancy report" }, 502);

  return json({
    hotel: profile.hotel_code,
    hotelName: profile.hotel_name,
    year: Number(year),
    month: Number(month),
    source: "supabase_cached_snapshots",
    note: "Read-only cached data; may lag behind the live Google Sheet.",
    days: data ?? [],
  });
}
