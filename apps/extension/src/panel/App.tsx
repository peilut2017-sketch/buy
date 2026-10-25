import type { ReviewView } from "@smartbuy/core";
import { Button, IconButton, Notice, Root, Skel } from "@smartbuy/ui";
import { useEffect, useState } from "preact/hooks";
import { useSession } from "../lib/auth.ts";
import { BACKEND_CONFIGURED } from "../lib/env.ts";
import { siteById } from "../lib/sites.ts";
import { AppealForm } from "./AppealForm.tsx";
import { RequireAccount, SignInCard } from "./AuthGate.tsx";
import { NotDetected } from "./NotDetected.tsx";
import { ProductHeader, type ProductRef } from "./ProductHeader.tsx";
import { ReportForm } from "./ReportForm.tsx";
import { ReviewsTab } from "./ReviewsTab.tsx";
import { useActiveTab } from "./useActiveTab.ts";
import { WriteFlow } from "./WriteFlow.tsx";

type View =
  | { name: "list" }
  | { name: "write" }
  | { name: "report"; review: ReviewView }
  | { name: "appeal"; review: ReviewView }
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

  const site = tab.product ? siteById(tab.product.siteId) : undefined;
  const fromTab: ProductRef | null =
    tab.product && site ? { siteId: tab.product.siteId, siteName: site.name, sku: tab.product.sku, parentSku: tab.product.parentSku, snapshot: tab.product } : null;
  const product = manual ?? fromTab;
  const productKey = product ? `${product.siteId}:${product.parentSku}` : "";

  // A different product, or a different tab, starts again at the list.
  useEffect(() => {
    setView({ name: "list" });
  }, [productKey]);
  // The strip's button can ask for the write form directly.
  useEffect(() => {
    if (tab.mode === "write" && fromTab) setView({ name: "write" });
  }, [tab.mode, fromTab?.parentSku]);

  const backToList = (reload = false) => {
    setView({ name: "list" });
    if (reload) setVersion((v) => v + 1);
  };

  let content;
  if (!BACKEND_CONFIGURED) {
    content = <Notice kind="error" title="החיבור לשרת לא הוגדר">גרסת הפיתוח הזו נבנתה בלי כתובת שרת, ולכן אין ממה לטעון ביקורות.</Notice>;
  } else if (tab.loading && !manual) {
    content = <div class="sb-stack sb-gap-3" role="status" aria-label="טוענים"><Skel width="60%" variant="title" /><Skel width="90%" /></div>;
  } else if (!product) {
    content = <NotDetected onLookup={setManual} />;
  } else if (view.name === "write") {
    content = (
      <RequireAccount reason="כדי לכתוב ביקורת צריך להתחבר.">
        {({ identity: id }) => <WriteFlow product={product} identity={id} onDone={() => backToList(true)} onCancel={() => backToList()} />}
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
  } else if (view.name === "signin") {
    content = <SignInView reason={view.reason} onDone={() => backToList(true)} />;
  } else {
    content = (
      <ReviewsTab
        product={product}
        identity={identity}
        version={version}
        onWrite={() => setView({ name: "write" })}
        onNeedSignIn={(reason) => setView({ name: "signin", reason })}
        onReport={(review) => setView({ name: "report", review })}
        onAppeal={(review) => setView({ name: "appeal", review })}
      />
    );
  }

  return (
    <Root class="panel">
      {product && (
        <header class="panel__header">
          <ProductHeader product={product} />
          {manual && <div><Button variant="quiet" small onClick={() => setManual(null)}>חזרה לעמוד הנוכחי</Button></div>}
          {view.name !== "list" && (
            <div><IconButton icon="arrow-back" iconFlip label="חזרה לביקורות" onClick={() => backToList()} /></div>
          )}
        </header>
      )}
      <main class="panel__main">{content}</main>
      <footer class="panel__footer">SmartBuy הוא שירות עצמאי ואין לו קשר לחנויות.</footer>
    </Root>
  );
}
