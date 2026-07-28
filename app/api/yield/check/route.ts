import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = "https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

type Profile = {
  hotel_code: string;
  hotel_name: string;
  total_rooms: number | null;
  google_spreadsheet_id: string | null;
  status: string;
};

type Settings = {
  hotel_code: string;
  alert_thresholds: number[];
  future_check_days: number;
  active: boolean;
  threshold_75_action: string;
  threshold_90_action: string;
  threshold_100_action: string;
  closure_action: string;
};

type Band = {
  sold_from: number;
  sold_to: number;
  rate: number;
};

type Plan = {
  hotel_code: string;
  plan_code: string;
  plan_name: string;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  yield_rate_bands: Band[];
};

type SuggestedRate = {
  planCode: string;
  planName: string;
  currency: string;
  rate: number;
  soldFrom: number;
  soldTo: number;
};

type Snapshot = {
  hotel_code: string;
  stay_date: string;
  total_rooms: number;
  rooms_sold: number;
  available_rooms: number;
  occupancy_percent: number;
  threshold_level: number | null;
  suggested_rates: SuggestedRate[];
};

type SheetDay = {
  day: number;
  occupied?: number;
  roomsSold?: number;
};

function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured");

  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function thresholdFor(percent: number, thresholds: number[]) {
  return (
    [...thresholds]
      .sort((a, b) => a - b)
      .filter((value) => percent >= value)
      .at(-1) ?? null
  );
}

function actionFor(level: number | null, settings: Settings) {
  if (level === settings.alert_thresholds[2])
    return settings.threshold_100_action;
  if (level === settings.alert_thresholds[1])
    return settings.threshold_90_action;
  if (level === settings.alert_thresholds[0])
    return settings.threshold_75_action;
  return "NOTIFY";
}

function sameRates(
  previous: SuggestedRate[] | null | undefined,
  current: SuggestedRate[],
) {
  return JSON.stringify(previous ?? []) === JSON.stringify(current);
}

function suggestedRates(
  plans: Plan[],
  hotelCode: string,
  stayDate: string,
  roomsSold: number,
) {
  return plans
    .filter(
      (plan) =>
        plan.hotel_code === hotelCode &&
        plan.active &&
        plan.effective_from <= stayDate &&
        (!plan.effective_to || plan.effective_to >= stayDate),
    )
    .flatMap((plan) => {
      const band = [...(plan.yield_rate_bands ?? [])]
        .sort((a, b) => a.sold_from - b.sold_from)
        .find(
          (item) =>
            roomsSold >= item.sold_from && roomsSold <= item.sold_to,
        );

      return band
        ? [
            {
              planCode: plan.plan_code,
              planName: plan.plan_name,
              currency: plan.currency,
              rate: Number(band.rate),
              soldFrom: band.sold_from,
              soldTo: band.sold_to,
            },
          ]
        : [];
    })
    .sort((a, b) => a.planCode.localeCompare(b.planCode));
}

async function requireMaster(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) return false;

  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
  } = await client.auth.getUser(token);

  if (!user) return false;

  const { data } = await client
    .from("occupancy_user_access")
    .select("role,active")
    .eq("user_id", user.id)
    .maybeSingle();

  return data?.active === true && data.role === "MASTER_ADMIN";
}

async function readMonth(profile: Profile, year: number, month: number) {
  const scriptUrl = process.env.OCCUPANCY_SCRIPT_URL;
  const token = process.env.OCCUPANCY_API_TOKEN;

  if (!scriptUrl || !token)
    throw new Error("Google Sheet reader is not configured");

  const target = new URL(scriptUrl);
  target.searchParams.set("action", "read");
  target.searchParams.set("token", token);
  target.searchParams.set("sheetId", profile.google_spreadsheet_id!);
  target.searchParams.set("year", String(year));
  target.searchParams.set("month", String(month));

  const response = await fetch(target, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`Reader returned ${response.status}`);

  const data = (await response.json()) as {
    success?: boolean;
    error?: string;
    totalRooms?: number;
    days?: SheetDay[];
    lastUpdatedDate?: string;
    lastUpdatedTime?: string;
  };

  if (!data.success) throw new Error(data.error ?? "Sheet reader failed");
  return data;
}

async function upsertSnapshot(
  db: SupabaseClient,
  snapshot: Snapshot,
  sourceUpdatedAt: string,
) {
  const { error } = await db
    .from("yield_occupancy_snapshots")
    .upsert(
      {
        ...snapshot,
        source_updated_at: sourceUpdatedAt,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "hotel_code,stay_date" },
    );

  if (error) throw error;
}

async function createAlert(
  db: SupabaseClient,
  profile: Profile,
  settings: Settings,
  previous: Snapshot,
  current: Snapshot,
) {
  const increased = current.rooms_sold > previous.rooms_sold;
  const wasFull = previous.available_rooms <= 0;
  const isFull = current.available_rooms <= 0;

  const alertType: "RATE_UPDATE" | "OTA_CLOSURE" | "OTA_REOPEN" =
    isFull && !wasFull
      ? "OTA_CLOSURE"
      : !isFull && wasFull
        ? "OTA_REOPEN"
        : "RATE_UPDATE";

  const action =
    alertType === "OTA_CLOSURE"
      ? settings.closure_action
      : actionFor(current.threshold_level, settings);

  if (action === "OFF") return false;

  const payload = {
    hotelName: profile.hotel_name,
    stayDate: current.stay_date,
    direction: increased
      ? "INCREASED"
      : current.rooms_sold < previous.rooms_sold
        ? "DECREASED"
        : "UNCHANGED",
    previous,
    current,
    suggestedRates: current.suggested_rates,
    missingRateRule: current.suggested_rates.length === 0,
  };

  const record = {
    hotel_code: profile.hotel_code,
    stay_date: current.stay_date,
    alert_type: alertType,
    threshold: current.threshold_level,
    total_rooms: current.total_rooms,
    rooms_sold: current.rooms_sold,
    available_rooms: current.available_rooms,
    occupancy_percent: current.occupancy_percent,
    previous_rooms_sold: previous.rooms_sold,
    rooms_change: current.rooms_sold - previous.rooms_sold,
    previous_available_rooms: previous.available_rooms,
    previous_occupancy_percent: previous.occupancy_percent,
    suggested_rates: current.suggested_rates,
    recommended_rate: current.suggested_rates[0]?.rate ?? null,
    currency: current.suggested_rates[0]?.currency ?? null,
    rate_plan_code:
      current.suggested_rates.map((rate) => rate.planCode).join(",") || null,
    action,
    status: "PENDING",
    payload,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("yield_alerts")
    .select("id")
    .eq("hotel_code", profile.hotel_code)
    .eq("stay_date", current.stay_date)
    .eq("alert_type", alertType)
    .in("status", ["PENDING", "STARTED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("yield_alerts")
      .update(record)
      .eq("id", existing.id);
    if (error) throw error;
    return false;
  }

  const { error } = await db.from("yield_alerts").insert(record);
  if (error) throw error;
  return true;
}

async function runEngine() {
  const db = adminClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { data: profiles, error: profileError },
    { data: settingsRows, error: settingsError },
    { data: plans, error: planError },
  ] = await Promise.all([
    db
      .from("occupancy_profiles")
      .select(
        "hotel_code,hotel_name,total_rooms,google_spreadsheet_id,status",
      )
      .eq("status", "Active"),
    db.from("yield_settings").select("*").eq("active", true),
    db
      .from("yield_rate_plans")
      .select(
        "hotel_code,plan_code,plan_name,currency,effective_from,effective_to,active,yield_rate_bands(sold_from,sold_to,rate)",
      )
      .eq("active", true),
  ]);

  if (profileError || settingsError || planError)
    throw profileError ?? settingsError ?? planError;

  const settingsByHotel = new Map(
    (settingsRows ?? []).map((row) => [row.hotel_code, row as Settings]),
  );

  const activeProfiles = (profiles ?? []).filter(
    (profile) =>
      profile.google_spreadsheet_id &&
      settingsByHotel.has(profile.hotel_code),
  ) as Profile[];

  const jobs: {
    profile: Profile;
    settings: Settings;
    cursor: Date;
    end: Date;
  }[] = [];

  for (const profile of activeProfiles) {
    const settings = settingsByHotel.get(profile.hotel_code)!;
    const end = new Date(today);
    end.setDate(end.getDate() + settings.future_check_days - 1);

    for (
      let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
      cursor <= end;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    ) {
      jobs.push({ profile, settings, cursor, end });
    }
  }

  let checkedDates = 0;
  let createdAlerts = 0;
  let updatedSnapshots = 0;
  let baselines = 0;
  let jobIndex = 0;
  const failures: string[] = [];

  async function processJob(job: (typeof jobs)[number]) {
    const { profile, settings, cursor, end } = job;

    try {
      const sheet = await readMonth(
        profile,
        cursor.getFullYear(),
        cursor.getMonth() + 1,
      );

      const totalRooms = Number(sheet.totalRooms || profile.total_rooms || 0);
      if (totalRooms <= 0) throw new Error("Total Rooms is missing");

      const monthDates = (sheet.days ?? [])
        .map((day) => ({
          date: new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            Number(day.day),
          ),
          sold: Number(day.occupied ?? day.roomsSold ?? 0),
        }))
        .filter((item) => item.date >= today && item.date <= end);

      const dates = monthDates.map((item) => isoDate(item.date));
      const { data: previousRows, error } = dates.length
        ? await db
            .from("yield_occupancy_snapshots")
            .select("*")
            .eq("hotel_code", profile.hotel_code)
            .in("stay_date", dates)
        : { data: [], error: null };

      if (error) throw error;

      const previousByDate = new Map(
        (previousRows ?? []).map((row) => [
          row.stay_date,
          row as Snapshot,
        ]),
      );

      for (const item of monthDates) {
        const stayDate = isoDate(item.date);
        const rates = suggestedRates(
          (plans ?? []) as Plan[],
          profile.hotel_code,
          stayDate,
          item.sold,
        );
        const percent = Number(((item.sold / totalRooms) * 100).toFixed(2));

        const current: Snapshot = {
          hotel_code: profile.hotel_code,
          stay_date: stayDate,
          total_rooms: totalRooms,
          rooms_sold: item.sold,
          available_rooms: totalRooms - item.sold,
          occupancy_percent: percent,
          threshold_level: thresholdFor(percent, settings.alert_thresholds),
          suggested_rates: rates,
        };

        const previous = previousByDate.get(stayDate);
        checkedDates++;

        if (!previous) {
          baselines++;
        } else {
          const changed = previous.rooms_sold !== current.rooms_sold;
          const thresholdChanged =
            previous.threshold_level !== current.threshold_level;
          const ratesChanged = !sameRates(
            previous.suggested_rates,
            current.suggested_rates,
          );

          if (
            changed &&
            (thresholdChanged ||
              ratesChanged ||
              previous.available_rooms <= 0 ||
              current.available_rooms <= 0)
          ) {
            if (
              await createAlert(
                db,
                profile,
                settings,
                previous,
                current,
              )
            )
              createdAlerts++;
          }
        }

        await upsertSnapshot(
          db,
          current,
          `${sheet.lastUpdatedDate ?? ""} ${
            sheet.lastUpdatedTime ?? ""
          }`.trim(),
        );
        updatedSnapshots++;
      }
    } catch (error) {
      failures.push(
        `${profile.hotel_code} ${monthKey(cursor)}: ${
          error instanceof Error ? error.message : "Check failed"
        }`,
      );
    }
  }

  async function worker() {
    while (jobIndex < jobs.length) {
      const job = jobs[jobIndex++];
      await processJob(job);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(6, jobs.length) }, () => worker()),
  );

  return {
    success: true,
    hotels: activeProfiles.length,
    checkedDates,
    updatedSnapshots,
    baselines,
    createdAlerts,
    failures,
    checkedAt: new Date().toISOString(),
  };
}

async function authorized(request: NextRequest) {
  if (request.method === "POST") return requireMaster(request);

  const authorization = request.headers.get("authorization") ?? "";

  // Accept either supported environment-variable name independently.
  // This prevents an old YIELD_CRON_SECRET from overriding a valid CRON_SECRET.
  const acceptedSecrets = [
    process.env.CRON_SECRET,
    process.env.YIELD_CRON_SECRET,
  ].filter((secret): secret is string => Boolean(secret));

  return acceptedSecrets.some(
    (secret) => authorization === `Bearer ${secret}`,
  );
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request)))
    return NextResponse.json(
      { success: false, error: "Master Admin access required" },
      { status: 403 },
    );

  try {
    return NextResponse.json(await runEngine());
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Yield check failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request)))
    return NextResponse.json(
      { success: false, error: "Cron authorization required" },
      { status: 401 },
    );

  try {
    return NextResponse.json(await runEngine());
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Yield check failed",
      },
      { status: 500 },
    );
  }
}
