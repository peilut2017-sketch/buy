import { rest, type ReviewTarget } from "@smartbuy/data";
import { AppealForm, Button, IconButton, Notice, ProductHeader, ReportForm, RequireAccount, ReviewsView, Segmented, SignInCard, Skel, UpdateForm, TrackingView, WriteFlow, useAuth, useResource, type SessionState } from "@smartbuy/ui";
import type { ReviewView } from "@smartbuy/core";
import { useEffect, useState } from "preact/hooks";
import { boot, setTitle } from "../lib/boot.tsx";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { Search } from "../lib/Search.tsx";
import { loadSites, resolveInput, type PublicSite } from "../lib/sites.ts";
import { Shell } from "../shell.tsx";

type View =
  | { name: "list" }
  | { name: "write" }
  | { name: "report"; review: ReviewView }
  | { name: "appeal"; review: ReviewView }
  | { name: "update"; review: ReviewView }
  | { name: "signin"; reason: string };

interface ProductRow {
  name: string | null;
  brand: string | null;
  image_url: string | null;
  url: string | null;
  product_type: string | null;
}

/** /<site>/<sku> and the shortcut /<sku>. The shortcut goes to the first store whose product pattern matches. */
function parsePath(sites: readonly PublicSite[]): { site: PublicSite; sku: string; parentSku: string } | null {
  const parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0 || parts.length > 2) return null;
  if (parts.length === 2) {
    const site = sites.find((s) => s.id === parts[0]);
    const found = site ? resolveInput(`/${parts[1]}`, [site]) : null;
    return site && found ? { site, sku: found.sku, parentSku: found.parentSku } : null;
  }
  const found = resolveInput(`/${parts[0]}`, sites);
  const site = found ? sites.find((s) => s.id === found.siteId) : undefined;
  return site && found ? { site, sku: found.sku, parentSku: found.parentSku } : null;
}

async function loadTarget(): Promise<{ target: ReviewTarget | null; sites: PublicSite[] }> {
  const sites = await loadSites();
  const found = parsePath(sites);
  if (!found) return { target: null, sites };
  const rows = await rest<ProductRow[]>("products", {
    params: { site_id: `eq.${found.site.id}`, parent_sku: `eq.${found.parentSku}`, select: "name,brand,image_url,url,product_type", limit: 1 },
  });
  const row = rows[0];
  return {
    sites,
    target: {
      siteId: found.site.id,
      siteName: found.site.name,
      sku: found.sku,
      parentSku: found.parentSku,
      productType: row?.product_type ?? found.site.adapterConfig.productType ?? "general",
      confidence: "medium",
      name: row?.name ?? null,
      brand: row?.brand ?? null,
      imageUrl: row?.image_url ?? null,
      url: row?.url ?? "",
      price: null,
      variantValues: {},
      variantOptions: [],
      source: "web",
    },
  };
}

function SignInView({ reason, onDone }: { reason: string; onDone: () => void }) {
  const { useSession } = useAuth();
  const session: SessionState = useSession();
  useEffect(() => {
    if (session.status === "in") onDone();
  }, [session.status]);
  return <SignInCard reason={reason} />;
}

function ProductPage() {
  const { useSession, getIdentity } = useAuth();
  const session = useSession();
  const identity = session.status === "in" ? session.identity : null;
  const data = useResource(loadTarget, []);
  const [view, setView] = useState<View>({ name: "list" });
  const [version, setVersion] = useState(0);
  const [tabName, setTabName] = useState<"reviews" | "tracking">("reviews");

  useEffect(() => {
    if (data.status === "ready" && data.data.target) setTitle(`ביקורות על ${data.data.target.name ?? data.data.target.sku}`);
    else setTitle("מוצר לא נמצא");
  }, [data.status]);

  if (!BACKEND_CONFIGURED) return <Shell><Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת.</Notice></Shell>;
  if (data.status === "loading") return <Shell><div class="web__card"><Skel width="60%" variant="title" /><Skel width="90%" /></div></Shell>;
  if (data.status === "error") {
    return (
      <Shell>
        <Notice kind="error" title="הביקורות לא נטענו" action={<Button small icon="refresh" onClick={data.reload}>ניסיון חוזר</Button>}>
          בדקו את החיבור לאינטרנט ונסו שוב.
        </Notice>
      </Shell>
    );
  }
  const { target, sites } = data.data;
  if (!target) {
    return (
      <Shell>
        <Notice kind="empty" title="לא מצאנו מוצר בכתובת הזו">אפשר לחפש לפי קישור למוצר או לפי מק״ט.</Notice>
        <div class="web__card"><Search sites={sites} autoFocus /></div>
      </Shell>
    );
  }

  const back = (reload = false) => {
    setView({ name: "list" });
    if (reload) setVersion((v) => v + 1);
  };

  let content;
  if (view.name === "write") {
    content = (
      <RequireAccount reason="כדי לכתוב ביקורת צריך להתחבר.">
        {({ identity: id }) => (
          <div class="sb-stack sb-gap-3">
            <Notice kind="info">ביקורת שנכתבת באתר מסומנת "ממתין לאימות", ומאומתת אוטומטית כשהתוסף במחשב מזהה את ההזמנה.</Notice>
            <WriteFlow target={target} identity={id} onDone={() => back(true)} onCancel={() => back()} />
          </div>
        )}
      </RequireAccount>
    );
  } else if (view.name === "report") {
    content = <RequireAccount reason="כדי לדווח על ביקורת צריך להתחבר.">{({ identity: id }) => <ReportForm review={view.review} identity={id} onClose={() => back()} />}</RequireAccount>;
  } else if (view.name === "appeal") {
    content = <RequireAccount reason="כדי לערער צריך להתחבר.">{({ identity: id }) => <AppealForm review={view.review} identity={id} onClose={() => back(true)} />}</RequireAccount>;
  } else if (view.name === "update") {
    content = <RequireAccount reason="כדי להוסיף עדכון צריך להתחבר.">{({ identity: id }) => <UpdateForm review={view.review} identity={id} onClose={(changed) => back(changed)} />}</RequireAccount>;
  } else if (view.name === "signin") {
    content = <SignInView reason={view.reason} onDone={() => back(true)} />;
  } else if (tabName === "tracking") {
    content = <TrackingView target={target} identity={identity} getIdentity={getIdentity} version={version} onNeedSignIn={(reason) => setView({ name: "signin", reason })} />;
  } else {
    content = (
      <ReviewsView
        target={target}
        identity={identity}
        getIdentity={getIdentity}
        version={version}
        onWrite={() => setView({ name: "write" })}
        onNeedSignIn={(reason) => setView({ name: "signin", reason })}
        onReport={(review) => setView({ name: "report", review })}
        onAppeal={(review) => setView({ name: "appeal", review })}
        onUpdate={(review) => setView({ name: "update", review })}
      />
    );
  }

  const storeLink = target.url.startsWith("https://") ? target.url : null;
  return (
    <Shell>
      <div class="web__card sb-stack sb-gap-3">
        <ProductHeader target={target} />
        {storeLink && <a class="sb-t-support" href={storeLink} rel="noopener noreferrer">לעמוד המוצר ב{target.siteName}</a>}
        {view.name !== "list" && <div><IconButton icon="arrow-back" iconFlip label="חזרה לביקורות" onClick={() => back()} /></div>}
      </div>
      {view.name === "list" && (
        <div class="admin-tabs">
          <Segmented label="תצוגה" value={tabName} onChange={setTabName} items={[{ id: "reviews", label: "ביקורות" }, { id: "tracking", label: "מחיר ומעקב" }]} />
        </div>
      )}
      <div class="web__card" role={view.name === "list" ? "tabpanel" : undefined} id={view.name === "list" ? `sb-panel-${tabName}` : undefined} aria-labelledby={view.name === "list" ? `sb-tab-${tabName}` : undefined}>{content}</div>
    </Shell>
  );
}

boot(<ProductPage />);
