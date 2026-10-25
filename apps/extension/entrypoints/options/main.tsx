import "@smartbuy/ui/tokens.css";
import "@smartbuy/ui/base.css";
import "../../src/panel/panel.css";
import { render } from "preact";
import { Options } from "../../src/options/Options.tsx";

render(<Options />, document.getElementById("app") as HTMLElement);
