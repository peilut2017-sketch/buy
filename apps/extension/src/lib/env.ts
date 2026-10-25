// Build-time settings from apps/extension/.env (never committed). The anon key is public by design.
// The service role key must never appear in the extension.

export const SUPABASE_URL: string = String(import.meta.env.WXT_SUPABASE_URL ?? "").replace(/\/$/, "");
export const SUPABASE_ANON_KEY: string = String(import.meta.env.WXT_SUPABASE_ANON_KEY ?? "");
/** Public website, for links such as the privacy policy and the uninstall survey. Empty until the domain is chosen. */
export const WEBSITE_URL: string = String(import.meta.env.WXT_WEBSITE_URL ?? "").replace(/\/$/, "");

export const BACKEND_CONFIGURED = SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
