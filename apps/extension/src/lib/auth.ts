// Sign-in. Google through the browser's identity flow, or a one-time code sent by email.
// The code flow keeps everything inside the extension: a magic link would open a page the extension cannot read.

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { browser } from "wxt/browser";
import { AuthError, type AuthApi, type SessionState } from "@smartbuy/ui";
import type { Identity } from "@smartbuy/data";
import { useEffect, useState } from "preact/hooks";
import { BACKEND_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.ts";
import { NotConfiguredError } from "@smartbuy/data";

const extensionStorage = {
  async getItem(key: string): Promise<string | null> {
    const got = await browser.storage.local.get(key);
    return (got[key] as string | undefined) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

let client: SupabaseClient | null = null;

export function authClient(): SupabaseClient {
  if (!BACKEND_CONFIGURED) throw new NotConfiguredError();
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: extensionStorage,
      storageKey: "sb-auth",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}

function toIdentity(session: Session | null): Identity | null {
  return session ? { token: session.access_token, userId: session.user.id, email: session.user.email ?? null } : null;
}

export async function currentIdentity(): Promise<Identity | null> {
  if (!BACKEND_CONFIGURED) return null;
  const { data } = await authClient().auth.getSession();
  return toIdentity(data.session);
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: BACKEND_CONFIGURED ? "loading" : "out" });
  useEffect(() => {
    if (!BACKEND_CONFIGURED) return;
    const auth = authClient().auth;
    let alive = true;
    const apply = (session: Session | null) => {
      if (!alive) return;
      const identity = toIdentity(session);
      setState(identity ? { status: "in", identity } : { status: "out" });
    };
    void auth.getSession().then(({ data }) => apply(data.session));
    const { data } = auth.onAuthStateChange((_event, session) => apply(session));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

export async function signInWithGoogle(): Promise<void> {
  const auth = authClient().auth;
  const redirectTo = browser.identity.getRedirectURL();
  const { data, error } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw new AuthError("לא הצלחנו להתחיל את ההתחברות. נסו שוב.");
  let redirected: string | undefined;
  try {
    redirected = await browser.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  } catch {
    throw new AuthError("ההתחברות בוטלה.");
  }
  const code = redirected ? new URL(redirected).searchParams.get("code") : null;
  if (!code) throw new AuthError("ההתחברות לא הושלמה. נסו שוב.");
  const exchanged = await auth.exchangeCodeForSession(code);
  if (exchanged.error) throw new AuthError("ההתחברות לא הושלמה. נסו שוב.");
}

export async function requestEmailCode(email: string): Promise<void> {
  const { error } = await authClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) {
    throw new AuthError(error.status === 429 ? "נשלחו יותר מדי בקשות. נסו שוב בעוד דקה." : "לא הצלחנו לשלוח קוד. בדקו את כתובת המייל ונסו שוב.");
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await authClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error) throw new AuthError("הקוד שגוי או שפג תוקפו. בקשו קוד חדש.");
}

export async function signOut(): Promise<void> {
  await authClient().auth.signOut();
}

export type { Identity, SessionState };

/** What the shared sign-in screens use in the extension. */
export const extensionAuth: AuthApi = {
  configured: BACKEND_CONFIGURED,
  useSession,
  signInWithGoogle,
  requestEmailCode,
  verifyEmailCode,
  getIdentity: currentIdentity,
  signOut,
};
