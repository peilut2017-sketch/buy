// The person's usual size per kind of item (spec 15). Stored in size_profiles; the owner of the row is the only reader.

import { ApiError, rest } from "./rest.ts";

/** "apparel" and "footwear" are the product types the adapters report. A finer split (tops, bottoms) needs a category from the adapter. */
export type SizeKind = "apparel" | "footwear";

export interface SizeEntry {
  kind: SizeKind;
  /** Empty means every brand. */
  brand: string;
  size: string;
}

interface Row {
  garment_type: SizeKind;
  brand: string;
  size: string;
}

export async function getSizeProfile(token: string, userId: string): Promise<SizeEntry[]> {
  const rows = await rest<Row[]>("size_profiles", { params: { user_id: `eq.${userId}`, select: "garment_type,brand,size" }, token });
  return rows.map((r) => ({ kind: r.garment_type, brand: r.brand, size: r.size }));
}

/** The brand-specific size wins over the all-brands one. */
export function pickUsualSize(entries: readonly SizeEntry[], kind: string, brand: string | null): string | null {
  const ofKind = entries.filter((e) => e.kind === kind);
  const specific = brand ? ofKind.find((e) => e.brand.toLowerCase() === brand.trim().toLowerCase()) : undefined;
  return (specific ?? ofKind.find((e) => e.brand === ""))?.size ?? null;
}

export async function saveSize(token: string, userId: string, entry: SizeEntry): Promise<void> {
  const rows = await rest<unknown[]>("size_profiles", {
    method: "POST",
    params: { on_conflict: "user_id,garment_type,brand", select: "size" },
    body: { user_id: userId, garment_type: entry.kind, brand: entry.brand, size: entry.size },
    token,
    prefer: "resolution=merge-duplicates,return=representation",
  });
  if (rows.length !== 1) throw new ApiError("not saved", 500);
}

export async function deleteSize(token: string, userId: string, kind: SizeKind, brand: string): Promise<void> {
  const rows = await rest<unknown[]>("size_profiles", {
    method: "DELETE",
    params: { user_id: `eq.${userId}`, garment_type: `eq.${kind}`, brand: `eq.${brand}`, select: "size" },
    token,
    prefer: "return=representation",
  });
  if (rows.length !== 1) throw new ApiError("not deleted", 500);
}
