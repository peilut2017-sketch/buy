import "../../src/lib/backend.ts";
import "@smartbuy/ui/tokens.css";
import "@smartbuy/ui/base.css";
import "@smartbuy/ui/reviews.css";
import "../../src/panel/panel.css";
import { render } from "preact";
import { Welcome } from "../../src/options/Welcome.tsx";

render(<Welcome />, document.getElementById("app") as HTMLElement);
