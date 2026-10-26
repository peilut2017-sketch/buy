import { callFunction, ApiError, NetworkError } from "@smartbuy/data";
import { Button, FieldError, Notice, TextArea, TextField } from "@smartbuy/ui";
import { useState } from "preact/hooks";
import { boot } from "../lib/boot.tsx";
import { Shell } from "../shell.tsx";

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

function Takedown() {
  const reviewId = Number(new URLSearchParams(location.search).get("review")) || null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  const submit = async (e: Event) => {
    e.preventDefault();
    setPhase({ kind: "sending" });
    setErrors({});
    try {
      await callFunction("takedown-request", { name, email, reason, reviewId, website: trap });
      setPhase({ kind: "sent" });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setErrors(err.fieldErrors);
        setPhase({ kind: "form" });
      } else {
        setPhase({ kind: "failed", message: err instanceof NetworkError ? "אין חיבור לשרת. הבקשה לא נשלחה. בדקו את החיבור ונסו שוב." : "הבקשה לא נשלחה. נסו שוב." });
      }
    }
  };

  return (
    <Shell>
      <h1 class="sb-t-name" style={{ fontSize: "24px", lineHeight: "30px" }}>בקשת הסרה</h1>
      <p class="sb-t-body sb-secondary">אתם מותג, חנות או אדם שמוזכר בביקורת, ורוצים להסיר או לתקן תוכן? כתבו לנו. כל בקשה נבדקת על ידי אדם, ואנחנו עונים תוך 48 שעות.</p>
      {phase.kind === "sent" ? (
        <Notice kind="success" title="הבקשה התקבלה">נבדוק אותה ונחזור אליכם בכתובת המייל שהשארתם.</Notice>
      ) : (
        <form class="web__card form" onSubmit={submit} noValidate>
          {reviewId && <p class="sb-t-support sb-secondary">הבקשה מתייחסת לביקורת מספר <bdi dir="ltr">{reviewId}</bdi>.</p>}
          <TextField label="שם" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} error={errors.name} autocomplete="name" maxLength={100} />
          <TextField label="כתובת מייל" type="email" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} error={errors.email} dir="ltr" class="ltr-input" autocomplete="email" />
          <TextArea label="מה צריך להסיר או לתקן, ולמה" value={reason} onInput={setReason} minChars={10} maxChars={2000} rows={6} error={errors.reason} />
          {/* A field people never see. Bots fill it in, and the server then stores nothing. */}
          <div aria-hidden="true" style={{ position: "absolute", insetInlineStart: "-10000px" }}>
            <label>אל תמלאו<input tabIndex={-1} autocomplete="off" value={trap} onInput={(e) => setTrap((e.currentTarget as HTMLInputElement).value)} /></label>
          </div>
          {phase.kind === "failed" && <FieldError>{phase.message}</FieldError>}
          <div><Button type="submit" variant="primary" disabled={phase.kind === "sending"}>{phase.kind === "sending" ? "שולחים…" : "שליחת הבקשה"}</Button></div>
        </form>
      )}
    </Shell>
  );
}

boot(<Takedown />);
