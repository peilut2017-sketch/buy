import { callFunction } from "@smartbuy/data";
import { Button, ChoiceGroup, FieldError, Notice } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { boot } from "../lib/boot.tsx";
import { Shell } from "../shell.tsx";

const REASONS = [
  { value: "too_many_popups", label: "יותר מדי חלונות והתראות" },
  { value: "not_useful", label: "זה לא היה מועיל לי" },
  { value: "privacy", label: "דאגה לפרטיות" },
  { value: "broken", label: "זה לא עבד כמו שצריך" },
  { value: "other", label: "משהו אחר" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

function Bye() {
  const [reason, setReason] = useState<Reason | null>(null);
  const [phase, setPhase] = useState<"form" | "sending" | "sent" | "failed">("form");

  const send = async (e: Event) => {
    e.preventDefault();
    if (!reason) return;
    setPhase("sending");
    try {
      await callFunction("events", { event: "uninstall", platform: "web_desktop", props: { reason } });
      setPhase("sent");
    } catch {
      setPhase("failed");
    }
  };

  return (
    <Shell>
      <h1 class="sb-t-name" style={{ fontSize: "24px", lineHeight: "30px" }}>תודה שניסיתם</h1>
      {phase === "sent" ? (
        <Notice kind="success" title="התשובה נשמרה">תודה. היא עוזרת לנו להבין מה להשתפר. התשובה אנונימית.</Notice>
      ) : (
        <form class="web__card form" onSubmit={send}>
          <ChoiceGroup<Reason> legend="מה גרם לכם להסיר את התוסף?" options={[...REASONS]} value={reason} onChange={setReason} disabled={phase === "sending"} />
          <p class="sb-t-support sb-secondary">אנחנו לא שומרים עם התשובה שום פרט מזהה.</p>
          {phase === "failed" && <FieldError>התשובה לא נשלחה. אפשר לנסות שוב.</FieldError>}
          <div><Button type="submit" variant="primary" disabled={!reason || phase === "sending"}>שליחה</Button></div>
        </form>
      )}
    </Shell>
  );
}

boot(<Bye />);
