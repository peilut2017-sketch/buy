import { fitMeter, formatDateHe, formatIls, formatRating, countLabel, REVIEWS, VERIFIED_REVIEWS, type ProductSummary } from "@smartbuy/core";
import { Button, FitMeter, IconButton, Root, Skel, Stars } from "@smartbuy/ui";
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

function PriceLine({ price, onOpen }: { price: StripPrice | null; onOpen: StripProps["onOpen"] }) {
  const lowest = price?.lowest ?? null;
  return (
    <div class="strip__price">
      {price?.current != null && <span class="strip__amount sb-num">{formatIls(price.current)}</span>}
      {lowest && (
        <span class="sb-t-support sb-secondary">
          הכי נמוך ב-90 יום: <span class="sb-num">{formatIls(lowest.price)}</span>, מ-{formatDateHe(new Date(lowest.since))}
        </span>
      )}
      <Button small icon="bell" onClick={() => onOpen("tracking")}>מעקב מחיר</Button>
    </div>
  );
}

function Body({ state, price, onOpen, onRetry }: Pick<StripProps, "state" | "price" | "onOpen" | "onRetry">) {
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
        <div>
          <Button variant="primary" small onClick={() => onOpen("write")}>כתיבת ביקורת</Button>
        </div>
        <PriceLine price={price} onOpen={onOpen} />
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
      <div>
        <Button variant="primary" small onClick={() => onOpen("reviews")}>ביקורות</Button>
      </div>
      <PriceLine price={price} onOpen={onOpen} />
    </div>
  );
}

export function Strip({ state, price, opaque, onOpen, onClose, onRetry }: StripProps) {
  return (
    <Root class="strip">
      <section class={opaque ? "sb-shell sb-shell--opaque" : "sb-shell"} aria-label="SmartBuy: ביקורות על המוצר">
        <div class="sb-region strip__inner">
          <div class="strip__top">
            <Brand />
            <span class="sb-grow" />
            <IconButton icon="close" label="סגירת הפס" onClick={onClose} />
          </div>
          <Body state={state} price={price} onOpen={onOpen} onRetry={onRetry} />
        </div>
      </section>
    </Root>
  );
}
