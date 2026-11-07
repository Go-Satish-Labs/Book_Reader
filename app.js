import { detectKind, extractFile } from "./convert.js";
import { buildStandaloneHtml, slug } from "./standalone.js";

const $ = id => document.getElementById(id);
const home = $("home"), readerRoot = $("reader"), msg = $("msg"), drop = $("drop"), fileInput = $("file");
let busy = false;

function loadAssetRegistry() {
  window.setLoader("Preparing sound catalog…", null);
  return Promise.all([
    fetch("assets/immersive-reading-sounds/sound_manifest.json").then(response => {
      if (!response.ok) throw new Error("Could not load the sound catalog.");
      return response.json();
    }),
    fetch("assets/immersive-reading-music/music_manifest.json").then(response => {
      if (!response.ok) throw new Error("Could not load the music catalog.");
      return response.json();
    })
  ]).then(([sounds, music]) => {
    const soundByCue = new Map();
    sounds.forEach(entry => {
      if (!entry.file || !entry.cue) return;
      const key = entry.cue.trim().toLowerCase();
      if (!soundByCue.has(key)) soundByCue.set(key, entry);
    });
    const musicByCategory = new Map();
    music.forEach(entry => {
      if (!entry.file || !entry.category) return;
      if (!musicByCategory.has(entry.category)) musicByCategory.set(entry.category, []);
      musicByCategory.get(entry.category).push(entry);
    });
    const registry = { sounds, music, soundByCue, musicByCategory };
    window.IB_ASSET_REGISTRY = registry;
    window.IB_SOUND_MANIFEST = sounds;
    window.IB_MUSIC_MANIFEST = music;
    window.setLoader(`${sounds.length} sounds and ${music.length} music tracks ready`, 100);
    return registry;
  });
}

window.IB_ASSETS_READY = loadAssetRegistry();

function report(text, isError = false) {
  msg.textContent = text;
  msg.className = "msg" + (isError ? " err" : "");
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Could not read ${path}`);
  return r.text();
}

async function exportBook(book) {
  try {
    const [css, js, soundManifest, musicManifest] = await Promise.all([
      fetchText("app.css"),
      fetchText("reader.js"),
      fetchText("assets/immersive-reading-sounds/sound_manifest.json").then(JSON.parse),
      fetchText("assets/immersive-reading-music/music_manifest.json").then(JSON.parse)
    ]);
    const choose = (list, re) => list.find(item => re.test(item.cue || item.title || ""));
    const selectedSounds = [
      choose(soundManifest, /rain|wind|wave|fire|cricket|stream|river/i),
      choose(soundManifest, /thunder/i),
      choose(soundManifest, /door/i),
      choose(soundManifest, /bird/i),
      choose(soundManifest, /footstep/i),
      choose(soundManifest, /water/i)
    ].filter(Boolean);
    const selectedMusic = [
      musicManifest.find(item => item.category === "Ambient"),
      musicManifest.find(item => item.category === "Horror")
    ].filter(Boolean);
    const packageAudio = async (root, entries, prefix) => Promise.all(entries.map(async entry => {
      const response = await fetch(`${root}/${entry.file.split("\\").map(encodeURIComponent).join("/")}`);
      if (!response.ok) throw new Error(`Could not package ${entry.file}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return [`${prefix}:${entry.file}`, `data:audio/mpeg;base64,${btoa(binary)}`];
    }));
    const embedded = Object.fromEntries([
      ...(await packageAudio("assets/immersive-reading-sounds", selectedSounds, "sound")),
      ...(await packageAudio("assets/immersive-reading-music", selectedMusic, "music"))
    ]);
    download(new Blob([buildStandaloneHtml(book, css, js, embedded, { sounds: soundManifest, music: musicManifest })], { type: "text/html" }), slug(book.title) + ".html");
  } catch (e) {
    alert("Export failed: " + e.message + "\nOpen the app through a web server (for example: npm start), not by double-clicking index.html.");
  }
}

function showHome() {
  readerRoot.innerHTML = "";
  readerRoot.hidden = true;
  home.hidden = false;
  report("");
}

function showBook(book) {
  home.hidden = true;
  readerRoot.hidden = false;
  IB.openReader(readerRoot, book, { onExport: () => exportBook(book), onBack: showHome });
}

async function openFile(file) {
  if (!file || busy) return;
  if (!detectKind(file.name)) return report("Unsupported file. Choose a PDF, DOCX or TXT file.", true);
  busy = true;
  window.showLoader("Preparing your book", file.name);
  report(`Reading “${file.name}” on your device…`);
  try {
    const book = await extractFile(file, m => {
      report(m);
      const progress = m.match(/^Reading page (\d+) of (\d+)/);
      window.setLoader(m, progress ? (Number(progress[1]) / Number(progress[2])) * 100 : null);
    });
    window.setLoader("Opening your book…", 100);
    report("Ready.");
    showBook(book);
  } catch (e) {
    report(e.message, true);
    window.setLoader("Could not open this file.", 0);
  } finally {
    busy = false;
    window.hideLoader();
  }
}

$("pick").addEventListener("click", () => fileInput.click());
$("pickSecondary").addEventListener("click", () => fileInput.click());
$("topPick").addEventListener("click", () => fileInput.click());
$("experience").addEventListener("click", () => $("drop").scrollIntoView({ behavior: "smooth", block: "center" }));
fileInput.addEventListener("change", () => {
  openFile(fileInput.files[0]);
  fileInput.value = "";
});
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("on"); });
drop.addEventListener("dragleave", () => drop.classList.remove("on"));
drop.addEventListener("drop", e => {
  e.preventDefault();
  drop.classList.remove("on");
  openFile(e.dataTransfer.files[0]);
});
$("themeBtn").addEventListener("click", () => IB.toggleTheme());
IB.applyTheme();
