import type { ReviewView } from "@smartbuy/core";
import { AppealForm, Button, IconButton, Notice, ProductHeader, ReportForm, RequireAccount, ReviewsView, RequireTerms, Root, Segmented, SignInCard, Skel, UpdateForm, TrackingView, WriteFlow } from "@smartbuy/ui";
import { useEffect, useState } from "preact/hooks";
import { currentIdentity, useSession } from "../lib/auth.ts";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { siteById } from "../lib/sites.ts";
import { removeSession } from "../lib/storage.ts";
import { NotDetected } from "./NotDetected.tsx";
import { toTarget, type ProductRef } from "./target.ts";
import { useActiveTab } from "./useActiveTab.ts";

type Tab = "reviews" | "tracking";

type View =
  | { name: "list" }
  | { name: "write" }
  | { name: "report"; review: ReviewView }
  | { name: "appeal"; review: ReviewView }
  | { name: "update"; review: ReviewView }
  | { name: "signin"; reason: string };

function SignInView({ reason, onDone }: { reason: string; onDone: () => void }) {
  const session = useSession();
  useEffect(() => {
    if (session.status === "in") onDone();
  }, [session.status]);
  return <SignInCard reason={reason} />;
}

export function App() {
  const session = useSession();
  const identity = session.status === "in" ? session.identity : null;
  const tab = useActiveTab();
  const [manual, setManual] = useState<ProductRef | null>(null);
  const [view, setView] = useState<View>({ name: "list" });
  const [version, setVersion] = useState(0);
  const [tabName, setTabName] = useState<Tab>("reviews");

  const site = tab.product ? siteById(tab.product.siteId) : undefined;
  const fromTab: ProductRef | null =
    tab.product && site ? { siteId: tab.product.siteId, siteName: site.name, sku: tab.product.sku, parentSku: tab.product.parentSku, snapshot: tab.product } : null;
  const product = manual ?? fromTab;
  const target = product ? toTarget(product, site?.bundled.config.sizeGroup ?? null, site?.bundled.config.colorGroup ?? null) : null;
  const productKey = product ? `${product.siteId}:${product.parentSku}` : "";

  // A different product, or a different tab, starts again at the list.
  useEffect(() => {
    setView({ name: "list" });
    setTabName("reviews");
  }, [productKey]);
  // The strip's button can ask for the write form directly.
  useEffect(() => {
    if (!fromTab) return;
    if (tab.mode === "write") setView({ name: "write" });
    if (tab.mode === "tracking") {
      setView({ name: "list" });
      setTabName("tracking");
    }
    if (tab.mode === "reviews") setTabName("reviews");
  }, [tab.mode, fromTab?.parentSku]);

  const backToList = (reload = false) => {
    setView({ name: "list" });
    if (reload) {
      setVersion((v) => v + 1);
      // The strip keeps a short-lived copy of the summary; a saved review must show there on the next look.
      if (product) void removeSession(`summary:${product.siteId}:${product.parentSku}`).catch(() => undefined);
    }
  };

  let content;
  if (!BACKEND_CONFIGURED) {
    content = <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת, ולכן אין ממה לטעון ביקורות.</Notice>;
  } else if (tab.loading && !manual) {
    content = <div class="sb-stack sb-gap-3" role="status" aria-label="טוענים"><Skel width="60%" variant="title" /><Skel width="90%" /></div>;
  } else if (!product || !target) {
    content = <NotDetected onLookup={setManual} />;
  } else if (view.name === "write") {
    content = (
      <RequireAccount reason="כדי לכתוב ביקורת צריך להתחבר.">
        {({ identity: id }) => <WriteFlow target={target} identity={id} onDone={() => backToList(true)} onCancel={() => backToList()} />}
      </RequireAccount>
    );
  } else if (view.name === "report") {
    content = (
      <RequireAccount reason="כדי לדווח על ביקורת צריך להתחבר.">
        {({ identity: id }) => <ReportForm review={view.review} identity={id} onClose={() => backToList()} />}
      </RequireAccount>
    );
  } else if (view.name === "appeal") {
    content = (
      <RequireAccount reason="כדי לערער צריך להתחבר.">
        {({ identity: id }) => <AppealForm review={view.review} identity={id} onClose={() => backToList(true)} />}
      </RequireAccount>
    );
  } else if (view.name === "update") {
    content = (
      <RequireAccount reason="כדי להוסיף עדכון צריך להתחבר.">
        {({ identity: id }) => <UpdateForm review={view.review} identity={id} onClose={(changed) => backToList(changed)} />}
      </RequireAccount>
    );
  } else if (view.name === "signin") {
    content = <SignInView reason={view.reason} onDone={() => backToList(true)} />;
  } else if (tabName === "tracking") {
    const tracking = (
      <TrackingView
        target={target}
        identity={identity}
        getIdentity={currentIdentity}
        version={version}
        onNeedSignIn={(reason) => setView({ name: "signin", reason })}
      />
    );
    content = identity ? <RequireTerms identity={identity}>{tracking}</RequireTerms> : tracking;
  } else {
    content = (
      <ReviewsView
        target={target}
        identity={identity}
        getIdentity={currentIdentity}
        version={version}
        onWrite={() => setView({ name: "write" })}
        onNeedSignIn={(reason) => setView({ name: "signin", reason })}
        onReport={(review) => setView({ name: "report", review })}
        onAppeal={(review) => setView({ name: "appeal", review })}
        onUpdate={(review) => setView({ name: "update", review })}
      />
    );
  }

  return (
    <Root class="panel">
      {target && (
        <header class="panel__header">
          <ProductHeader target={target} />
          {manual && <div><Button variant="quiet" small onClick={() => setManual(null)}>חזרה לעמוד הנוכחי</Button></div>}
          {view.name !== "list" && (
            <div><IconButton icon="arrow-back" iconFlip label="חזרה לביקורות" onClick={() => backToList()} /></div>
          )}
        </header>
      )}
      {target && view.name === "list" && (
        <nav class="panel__tabs" aria-label="חלקי הפאנל">
          <Segmented
            label="תצוגה"
            value={tabName}
            onChange={setTabName}
            items={[{ id: "reviews", label: "ביקורות" }, { id: "tracking", label: "מחיר ומעקב" }]}
          />
        </nav>
      )}
      <main class="panel__main">
        {target && view.name === "list" ? (
          <div key={tabName} class="sb-stack sb-gap-4 sb-enter" role="tabpanel" id={`sb-panel-${tabName}`} aria-labelledby={`sb-tab-${tabName}`}>{content}</div>
        ) : (
          <div key={view.name} class="sb-enter sb-enter--push">{content}</div>
        )}
      </main>
      <footer class="panel__footer">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות.</footer>
    </Root>
  );
}
