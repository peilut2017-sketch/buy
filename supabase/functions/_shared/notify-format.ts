/** ₪149.90 and ₪150, as in the interface (the shekel sign first, no space). */
export function formatIls(amount: number): string {
  const whole = Number.isInteger(amount);
  return `₪${amount.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
