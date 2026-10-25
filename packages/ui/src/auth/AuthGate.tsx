import { TERMS_VERSION, validateNickname } from "@smartbuy/core";
import { NetworkError, NicknameTakenError, acceptTerms, getProfile, setNickname, type Identity, type Profile } from "@smartbuy/data";
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
        <p class="sb-t-support sb-secondary">{reason} צפייה בביקורות לא דורשת התחברות. אנחנו שומרים רק את כתובת המייל ואת הכינוי שתבחרו. בכניסה הראשונה תתבקשו לאשר את תנאי השימוש.</p>
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

/**
 * The terms of use, accepted once at sign-up (and again when the version changes). The server refuses writes until then,
 * so this screen is the way forward and not a formality. It says what the service does automatically, in plain words.
 */
export function TermsCard({ identity, onAccepted }: { identity: Identity; onAccepted: () => void }) {
  const { termsUrl } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!agreed) return setError("כדי להמשיך צריך לאשר את תנאי השימוש.");
    setBusy(true);
    setError(null);
    try {
      await acceptTerms(identity.token, TERMS_VERSION);
      onAccepted(); // shown only after the server stored it
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="sb-stack sb-gap-3" onSubmit={submit} noValidate>
      <div class="sb-stack" style={{ gap: "2px" }}>
        <h2 class="sb-t-heading">תנאי שימוש</h2>
        <p class="sb-t-support sb-secondary">לפני שממשיכים, בקצרה מה השירות עושה:</p>
      </div>
      <ul class="sb-stack sb-gap-2 sb-t-support" style={{ margin: 0, paddingInlineStart: "20px" }}>
        <li>מציג ביקורות של משתמשים ומעקב מחירים באתרי קניות. השירות עצמאי ואין לו קשר לחנויות.</li>
        <li>בודק מחירים ומלאי של מוצרים שאתם עוקבים אחריהם, באופן אוטומטי.</li>
        <li>אם תאשרו בדיקת הזמנות, התוסף קורא את עמוד ההזמנות שלכם בחנות כדי לאמת רכישות. נשמר רק גיבוב של מספר ההזמנה, המק"טים והתאריכים.</li>
        <li>הכינוי והביקורות שתכתבו פומביים. השם האמיתי לא מוצג.</li>
      </ul>
      {termsUrl && <a class="sb-t-support" href={termsUrl} target="_blank" rel="noreferrer">לקריאת תנאי השימוש המלאים</a>}
      <label class="sb-t-body" style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed((e.currentTarget as HTMLInputElement).checked)} disabled={busy} />
        <span>קראתי ואני מאשר/ת את תנאי השימוש</span>
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <Button type="submit" variant="primary" block disabled={busy}>{busy ? "שומרים…" : "אישור והמשך"}</Button>
    </form>
  );
}

/** Children render only once the signed-in person has accepted the current terms. */
export function RequireTerms({ identity, children }: { identity: Identity; children: ComponentChildren }) {
  const profile = useResource(() => getProfile(identity.token, identity.userId), [identity.userId]);
  const [accepted, setAccepted] = useState(false);
  if (profile.status === "loading") return <Skel width="70%" height="18px" />;
  if (profile.status === "error") {
    return (
      <Notice kind="error" title="לא הצלחנו לטעון את הפרופיל" action={<Button small onClick={profile.reload}>ניסיון חוזר</Button>}>
        בדקו את החיבור לאינטרנט ונסו שוב.
      </Notice>
    );
  }
  if (!accepted && profile.data?.termsVersion !== TERMS_VERSION) return <TermsCard identity={identity} onAccepted={() => setAccepted(true)} />;
  return <>{children}</>;
}

export interface Account {
  identity: Identity;
  profile: Profile & { displayName: string };
}

/**
 * Renders `children` only for a signed-in user with a nickname. Otherwise it asks for what is missing.
 * `reason` tells people why sign-in is needed, in one sentence.
 */
export function RequireAccount({ reason, terms = true, children }: { reason: string; /** False for screens that must stay reachable before acceptance, such as export and deletion of one's own data. */ terms?: boolean; children: (account: Account) => ComponentChildren }) {
  const { configured, useSession } = useAuth();
  const session = useSession();
  if (!configured) return <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת.</Notice>;
  if (session.status === "loading") return <Skel width="70%" height="18px" />;
  if (session.status === "out") return <SignInCard reason={reason} />;
  return <WithProfile identity={session.identity} terms={terms}>{children}</WithProfile>;
}

function WithProfile({ identity, terms, children }: { identity: Identity; terms: boolean; children: (account: Account) => ComponentChildren }) {
  const profile = useResource(() => getProfile(identity.token, identity.userId), [identity.userId]);
  const [saved, setSaved] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  if (profile.status === "loading") return <Skel width="70%" height="18px" />;
  if (profile.status === "error") {
    return (
      <Notice kind="error" title="לא הצלחנו לטעון את הפרופיל" action={<Button small onClick={profile.reload}>ניסיון חוזר</Button>}>
        בדקו את החיבור לאינטרנט ונסו שוב.
      </Notice>
    );
  }
  if (terms && !acceptedTerms && profile.data?.termsVersion !== TERMS_VERSION) return <TermsCard identity={identity} onAccepted={() => setAcceptedTerms(true)} />;
  const displayName = saved ?? profile.data?.displayName ?? null;
  if (!displayName || !profile.data) return <NicknameCard identity={identity} onSaved={setSaved} />;
  return <>{children({ identity, profile: { ...profile.data, displayName } })}</>;
}
