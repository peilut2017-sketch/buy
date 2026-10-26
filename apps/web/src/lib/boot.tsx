import { configureBackend } from "@smartbuy/data";
import { AuthProvider } from "@smartbuy/ui";
import { render, type ComponentChildren } from "preact";
import { webAuth } from "./auth.ts";
import { BACKEND } from "./env.ts";

/** Starts a page: points the data layer at the backend, provides sign-in, and draws the page. */
export function boot(page: ComponentChildren): void {
  configureBackend({ url: BACKEND.url, anonKey: BACKEND.anonKey });
  render(<AuthProvider auth={webAuth}>{page}</AuthProvider>, document.getElementById("app") as HTMLElement);
}

/** The page title follows the product or section once it is known. */
export function setTitle(title: string): void {
  document.title = `${title} | SmartBuy`;
}
