import "@smartbuy/ui/tokens.css";
import "@smartbuy/ui/base.css";
import "../../src/panel/panel.css";
import { render } from "preact";
import { App } from "../../src/panel/App.tsx";

render(<App />, document.getElementById("app") as HTMLElement);
