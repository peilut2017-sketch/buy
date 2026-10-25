// Mounts the strip in a shadow root, so the store's CSS cannot reach it and ours cannot reach the store (CLAUDE.md rule 5).

import { h, render } from "preact";
import baseCss from "@smartbuy/ui/base.css?inline";
import tokensCss from "@smartbuy/ui/tokens.css?inline";
import { needsOpaque, sampleBackdrop } from "./backdrop.ts";
import stripCss from "./strip.css?inline";
import { Strip, type StripProps } from "./Strip.tsx";

export const HOST_TAG = "smartbuy-strip";

export interface MountedStrip {
  update(props: Omit<StripProps, "opaque">): void;
  unmount(): void;
  host: HTMLElement;
}

export function mountStrip(doc: Document, initial: Omit<StripProps, "opaque">): MountedStrip {
  doc.querySelectorAll(HOST_TAG).forEach((el) => el.remove());

  const host = doc.createElement(HOST_TAG);
  host.setAttribute("dir", "rtl");
  host.setAttribute("lang", "he");
  // Inline styles beat the page's own rules; `all: initial` in the shadow sheet only resets what is inherited.
  host.style.cssText = [
    "position:fixed",
    "inset-block-end:16px",
    "inset-inline-end:16px",
    "z-index:2147483000",
    "inline-size:min(380px, calc(100vw - 32px))",
    "isolation:isolate",
    "display:block",
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `${tokensCss}\n${baseCss}\n${stripCss}`;
  const container = doc.createElement("div");
  shadow.append(style, container);
  doc.documentElement.append(host);

  let props = initial;
  let opaque = true; // safest until the backdrop has been measured
  const draw = () => render(h(Strip, { ...props, opaque }), container);
  draw();

  // Measure once, after the first layout.
  const win = doc.defaultView;
  const measure = () => {
    const rect = host.getBoundingClientRect();
    opaque = needsOpaque(sampleBackdrop(doc, rect, host));
    draw();
  };
  if (win) win.requestAnimationFrame(() => win.requestAnimationFrame(measure));
  else measure();

  return {
    host,
    update(next) {
      props = next;
      draw();
    },
    unmount() {
      render(null, container);
      host.remove();
    },
  };
}
