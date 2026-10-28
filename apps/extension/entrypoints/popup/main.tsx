import "../../src/lib/backend.ts";
import "@smartbuy/ui/tokens.css";
import "@smartbuy/ui/base.css";
import "@smartbuy/ui/reviews.css";
import "../../src/panel/panel.css";
import { AuthProvider } from "@smartbuy/ui";
import { render } from "preact";
import { extensionAuth } from "../../src/lib/auth.ts";
import { Popup } from "../../src/popup/Popup.tsx";
import { watchTheme } from "../../src/lib/theme.ts";

document.body.style.inlineSize = "360px";
watchTheme(document.documentElement);
render(<AuthProvider auth={extensionAuth}><Popup /></AuthProvider>, document.getElementById("app") as HTMLElement);
