// Hebrew text helpers: counts with correct number agreement, and the typographic marks the copy rules require.

export interface CountForms {
  /** Used for exactly one, written in full: "ביקורת אחת". */
  one: string;
  /** Used for exactly two when Hebrew has a dual form: "יומיים". Omit to use the plural with the digit. */
  two?: string;
  /** Plural noun, used after the number: "ביקורות". */
  many: string;
  /** Used for zero when zero needs its own words, for example "אין ביקורות". Otherwise "0 ביקורות" is shown. */
  zero?: string;
}

/** countLabel(1, forms) = "ביקורת אחת", countLabel(5, forms) = "5 ביקורות". */
export function countLabel(n: number, forms: CountForms): string {
  if (n === 0 && forms.zero) return forms.zero;
  if (n === 1) return forms.one;
  if (n === 2 && forms.two) return forms.two;
  return `${formatCount(n)} ${forms.many}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export const REVIEWS = { one: "ביקורת אחת", many: "ביקורות", zero: "אין ביקורות" } as const;
export const VERIFIED_REVIEWS = { one: "מאומתת", many: "מאומתות" } as const;
export const BUYERS = { one: "קונה אחד", many: "קונים" } as const;

export const GERESH = "׳";
export const GERSHAYIM = "״";
