// Converts a local file to plain text, on the device. Loaded only when a file is chosen.
const MAX_BYTES = 60 * 1048576;

export function detectKind(name) {
  const e = String(name).split(".").pop().toLowerCase();
  return e === "pdf" || e === "docx" || e === "txt" ? e : null;
}

// Checks the real file signature, not only the extension.
function signatureOk(kind, head) {
  if (kind === "pdf") return String.fromCharCode(...head.slice(0, 5)) === "%PDF-";
  if (kind === "docx") return head[0] === 0x50 && head[1] === 0x4b; // ZIP container
  return true;
}

let mammothPromise = null;
function loadMammoth() {
  if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./mammoth.browser.min.js";
      s.onload = () => resolve(globalThis.mammoth);
      s.onerror = () => reject(new Error("Could not load the Word reader."));
      document.head.appendChild(s);
    });
  }
  return mammothPromise;
}

let pdfPromise = null;
function loadPdf() {
  if (!pdfPromise) {
    pdfPromise = import("./pdf.min.mjs").then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = "./pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfPromise;
}

/** Returns { title, kind, text, pdfPages? }. PDF pages include rendered images. */
export async function extractFile(file, onProgress = () => {}) {
  const kind = detectKind(file.name);
  if (!kind) throw new Error("Unsupported file. Choose a PDF, DOCX or TXT file.");
  if (file.size > MAX_BYTES) throw new Error("That file is over 60 MB. Try a smaller one.");

  const buf = await file.arrayBuffer();
  if (!signatureOk(kind, new Uint8Array(buf, 0, Math.min(8, buf.byteLength)))) {
    throw new Error(`This file is named .${kind} but its contents do not match that format.`);
  }
  const title = file.name.replace(/\.[^.]+$/, "");

  if (kind === "txt") return { title, kind, text: new TextDecoder().decode(buf) };

  if (kind === "docx") {
    const mammoth = await loadMammoth();
    try {
      const r = await mammoth.extractRawText({ arrayBuffer: buf });
      return { title, kind, text: r.value };
    } catch {
      throw new Error("This DOCX file is damaged and could not be opened.");
    }
  }

  const pdfjs = await loadPdf();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Remove the password and try again.");
    }
    throw new Error("This PDF is damaged and could not be opened.");
  }

  let out = "";
  const pdfPages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.35 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const content = await page.getTextContent();
    let line = "";
    let last = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      if (last !== null && Math.abs(item.transform[5] - last) > 4) line += "\n";
      line += item.str + " ";
      last = item.transform[5];
    }
    const pageText = line.trim();
    out += pageText + "\n\n";
    pdfPages.push({ image: canvas.toDataURL("image/jpeg", 0.88), text: pageText });
    onProgress(`Reading page ${i} of ${doc.numPages}…`);
  }
  return { title, kind, text: out.replace(/ +\n/g, "\n"), pdfPages };
}
