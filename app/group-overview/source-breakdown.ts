export type SourceRoom = { name: string; rooms: number };
export type SourcePayload = {
  dailySources?: { day: number; rooms: SourceRoom[] }[];
  sources?: { name: string; days?: { day: number; rooms: number }[] }[];
};

const sourceKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
// Exact aliases only: never merge unrelated agents using substring matching.
const aliases: Record<string, string> = {
  booking: "Booking.com", bookingcom: "Booking.com", bookingdotcom: "Booking.com",
  agoda: "Agoda", agodacom: "Agoda",
  expedia: "Expedia", expediacom: "Expedia",
  tripcom: "Trip.com", tripdotcom: "Trip.com",
  airbnb: "Airbnb", airbnbcom: "Airbnb",
  direct: "Direct", directbooking: "Direct", directbookings: "Direct",
  website: "Website", hotelwebsite: "Website", officialwebsite: "Website",
  walkin: "Walk-in", walkins: "Walk-in",
  foc: "FOC", freeofcharge: "FOC",
};
export function canonicalSource(name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  return aliases[sourceKey(clean)] ?? clean;
}
export function extractDailySources(payload: SourcePayload, days: number): SourceRoom[][] {
  return Array.from({ length: days }, (_, index) => {
    const direct = payload.dailySources?.find((entry) => Number(entry.day) === index + 1);
    const rows = direct ? direct.rooms : (payload.sources ?? []).map((source) => ({
      name: source.name,
      rooms: source.days?.find((entry) => Number(entry.day) === index + 1)?.rooms ?? 0,
    }));
    return rows.map((row) => ({ name: String(row.name ?? "").trim(), rooms: Number(row.rooms) }))
      .filter((row) => row.name && Number.isFinite(row.rooms) && row.rooms > 0);
  });
}
export function groupSourceBreakdown(hotels: { occupied: number[]; dailySources?: SourceRoom[][] }[], index: number) {
  const totals = new Map<string, SourceRoom>();
  let unclassified = 0;
  let excess = 0;
  for (const hotel of hotels) {
    let recorded = 0;
    for (const source of hotel.dailySources?.[index] ?? []) {
      const name = canonicalSource(source.name);
      const key = sourceKey(name);
      const previous = totals.get(key);
      totals.set(key, { name: previous?.name ?? name, rooms: (previous?.rooms ?? 0) + source.rooms });
      recorded += source.rooms;
    }
    const sold = hotel.occupied[index] ?? 0;
    unclassified += Math.max(0, sold - recorded);
    excess += Math.max(0, recorded - sold);
  }
  const sources = [...totals.values()].sort((a, b) => b.rooms - a.rooms || a.name.localeCompare(b.name));
  return { sources, unclassified, excess, recorded: sources.reduce((sum, source) => sum + source.rooms, 0) };
}
