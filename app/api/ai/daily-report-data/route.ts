import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = "https://otiiioaazkanroyzvlkg.supabase.co";
const REPORT_DAYS = 31;
const HOTELS: Record<string, string> = {
  GTL: "Grand Tamarind Lake",
  LTL: "Lavendish Tamarind Lifestyle",
  LWS: "Lavendish Wild Safari",
  LOH: "Lavendish Okrin Hotel",
  LLG: "Lavendish Lake Giritale",
  LBR: "Lavendish Beach Resort",
  LWW: "Lavendish Wild Wilpattu",
  MLR: "Miridiya Lake Resort",
  LCR: "Lavendish Country Resort",
  LHK: "Lavendish Hills Kandy",
};

type Snapshot = {
  hotel_code: string;
  stay_date: string;
  total_rooms: number;
  rooms_sold: number;
  available_rooms: number;
  occupancy_percent: number;
  source_breakdown: Array<{ name: string; rooms: number }> | null;
  suggested_rates: Array<{ planCode?: string; planName?: string; currency?: string; rate?: number }> | null;
  source_updated_at: string | null;
  last_checked_at: string;
};

function colomboDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  const received = request.headers.get("authorization") ?? "";
  return expected.length >= 24 && received === `Bearer ${expected}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildReport(rows: Snapshot[], generatedAt: string, from: string, to: string) {
  const staleBefore = Date.now() - 30 * 60 * 1000;
  const hotelReports = Object.entries(HOTELS).map(([hotelCode, hotelName]) => {
    const hotelRows = rows.filter((row) => row.hotel_code === hotelCode);
    const today = hotelRows.find((row) => row.stay_date === from) ?? null;
    const next7 = hotelRows.filter((row) => row.stay_date >= from).slice(0, 7);
    const next30 = hotelRows.filter((row) => row.stay_date >= from).slice(0, 30);
    const occupancy = (period: Snapshot[]) => {
      const rooms = period.reduce((sum, row) => sum + Number(row.total_rooms || 0), 0);
      const sold = period.reduce((sum, row) => sum + Number(row.rooms_sold || 0), 0);
      return rooms ? Number(((sold / rooms) * 100).toFixed(2)) : null;
    };
    const lowDates = next30
      .filter((row) => Number(row.occupancy_percent) < 40)
      .map((row) => ({ date: row.stay_date, occupancyPercent: Number(row.occupancy_percent), availableRooms: Number(row.available_rooms) }));
    const highDates = next30
      .filter((row) => Number(row.occupancy_percent) >= 75)
      .map((row) => ({ date: row.stay_date, occupancyPercent: Number(row.occupancy_percent), availableRooms: Number(row.available_rooms) }));
    const latestSync = hotelRows.reduce((latest, row) => row.last_checked_at > latest ? row.last_checked_at : latest, "");
    return {
      hotelCode,
      hotelName,
      status: hotelRows.length ? "AVAILABLE" : "MISSING",
      today: today ? {
        totalRooms: Number(today.total_rooms),
        roomsSold: Number(today.rooms_sold),
        availableRooms: Number(today.available_rooms),
        occupancyPercent: Number(today.occupancy_percent),
        sources: Array.isArray(today.source_breakdown) ? today.source_breakdown.filter((source) => Number(source.rooms) > 0) : [],
        suggestedRates: Array.isArray(today.suggested_rates) ? today.suggested_rates : [],
      } : null,
      next7DaysOccupancyPercent: occupancy(next7),
      next30DaysOccupancyPercent: occupancy(next30),
      lowOccupancyDates: lowDates,
      highOccupancyDates: highDates,
      datesReturned: hotelRows.length,
      latestSync: latestSync || null,
      freshness: latestSync && new Date(latestSync).getTime() >= staleBefore ? "FRESH" : "STALE_OR_MISSING",
    };
  });
  return {
    reportType: "LAVENDISH_DAILY_OCCUPANCY",
    reportDate: from,
    generatedAt,
    timezone: "Asia/Colombo",
    range: { from, to },
    hotelsExpected: Object.keys(HOTELS).length,
    hotelsAvailable: hotelReports.filter((hotel) => hotel.status === "AVAILABLE").length,
    hotelsNeedingAttention: hotelReports.filter((hotel) => hotel.status !== "AVAILABLE" || hotel.freshness !== "FRESH").map((hotel) => hotel.hotelCode),
    hotels: hotelReports,
  };
}

function emailHtml(report: ReturnType<typeof buildReport>) {
  const cards = report.hotels.map((hotel) => {
    const today = hotel.today;
    return `<tr><td style="padding:12px;border-bottom:1px solid #e9e4ef"><b>${escapeHtml(hotel.hotelCode)} · ${escapeHtml(hotel.hotelName)}</b><br><span style="color:#746d7d">Today: ${today ? `${today.roomsSold}/${today.totalRooms} sold · ${today.occupancyPercent}% · ${today.availableRooms} available` : "data missing"}</span><br><span style="color:#746d7d">Next 7 days: ${hotel.next7DaysOccupancyPercent ?? "—"}% · Next 30 days: ${hotel.next30DaysOccupancyPercent ?? "—"}% · ${escapeHtml(hotel.freshness)}</span></td></tr>`;
  }).join("");
  return `<div style="font-family:Arial,sans-serif;color:#251f2d;max-width:760px;margin:auto"><div style="padding:22px;border-radius:14px 14px 0 0;background:#6f5ca1;color:white"><div style="font-size:12px;letter-spacing:.08em">N K HOTELS · LAVENDISH INTELLIGENCE</div><h1 style="margin:8px 0 3px;font-size:25px">Daily occupancy data ready</h1><div>${escapeHtml(report.reportDate)} · ${report.hotelsAvailable}/${report.hotelsExpected} hotels available</div></div><table style="width:100%;border-collapse:collapse;border:1px solid #e9e4ef">${cards}</table><div style="padding:16px;background:#f5f2f8;color:#625b69;font-size:13px">AI Monitor: review this structured occupancy snapshot together with current market, competitor and destination demand signals. Reply with completion updates where management action is required.</div></div>`;
}

async function sendEmail(report: ReturnType<typeof buildReport>) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DAILY_REPORT_EMAIL_TO;
  const from = process.env.DAILY_REPORT_EMAIL_FROM;
  if (!apiKey || !to || !from) return { sent: false, reason: "Email delivery is not configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((email) => email.trim()).filter(Boolean),
      subject: `Lavendish daily occupancy data · ${report.reportDate}`,
      html: emailHtml(report),
      text: JSON.stringify(report),
    }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const result = await response.json() as { id?: string };
  return { sent: true, id: result.id ?? null };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Cron authorization required" }, { status: 401 });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.json({ success: false, error: "Supabase service is not configured" }, { status: 503 });

  const from = colomboDate();
  const to = colomboDate(REPORT_DAYS - 1);
  const generatedAt = new Date().toISOString();
  const db = createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("yield_occupancy_snapshots")
    .select("hotel_code,stay_date,total_rooms,rooms_sold,available_rooms,occupancy_percent,source_breakdown,suggested_rates,source_updated_at,last_checked_at")
    .in("hotel_code", Object.keys(HOTELS))
    .gte("stay_date", from)
    .lte("stay_date", to)
    .order("hotel_code")
    .order("stay_date");
  if (error) return NextResponse.json({ success: false, error: "Occupancy cache could not be read" }, { status: 500 });

  const report = buildReport((data ?? []) as Snapshot[], generatedAt, from, to);
  const { error: saveError } = await db.from("ai_daily_report_snapshots").upsert({
    report_date: from,
    generated_at: generatedAt,
    report_data: report,
    hotel_count: report.hotelsAvailable,
    stale_hotel_codes: report.hotelsNeedingAttention,
  }, { onConflict: "report_date" });
  if (saveError) return NextResponse.json({ success: false, error: "Daily report snapshot could not be saved" }, { status: 500 });

  try {
    const email = await sendEmail(report);
    await db.from("ai_daily_report_snapshots").update({ email_sent: email.sent, email_sent_at: email.sent ? generatedAt : null, email_error: email.sent ? null : email.reason }).eq("report_date", from);
    return NextResponse.json({ success: true, reportDate: from, hotelsAvailable: report.hotelsAvailable, needsAttention: report.hotelsNeedingAttention, email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await db.from("ai_daily_report_snapshots").update({ email_sent: false, email_error: message }).eq("report_date", from);
    return NextResponse.json({ success: false, reportSaved: true, reportDate: from, error: message }, { status: 502 });
  }
}
