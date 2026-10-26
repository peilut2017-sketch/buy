// Points the shared data layer at this build's Supabase project. Imported first by every entry point.
import { configureBackend } from "@smartbuy/data";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.ts";

configureBackend({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
