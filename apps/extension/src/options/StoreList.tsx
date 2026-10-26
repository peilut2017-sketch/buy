import { Button, Notice, Skel } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { grantAccess, revokeAccess, useAccess } from "../lib/access.ts";
import { SITES } from "../lib/sites.ts";

/** One row per supported store. Access is a runtime permission: Chrome asks, and the user can withdraw it at any time. */
export function StoreList({ onGranted }: { onGranted?: () => void }) {
  const { access, refresh } = useAccess();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (access === null) return <Skel width="80%" height="36px" />;

  return (
    <div class="sb-stack sb-gap-3">
      <ul class="sb-list">
        {SITES.map((site) => {
          const on = access[site.id] === true;
          return (
            <li key={site.id} class="sb-row sb-spread sb-gap-3" style={{ paddingBlock: "var(--space-3)" }}>
              <div class="sb-stack" style={{ gap: "2px" }}>
                <span class="sb-t-heading">{site.name}</span>
                <span class="sb-t-support sb-secondary">{on ? "פעיל. הפס מופיע בעמודי מוצר." : "לא הופעל. בלי אישור התוסף לא קורא את האתר."}</span>
              </div>
              {on ? (
                <Button
                  small
                  disabled={busy === site.id}
                  onClick={async () => {
                    setBusy(site.id);
                    setError(null);
                    try {
                      await revokeAccess(site);
                    } catch {
                      setError("לא הצלחנו לבטל את הגישה. נסו שוב.");
                    } finally {
                      setBusy(null);
                      refresh();
                    }
                  }}
                >
                  ביטול גישה
                </Button>
              ) : (
                <Button
                  small
                  variant="primary"
                  disabled={busy === site.id}
                  onClick={async () => {
                    setBusy(site.id);
                    setError(null);
                    try {
                      if (await grantAccess(site)) onGranted?.();
                      else setError("לא אושרה גישה. אפשר לנסות שוב בכל רגע.");
                    } catch {
                      setError("לא הצלחנו להפעיל את החנות. נסו שוב.");
                    } finally {
                      setBusy(null);
                      refresh();
                    }
                  }}
                >
                  הפעלה
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
