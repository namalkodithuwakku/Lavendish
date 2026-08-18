import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { HOTEL_PROFILE_SEEDS } from "../../../profile-seed-data";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = "https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";
const DEFAULT_RAPIDAPI_HOST = "xotelo-hotel-prices.p.rapidapi.com";

type XoteloHotel = {
  hotel_key?: string;
  name?: string;
  place_name?: string;
  short_place_name?: string;
  url?: string;
};

type Competitor = { name?: string; url?: string; active?: boolean; xoteloHotelKey?: string; xoteloName?: string };

type HotelMatch = XoteloHotel & { score: number };

function competitorSetFor(code: string | null, data: Record<string, unknown>) {
  const saved = data.competitorSet as { main?: Competitor[]; additional?: Competitor[]; criteria?: Record<string, unknown> } | undefined;
  if ((saved?.main?.length ?? 0) + (saved?.additional?.length ?? 0) > 0) return saved;
  const key = code === "LTL" ? "TLK" : code === "LBR" ? "LBU" : code ?? "";
  const seed = HOTEL_PROFILE_SEEDS[key]?.profile.competitorSet;
  return seed && typeof seed === "object" ? seed as typeof saved : saved;
}

function db() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireMaster(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return null;
  const auth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await auth.auth.getUser(token);
  if (!user) return null;
  const { data } = await db().from("occupancy_user_access").select("role,active").eq("user_id", user.id).maybeSingle();
  return data?.active && data.role === "MASTER_ADMIN" ? user : null;
}

function cleanName(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/\b(hotel|resort|the|by)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchScore(expected: string, candidate: XoteloHotel, location: string) {
  const left = cleanName(expected), right = cleanName(candidate.name ?? "");
  if (!left || !right) return 0;
  let score = left === right ? 1 : left.includes(right) || right.includes(left) ? .88 : 0;
  if (!score) {
    const words = left.split(" ").filter(word => word.length > 2);
    score = words.filter(word => right.includes(word)).length / Math.max(1, words.length);
  }
  const place = cleanName(`${candidate.place_name ?? ""} ${candidate.short_place_name ?? ""}`);
  if (location && place.includes(cleanName(location))) score = Math.min(1, score + .08);
  return score;
}

function tripadvisorKey(value: string) {
  const match = value.match(/Hotel_Review-g(\d+)-d(\d+)/i) ?? value.match(/\b(g\d+-d\d+)\b/i);
  return match ? (match[1]?.startsWith("g") ? match[1] : `g${match[1]}-d${match[2]}`) : null;
}

async function findTripadvisorMatch(name: string, location: string, serpApiKey?: string): Promise<HotelMatch | null> {
  if (!serpApiKey) return null;
  try {
    const params = new URLSearchParams({
      engine: "google",
      q: `site:tripadvisor.com/Hotel_Review \"${name}\" ${location} Sri Lanka`,
      gl: "lk", hl: "en", num: "10", api_key: serpApiKey,
    });
    const response = await fetch(`https://serpapi.com/search.json?${params}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { organic_results?: Array<{ title?: string; link?: string; redirect_link?: string }> };
    const candidates = (payload.organic_results ?? []).flatMap(result => {
      const url = result.link ?? result.redirect_link ?? "";
      const hotelKey = tripadvisorKey(url);
      if (!hotelKey) return [];
      const item: XoteloHotel = { hotel_key: hotelKey, name: result.title?.replace(/\s*-\s*Tripadvisor.*$/i, "").trim() || name, url };
      return [{ item, score: matchScore(name, item, location) }];
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < .55 || !best.item.hotel_key) return null;
    return { ...best.item, score: best.score };
  } catch {
    return null;
  }
}

async function findHotel(name: string, location: string, apiKey: string, host: string, serpApiKey?: string): Promise<HotelMatch | null> {
  const simplified = name.replace(/\b(hotel|resort|the|by|lavendish)\b/gi, " ").replace(/\s+/g, " ").trim();
  const queries = [
    name.trim(),
    simplified,
    [name, location].filter(Boolean).join(" "),
    [simplified, location].filter(Boolean).join(" "),
  ].filter((query, index, all) => query && all.findIndex(item => item.toLowerCase() === query.toLowerCase()) === index);
  let best: { item: XoteloHotel; score: number } | undefined;

  for (const query of queries) {
    const response = await fetch(`https://${host}/api/search?${new URLSearchParams({ query, location_type: "accommodation" })}`, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": host }, cache: "no-store",
    });
    const payload = await response.json() as { error?: { message?: string } | string; result?: { list?: XoteloHotel[] } };
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (!response.ok) throw new Error(`Xotelo search failed: ${message ?? `HTTP ${response.status}`}`);
    if (payload.error && !/no results? found/i.test(message ?? "")) throw new Error(`Xotelo search failed: ${message}`);

    const candidate = (payload.result?.list ?? [])
      .map(item => ({ item, score: matchScore(name, item, location) }))
      .sort((a, b) => b.score - a.score)[0];
    if (candidate && (!best || candidate.score > best.score)) best = candidate;
    if (best?.score === 1) break;
  }

  if (best && best.score >= .72 && best.item.hotel_key) return { ...best.item, score: best.score };
  return findTripadvisorMatch(name, location, serpApiKey);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireMaster(request);
    if (!user) return NextResponse.json({ error: "Master Admin access required" }, { status: 403 });
    const apiKey = process.env.RAPIDAPI_KEY ?? process.env.XOTELO_RAPIDAPI_KEY;
    if (!apiKey) return NextResponse.json({ error: "Add RAPIDAPI_KEY in Vercel before automatic Xotelo setup." }, { status: 503 });
    const body = await request.json() as { propertyId?: string };
    if (!body.propertyId) return NextResponse.json({ error: "Select a hotel first" }, { status: 400 });

    const client = db();
    const { data: property, error } = await client.from("properties").select("id,name,location,legacy_hotel_code,property_profiles(id,profile_data)").eq("id", body.propertyId).single();
    if (error || !property) throw error ?? new Error("Hotel not found");
    const relation = property.property_profiles as unknown;
    const profiles = Array.isArray(relation) ? relation : relation ? [relation] : [];
    const profile = profiles[0] as { id?: string; profile_data?: Record<string, unknown> } | undefined;
    const profileData = profile?.profile_data ?? {};
    const set = competitorSetFor(property.legacy_hotel_code, profileData);
    const main = [...(set?.main ?? [])].slice(0, 4);
    const host = process.env.XOTELO_RAPIDAPI_HOST ?? DEFAULT_RAPIDAPI_HOST;
    const serpApiKey = process.env.SERPAPI_API_KEY;
    const location = property.location ?? "Sri Lanka";
    const ownMatch = await findHotel(property.name, location, apiKey, host, serpApiKey);
    const matched: Array<{ name: string; hotelKey: string; matchedName: string; score: number }> = [];
    const unmatched: string[] = [];
    const updatedMain: Competitor[] = [];

    for (const competitor of main) {
      if (!competitor.name?.trim()) { updatedMain.push(competitor); continue; }
      const found = await findHotel(competitor.name.trim(), location, apiKey, host, serpApiKey);
      if (found?.hotel_key) {
        matched.push({ name: competitor.name, hotelKey: found.hotel_key, matchedName: found.name ?? competitor.name, score: found.score });
        updatedMain.push({ ...competitor, xoteloHotelKey: found.hotel_key, xoteloName: found.name ?? competitor.name });
      } else {
        unmatched.push(competitor.name);
        updatedMain.push(competitor);
      }
    }
    if (ownMatch?.hotel_key) matched.unshift({ name: property.name, hotelKey: ownMatch.hotel_key, matchedName: ownMatch.name ?? property.name, score: ownMatch.score });
    else unmatched.unshift(property.name);

    const xotelo = ownMatch?.hotel_key ? { hotelKey: ownMatch.hotel_key, matchedName: ownMatch.name ?? property.name, matchedAt: new Date().toISOString() } : profileData.xotelo;
    const payload: Record<string, unknown> = {
      property_id: property.id,
      profile_data: { ...profileData, xotelo, competitorSet: { ...set, main: updatedMain } },
      verification_status: "NEEDS_REVIEW", updated_by: user.id, updated_at: new Date().toISOString(),
    };
    if (profile?.id) payload.id = profile.id;
    const { error: saveError } = await client.from("property_profiles").upsert(payload, { onConflict: "property_id" });
    if (saveError) throw saveError;
    return NextResponse.json({ ok: true, hotel: property.name, matched, unmatched, matchedCount: matched.length, requestedCount: main.filter(item => item.name?.trim()).length + 1 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not set up Xotelo" }, { status: 500 });
  }
}
