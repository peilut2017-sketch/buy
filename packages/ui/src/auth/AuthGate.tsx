import { validateNickname } from "@smartbuy/core";
import { NetworkError, NicknameTakenError, getProfile, setNickname, type Identity, type Profile } from "@smartbuy/data";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Button, Notice, Skel, TextField } from "../components.tsx";
import { useResource } from "../hooks.ts";
import { AuthError, useAuth } from "./context.tsx";

function messageOf(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  if (e instanceof NetworkError) return "אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.";
  return "משהו השתבש. נסו שוב.";
}

/** Sign-in card: Google, or a one-time code by email. Viewing reviews never needs this; writing and voting do. */
export function SignInCard({ reason }: { reason: string }) {
  const { signInWithGoogle, requestEmailCode, verifyEmailCode } = useAuth();
  const [step, setStep] = useState<"choose" | "email" | "code">("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>, next?: typeof step) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (next) setStep(next);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sb-stack sb-gap-3">
      <div class="sb-stack" style={{ gap: "2px" }}>
        <h2 class="sb-t-heading">נדרשת התחברות</h2>
        <p class="sb-t-support sb-secondary">{reason} צפייה בביקורות לא דורשת התחברות. אנחנו שומרים רק את כתובת המייל ואת הכינוי שתבחרו.</p>
      </div>

      {step === "choose" && (
        <div class="sb-stack sb-gap-2">
          <Button variant="primary" block disabled={busy} onClick={() => run(signInWithGoogle)}>המשך עם Google</Button>
          <Button block disabled={busy} onClick={() => setStep("email")}>המשך עם קוד במייל</Button>
        </div>
      )}

      {step === "email" && (
        <form class="sb-stack sb-gap-3" onSubmit={(e) => (e.preventDefault(), void run(() => requestEmailCode(email), "code"))}>
          <TextField label="כתובת מייל" type="email" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} dir="ltr" class="ltr-input" autocomplete="email" required />
          <Button type="submit" variant="primary" block disabled={busy || email.trim() === ""}>שליחת קוד</Button>
        </form>
      )}

      {step === "code" && (
        <form class="sb-stack sb-gap-3" onSubmit={(e) => (e.preventDefault(), void run(() => verifyEmailCode(email, code)))}>
          <TextField label="הקוד שנשלח אליכם" hint={`שלחנו קוד ל-${email}`} value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} inputMode="numeric" autocomplete="one-time-code" dir="ltr" class="ltr-input" required />
          <Button type="submit" variant="primary" block disabled={busy || code.trim() === ""}>אישור</Button>
          <Button variant="quiet" onClick={() => setStep("email")}>החלפת כתובת</Button>
        </form>
      )}

      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}

/** The nickname is public; the real name is never shown (spec 12). Unique, 2 to 30 characters. */
export function NicknameCard({ identity, onSaved }: { identity: Identity; onSaved: (name: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    const checked = validateNickname(name);
    if (!checked.ok) return setError(checked.errors.displayName ?? "הכינוי לא תקין.");
    setBusy(true);
    setError(null);
    try {
      onSaved(await setNickname(identity.token, identity.userId, checked.value));
    } catch (err) {
      setError(err instanceof NicknameTakenError ? "הכינוי הזה תפוס. בחרו כינוי אחר." : messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="sb-stack sb-gap-3" onSubmit={submit}>
      <div class="sb-stack" style={{ gap: "2px" }}>
        <h2 class="sb-t-heading">בחירת כינוי</h2>
        <p class="sb-t-support sb-secondary">הכינוי מופיע ליד הביקורות שלכם. השם האמיתי לא מוצג לאף אחד.</p>
      </div>
      <TextField label="כינוי" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} maxLength={30} error={error ?? undefined} autocomplete="nickname" />
      <Button type="submit" variant="primary" block disabled={busy || name.trim() === ""}>שמירת כינוי</Button>
    </form>
  );
}

export interface Account {
  identity: Identity;
  profile: Profile & { displayName: string };
}

/**
 * Renders `children` only for a signed-in user with a nickname. Otherwise it asks for what is missing.
 * `reason` tells people why sign-in is needed, in one sentence.
 */
export function RequireAccount({ reason, children }: { reason: string; children: (account: Account) => ComponentChildren }) {
  const { configured, useSession } = useAuth();
  const session = useSession();
  if (!configured) return <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת.</Notice>;
  if (session.status === "loading") return <Skel width="70%" height="18px" />;
  if (session.status === "out") return <SignInCard reason={reason} />;
  return <WithProfile identity={session.identity}>{children}</WithProfile>;
}

function WithProfile({ identity, children }: { identity: Identity; children: (account: Account) => ComponentChildren }) {
  const profile = useResource(() => getProfile(identity.token, identity.userId), [identity.userId]);
  const [saved, setSaved] = useState<string | null>(null);

  if (profile.status === "loading") return <Skel width="70%" height="18px" />;
  if (profile.status === "error") {
    return (
      <Notice kind="error" title="לא הצלחנו לטעון את הפרופיל" action={<Button small onClick={profile.reload}>ניסיון חוזר</Button>}>
        בדקו את החיבור לאינטרנט ונסו שוב.
      </Notice>
    );
  }
  const displayName = saved ?? profile.data?.displayName ?? null;
  if (!displayName || !profile.data) return <NicknameCard identity={identity} onSaved={setSaved} />;
  return <>{children({ identity, profile: { ...profile.data, displayName } })}</>;
}
