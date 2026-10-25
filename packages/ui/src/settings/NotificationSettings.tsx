import { ISRAELI_CITIES } from "@smartbuy/core";
import {
  ApiError,
  createTelegramLink,
  getNotificationSettings,
  toggleChannel,
  updatePref,
  updateProfileSettings,
  type ChannelName,
  type Identity,
  type NotificationKind,
  type NotificationSettings as Settings,
} from "@smartbuy/data";
import { useState } from "preact/hooks";
import { Button, Notice, SelectField, Skel, Switch, TextField } from "../components.tsx";
import { useResource } from "../hooks.ts";

const KINDS: { kind: NotificationKind; label: string }[] = [
  { kind: "price_target", label: "ירידה מתחת למחיר יעד" },
  { kind: "price_drop", label: "ירידה של אחוז שהגדרתי" },
  { kind: "restock", label: "חזרה למלאי במידה ובצבע שלי" },
  { kind: "new_review_on_watch", label: "ביקורת חדשה על מוצר במעקב" },
  { kind: "my_review_activity", label: "סימוני מועיל על הביקורות שלי" },
  { kind: "moderation_decision", label: "החלטה על דיווח או ביקורת שלי" },
  { kind: "pending_review_reminder", label: "תזכורת לכתוב ביקורת על מה שקניתי" },
  { kind: "durability_reminder", label: "תזכורת לעדכן ביקורת אחרי כמה חודשים" },
];

const CHANNEL_LABEL: Record<ChannelName, string> = { extension: "התוסף", telegram: "טלגרם", email: "מייל", webpush: "דפדפן" };
const CAPS = [1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `עד ${n} הודעות ביום` }));
const CITIES = ISRAELI_CITIES.map((c) => ({ value: c.id, label: c.he }));

type Banner = { kind: "success" | "error"; text: string } | null;

/** Every change is saved at once, and the banner says "saved" only after the server confirmed it. */
export function NotificationSettingsPanel({ identity }: { identity: Identity }) {
  const data = useResource(() => getNotificationSettings(identity.token, identity.userId), [identity.userId]);
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);

  if (data.status === "loading") return <Skel width="100%" height="120px" />;
  if (data.status === "error") return <Notice kind="error" title="ההגדרות לא נטענו" action={<Button small onClick={data.reload}>ניסיון חוזר</Button>} />;
  const s: Settings = data.data;

  const apply = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setBanner(null);
    try {
      await action();
      setBanner({ kind: "success", text: "ההגדרה נשמרה." });
      data.reload();
    } catch (e) {
      setBanner({ kind: "error", text: e instanceof ApiError && e.status === 409 ? e.message : "ההגדרה לא נשמרה. נסו שוב." });
    } finally {
      setBusy(false);
    }
  };

  const channel = (name: ChannelName) => s.channels.find((c) => c.channel === name);
  const connected = (name: ChannelName) => {
    const c = channel(name);
    return Boolean(c && c.verified && c.enabled);
  };
  const quiet = s.quietHours ?? { from: "22:00", to: "08:00" };

  const connectTelegram = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const link = await createTelegramLink(identity.token);
      window.open(link.url, "_blank", "noopener");
      setBanner({ kind: "success", text: "נפתח טלגרם. לחצו שם על Start כדי להשלים את החיבור. הקישור תקף 15 דקות." });
    } catch (e) {
      setBanner({ kind: "error", text: e instanceof ApiError && e.status === 503 ? "חיבור טלגרם עוד לא הוגדר בשירות." : "לא הצלחנו ליצור קישור. נסו שוב." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sb-stack sb-gap-4">
      <div role="status" aria-live="polite">{banner && <Notice kind={banner.kind}>{banner.text}</Notice>}</div>

      <section class="sb-stack sb-gap-3" aria-labelledby="ns-quiet">
        <h3 class="sb-t-heading" id="ns-quiet">שקט</h3>
        <Switch checked={s.quietMode} disabled={busy} label="מצב שקט" description="משתיק את כל ההתראות עד שתכבו אותו." onChange={(v) => apply(() => updateProfileSettings(identity.token, identity.userId, { quiet_mode: v }))} />
        <Switch checked={s.quietHours !== null} disabled={busy} label="שעות שקטות" description="ההתראות מחכות לסוף השעות השקטות." onChange={(v) => apply(() => updateProfileSettings(identity.token, identity.userId, { quiet_hours: v ? quiet : null }))} />
        {s.quietHours && (
          <div class="sb-row sb-gap-3 sb-wrap">
            <TextField label="מ-" type="time" value={quiet.from} dir="ltr" disabled={busy} onChange={(e) => apply(() => updateProfileSettings(identity.token, identity.userId, { quiet_hours: { ...quiet, from: (e.currentTarget as HTMLInputElement).value } }))} />
            <TextField label="עד" type="time" value={quiet.to} dir="ltr" disabled={busy} onChange={(e) => apply(() => updateProfileSettings(identity.token, identity.userId, { quiet_hours: { ...quiet, to: (e.currentTarget as HTMLInputElement).value } }))} />
          </div>
        )}
        <Switch checked={s.shabbatMode} disabled={busy || (!s.shabbatMode && s.shabbatCity === null)} label="מצב שבת" description="בלי התראות משקיעה ביום שישי עד צאת השבת, לפי העיר שבחרתם." onChange={(v) => apply(() => updateProfileSettings(identity.token, identity.userId, { shabbat_mode: v }))} />
        <SelectField label="עיר לחישוב זמני שבת" value={s.shabbatCity ?? ""} options={CITIES} placeholder="בחירת עיר" disabled={busy} onChange={(v) => apply(() => updateProfileSettings(identity.token, identity.userId, { shabbat_city: v || null, ...(v === "" ? { shabbat_mode: false } : {}) }))} />
        <SelectField label="תקרה יומית" value={String(s.dailyCap)} options={CAPS} disabled={busy} onChange={(v) => apply(() => updateProfileSettings(identity.token, identity.userId, { daily_notification_cap: Number(v) }))} />
      </section>

      <section class="sb-stack sb-gap-3" aria-labelledby="ns-channels">
        <h3 class="sb-t-heading" id="ns-channels">ערוצים</h3>
        <p class="sb-t-support sb-secondary">התראות בתוסף מגיעות כשהדפדפן פתוח. טלגרם ומייל עובדים בכל מקום.</p>
        <div class="sb-row sb-spread sb-gap-3">
          <span class="sb-t-body">טלגרם {connected("telegram") ? "(מחובר)" : ""}</span>
          <div class="sb-row sb-gap-2">
            <Button small disabled={busy} onClick={connectTelegram}>{channel("telegram") ? "חיבור מחדש" : "חיבור טלגרם"}</Button>
            {channel("telegram") && <Button small variant="quiet" disabled={busy} onClick={() => apply(() => toggleChannel(identity.token, identity.userId, "telegram", !channel("telegram")!.enabled))}>{channel("telegram")!.enabled ? "כיבוי" : "הפעלה"}</Button>}
          </div>
        </div>
        <Switch checked={connected("email")} disabled={busy} label="מייל" description={identity.email ? `נשלח אל ${identity.email}` : "לחשבון אין כתובת מייל."} onChange={(v) => apply(() => toggleChannel(identity.token, identity.userId, "email", v))} />
      </section>

      <section class="sb-stack sb-gap-2" aria-labelledby="ns-kinds">
        <h3 class="sb-t-heading" id="ns-kinds">על מה להתריע</h3>
        <ul class="sb-list">
          {KINDS.map(({ kind, label }) => {
            const pref = s.prefs.find((p) => p.kind === kind);
            if (!pref) return null;
            return (
              <li key={kind} class="sb-stack sb-gap-2" style={{ paddingBlock: "var(--space-3)" }}>
                <Switch checked={pref.enabled} disabled={busy} label={label} onChange={(v) => apply(() => updatePref(identity.token, identity.userId, kind, { enabled: v }))} />
                {pref.enabled && (
                  <fieldset class="sb-row sb-gap-3 sb-wrap" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend class="sb-visually-hidden">ערוצים עבור {label}</legend>
                    {(["extension", "telegram", "email"] as const).map((name) => {
                      const on = pref.channels.includes(name);
                      const usable = name === "extension" || connected(name);
                      return (
                        <label key={name} class="sb-t-support" style={{ display: "inline-flex", gap: "6px", alignItems: "center", opacity: usable ? 1 : 0.55 }}>
                          <input type="checkbox" checked={on} disabled={busy || (!usable && !on)} onChange={(e) => apply(() => updatePref(identity.token, identity.userId, kind, { channels: toggle(pref.channels, name, (e.currentTarget as HTMLInputElement).checked) }))} />
                          {CHANNEL_LABEL[name]}
                        </label>
                      );
                    })}
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function toggle(list: ChannelName[], name: ChannelName, on: boolean): ChannelName[] {
  const set = new Set(list);
  if (on) set.add(name);
  else set.delete(name);
  // A kind with no channel would never reach anyone, so the extension stays as the floor.
  return set.size === 0 ? ["extension"] : [...set];
}
