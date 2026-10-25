import { formatDateHe, formatIls, historyState, lowestInWindow, validateTargetPrice } from "@smartbuy/core";
import { ApiError, NetworkError, TargetTooHighError, deleteWatch, getTracking, saveWatch, type Identity, type ReviewTarget, type TrackingData, type Watch } from "@smartbuy/data";
import { useMemo, useState } from "preact/hooks";
import { Button, FieldError, Notice, SelectField, Skel, Switch, TextField } from "../components.tsx";
import { useResource } from "../hooks.ts";
import { PriceChart } from "./PriceChart.tsx";

export interface TrackingViewProps {
  target: ReviewTarget;
  identity: Identity | null;
  getIdentity: () => Promise<Identity | null>;
  onNeedSignIn: (reason: string) => void;
  /** Bumps when something outside changed, so the data reloads. */
  version?: number;
}

const DROPS = [5, 10, 15, 20, 30].map((n) => ({ value: String(n), label: `${n}%` }));

type Phase = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

function describeWatch(w: Watch): string {
  const parts: string[] = [];
  if (w.targetPrice !== null) parts.push(`מחיר יעד ${formatIls(w.targetPrice)}`);
  if (w.dropPercent !== null) parts.push(`ירידה של ${w.dropPercent}% ומעלה`);
  if (w.notifyRestock) parts.push("חזרה למלאי");
  return parts.join(" · ");
}

export function TrackingView({ target, identity, getIdentity, onNeedSignIn, version = 0 }: TrackingViewProps) {
  const data = useResource<TrackingData>(
    () => getTracking({ siteId: target.siteId, parentSku: target.parentSku, sku: target.sku, token: identity?.token ?? null, userId: identity?.userId ?? null }),
    [target.siteId, target.parentSku, target.sku, identity?.userId ?? "", version],
  );
  const now = useMemo(() => new Date(), [data.status]);
  const [editing, setEditing] = useState(false);
  const [targetText, setTargetText] = useState("");
  const [drop, setDrop] = useState("");
  const [restock, setRestock] = useState(false);
  const [errors, setErrors] = useState<{ target?: string; form?: string }>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [override, setOverride] = useState<{ watch: Watch | null } | null>(null);

  if (data.status === "loading") return <div class="sb-stack sb-gap-3" role="status" aria-label="טוענים נתוני מחיר"><Skel width="40%" variant="title" /><Skel width="100%" height="120px" /></div>;
  if (data.status === "error") {
    return (
      <Notice kind="error" title="נתוני המחיר לא נטענו" action={<Button small icon="refresh" onClick={data.reload}>ניסיון חוזר</Button>}>
        {data.error instanceof NetworkError ? "בדקו את החיבור לאינטרנט ונסו שוב." : "אירעה שגיאה בטעינה. נסו שוב בעוד רגע."}
      </Notice>
    );
  }

  const tracking = data.data;
  const watch = override ? override.watch : tracking.watch;
  const history = historyState(tracking.points, now);
  const lastPrice = [...tracking.points].reverse().find((p) => p.price !== null)?.price ?? null;
  const currentPrice = target.price?.price ?? lastPrice;
  const low = lowestInWindow(tracking.points, now);
  const showForm = editing || (!watch && true);

  const beginEdit = () => {
    setTargetText(watch?.targetPrice != null ? String(watch.targetPrice) : "");
    setDrop(watch?.dropPercent != null ? String(watch.dropPercent) : "");
    setRestock(watch?.notifyRestock ?? false);
    setErrors({});
    setPhase({ kind: "idle" });
    setEditing(true);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const next: typeof errors = {};
    let targetValue: number | null = null;
    if (targetText.trim() !== "") {
      const checked = validateTargetPrice(targetText, currentPrice);
      if (checked.ok) targetValue = checked.value;
      else next.target = checked.error;
    }
    if (!next.target && targetValue === null && drop === "" && !restock) next.form = "בחרו מחיר יעד, אחוז ירידה או הודעת מלאי.";
    setErrors(next);
    if (next.target || next.form) return;
    if (tracking.productId === null) return setErrors({ form: "עוד אין נתוני מחיר למוצר הזה, ולכן אי אפשר להגדיר מעקב. נסו שוב אחרי שהמוצר יצפה בעמוד שלו." });

    const id = identity ?? (await getIdentity());
    if (!id) return onNeedSignIn("כדי להגדיר מעקב צריך להתחבר.");
    setPhase({ kind: "saving" });
    try {
      const saved = await saveWatch(
        id.token,
        id.userId,
        { productId: tracking.productId, variantId: tracking.variantId, targetPrice: targetValue, dropPercent: drop === "" ? null : Number(drop), notifyRestock: restock, restockValues: Object.keys(target.variantValues).length > 0 ? target.variantValues : null },
        watch?.id ?? null,
      );
      setOverride({ watch: saved });
      setEditing(false);
      setPhase({ kind: "saved" });
    } catch (err) {
      if (err instanceof TargetTooHighError) {
        setErrors({ target: `מחיר היעד צריך להיות נמוך מהמחיר הנוכחי${currentPrice !== null ? ` (${formatIls(currentPrice)})` : ""}.` });
        setPhase({ kind: "idle" });
      } else {
        setPhase({ kind: "failed", message: err instanceof NetworkError ? "אין חיבור לשרת. המעקב לא נשמר. בדקו את החיבור ונסו שוב." : err instanceof ApiError && err.status === 409 ? "כבר יש מעקב על המוצר הזה. טענו מחדש ונסו שוב." : "המעקב לא נשמר. נסו שוב." });
      }
    }
  };

  const stop = async () => {
    if (!watch || !window.confirm("להפסיק את המעקב?")) return;
    const id = identity ?? (await getIdentity());
    if (!id) return onNeedSignIn("כדי לנהל מעקבים צריך להתחבר.");
    try {
      await deleteWatch(id.token, watch.id);
      setOverride({ watch: null });
      setPhase({ kind: "idle" });
      setEditing(false);
    } catch {
      setPhase({ kind: "failed", message: "המעקב לא הופסק. נסו שוב." });
    }
  };

  return (
    <div class="sb-stack sb-gap-4">
      <section class="sb-stack sb-gap-2" aria-label="היסטוריית מחיר">
        {currentPrice !== null && <p class="sb-t-price">{formatIls(currentPrice)}</p>}
        {low && history.kind !== "none" && <p class="sb-t-support sb-secondary">הכי נמוך ב-90 יום: <span class="sb-num">{formatIls(low.price)}</span>, מ-{formatDateHe(low.since)}</p>}
        {history.kind === "none" && <Notice kind="empty" title="עוד אין נתוני מחיר">נתחיל לעקוב אחרי המחיר ברגע שהמוצר ייצפה בעמוד שלו.</Notice>}
        {history.kind === "sparse" && <p class="sb-t-support sb-secondary">{history.message}</p>}
        {history.kind !== "none" && <PriceChart points={tracking.points} target={watch?.targetPrice ?? null} now={now} />}
        {watch?.targetPrice != null && history.kind !== "none" && <p class="sb-t-support sb-secondary">הקו המקווקו הוא מחיר היעד.</p>}
      </section>

      <section class="sb-stack sb-gap-3" aria-labelledby="track-h">
        <h2 class="sb-t-heading" id="track-h">מעקב</h2>
        {phase.kind === "saved" && <Notice kind="success" title="המעקב נשמר">נשלח התראה בערוצים שהגדרתם. אפשר לשנות אותם בהגדרות.</Notice>}
        {watch && !editing && (
          <div class="sb-stack sb-gap-2">
            <p class="sb-t-body">עוקבים: {describeWatch(watch)}</p>
            <div class="sb-row sb-gap-2"><Button small icon="edit" onClick={beginEdit}>עריכה</Button><Button small variant="danger" icon="trash" onClick={stop}>הפסקת מעקב</Button></div>
          </div>
        )}
        {showForm && (
          <form class="form" onSubmit={submit} noValidate>
            <TextField label="מחיר יעד (₪)" hint={currentPrice !== null ? `חייב להיות נמוך מ-${formatIls(currentPrice)}` : undefined} value={targetText} onInput={(e) => setTargetText((e.currentTarget as HTMLInputElement).value)} inputMode="decimal" dir="ltr" class="ltr-input" error={errors.target} disabled={phase.kind === "saving"} />
            <SelectField label="או ירידה של לפחות" value={drop} onChange={setDrop} options={DROPS} placeholder="ללא" disabled={phase.kind === "saving"} />
            <Switch checked={restock} onChange={setRestock} label="הודעה כשהמוצר חוזר למלאי" description={Object.keys(target.variantValues).length > 0 ? `במידה ובצבע שבחרתם: ${Object.values(target.variantValues).join(", ")}` : undefined} disabled={phase.kind === "saving"} />
            {errors.form && <FieldError>{errors.form}</FieldError>}
            {phase.kind === "failed" && <FieldError>{phase.message}</FieldError>}
            <div class="sb-row sb-gap-2">
              <Button type="submit" variant="primary" disabled={phase.kind === "saving"}>{phase.kind === "saving" ? "שומרים…" : "שמירת מעקב"}</Button>
              {editing && <Button onClick={() => setEditing(false)} disabled={phase.kind === "saving"}>ביטול</Button>}
            </div>
          </form>
        )}
        {phase.kind === "failed" && !showForm && <FieldError>{phase.message}</FieldError>}
      </section>
    </div>
  );
}
