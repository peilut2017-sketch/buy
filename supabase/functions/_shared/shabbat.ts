// Shabbat mode (spec 14): from sunset on Friday until the stars come out on Saturday night, by the user's own city.
// The astronomy comes from @hebcal/core, passed in so this file has no bare import (Deno and Node both run it).

export interface IsraeliCity {
  id: string;
  he: string;
  lat: number;
  lon: number;
}

/** Cities a user can pick. Coordinates are approximate (two decimals), which is within a minute or two of sunset. */
export const ISRAELI_CITIES: readonly IsraeliCity[] = [
  { id: "jerusalem", he: "ירושלים", lat: 31.77, lon: 35.22 },
  { id: "tel-aviv", he: "תל אביב-יפו", lat: 32.08, lon: 34.78 },
  { id: "haifa", he: "חיפה", lat: 32.79, lon: 34.99 },
  { id: "beer-sheva", he: "באר שבע", lat: 31.25, lon: 34.79 },
  { id: "eilat", he: "אילת", lat: 29.56, lon: 34.95 },
  { id: "tiberias", he: "טבריה", lat: 32.79, lon: 35.53 },
  { id: "ashdod", he: "אשדוד", lat: 31.8, lon: 34.65 },
  { id: "ashkelon", he: "אשקלון", lat: 31.67, lon: 34.57 },
  { id: "petah-tikva", he: "פתח תקווה", lat: 32.09, lon: 34.89 },
  { id: "netanya", he: "נתניה", lat: 32.33, lon: 34.86 },
  { id: "rishon-lezion", he: "ראשון לציון", lat: 31.97, lon: 34.8 },
  { id: "rehovot", he: "רחובות", lat: 31.89, lon: 34.81 },
  { id: "bnei-brak", he: "בני ברק", lat: 32.08, lon: 34.83 },
  { id: "holon", he: "חולון", lat: 32.01, lon: 34.77 },
  { id: "ramat-gan", he: "רמת גן", lat: 32.07, lon: 34.82 },
  { id: "herzliya", he: "הרצליה", lat: 32.16, lon: 34.84 },
  { id: "kfar-saba", he: "כפר סבא", lat: 32.18, lon: 34.91 },
  { id: "modiin", he: "מודיעין", lat: 31.9, lon: 35.01 },
  { id: "beit-shemesh", he: "בית שמש", lat: 31.75, lon: 34.99 },
  { id: "nazareth", he: "נצרת", lat: 32.7, lon: 35.3 },
  { id: "safed", he: "צפת", lat: 32.96, lon: 35.5 },
  { id: "acre", he: "עכו", lat: 32.93, lon: 35.08 },
  { id: "hadera", he: "חדרה", lat: 32.43, lon: 34.92 },
  { id: "kiryat-shmona", he: "קריית שמונה", lat: 33.21, lon: 35.57 },
];

export function cityById(id: string | null | undefined): IsraeliCity | null {
  return ISRAELI_CITIES.find((c) => c.id === id) ?? null;
}

/** The part of @hebcal/core this file uses. */
// deno-lint-ignore-file no-explicit-any
export interface HebcalLike {
  Location: new (lat: number, lon: number, il: boolean, tzid: string) => any;
  Zmanim: new (location: any, date: Date, useElevation: boolean) => { sunset(): Date; tzeit(angle?: number): Date };
}

export const TIMEZONE = "Asia/Jerusalem";
export const TZEIT_DEGREES = 8.5;

/** The calendar date and weekday (0 = Sunday) in Israel for an instant. */
export function israelDate(instant: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

export interface ShabbatWindow {
  start: Date;
  end: Date;
}

/** The Shabbat that starts on the Friday on or before `now` (Israel date). Null from Sunday to Thursday. */
export function shabbatWindow(now: Date, city: IsraeliCity, hebcal: HebcalLike): ShabbatWindow | null {
  const today = israelDate(now);
  if (today.weekday !== 5 && today.weekday !== 6) return null;
  const fridayOffset = today.weekday === 6 ? -1 : 0;
  // Date components are interpreted in the runtime's own zone by Hebcal, which is what `new Date(y, m, d)` builds.
  const friday = new Date(today.year, today.month - 1, today.day + fridayOffset);
  const saturday = new Date(today.year, today.month - 1, today.day + fridayOffset + 1);
  const location = new hebcal.Location(city.lat, city.lon, true, TIMEZONE);
  return {
    start: new hebcal.Zmanim(location, friday, false).sunset(),
    end: new hebcal.Zmanim(location, saturday, false).tzeit(TZEIT_DEGREES),
  };
}

/** When Shabbat ends, if `now` is inside it. */
export function shabbatEndsAt(now: Date, city: IsraeliCity | null, hebcal: HebcalLike): Date | null {
  if (!city) return null;
  const window = shabbatWindow(now, city, hebcal);
  return window && now >= window.start && now < window.end ? window.end : null;
}
