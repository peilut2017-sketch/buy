import {
  NO_FILTERS,
  REVIEWS,
  SORT_LABEL,
  VERIFIED_REVIEWS,
  activeFilterCount,
  countLabel,
  filterReviews,
  fitMeter,
  formatRating,
  sortReviews,
  type ReviewFilters,
  type ReviewView,
  type SortMode,
} from "@smartbuy/core";
import { Button, CompactSelect, FitMeter, Notice, Skel, Stars } from "@smartbuy/ui";
import { useMemo, useState } from "preact/hooks";
import { currentIdentity } from "../lib/auth.ts";
import { deleteReview, getReviews, getSummary, setHelpful, type ReviewsResult } from "../lib/data.ts";
import { useResource } from "../lib/hooks.ts";
import { NetworkError } from "../lib/rest.ts";
import { ReviewItem } from "./ReviewItem.tsx";
import type { ProductRef } from "./ProductHeader.tsx";
import type { Identity } from "../lib/auth.ts";

export interface ReviewsTabProps {
  product: ProductRef;
  identity: Identity | null;
  /** Bumps when something changed elsewhere (a review was saved) and the list must reload. */
  version: number;
  onWrite: () => void;
  onNeedSignIn: (reason: string) => void;
  onReport: (review: ReviewView) => void;
  onAppeal: (review: ReviewView) => void;
}

interface Loaded {
  productId: number | null;
  summary: Awaited<ReturnType<typeof getSummary>>;
  result: ReviewsResult;
}

async function load(product: ProductRef, identity: Identity | null): Promise<Loaded> {
  const token = identity?.token ?? null;
  const summary = await getSummary(product.siteId, product.parentSku, token);
  if (!summary) return { productId: null, summary: null, result: { reviews: [], mine: null } };
  const result = await getReviews(summary.productId, token, identity?.userId ?? null);
  return { productId: summary.productId, summary, result };
}

function ListSkeleton() {
  return (
    <div class="sb-stack sb-gap-4" role="status" aria-label="טוענים ביקורות">
      {[0, 1, 2].map((i) => (
        <div key={i} class="sb-stack sb-gap-2">
          <Skel width="40%" variant="title" />
          <Skel width="95%" />
          <Skel width="80%" />
        </div>
      ))}
    </div>
  );
}

const RATING_OPTIONS = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: n === 1 ? "כוכב אחד" : `${n} כוכבים` }));
const FIT_OPTIONS = [
  { value: "small", label: "קטן" },
  { value: "exact", label: "מדויק" },
  { value: "large", label: "גדול" },
];

export function ReviewsTab({ product, identity, version, onWrite, onNeedSignIn, onReport, onAppeal }: ReviewsTabProps) {
  const data = useResource(() => load(product, identity), [product.siteId, product.parentSku, identity?.userId ?? "", version]);
  const [filters, setFilters] = useState<ReviewFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortMode>("relevance");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [local, setLocal] = useState<{ version: number; patches: Map<number, Partial<ReviewView>>; removed: Set<number> }>({ version, patches: new Map(), removed: new Set() });
  const now = useMemo(() => new Date(), [data.status]);

  // Changes confirmed by the server are layered over the loaded list until the next reload.
  const layer = local.version === version ? local : { version, patches: new Map<number, Partial<ReviewView>>(), removed: new Set<number>() };

  if (data.status === "loading") return <ListSkeleton />;
  if (data.status === "error") {
    return (
      <Notice
        kind="error"
        title="הביקורות לא נטענו"
        action={<Button small icon="refresh" onClick={data.reload}>ניסיון חוזר</Button>}
      >
        {data.error instanceof NetworkError ? "בדקו את החיבור לאינטרנט ונסו שוב." : "אירעה שגיאה בטעינה. נסו שוב בעוד רגע."}
      </Notice>
    );
  }

  const { summary, result } = data.data;
  const all = result.reviews.filter((r) => !layer.removed.has(r.id)).map((r) => ({ ...r, ...layer.patches.get(r.id) }));
  const shown = sortReviews(filterReviews(all, filters), sort);
  const filterCount = activeFilterCount(filters);
  const meter = summary ? fitMeter({ small: summary.fitSmall, exact: summary.fitExact, large: summary.fitLarge }) : null;
  const patch = (id: number, change: Partial<ReviewView>) =>
    setLocal({ version, patches: new Map(layer.patches).set(id, { ...layer.patches.get(id), ...change }), removed: layer.removed });

  const guarded = async (review: ReviewView, action: (id: Identity) => Promise<void>, failure: string) => {
    const id = identity ?? (await currentIdentity());
    if (!id) return onNeedSignIn("כדי לסמן ביקורת כמועילה או לפעול עליה צריך להתחבר.");
    setBusyId(review.id);
    setActionError(null);
    try {
      await action(id);
    } catch {
      setActionError(failure);
    } finally {
      setBusyId(null);
    }
  };

  const onHelpful = (review: ReviewView) =>
    guarded(
      review,
      async (id) => {
        const next = !review.votedHelpful;
        await setHelpful(id.token, id.userId, review.id, next);
        patch(review.id, { votedHelpful: next, helpfulCount: Math.max(0, review.helpfulCount + (next ? 1 : -1)) });
      },
      "הסימון לא נשמר. נסו שוב.",
    );

  const onDelete = (review: ReviewView) => {
    if (!window.confirm("למחוק את הביקורת? אי אפשר לשחזר אותה.")) return;
    void guarded(
      review,
      async (id) => {
        await deleteReview(id.token, review.id);
        setLocal({ version, patches: layer.patches, removed: new Set(layer.removed).add(review.id) });
      },
      "הביקורת לא נמחקה. נסו שוב.",
    );
  };

  const writeLabel = result.mine?.body ? "עריכת הביקורת שלי" : "כתיבת ביקורת";

  return (
    <div class="sb-stack sb-gap-4">
      {summary && summary.reviewsCount > 0 && summary.ratingAvg !== null ? (
        <section class="sb-stack sb-gap-3" aria-label="סיכום ביקורות">
          <div class="summary">
            <span class="summary__score" aria-hidden="true">{formatRating(summary.ratingAvg)}</span>
            <div class="sb-stack" style={{ gap: "2px" }}>
              <Stars value={summary.ratingAvg} size={18} />
              <span class="sb-t-support sb-secondary">
                {countLabel(summary.reviewsCount, REVIEWS)}
                {summary.verifiedCount > 0 && ` · ${countLabel(summary.verifiedCount, VERIFIED_REVIEWS)}`}
              </span>
            </div>
          </div>
          {meter && <FitMeter meter={meter} />}
        </section>
      ) : null}

      {all.length > 0 && (
        <section class="filters" aria-label="סינון ומיון">
          <CompactSelect label="סינון לפי דירוג" value={filters.rating === null ? "" : String(filters.rating)} onChange={(v) => setFilters({ ...filters, rating: v ? Number(v) : null })} options={RATING_OPTIONS} placeholder="כל הדירוגים" />
          <CompactSelect label="סינון לפי התאמת מידה" value={filters.fit ?? ""} onChange={(v) => setFilters({ ...filters, fit: (v || null) as ReviewFilters["fit"] })} options={FIT_OPTIONS} placeholder="כל ההתאמות" />
          <CompactSelect label="מיון" value={sort} onChange={(v) => setSort(v as SortMode)} options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))} />
          <button type="button" class="toggle-chip" aria-pressed={filters.verifiedOnly} onClick={() => setFilters({ ...filters, verifiedOnly: !filters.verifiedOnly })}>רק מאומתות</button>
          <button type="button" class="toggle-chip" aria-pressed={filters.longTermOnly} onClick={() => setFilters({ ...filters, longTermOnly: !filters.longTermOnly })}>שימוש ממושך</button>
          {filterCount > 0 && <Button variant="quiet" small onClick={() => setFilters(NO_FILTERS)}>ניקוי סינון ({filterCount})</Button>}
        </section>
      )}

      {actionError && <Notice kind="error">{actionError}</Notice>}
      <div class="sr-live" role="status" aria-live="polite">{filterCount > 0 ? `${countLabel(shown.length, REVIEWS)} אחרי סינון` : ""}</div>

      {all.length === 0 ? (
        <Notice kind="empty" title="עוד אין ביקורות על המוצר הזה">
          קנית אותו? הביקורת שלך תעזור לבאים אחריך.
        </Notice>
      ) : shown.length === 0 ? (
        <Notice kind="empty" title="אין ביקורות שמתאימות לסינון" action={<Button small onClick={() => setFilters(NO_FILTERS)}>ניקוי סינון</Button>} />
      ) : (
        <div class="sb-list" role="list" aria-label="ביקורות">
          {shown.map((review) => (
            <div role="listitem" key={review.id}>
              <ReviewItem
                review={review}
                now={now}
                busy={busyId === review.id}
                onHelpful={onHelpful}
                onReport={(r) => (identity ? onReport(r) : onNeedSignIn("כדי לדווח על ביקורת צריך להתחבר."))}
                onEdit={() => onWrite()}
                onDelete={onDelete}
                onAppeal={onAppeal}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <Button variant="primary" block onClick={onWrite}>{writeLabel}</Button>
      </div>
    </div>
  );
}
