// Synthetic users, products and a configured site for the handler tests. Nothing here is real data.
import type { Ctx } from "../handlers/context.ts";
import { createStore } from "../store.sql.ts";
import type { TestDb } from "./db.ts";

export const BUNDLED_RULES = { parentSku: { fromSku: "^(.{6})" }, productType: "apparel" };

export const USERS = {
  alice: "a0000000-0000-4000-8000-000000000001",
  bob: "b0000000-0000-4000-8000-000000000002",
  carol: "c0000000-0000-4000-8000-000000000003",
  dave: "d0000000-0000-4000-8000-000000000004",
  erin: "e0000000-0000-4000-8000-000000000005",
  mia: "f0000000-0000-4000-8000-000000000006", // moderator
  adam: "f1000000-0000-4000-8000-000000000007", // admin
} as const;

export type UserName = keyof typeof USERS;

export const NOW = new Date("2026-10-25T10:00:00Z");

export async function seed(db: TestDb): Promise<void> {
  const { raw } = db;
  for (const [name, id] of Object.entries(USERS)) await raw`insert into auth.users (id, email) values (${id}, ${`${name}@test.invalid`})`;
  // The signup trigger created the profiles. Give everyone a nickname, and staff their roles.
  for (const [name, id] of Object.entries(USERS)) await raw`update public.profiles set display_name = ${`nick_${name}`} where id = ${id}`;
  await raw`update public.profiles set role = 'moderator' where id = ${USERS.mia}`;
  await raw`update public.profiles set role = 'admin' where id = ${USERS.adam}`;
  await raw`update public.sites set adapter_config = ${raw.json(BUNDLED_RULES)}, status = 'beta' where id = 'terminalx'`;
}

export const deleted: string[] = [];

export function ctxFor(db: TestDb, who: UserName | null, over: Partial<Ctx> = {}): Ctx {
  return {
    user: who ? { id: USERS[who], email: `${who}@test.invalid` } : null,
    now: NOW,
    store: createStore(db.sql, {
      deleteAuthUser: async (id) => {
        deleted.push(id);
        await db.raw`delete from auth.users where id = ${id}`;
      },
    }),
    pepper: "test-pepper-0123456789abcdef",
    ...over,
  };
}

export const REVIEW_TEXT = "ביקורת בדיקה ארוכה מספיק כדי לעבור את הבדיקה של אורך הטקסט המינימלי.";

/** A valid submit-review body for a product. */
export function reviewBody(sku = "w817260002", over: Record<string, unknown> = {}) {
  return {
    siteId: "terminalx",
    sku,
    parentSku: sku.slice(0, 6),
    productType: "general", // ignored by the server: the site's config decides
    detectionConfidence: "high",
    product: { name: "מכנסי בדיקה", brand: "מותג בדיקה", imageUrl: "https://media.example.test/a.jpg", url: `https://www.terminalx.com/${sku}` },
    variantValues: { מידה: "M" },
    rating: 4,
    title: null,
    body: REVIEW_TEXT,
    answers: { fit: "exact" },
    purchaseMonth: "2026-09",
    ...over,
  };
}
