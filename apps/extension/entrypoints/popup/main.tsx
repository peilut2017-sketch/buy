import "@smartbuy/ui/tokens.css";
import "@smartbuy/ui/base.css";
import "../../src/panel/panel.css";
import { render } from "preact";
import { Popup } from "../../src/popup/Popup.tsx";

document.body.style.inlineSize = "360px";
render(<Popup />, document.getElementById("app") as HTMLElement);
