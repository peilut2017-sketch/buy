import { validateNickname } from "@smartbuy/core";
import { NicknameTakenError, callFunction, getProfile, setNickname, setProfileFlag, type Identity } from "@smartbuy/data";
import { useState } from "preact/hooks";
import { Button, Notice, Skel, Switch, TextField } from "../components.tsx";
import { useAuth } from "../auth/context.tsx";
import { useResource } from "../hooks.ts";

export function AccountPanel({ identity }: { identity: Identity }) {
  const { signOut } = useAuth();
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

export function QuietModeSwitch({ identity }: { identity: Identity }) {
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

export function DataControls({ identity }: { identity: Identity }) {
  const { signOut } = useAuth();
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

