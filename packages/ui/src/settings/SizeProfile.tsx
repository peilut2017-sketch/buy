import { ApiError, NetworkError, deleteSize, getSizeProfile, saveSize, type Identity, type SizeEntry, type SizeKind } from "@smartbuy/data";
import { useState } from "preact/hooks";
import { Button, Notice, SelectField, Skel, TextField } from "../components.tsx";
import { useResource } from "../hooks.ts";

const KIND_LABEL: Record<SizeKind, string> = { apparel: "בגדים", footwear: "נעליים" };
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as SizeKind[]).map((value) => ({ value, label: KIND_LABEL[value] }));

type Banner = { kind: "success" | "error"; text: string } | null;

/** The usual size per kind of item, optionally per brand. It tunes "בשבילך: קח L" and is never shown to anyone else. */
export function SizeProfilePanel({ identity }: { identity: Identity }) {
  const data = useResource(() => getSizeProfile(identity.token, identity.userId), [identity.userId]);
  const [kind, setKind] = useState<SizeKind>("apparel");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);

  if (data.status === "loading") return <Skel width="100%" height="64px" />;
  if (data.status === "error") return <Notice kind="error" title="פרופיל המידות לא נטען" action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;

  const failure = (e: unknown) => (e instanceof NetworkError ? "אין חיבור לשרת. השינוי לא נשמר." : e instanceof ApiError ? "השינוי לא נשמר. נסו שוב." : "השינוי לא נשמר. נסו שוב.");

  const add = async (e: Event) => {
    e.preventDefault();
    const clean = size.trim();
    if (clean === "") return setError("הזינו מידה, למשל M או 42.");
    if (Array.from(clean).length > 20) return setError("המידה ארוכה מדי.");
    setError(null);
    setBusy(true);
    setBanner(null);
    try {
      await saveSize(identity.token, identity.userId, { kind, brand: brand.trim(), size: clean });
      setSize("");
      setBrand("");
      setBanner({ kind: "success", text: "המידה נשמרה." });
      data.reload();
    } catch (err) {
      setBanner({ kind: "error", text: failure(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: SizeEntry) => {
    setBusy(true);
    setBanner(null);
    try {
      await deleteSize(identity.token, identity.userId, entry.kind, entry.brand);
      data.reload();
    } catch (err) {
      setBanner({ kind: "error", text: failure(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sb-stack sb-gap-3">
      <p class="sb-t-support sb-secondary">עם המידה הרגילה שלכם נוכל להציג "בשבילך: קח L", לפי קונים שהמידה הרגילה שלהם כמו שלכם. ההמלצה מופיעה רק כשיש מספיק ביקורות.</p>
      <div role="status" aria-live="polite">{banner && <Notice kind={banner.kind}>{banner.text}</Notice>}</div>
      {data.data.length > 0 && (
        <ul class="sb-list" aria-label="המידות שלי">
          {data.data.map((entry) => (
            <li key={`${entry.kind}:${entry.brand}`} class="sb-row sb-spread sb-gap-2" style={{ paddingBlock: "var(--space-2)" }}>
              <span class="sb-t-body">{KIND_LABEL[entry.kind]}{entry.brand ? `, ${entry.brand}` : ""}: <bdi dir="ltr">{entry.size}</bdi></span>
              <Button variant="quiet" small disabled={busy} onClick={() => remove(entry)}>הסרה</Button>
            </li>
          ))}
        </ul>
      )}
      <form class="form" onSubmit={add} noValidate>
        <SelectField label="סוג פריט" value={kind} onChange={(v) => setKind(v as SizeKind)} options={KIND_OPTIONS} disabled={busy} />
        <TextField label="מותג (לא חובה)" hint="בלי מותג, המידה חלה על כל המותגים." value={brand} maxLength={40} onInput={(e) => setBrand((e.currentTarget as HTMLInputElement).value)} disabled={busy} />
        <TextField label="המידה הרגילה" value={size} maxLength={20} placeholder="למשל M או 42" dir="ltr" class="ltr-input" onInput={(e) => setSize((e.currentTarget as HTMLInputElement).value)} error={error ?? undefined} disabled={busy} />
        <div><Button type="submit" variant="primary" disabled={busy}>שמירת מידה</Button></div>
      </form>
    </div>
  );
}
