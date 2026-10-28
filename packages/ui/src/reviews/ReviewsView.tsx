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
  reviewColors,
  sizeAdvice,
  sortReviews,
  type ReviewFilters,
  type ReviewView,
  type SortMode,
} from "@smartbuy/core";
import { NetworkError, deleteReview, getReviews, getSizeProfile, getSummary, pickUsualSize, setHelpful, type Identity, type ReviewTarget, type ReviewsResult } from "@smartbuy/data";
import { useMemo, useState } from "preact/hooks";
import { Button, CompactSelect, FitMeter, Notice, Skel, Stars } from "../components.tsx";
import { Icon } from "../icons.tsx";
import { useResource } from "../hooks.ts";
import { ReviewItem } from "./ReviewItem.tsx";

export interface ReviewsViewProps {
  target: ReviewTarget;
  identity: Identity | null;
  /** Looks the user up again at the moment of an action, in case they signed in after the screen loaded. */
  getIdentity: () => Promise<Identity | null>;
  /** Bumps when something changed elsewhere (a review was saved) and the list must reload. */
  version: number;
  onWrite: () => void;
  onNeedSignIn: (reason: string) => void;
  onReport: (review: ReviewView) => void;
  onAppeal: (review: ReviewView) => void;
  onUpdate: (review: ReviewView) => void;
}

interface Loaded {
  productId: number | null;
  summary: Awaited<ReturnType<typeof getSummary>>;
  result: ReviewsResult;
  /** The signed-in person's usual size for this kind of product, when they set one and the store has a size group. */
  usualSize: string | null;
}

async function load(target: ReviewTarget, identity: Identity | null): Promise<Loaded> {
  const token = identity?.token ?? null;
  const summary = await getSummary(target.siteId, target.parentSku, token);
  if (!summary) return { productId: null, summary: null, result: { reviews: [], mine: null }, usualSize: null };
  const [result, usualSize] = await Promise.all([
    getReviews(summary.productId, token, identity?.userId ?? null),
    // Advice is a bonus: if the profile cannot be read the reviews still load.
    identity && target.sizeGroup ? getSizeProfile(identity.token, identity.userId).then((p) => pickUsualSize(p, target.productType, target.brand), () => null) : Promise.resolve(null),
  ]);
  return { productId: summary.productId, summary, result, usualSize };
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

export function ReviewsView({ target, identity, getIdentity, version, onWrite, onNeedSignIn, onReport, onAppeal, onUpdate }: ReviewsViewProps) {
  const data = useResource(() => load(target, identity), [target.siteId, target.parentSku, identity?.userId ?? "", version]);
  const [filters, setFilters] = useState<ReviewFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortMode>("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const { summary, result, usualSize } = data.data;
  const advice = usualSize ? sizeAdvice(result.reviews, usualSize, target.sizeGroup) : null;
  const all = result.reviews.filter((r) => !layer.removed.has(r.id)).map((r) => ({ ...r, ...layer.patches.get(r.id) }));
  const shown = sortReviews(filterReviews(all, filters, target.colorGroup), sort);
  const filterCount = activeFilterCount(filters);
  const colors = reviewColors(all, target.colorGroup);
  const pageColor = target.colorGroup ? target.variantValues[target.colorGroup] ?? null : null;
  const pageColorKnown = pageColor !== null && colors.some((c) => c.color.toLowerCase() === pageColor.toLowerCase());
  const meter = summary ? fitMeter({ small: summary.fitSmall, exact: summary.fitExact, large: summary.fitLarge }) : null;
  const patch = (id: number, change: Partial<ReviewView>) =>
    setLocal({ version, patches: new Map(layer.patches).set(id, { ...layer.patches.get(id), ...change }), removed: layer.removed });

  const guarded = async (review: ReviewView, action: (id: Identity) => Promise<void>, failure: string) => {
    const id = identity ?? (await getIdentity());
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
          {advice?.kind === "advice" && <Notice kind="info" title={advice.headline}>{advice.support}</Notice>}
        </section>
      ) : null}

      {all.length > 0 && (
        <section class="sb-stack sb-gap-2" aria-label="סינון ומיון">
          <div class="filters">
            <button type="button" class="sb-btn sb-btn--secondary sb-btn--sm" aria-expanded={filtersOpen} aria-controls="sb-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
              <Icon name="sliders" size={16} />
              סינון
              {filterCount > 0 && <span class="sb-badge" aria-label={`${filterCount} מסננים פעילים`}>{filterCount}</span>}
            </button>
            <CompactSelect label="מיון" value={sort} onChange={(v) => setSort(v as SortMode)} options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))} />
            {filterCount > 0 && <Button variant="quiet" small onClick={() => setFilters(NO_FILTERS)}>ניקוי סינון</Button>}
          </div>
          <div class="sb-disclosure" id="sb-filters" data-open={filtersOpen ? "true" : "false"}>
            <div class="sb-disclosure__inner">
              <div class="filters">
                <CompactSelect label="סינון לפי דירוג" value={filters.rating === null ? "" : String(filters.rating)} onChange={(v) => setFilters({ ...filters, rating: v ? Number(v) : null })} options={RATING_OPTIONS} placeholder="כל הדירוגים" />
                <CompactSelect label="סינון לפי התאמת מידה" value={filters.fit ?? ""} onChange={(v) => setFilters({ ...filters, fit: (v || null) as ReviewFilters["fit"] })} options={FIT_OPTIONS} placeholder="כל ההתאמות" />
                {colors.length > 1 && (
                  <CompactSelect label="סינון לפי צבע" value={filters.color ?? ""} onChange={(v) => setFilters({ ...filters, color: v || null })} options={colors.map((c) => ({ value: c.color, label: `${c.color} (${c.count})` }))} placeholder="כל הצבעים" />
                )}
                {pageColorKnown && pageColor && (
                  <button type="button" class="toggle-chip" aria-pressed={filters.color?.toLowerCase() === pageColor.toLowerCase()} onClick={() => setFilters({ ...filters, color: filters.color?.toLowerCase() === pageColor.toLowerCase() ? null : pageColor })}>
                    רק הצבע שבעמוד
                  </button>
                )}
                <button type="button" class="toggle-chip" aria-pressed={filters.verifiedOnly} onClick={() => setFilters({ ...filters, verifiedOnly: !filters.verifiedOnly })}>רק מאומתות</button>
                <button type="button" class="toggle-chip" aria-pressed={filters.longTermOnly} onClick={() => setFilters({ ...filters, longTermOnly: !filters.longTermOnly })}>שימוש ממושך</button>
              </div>
            </div>
          </div>
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
                onUpdate={onUpdate}
                variantOrder={[target.colorGroup, target.sizeGroup]}
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
