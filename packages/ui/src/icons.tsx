// One consistent line-icon family: 24px grid, 1.75 stroke, round caps. Rendered at 16 or 18px.
// Directional icons (chevron, arrow) are mirrored in RTL through the `flip` prop. Star, check, bell, gear and close are not.

const PATHS = {
  star: "M12 3.5l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1-5.5-3-5.5 3 1.2-6.1-4.5-4.2 6.1-.8L12 3.5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  flag: "M6 21V4m0 0h11l-2 4 2 4H6",
  thumb: "M7 11v9H4v-9h3zm0 0l4-7a2 2 0 0 1 2 2l-.5 3.5H18a2 2 0 0 1 2 2.3l-1 6a2 2 0 0 1-2 1.7H7",
  chevron: "M9 6l6 6-6 6",
  "chevron-down": "M6 9l6 6 6-6",
  "arrow-back": "M10 6l-6 6 6 6M4 12h16",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  alert: "M12 4l9 16H3L12 4zM12 10v4M12 17h.01",
  edit: "M4 20h4l10-10-4-4L4 16v4zM13 7l4 4",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  external: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  shield: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3zM8.5 12l2.5 2.5L15.5 10",
  hourglass: "M7 4h10M7 20h10M8 4c0 4 4 5 4 8s-4 4-4 8M16 4c0 4-4 5-4 8s4 4 4 8",
  sliders: "M4 8h10M18 8h2M4 16h2M10 16h10M14 6v4M6 14v4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  size?: 14 | 16 | 18 | 20 | 24;
  /** Accessible name. Leave empty when the icon is decoration next to text. */
  label?: string;
  /** Mirror in RTL. Use for arrows and chevrons that carry a direction. */
  flip?: boolean;
}

export function Icon({ name, size = 16, label, flip }: IconProps) {
  return (
    <svg
      class={flip ? "sb-icon sb-flip" : "sb-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "star" ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
