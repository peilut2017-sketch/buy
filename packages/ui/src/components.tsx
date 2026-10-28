import type { ComponentChildren, JSX } from "preact";
import { useId, useRef } from "preact/hooks";
import type { FitMeter as FitMeterData } from "@smartbuy/core";
import { Icon, type IconName } from "./icons.tsx";
import { THEME_OPTIONS, type ThemePref } from "./theme.ts";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Root of every SmartBuy surface: Hebrew, right to left, tokens and base styles apply inside it. */
export function Root({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return (
    <div class={cx("sb-root", className)} dir="rtl" lang="he">
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- buttons */

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "size" | "icon"> {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
  icon?: IconName;
  iconFlip?: boolean;
}

export function Button({ variant = "secondary", small, block, icon, iconFlip, children, class: className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type as "button"}
      class={cx("sb-btn", `sb-btn--${variant}`, small && "sb-btn--sm", block && "sb-btn--block", className as string)}
      {...rest}
    >
      {icon && <Icon name={icon} flip={iconFlip} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<JSX.IntrinsicElements["button"], "size" | "label" | "icon"> {
  icon: IconName;
  /** Required: an icon button has no visible text, so it needs an accessible name and a tooltip. */
  label: string;
  iconFlip?: boolean;
}

export function IconButton({ icon, label, iconFlip, class: className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type as "button"} class={cx("sb-icon-btn", className as string)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={18} flip={iconFlip} />
    </button>
  );
}

/* ---------------------------------------------------------------- stars */

export function ratingText(value: number): string {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `דירוג ${shown} מתוך 5`;
}

export function Stars({ value, size = 14 }: { value: number; size?: 14 | 16 | 18 }) {
  const filled = Math.round(value);
  return (
    <span class="sb-stars" role="img" aria-label={ratingText(value)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} class={n <= filled ? "sb-star--on" : undefined} style={{ lineHeight: 0 }}>
          <Icon name="star" size={size} />
        </span>
      ))}
    </span>
  );
}

const STAR_WORDS = ["", "כוכב אחד", "2 כוכבים", "3 כוכבים", "4 כוכבים", "5 כוכבים"];

export function StarInput({ value, onChange, legend = "דירוג כללי", error }: { value: number | null; onChange: (n: number) => void; legend?: string; error?: string }) {
  const name = useId();
  const errorId = useId();
  return (
    <div class="sb-field">
      <fieldset class="sb-star-input" aria-describedby={error ? errorId : undefined}>
        <legend class="sb-label">{legend}</legend>
        <div class="sb-row" style={{ gap: "4px" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} class={value !== null && n <= value ? "is-on" : undefined}>
              <input type="radio" name={name} value={n} checked={value === n} aria-label={STAR_WORDS[n]} onChange={() => onChange(n)} />
              <Icon name="star" size={24} />
            </label>
          ))}
        </div>
      </fieldset>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/* ---------------------------------------------------------------- navigation */

export interface SegmentItem<T extends string> {
  id: T;
  label: string;
}

/** Tabs with roving focus. The arrow keys follow the visual direction, which is reversed in RTL. */
export function Segmented<T extends string>({ items, value, onChange, label }: { items: SegmentItem<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number) => {
    const next = (from + step + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  };
  const active = Math.max(0, items.findIndex((item) => item.id === value));
  return (
    <div class="sb-segmented" role="tablist" aria-label={label} style={{ "--n": String(items.length), "--i": String(active) }}>
      <span class="sb-segmented__thumb" aria-hidden="true" />
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`sb-tab-${item.id}`}
          aria-selected={item.id === value}
          aria-controls={`sb-panel-${item.id}`}
          tabIndex={item.id === value ? 0 : -1}
          class="sb-segment"
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") (e.preventDefault(), move(i, 1));
            else if (e.key === "ArrowRight") (e.preventDefault(), move(i, -1));
            else if (e.key === "Home") (e.preventDefault(), move(-1, 1));
            else if (e.key === "End") (e.preventDefault(), move(items.length, -1));
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- chips and notices */

export function Chip({ icon, tone, children }: { icon?: IconName; tone?: "verified" | "pending"; children: ComponentChildren }) {
  return (
    <span class={cx("sb-chip", tone && `sb-chip--${tone}`)}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export interface NoticeProps {
  kind?: "info" | "error" | "success" | "empty";
  title?: string;
  children?: ComponentChildren;
  action?: ComponentChildren;
}

const NOTICE_ICON: Record<NonNullable<NoticeProps["kind"]>, IconName | null> = {
  info: "info",
  error: "alert",
  success: "check",
  empty: null,
};

export function Notice({ kind = "info", title, children, action }: NoticeProps) {
  const icon = NOTICE_ICON[kind];
  return (
    <div class={cx("sb-notice", `sb-notice--${kind}`)} role={kind === "error" ? "alert" : "status"}>
      {icon && <Icon name={icon} size={18} />}
      <div class="sb-notice__body">
        {title && <div class="sb-notice__title">{title}</div>}
        {children && <div class="sb-secondary">{children}</div>}
        {action && <div style={{ marginBlockStart: "var(--space-2)" }}>{action}</div>}
      </div>
    </div>
  );
}

export function Skel({ width, height, variant = "line" }: { width?: string; height?: string; variant?: "line" | "title" | "thumb" }) {
  return <span class={cx("sb-skel", `sb-skel--${variant}`)} style={{ inlineSize: width, blockSize: height }} aria-hidden="true" />;
}

/* ---------------------------------------------------------------- fit meter */

export function FitMeter({ meter, compact }: { meter: FitMeterData; compact?: boolean }) {
  if (!meter.enough) {
    return <p class="sb-t-support sb-secondary">{meter.message}</p>;
  }
  return (
    <div class={cx("sb-fit", compact && "sb-fit--compact")} role="img" aria-label={meter.ariaLabel}>
      <div class="sb-fit__sentence" aria-hidden="true">
        <strong>{meter.sentence}</strong>
        <span class="sb-t-support sb-secondary">{meter.buyers}</span>
      </div>
      <div class="sb-fit__track" aria-hidden="true">
        <span class="sb-fit__line" />
        <span class="sb-fit__tick" />
        <span class="sb-fit__dot" style={{ "--p": String(meter.position) }} />
      </div>
      <div class="sb-fit__labels" aria-hidden="true">
        <span>קטן</span>
        <span>מדויק</span>
        <span>גדול</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- form fields */

export function FieldError({ id, children }: { id?: string; children: ComponentChildren }) {
  return (
    <p class="sb-error-text" id={id} role="alert">
      <Icon name="alert" size={14} />
      <span>{children}</span>
    </p>
  );
}

interface BaseFieldProps {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({ label, error, hint, class: _c, ...rest }: BaseFieldProps & JSX.IntrinsicElements["input"]) {
  const id = useId();
  const describedBy = [error && `${id}-e`, hint && `${id}-h`].filter(Boolean).join(" ") || undefined;
  return (
    <div class="sb-field">
      <label class="sb-label" for={id}>{label}</label>
      <input id={id} class="sb-input" aria-invalid={error ? "true" : undefined} aria-describedby={describedBy} {...rest} />
      {hint && <p class="sb-hint" id={`${id}-h`}>{hint}</p>}
      {error && <FieldError id={`${id}-e`}>{error}</FieldError>}
    </div>
  );
}

export interface TextAreaProps extends BaseFieldProps {
  value: string;
  onInput: (value: string) => void;
  minChars?: number;
  maxChars?: number;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

/** The counter says how many more characters are needed, then how many remain. */
export function TextArea({ label, error, hint, value, onInput, minChars, maxChars, placeholder, rows = 5, disabled }: TextAreaProps) {
  const id = useId();
  const length = Array.from(value.trim()).length;
  const counter =
    minChars !== undefined && length > 0 && length < minChars
      ? `עוד ${minChars - length} תווים לפחות`
      : maxChars !== undefined
        ? `${length.toLocaleString("en-US")} מתוך ${maxChars.toLocaleString("en-US")}`
        : "";
  const describedBy = [error && `${id}-e`, hint && `${id}-h`].filter(Boolean).join(" ") || undefined;
  return (
    <div class="sb-field">
      <label class="sb-label" for={id}>{label}</label>
      <textarea
        id={id}
        class="sb-textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        onInput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)}
      />
      {counter && <span class="sb-field-counter" aria-live="off">{counter}</span>}
      {hint && <p class="sb-hint" id={`${id}-h`}>{hint}</p>}
      {error && <FieldError id={`${id}-e`}>{error}</FieldError>}
    </div>
  );
}

export function SelectField({ label, error, hint, value, onChange, options, placeholder, disabled }: BaseFieldProps & { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  const describedBy = [error && `${id}-e`, hint && `${id}-h`].filter(Boolean).join(" ") || undefined;
  return (
    <div class="sb-field">
      <label class="sb-label" for={id}>{label}</label>
      <select id={id} class="sb-select" value={value} disabled={disabled} aria-invalid={error ? "true" : undefined} aria-describedby={describedBy} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p class="sb-hint" id={`${id}-h`}>{hint}</p>}
      {error && <FieldError id={`${id}-e`}>{error}</FieldError>}
    </div>
  );
}

/** A small select for filter rows. The label is the accessible name only, because the options already say what they filter. */
export function CompactSelect({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select class="sb-select sb-select--compact" aria-label={label} value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function ChoiceGroup<T extends string>({ legend, options, value, onChange, error, disabled }: { legend: string; options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; error?: string; disabled?: boolean }) {
  const name = useId();
  const errorId = useId();
  return (
    <div class="sb-field">
      <fieldset class="sb-choices" aria-describedby={error ? errorId : undefined} disabled={disabled}>
        <legend class="sb-label" style={{ marginBlockEnd: "var(--space-1)" }}>{legend}</legend>
        {options.map((o) => (
          <label key={o.value} class="sb-choice">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label class="sb-switch" for={id}>
      <span class="sb-grow">
        <span class="sb-t-body" style={{ display: "block" }}>{label}</span>
        {description && <span class="sb-t-support sb-secondary" style={{ display: "block" }}>{description}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="sb-switch__track" aria-hidden="true" />
    </label>
  );
}

/* ---------------------------------------------------------------- appearance */

/** Light, dark or follow the system. The caller stores the choice and says whether storing it worked. */
export function ThemeChoice({ value, onChange, disabled }: { value: ThemePref; onChange: (v: ThemePref) => void; disabled?: boolean }) {
  return <ChoiceGroup legend="מראה" options={THEME_OPTIONS} value={value} onChange={onChange} disabled={disabled} />;
}
