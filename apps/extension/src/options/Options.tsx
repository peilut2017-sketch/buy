import { validateNickname } from "@smartbuy/core";
import { Button, Notice, Root, Skel, Switch, TextField } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { signOut, useSession, type Identity } from "../lib/auth.ts";
import { getProfile, NicknameTakenError, setNickname, setProfileFlag } from "../lib/data.ts";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { useResource } from "../lib/hooks.ts";
import { callFunction } from "../lib/rest.ts";
import { SignInCard } from "../panel/AuthGate.tsx";
import { StoreList } from "./StoreList.tsx";

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="sb-stack sb-gap-3" style={{ paddingBlock: "var(--space-5)", borderBlockStart: "1px solid var(--sb-divider)" }}>
      <h2 class="sb-t-heading">{title}</h2>
      {children}
    </section>
  );
}

function Account({ identity }: { identity: Identity }) {
  const profile = useResource(() => getProfile(identity.token, identity.userId), [identity.userId]);
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (profile.status === "loading") return <Skel width="60%" height="36px" />;
  if (profile.status === "error") return <Notice kind="error" title="לא הצלחנו לטעון את החשבון" action={<Button small onClick={profile.reload}>ניסיון חוזר</Button>} />;
  const current = name ?? profile.data?.displayName ?? "";

  const save = async (e: Event) => {
    e.preventDefault();
    const checked = validateNickname(current);
    if (!checked.ok) return setMessage({ kind: "error", text: checked.errors.displayName ?? "הכינוי לא תקין." });
    setBusy(true);
    setMessage(null);
    try {
      const saved = await setNickname(identity.token, identity.userId, checked.value);
      setName(saved);
      setMessage({ kind: "success", text: "הכינוי נשמר." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof NicknameTakenError ? "הכינוי הזה תפוס. בחרו כינוי אחר." : "הכינוי לא נשמר. נסו שוב." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sb-stack sb-gap-3">
      <p class="sb-t-support sb-secondary">מחוברים כ-<bdi dir="ltr">{identity.email ?? "משתמש"}</bdi></p>
      <form class="sb-stack sb-gap-3" onSubmit={save}>
        <TextField label="כינוי" hint="מוצג ליד הביקורות שלכם." value={current} maxLength={30} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        <div class="sb-row sb-gap-2">
          <Button type="submit" variant="primary" disabled={busy}>שמירת כינוי</Button>
          <Button onClick={() => void signOut()}>התנתקות</Button>
        </div>
      </form>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
    </div>
  );
}

function QuietMode({ identity }: { identity: Identity }) {
  const profile = useResource(() => getProfile(identity.token, identity.userId), [identity.userId]);
  const [override, setOverride] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const value = override ?? profile.data?.quietMode ?? false;
  return (
    <div class="sb-stack sb-gap-2">
      <Switch
        checked={value}
        disabled={profile.status !== "ready"}
        label="מצב שקט"
        description="משתיק את כל ההתראות עד שתכבו אותו."
        onChange={async (next) => {
          setError(false);
          try {
            await setProfileFlag(identity.token, identity.userId, { quiet_mode: next });
            setOverride(next);
          } catch {
            setError(true);
          }
        }}
      />
      {error && <Notice kind="error">ההגדרה לא נשמרה. נסו שוב.</Notice>}
    </div>
  );
}

function DataControls({ identity }: { identity: Identity }) {
  const [state, setState] = useState<"idle" | "working" | "exported" | "failed" | "deleted">("idle");

  const exportData = async () => {
    setState("working");
    try {
      const data = await callFunction<unknown>("export-my-data", {}, identity.token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "smartbuy-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
      setState("exported");
    } catch {
      setState("failed");
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm("למחוק את החשבון וכל המידע שלו? זה כולל את הביקורות שכתבתם, ואי אפשר לשחזר.")) return;
    setState("working");
    try {
      await callFunction("delete-my-account", { confirm: true }, identity.token);
      await signOut();
      setState("deleted");
    } catch {
      setState("failed");
    }
  };

  return (
    <div class="sb-stack sb-gap-3">
      <p class="sb-t-support sb-secondary">אפשר להוריד את כל המידע שנשמר עליכם, או למחוק אותו. מחיקת החשבון מוחקת גם את הביקורות שכתבתם.</p>
      <div class="sb-row sb-gap-2 sb-wrap">
        <Button disabled={state === "working"} onClick={exportData}>ייצוא המידע שלי</Button>
        <Button variant="danger" disabled={state === "working"} onClick={deleteAccount}>מחיקת החשבון</Button>
      </div>
      {state === "exported" && <Notice kind="success">הקובץ ירד למחשב.</Notice>}
      {state === "deleted" && <Notice kind="success">החשבון נמחק.</Notice>}
      {state === "failed" && <Notice kind="error">הפעולה לא הושלמה. נסו שוב.</Notice>}
    </div>
  );
}

export function Options() {
  const session = useSession();
  return (
    <Root class="options">
      <main style={{ maxInlineSize: "560px", marginInline: "auto", padding: "var(--space-6) var(--space-4)" }}>
        <h1 class="sb-t-name" style={{ marginBlockEnd: "var(--space-4)" }}>הגדרות SmartBuy</h1>

        <Section title="חנויות">
          <p class="sb-t-support sb-secondary">התוסף פועל רק בחנויות שהפעלתם, ורק בעמודי מוצר. הוא לא שומר היסטוריית גלישה.</p>
          <StoreList />
        </Section>

        {BACKEND_CONFIGURED && (
          <Section title="חשבון">
            {session.status === "loading" && <Skel width="60%" height="36px" />}
            {session.status === "out" && <SignInCard reason="החשבון מאפשר לכתוב ביקורות, לסמן ביקורות כמועילות ולדווח." />}
            {session.status === "in" && <Account identity={session.identity} />}
          </Section>
        )}

        {session.status === "in" && (
          <>
            <Section title="התראות"><QuietMode identity={session.identity} /></Section>
            <Section title="הפרטיות שלכם"><DataControls identity={session.identity} /></Section>
          </>
        )}

        <Section title="איך זה עובד">
          <p class="sb-t-body">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות. סדר הביקורות ותוכנן לא מושפעים מהכנסה או מפרסום. ביקורת מאומתת מסומנת ככזו רק כשהרכישה אומתה.</p>
        </Section>
      </main>
    </Root>
  );
}
