export function slug(value) {
  return String(value || "immersive-book").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "immersive-book";
}

export function buildStandaloneHtml(book, css, reader, soundAssets = {}) {
  const data = JSON.stringify(book).replace(/</g, "\\u003c");
  const sounds = JSON.stringify(soundAssets).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(book.title).replace(/[<&>"]/g, "")}</title><style>${css}</style></head>
<body><main id="reader"></main><script>window.IB_SOUND_ASSETS=${sounds};</script><script>${reader}</script>
<script>
(function () {
  var root = document.getElementById("reader");
  window.IB.openReader(root, ${data}, { onBack: function () { location.reload(); } });
}());
</script></body></html>`;
}
