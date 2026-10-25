// Sign-in is different on each platform (the extension uses the browser's identity flow, the website a redirect),
// so the shared screens talk to this small interface and each app provides its own.
import type { Identity } from "@smartbuy/data";
import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";

export type SessionState = { status: "loading" } | { status: "out" } | { status: "in"; identity: Identity };

export class AuthError extends Error {}

export interface AuthApi {
  /** False when the build has no backend, so screens can say so instead of failing. */
  configured: boolean;
  /** Where the terms of use can be read, or null when the build has no website address. */
  termsUrl: string | null;
  useSession(): SessionState;
  signInWithGoogle(): Promise<void>;
  requestEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  getIdentity(): Promise<Identity | null>;
  signOut(): Promise<void>;
}

const Context = createContext<AuthApi | null>(null);

export function AuthProvider({ auth, children }: { auth: AuthApi; children: ComponentChildren }) {
  return <Context.Provider value={auth}>{children}</Context.Provider>;
}

export function useAuth(): AuthApi {
  const auth = useContext(Context);
  if (!auth) throw new Error("AuthProvider is missing");
  return auth;
}
