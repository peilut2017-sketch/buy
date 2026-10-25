// Website sign-in: Google by redirect, or a one-time code by email, through supabase-js with the session kept by the browser.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "@smartbuy/data";
import { AuthError, type AuthApi, type SessionState } from "@smartbuy/ui";
import { useEffect, useState } from "preact/hooks";
import { BACKEND, BACKEND_CONFIGURED } from "./env.ts";

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  client ??= createClient(BACKEND.url, BACKEND.anonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  return client;
}

function toIdentity(session: Session | null): Identity | null {
  return session ? { token: session.access_token, userId: session.user.id, email: session.user.email ?? null } : null;
}

function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: BACKEND_CONFIGURED ? "loading" : "out" });
  useEffect(() => {
    if (!BACKEND_CONFIGURED) return;
    let alive = true;
    const apply = (session: Session | null) => {
      if (!alive) return;
      const identity = toIdentity(session);
      setState(identity ? { status: "in", identity } : { status: "out" });
    };
    void sb().auth.getSession().then(({ data }) => apply(data.session));
    const { data } = sb().auth.onAuthStateChange((_e, session) => apply(session));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

export const webAuth: AuthApi = {
  configured: BACKEND_CONFIGURED,
  useSession,
  async signInWithGoogle() {
    const { error } = await sb().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}${location.pathname}${location.search}` } });
    if (error) throw new AuthError("לא הצלחנו להתחיל את ההתחברות. נסו שוב.");
  },
  async requestEmailCode(email) {
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw new AuthError(error.status === 429 ? "נשלחו יותר מדי בקשות. נסו שוב בעוד דקה." : "לא הצלחנו לשלוח קוד. בדקו את כתובת המייל ונסו שוב.");
  },
  async verifyEmailCode(email, code) {
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) throw new AuthError("הקוד שגוי או שפג תוקפו. בקשו קוד חדש.");
  },
  async getIdentity() {
    if (!BACKEND_CONFIGURED) return null;
    return toIdentity((await sb().auth.getSession()).data.session);
  },
  async signOut() {
    await sb().auth.signOut();
  },
};
