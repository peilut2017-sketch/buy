import "../../src/lib/backend.ts";
import "@smartbuy/ui/tokens.css";
import "@smartbuy/ui/base.css";
import "@smartbuy/ui/reviews.css";
import "../../src/panel/panel.css";
import { AuthProvider } from "@smartbuy/ui";
import { render } from "preact";
import { extensionAuth } from "../../src/lib/auth.ts";
import { App } from "../../src/panel/App.tsx";
import { watchTheme } from "../../src/lib/theme.ts";

watchTheme(document.documentElement);
render(<AuthProvider auth={extensionAuth}><App /></AuthProvider>, document.getElementById("app") as HTMLElement);
