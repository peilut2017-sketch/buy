import { fitMeter, formatDateHe, formatIls, formatRating, countLabel, REVIEWS, VERIFIED_REVIEWS, type ProductSummary } from "@smartbuy/core";
import { Button, FitMeter, IconButton, Root, Skel, Stars } from "@smartbuy/ui";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PanelMode } from "../lib/messages.ts";

export type StripState = { kind: "loading" } | { kind: "ready"; summary: ProductSummary | null } | { kind: "error" };

/** What the strip says about the price. Both parts are optional: nothing is shown that was not measured. */
export interface StripPrice {
  current: number | null;
  lowest: { price: number; since: string } | null;
}

export interface StripProps {
  state: StripState;
  price: StripPrice | null;
  /** "בשבילך: קח L", only for a signed-in person with a size profile and enough comparable reviews. */
  advice: { headline: string; support: string } | null;
  /** The glass frame is made opaque over a dark or busy page. */
  opaque: boolean;
  onOpen: (mode: PanelMode) => void;
  onClose: () => void;
  onRetry: () => void;
}

function Brand() {
  return (
    <span class="strip__brand">
      <span class="strip__mark" aria-hidden="true" />
      SmartBuy
    </span>
  );
}

/** What was measured about the price. When nothing was, there is no row at all. */
function PriceLine({ price }: { price: StripPrice | null }) {
  const lowest = price?.lowest ?? null;
  if (price?.current == null && !lowest) return null;
  return (
    <div class="strip__price">
      {price?.current != null && <span class="strip__amount sb-num">{formatIls(price.current)}</span>}
      {lowest && (
        <span class="sb-t-support sb-secondary">
          הכי נמוך ב-90 יום: <span class="sb-num">{formatIls(lowest.price)}</span>, מ-{formatDateHe(new Date(lowest.since))}
        </span>
      )}
    </div>
  );
}

/** The two things a person can do from the strip, side by side and the same width. */
function Actions({ primary, onOpen }: { primary: { label: string; mode: PanelMode }; onOpen: StripProps["onOpen"] }) {
  return (
    <div class="strip__actions">
      <Button variant="primary" small onClick={() => onOpen(primary.mode)}>{primary.label}</Button>
      <Button small icon="bell" onClick={() => onOpen("tracking")}>מעקב מחיר</Button>
    </div>
  );
}

function Body({ state, price, advice, onOpen, onRetry }: Pick<StripProps, "state" | "price" | "advice" | "onOpen" | "onRetry">) {
  if (state.kind === "loading") {
    return (
      <div class="sb-stack sb-gap-2" role="status" aria-label="טוענים ביקורות">
        <Skel width="60%" variant="title" />
        <Skel width="85%" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div class="sb-stack sb-gap-2" role="alert">
        <span class="sb-t-heading">הביקורות לא נטענו</span>
        <span class="sb-t-support sb-secondary">בדקו את החיבור לאינטרנט ונסו שוב.</span>
        <div>
          <Button small icon="refresh" onClick={onRetry}>ניסיון חוזר</Button>
        </div>
      </div>
    );
  }

  const summary = state.summary;
  if (!summary || summary.reviewsCount === 0) {
    return (
      <div class="sb-stack sb-gap-2">
        <span class="sb-t-heading">עוד אין ביקורות על המוצר הזה</span>
        <span class="sb-t-support sb-secondary">קנית אותו? הביקורת שלך תעזור לבאים אחריך.</span>
        <PriceLine price={price} />
        <Actions primary={{ label: "כתיבת ביקורת", mode: "write" }} onOpen={onOpen} />
      </div>
    );
  }

  const meter = fitMeter({ small: summary.fitSmall, exact: summary.fitExact, large: summary.fitLarge });
  return (
    <div class="sb-stack sb-gap-2">
      <div class="strip__score">
        <span class="strip__rating">{formatRating(summary.ratingAvg)}</span>
        {summary.ratingAvg !== null && <Stars value={summary.ratingAvg} size={16} />}
        <span class="sb-t-support sb-secondary">
          {countLabel(summary.reviewsCount, REVIEWS)}
          {summary.verifiedCount > 0 && ` · ${countLabel(summary.verifiedCount, VERIFIED_REVIEWS)}`}
        </span>
      </div>
      {meter.enough && <FitMeter meter={meter} compact />}
      {advice && (
        <p class="strip__advice">
          <span class="sb-t-heading">{advice.headline}</span>
          <span class="sb-t-support sb-secondary">{advice.support}</span>
        </p>
      )}
      <PriceLine price={price} />
      <Actions primary={{ label: "ביקורות", mode: "reviews" }} onOpen={onOpen} />
    </div>
  );
}

/** How long the exit may take before the strip is removed anyway (the transition end event is the normal trigger). */
const EXIT_FALLBACK_MS = 400;

export function Strip({ state, price, advice, opaque, onOpen, onClose, onRetry }: StripProps) {
  // It comes in from its corner and leaves by the same path (spatial consistency). Entering starts one frame after the first paint.
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const motion = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(id);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };
    motion.current?.addEventListener("transitionend", (e) => { if (e.target === motion.current && e.propertyName === "opacity") finish(); });
    timer.current = setTimeout(finish, EXIT_FALLBACK_MS);
  };

  return (
    <Root class="strip">
      <div ref={motion} class={shown && !leaving ? "strip__motion is-in" : "strip__motion"}>
        <section class={opaque ? "sb-shell sb-shell--opaque" : "sb-shell"} aria-label="SmartBuy: ביקורות על המוצר">
          <div class="sb-region strip__inner">
            <div class="strip__top">
              <Brand />
              <span class="sb-grow" />
              <IconButton icon="close" label="סגירת הפס" onClick={close} />
            </div>
            <Body state={state} price={price} advice={advice} onOpen={onOpen} onRetry={onRetry} />
          </div>
        </section>
      </div>
    </Root>
  );
}
