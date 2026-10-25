// Product pages for the end-to-end tests. SYNTHETIC: they imitate the markup signals the adapter reads,
// with different backgrounds, to check the strip over light, dark and busy pages.
export function productPage({ sku, name = "מכנסי בדיקה", theme = "light", image = true, hostile = false }) {
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
<body><header>TERMINAL X (דף בדיקה)</header><main><h1>${name}</h1><p>עמוד מוצר סינתטי לבדיקות.</p></main></body>
</html>`;
}

export function plainPage(title = "נשים") {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><link rel="canonical" href="https://www.terminalx.com/women"></head><body><h1>${title}</h1></body></html>`;
}
