// Product pages for the end-to-end tests. SYNTHETIC: they imitate the markup signals the adapter reads,
// with different backgrounds, to check the strip over light, dark and busy pages.
export function productPage({ sku, name = "מכנסי בדיקה", theme = "light", image = true, hostile = false, variants = false }) {
  const url = `https://www.terminalx.com/${sku}`;
  const themes = {
    light: "background:#ffffff;color:#222",
    dark: "background:#0d0d10;color:#eee",
    busy: "background:linear-gradient(135deg,#ff7a59,#2b5876 50%,#4e4376);color:#fff",
  };
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <link rel="canonical" href="${url}">
  <meta property="og:url" content="${url}">
  ${image ? `<meta property="og:image" content="https://media.terminalx.com/pub/media/catalog/product/w/8/${sku}-1234567.jpg">` : ""}
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":${JSON.stringify(name)},"sku":"${sku}","brand":{"@type":"Brand","name":"מותג בדיקה"},"offers":{"@type":"Offer","price":"149.90","priceCurrency":"ILS","availability":"https://schema.org/InStock"}}</script>
  <style>
    body{margin:0;${themes[theme]};font:16px/1.5 Arial,sans-serif;min-height:1400px}
    header{position:sticky;top:0;padding:16px;background:rgba(127,127,127,.25)}
    ${hostile ? `*{color:red!important;font-size:40px!important;letter-spacing:6px!important} button{background:lime!important;border:5px dashed red!important;border-radius:0!important} div,section{padding:50px!important}` : ""}
  </style>
</head>
<body><header>TERMINAL X (דף בדיקה)</header><main><h1>${name}</h1><p>עמוד מוצר סינתטי לבדיקות.</p>${variants ? variantBlock() : ""}</main></body>
</html>`;
}

export function plainPage(title = "נשים") {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><link rel="canonical" href="https://www.terminalx.com/women"></head><body><h1>${title}</h1></body></html>`;
}

/** A category page. SYNTHETIC: three product cards, two of which have reviews in the mock backend. */
export function listingPage() {
  const card = (sku, name) => `<li class="product-card" style="border:1px solid #ccc;padding:8px;margin:8px;list-style:none;inline-size:180px"><a class="card-link" href="/${sku}">${name}</a><div>₪149.90</div></li>`;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>נשים (דף בדיקה)</title><link rel="canonical" href="https://www.terminalx.com/category/women"></head><body style="background:#fff;color:#222;font:16px Arial"><h1>נשים</h1><ul style="display:flex;flex-wrap:wrap;padding:0">${card("w817260002", "מכנסי בדיקה")}${card("w900030001", "חולצת בדיקה")}${card("w900010001", "מעיל בדיקה")}</ul></body></html>`;
}

/** Colour and size pickers in the shape of the real page (data-test-id and hashed class names). Choosing a colour moves the "selected" class a moment later, as the real page does after it re-renders. */
function variantBlock() {
  return `<div class="attribute-wrapper_x"><div class="label-wrapper_x"><span>צבע  :</span><span>ורוד עתיק</span></div>
  <div id="colors" style="display:flex;gap:8px"><div data-test-id="qa-color-item" class="color-item_x selected_x" style="inline-size:24px;block-size:24px;background:pink" title="ורוד עתיק : צבע"></div><div data-test-id="qa-color-item" class="color-item_x" style="inline-size:24px;block-size:24px;background:#ddd" title="לבן : צבע"></div></div></div>
  <div class="attribute-wrapper_x"><div class="label-sizes_x"><div class="right-side_x">מידה</div></div>
  <div><div data-test-id="qa-size-item" class="size-item_x is-selected_x">M</div><div data-test-id="qa-size-item-not-available" class="size-item_x out-of-stock_x">S</div></div></div>
  <script>document.querySelectorAll("#colors > div").forEach((el) => el.addEventListener("click", () => {
    history.pushState({}, "", location.pathname + "?color=2");
    setTimeout(() => { document.querySelectorAll("#colors > div").forEach((c) => c.className = "color-item_x"); el.className = "color-item_x selected_x"; }, 150);
  }));</script>`;
}

/** The store's "my orders" page. SYNTHETIC: it asks for the order list the way the real page does, with its own fetch. */
export function ordersPage() {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>ההזמנות שלי (דף בדיקה)</title></head><body style="background:#fff;color:#222;font:16px Arial"><h1>ההזמנות שלי</h1><div id="out">טוענים…</div>
<script>setTimeout(async () => { const r = await fetch("/pg/QueryCustomerOrders?v=test"); const j = await r.json(); document.getElementById("out").textContent = j.data.customerOrders.count + " הזמנות"; }, 100);</script></body></html>`;
}
