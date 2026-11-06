/* Immersive Book reader engine. Plain JavaScript: no framework, no database, no imports.
   Exposes window.IB. The same file runs in the app and inside exported standalone books. */
(function (global) {
  "use strict";
  var doc = global.document;

  /* ---------- sound rules ---------- */
  var SCENES = {
    wind: { label: "Open air", sound: "Breeze and moving leaves", rules: [
      [/\b(breeze|wind|gusts?|howl(?:ed|ing)?|whistl(?:e|ed|ing))\b/g, 1],
      [/grass|leaves?|branches|trees? swaying|valley/g, 0.8]] },
    rain: { label: "Rainy surroundings", sound: "Gentle rain", rules: [
      [/\brain(ed|ing|s|y)?\b/g, 1], [/raindrops?|drizzle|downpour|patter(ed|ing)|droplets?/g, 1.5],
      [/(on|against) the (roof|window|glass|pane|leaves?)/g, 1], [/umbrella|puddles?|soaked|dripping/g, 0.8]] },
    storm: { label: "Stormy night", sound: "Heavy rain and wind", rules: [
      [/\bstorm\b/g, 1.2], [/thunder(ed|clap|ing)?|lightning/g, 1.5],
      [/howl(ed|ing)|gale|shutters rattled|rattled the shutters/g, 1]] },
    sea: { label: "Seaside", sound: "Ocean waves", rules: [
      [/\b(sea|ocean|surf|tide|shore|harbou?r|beach)\b/g, 1], [/\bwaves\b/g, 1.2], [/gulls?|salt air/g, 1]] },
    fire: { label: "By the fire", sound: "Crackling fire", rules: [
      [/\bhearth\b|campfire|fireplace|embers/g, 1.5], [/crackl(ed|es|ing)|flames?/g, 1], [/dry logs|\bfire\b/g, 0.8]] },
    forest: { label: "Forest", sound: "Wind through trees", rules: [
      [/forest|\bwoods\b|woodland|canopy/g, 1.3], [/birdsong|birds (were )?singing|\bbirds\b/g, 1.3],
      [/rustl(ed|ing)|brambles|branches/g, 0.7]] },
    night: { label: "Quiet night", sound: "Crickets", rules: [
      [/crickets?|cicadas?/g, 2.2], [/long grass|under the stars/g, 0.7]] },
    stream: { label: "Stream", sound: "Flowing water", rules: [
      [/\b(stream|brook|creek|river|waterfall|rapids)\b/g, 1.2], [/\b(trickl\w*|bubbl\w*|gurgl\w*)\b/g, 0.8]] }
    , indoor: { label: "Quiet interior", sound: "Room tone and wood", rules: [
      [/room|house|library|attic|basement|inside|indoors/g, 1], [/floorboards?|clock|window|kettle|paper|book/g, 0.8]] }
    , city: { label: "Distant city", sound: "Street and distant movement", rules: [
      [/city|street|market|station|traffic|crowd|train|car|restaurant/g, 1], [/horn|conversation|wheels?|engine/g, 0.8]] }
    , farm: { label: "Countryside", sound: "Farm and village ambience", rules: [
      [/farm|barn|stable|village|meadow|horse|cow|sheep|goat|rooster/g, 1], [/wagon|hay|tractor|chicks?/g, 0.8]] }
    , desert: { label: "Dry open land", sound: "Dry wind and sand", rules: [
      [/desert|sand|dunes?|dryland|oasis/g, 1.3], [/dust|camel|scorching|parched/g, 0.8]] }
  };
  var CUES = {
    thunder: { re: /thunder(ed|clap)?|crack of thunder|lightning flashed/g },
    door: { re: /(opened|creaked|pushed|swung) (open )?the (front |old |heavy )?door|door (opened|creaked|swung)|old door creaked/g },
    birds: { re: /birdsong|birds (were |began )?(singing|sang|chirping)|birds? chirp\w*/g },
    steps: { re: /footsteps?|footfalls?|hooves?|walking|ran across|running/g },
    water: { re: /splash(?:ed|ing)?|lapping|pour(?:ed|ing)?|drip(?:ped|ping)?|wading/g },
    crack: { re: /crackling|fireplace|campfire|logs? (?:popped|snapped)|embers?/g },
    animals: { re: /dog bark|wolf howl|owl hoot|frogs?|cicadas?|bees? buzz|horse neigh|cow moo/g }
  };
  var NEG = /\b(no|not|nor|never|without|neither|isn't|wasn't|didn't|don't|doesn't|aren't|weren't)\b/;
  var META = /(like|as if|as though|tears|rain check|heart could|a storm of|storm of|memory|metaphor)\W+(\w+\W+){0,3}$/i;
  var THRESH = 2;
  var SPREAD_MS = 6000;
  var LEVEL = [0.5, 0.8, 1.1];
  var DEFAULT_PREFS = { enabled: true, volume: 0.7, intensity: 1 };
  var BUDGET = 560;
  // Sound asset resolution order: embedded base64 (standalone export) -> local assets/ -> free-sound API -> synthesized fallback.
  // Populate FREE_SOUND_SOURCES with direct URLs to royalty-free WAV/MP3 files (e.g. Mixkit, Pixabay, Freesound CDN).
  var FREE_SOUND_SOURCES = {
    rain: [], wind: [], sea: [], fire: [], night: [], stream: []
  };

  /* ---------- storage (localStorage only) ---------- */
  function read(k) {
    try { var v = global.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function write(k, v) {
    try { global.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
  }
  var store = {
    progress: function (k) { var v = read("ib:progress:" + k); return v && typeof v.page === "number" ? v.page : 0; },
    saveProgress: function (k, page) { write("ib:progress:" + k, { page: page }); },
    marks: function (k) { var v = read("ib:marks:" + k); return Array.isArray(v) ? v : []; },
    saveMarks: function (k, list) { write("ib:marks:" + k, list); }
  };

  /* ---------- helpers ---------- */
  function fingerprint(title, text) {
    var s = title + "\u0001" + text, h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + "-" + s.length.toString(36);
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function byPage(a, b) { return a.page - b.page; }
  function pageText(p) { return p.blocks.map(function (b) { return b.h != null ? b.h : b.p; }).join("\n"); }
  function el(tag, props, kids) {
    var n = doc.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "className") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "value") n.value = v;
      else if (k.indexOf("on") === 0) n[k] = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
    });
    return n;
  }
  function downloadBlob(blob, name) {
    var url = global.URL.createObjectURL(blob), a = el("a", { href: url, download: name });
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
  }
  function reduceMotion() { return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function b64ToBuffer(base64) {
    var b64 = String(base64);
    if (b64.indexOf(",") >= 0) b64 = b64.split(",")[1];
    var bin = atob(b64), buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }

  /* ---------- theme ---------- */
  function applyTheme() {
    var t = read("ib:theme") === "night" ? "night" : "day";
    if (doc && doc.documentElement) doc.documentElement.setAttribute("data-theme", t);
  }
  function toggleTheme() {
    write("ib:theme", read("ib:theme") === "night" ? "day" : "night");
    applyTheme();
  }

  /* ---------- pagination ---------- */
  function paginate(source) {
    var pages = [], cur = [], len = 0, chapter = "";
    function flush() {
      if (!cur.length) return;
      var h = null;
      cur.forEach(function (b) { if (b.h) h = b.h; });
      if (h) chapter = h;
      pages.push({ chapter: chapter, blocks: cur });
      cur = []; len = 0;
    }
    source.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (par0) {
      if (par0.indexOf("## ") === 0) { flush(); cur.push({ h: par0.slice(3) }); len = 160; return; }
      var par = par0;
      while (par.length > 0) {
        var room = BUDGET - len;
        if (room < 200) { flush(); room = BUDGET; }
        if (par.length <= room) { cur.push({ p: par }); len += par.length + 40; par = ""; }
        else {
          var cut = par.lastIndexOf(". ", room);
          if (cut < 150) cut = par.lastIndexOf(" ", room);
          if (cut <= 0) cut = room;
          cur.push({ p: par.slice(0, cut + 1) });
          par = par.slice(cut + 1).trim();
          flush();
        }
      }
    });
    flush();
    return pages;
  }

  /* ---------- sound plan: analysed once per book, then played back ---------- */
  function sentencesOf(t) {
    var out = [], re = /[^.!?\n]+[.!?]*/g, m;
    while ((m = re.exec(t))) { var s = m[0].trim(); if (s) out.push({ text: s, at: m.index }); }
    return out;
  }
  function isFigurative(low, at, match) {
    var end = at + match.length;
    return META.test(low.slice(Math.max(0, at - 32), end)) || /^ of /.test(low.slice(end, end + 4));
  }
  function nearText(low, at) { return low.slice(Math.max(0, at - 30), at).split(/\s+/).slice(-4).join(" "); }
  function literalHit(low, re) {
    re.lastIndex = 0;
    var m = re.exec(low);
    re.lastIndex = 0;
    if (!m) return false;
    return !isFigurative(low, m.index, m[0]) && !NEG.test(nearText(low, m.index));
  }
  function score(text, rules) {
    var low = text.toLowerCase(), s = 0;
    rules.forEach(function (r) {
      var re = r[0], c = 0, m;
      re.lastIndex = 0;
      while (c < 3 && (m = re.exec(low))) {
        if (!isFigurative(low, m.index, m[0]) && !NEG.test(nearText(low, m.index))) c++;
      }
      re.lastIndex = 0;
      s += c * r[1];
    });
    return s;
  }
  function buildPlan(pageTexts) {
    var base = 0, state = null, quietRun = 0, lastFire = {};
    var sceneKeys = Object.keys(SCENES), cueKeys = Object.keys(CUES);
    var pages = pageTexts.map(function (text, i) {
      var start = base;
      base += text.length;
      var sc = {}, cues = [];
      sceneKeys.forEach(function (k) { sc[k] = 0; });
      sentencesOf(text).forEach(function (s) {
        var at = start + s.at, low = s.text.toLowerCase();
        sceneKeys.forEach(function (k) { sc[k] += score(s.text, SCENES[k].rules); });
        cueKeys.forEach(function (c) {
          if (cues.some(function (x) { return x.cue === c; })) return;   // one per type per page
          if (lastFire[c] !== undefined && i - lastFire[c] < 2) return;  // cooldown: two pages
          if (literalHit(low, CUES[c].re)) { cues.push({ cue: c, at: at }); lastFire[c] = i; }
        });
      });
      var stormy = sc.storm >= 2;
      if (stormy) sc.rain = Math.max(sc.rain, 3);
      var best = null, bs = 0;
      sceneKeys.forEach(function (k) { if (sc[k] > bs) { bs = sc[k]; best = k; } });
      if (bs >= THRESH) { state = best === "rain" && stormy ? "storm" : best; quietRun = 0; }
      else if (++quietRun >= 2) state = null;
      return { scene: state, stormy: stormy || state === "storm", cues: cues, start: start, length: text.length };
    });
    return { pages: pages };
  }
  function playbackFor(plan, ids) {
    var head = plan.pages[ids[0]], tail = plan.pages[ids[ids.length - 1]];
    var first = head.start, span = (tail.start + tail.length - first) || 1, events = [];
    ids.forEach(function (i) {
      plan.pages[i].cues.forEach(function (c) {
        events.push({ cue: c.cue, at: c.at, delayMs: 400 + ((c.at - first) / span) * SPREAD_MS });
      });
    });
    return { scene: head.scene, stormy: head.stormy, events: events };
  }

  /* ---------- Web Audio sound engine (synthesised, no audio files) ---------- */
  function loadPrefs() {
    var v = read("ib:sound");
    return Object.assign({}, DEFAULT_PREFS, v && typeof v === "object" ? v : {});
  }
  function SoundEngine(prefs) {
    this.prefs = prefs;
    this.ctx = null; this.master = null; this.noise = null;
    this.amb = null; this.ambKey = null; this.timers = []; this.fired = {};
    this.last = null; this.listeners = []; this.status = "Environment: quiet";
  }
  SoundEngine.prototype.subscribe = function (fn) {
    var self = this;
    this.listeners.push(fn);
    return function () { self.listeners = self.listeners.filter(function (f) { return f !== fn; }); };
  };
  SoundEngine.prototype.emit = function (s) {
    this.status = s;
    this.listeners.forEach(function (f) { f(); });
  };
  SoundEngine.prototype.level = function () {
    return this.prefs.enabled ? this.prefs.volume * LEVEL[this.prefs.intensity] : 0;
  };
  // Must run inside a user gesture (START READING); browsers block audio before that.
  SoundEngine.prototype.init = function () {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    var C = global.AudioContext || global.webkitAudioContext;
    if (!C) return;
    var ctx = new C(), master = ctx.createGain();
    master.gain.value = this.level();
    master.connect(ctx.destination);
    var noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; // texture only
    this.ctx = ctx; this.master = master; this.noise = noise;
  };
  SoundEngine.prototype.setPrefs = function (p) {
    this.prefs = Object.assign({}, p);
    write("ib:sound", this.prefs);
    if (this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.1);
    if (!this.prefs.enabled) { this.clearTimers(); this.setAmbience(null); this.emit("Intelligent sound is off"); }
    else if (this.last) this.play(this.last.pb, this.last.key);
  };
  SoundEngine.prototype.play = function (pb, bookKey) {
    var self = this;
    this.last = { pb: pb, key: bookKey };
    this.clearTimers();
    if (!this.prefs.enabled) { this.emit("Intelligent sound is off"); return; }
    if (!this.ctx) { this.emit("Environment: quiet · sound starts when you press START READING"); return; }
    var k = pb.scene ? (pb.stormy ? "storm" : pb.scene) : null;
    if (k !== this.ambKey) this.setAmbience(k);
    pb.events.forEach(function (e) {
      var id = bookKey + ":" + e.at + ":" + e.cue;
      if (self.fired[id]) return;
      self.timers.push(setTimeout(function () { self.fired[id] = true; self.one(e.cue); }, e.delayMs));
    });
    this.emit(k ? "Environment: " + SCENES[k].label + " · Playing: " + SCENES[k].sound : "Environment: quiet · no sound matched");
  };
  SoundEngine.prototype.stop = function () {
    this.clearTimers();
    this.last = null;
    this.setAmbience(null);
    this.emit("Sound stopped");
  };
  SoundEngine.prototype.clearTimers = function () {
    this.timers.forEach(function (t) { clearTimeout(t); });
    this.timers = [];
  };
  SoundEngine.prototype.resolveSoundAsset = function (name) {
    var assets = global.IB_SOUND_ASSETS || {};
    if (assets[name]) return assets[name];
    return "assets/" + name + ".wav";
  };
  SoundEngine.prototype.fetchSoundBuffer = function (url) {
    var self = this;
    return new Promise(function (res, rej) {
      try {
        if (String(url).indexOf("data:") === 0) {
          self.ctx.decodeAudioData(b64ToBuffer(url).buffer).then(res, rej);
        } else {
          fetch(url).then(function (r) {
            if (!r.ok) throw new Error("Asset not found: " + url);
            return r.arrayBuffer();
          }).then(function (ab) {
            self.ctx.decodeAudioData(ab).then(res, rej);
          }, rej);
        }
      } catch (e) { rej(e); }
    });
  };
  SoundEngine.prototype.loadAmbienceBuffer = function (k) {
    var self = this;
    var name = k === "storm" ? "rain" : k;
    var attempts = [];
    var assets = global.IB_SOUND_ASSETS || {};
    if (assets[name]) attempts.push(function () { return self.fetchSoundBuffer(assets[name]); });
    attempts.push(function () { return self.fetchSoundBuffer("assets/" + name + ".wav"); });
    (FREE_SOUND_SOURCES[name] || []).forEach(function (url) {
      attempts.push(function () { return self.fetchSoundBuffer(url); });
    });
    var i = 0;
    function next() {
      if (i >= attempts.length) return Promise.reject(new Error("no ambience asset for " + name));
      return attempts[i++]().catch(function () { return next(); });
    }
    return next();
  };
  SoundEngine.prototype.setAmbience = function (k) {
    var self = this;
    if (this.amb) this.fadeOut(this.amb);
    this.amb = null;
    this.ambKey = k;
    if (!k || !this.ctx) return;
    var ctx = this.ctx, gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    this.loadAmbienceBuffer(k).then(function (buf) {
      if (self.ambKey !== k) return;
      var node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = true;
      node.connect(gain);
      node.start(0);
      gain.gain.setTargetAtTime(self.level(), ctx.currentTime, 0.7);
      self.amb = { gain: gain, stops: [function () { node.stop(); node.disconnect(); }] };
      self.emit(k ? "Environment: " + SCENES[k].label + " · Playing: " + SCENES[k].sound : "Environment: quiet · no sound matched");
    }, function () {
      self.buildAmbience(k, gain, []);
      gain.gain.setTargetAtTime(self.level(), ctx.currentTime, 0.7);
      self.amb = { gain: gain, stops: [] };
    });
  };
  SoundEngine.prototype.fadeOut = function (a) {
    var ctx = this.ctx;
    a.gain.gain.cancelScheduledValues(ctx.currentTime);
    a.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(function () { a.stops.forEach(function (f) { f(); }); a.gain.disconnect(); }, 2600);
  };
  SoundEngine.prototype.src = function () {
    var s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start();
    return s;
  };
  SoundEngine.prototype.filter = function (type, f, q) {
    var n = this.ctx.createBiquadFilter();
    n.type = type; n.frequency.value = f;
    if (q) n.Q.value = q;
    return n;
  };
  SoundEngine.prototype.lfo = function (hz, depth, target) {
    var o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = hz; g.gain.value = depth;
    o.connect(g); g.connect(target); o.start();
    return o;
  };
  SoundEngine.prototype.buildAmbience = function (k, out, stops) {
    var self = this;
    function rain(v) {
      var n = self.src(), g = self.ctx.createGain();
      g.gain.value = v;
      n.connect(self.filter("highpass", 900)).connect(self.filter("lowpass", 6500)).connect(g).connect(out);
      stops.push(function () { n.stop(); });
    }
    function wind(v) {
      var n = self.src(), f = self.filter("lowpass", 450), g = self.ctx.createGain();
      g.gain.value = v;
      n.connect(f).connect(g).connect(out);
      var l = self.lfo(0.14, 220, f.frequency);
      stops.push(function () { n.stop(); l.stop(); });
    }
    if (k === "rain") rain(0.4);
    else if (k === "storm") { rain(0.7); wind(0.8); }
    else if (k === "wind" || k === "forest" || k === "desert") wind(k === "desert" ? 0.25 : 0.15);
    else if (k === "sea") {
      var n1 = this.src(), g1 = this.ctx.createGain();
      g1.gain.value = 0.45;
      n1.connect(this.filter("lowpass", 750)).connect(g1).connect(out);
      var l1 = this.lfo(0.1, 0.4, g1.gain);
      stops.push(function () { n1.stop(); l1.stop(); });
    } else if (k === "fire") {
      var n2 = this.src(), g2 = this.ctx.createGain();
      g2.gain.value = 0.12;
      n2.connect(this.filter("highpass", 1800)).connect(g2).connect(out);
      var l2 = this.lfo(3.1, 0.035, g2.gain);
      stops.push(function () { n2.stop(); l2.stop(); });
    } else if (k === "night") {
      var s = this.ctx.createOscillator(), g3 = this.ctx.createGain();
      s.frequency.value = 4300; g3.gain.value = 0.03;
      s.connect(g3).connect(out); s.start();
      var l3 = this.lfo(17, 0.03, g3.gain);
      stops.push(function () { s.stop(); l3.stop(); });
    } else if (k === "stream") {
      var n4 = this.src(), g4 = this.ctx.createGain();
      g4.gain.value = 0.3;
      n4.connect(this.filter("bandpass", 1100, 0.6)).connect(g4).connect(out);
      var l4 = this.lfo(0.7, 0.08, g4.gain);
      stops.push(function () { n4.stop(); l4.stop(); });
    }
  };
  SoundEngine.prototype.one = function (cue) {
    if (!this.ctx || !this.master || !this.prefs.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime, out = ctx.createGain();
    out.connect(this.master);
    var env, n, o, i, steps;
    if (cue === "thunder") {
      n = ctx.createBufferSource(); n.buffer = this.noise;
      env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.8, t + 0.4);
      env.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
      n.connect(this.filter("lowpass", 260)).connect(env).connect(out);
      n.start(t, 0); n.stop(t + 5);
    } else if (cue === "door") {
      o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(170, t);
      o.frequency.linearRampToValueAtTime(120, t + 0.7);
      env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.05, t + 0.15);
      env.gain.linearRampToValueAtTime(0, t + 0.8);
      o.connect(this.filter("bandpass", 900, 6)).connect(env).connect(out);
      o.start(t); o.stop(t + 0.9);
    } else if (cue === "birds" || cue === "animals") {
      this.chirp(ctx, out, t, 2600); this.chirp(ctx, out, t + 0.35, 3000); this.chirp(ctx, out, t + 0.8, 2400);
    } else if (cue === "steps") {
      steps = [[0, 0.13], [0.55, 0.1], [1.1, 0.13], [1.65, 0.1]];
      for (i = 0; i < steps.length; i++) {
        n = ctx.createBufferSource(); n.buffer = this.noise;
        env = ctx.createGain();
        env.gain.setValueAtTime(0, t + steps[i][0]);
        env.gain.linearRampToValueAtTime(steps[i][1], t + steps[i][0] + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, t + steps[i][0] + 0.12);
        n.connect(this.filter("lowpass", 500)).connect(env).connect(out);
        n.start(t + steps[i][0], 0); n.stop(t + steps[i][0] + 0.15);
      }
    } else if (cue === "water" || cue === "crack") {
      n = ctx.createBufferSource(); n.buffer = this.noise;
      env = ctx.createGain();
      env.gain.setValueAtTime(0.001, t);
      env.gain.exponentialRampToValueAtTime(cue === "water" ? 0.12 : 0.18, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t + (cue === "water" ? 0.65 : 0.28));
      n.connect(this.filter(cue === "water" ? "bandpass" : "highpass", cue === "water" ? 1200 : 1800, 0.8)).connect(env).connect(out);
      n.start(t); n.stop(t + 0.7);
    }
  };
  SoundEngine.prototype.chirp = function (ctx, out, t, f) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.25);
  };

  /* ---------- reader UI ---------- */
  function validMark(m, last) {
    return !!m && typeof m.id === "string" && typeof m.title === "string" &&
      typeof m.page === "number" && isFinite(m.page) && m.page >= 0 && m.page <= last;
  }
  var ZOOMS = [60, 75, 90, 100, 110, 125, 150, 175, 200];
  var TEXT_RATIO = 0.72; // page width / height for text books
  var TURN_MS = 800;

  function loadView() {
    var v = read("ib:view") || {};
    return {
      zoom: ZOOMS.indexOf(v.zoom) >= 0 ? v.zoom : 100,
      layout: ["auto", "single", "double"].indexOf(v.layout) >= 0 ? v.layout : "auto",
      fit: v.fit === "width" ? "width" : "page"
    };
  }

  function openReader(root, book, opts) {
    opts = opts || {};
    var hasPdf = Array.isArray(book.pdfPages) && book.pdfPages.length > 0;
    var pages = hasPdf
      ? book.pdfPages.map(function (p) {
        return { chapter: "", image: p.image, w: p.w, h: p.h, blocks: p.text ? [{ p: p.text }] : [] };
      })
      : paginate(book.text || "");
    if (!pages.length) pages = [{ chapter: "", blocks: [{ p: "This document has no readable text." }] }];
    var ratio = TEXT_RATIO;
    if (hasPdf && pages[0].w && pages[0].h) ratio = Math.max(0.45, Math.min(1.6, pages[0].w / pages[0].h));
    var plan = buildPlan(pages.map(pageText));
    var key = fingerprint(book.title, book.text || "");
    var last = Math.max(0, pages.length - 1);
    var engine = new SoundEngine(loadPrefs());
    var view = loadView();
    var st = { idx: 0, single: false, turn: null, panel: false, pop: null, marks: [], zoom: view.zoom, layout: view.layout, fit: view.fit };
    var els = {}, closed = true, unsubSound = null, touchX = null, hideTimer = null, ro = null, turnTimer = null;
    var viewRefresh = [];
    var handlers = {};

    function clampIdx(p) { return Math.max(0, Math.min(p | 0, last)); }
    function cur() { return st.single ? st.idx : st.idx - (st.idx % 2); }
    function saveMarks() { store.saveMarks(key, st.marks); }
    function saveView() { write("ib:view", { zoom: st.zoom, layout: st.layout, fit: st.fit }); }
    function fail(text) { global.alert(text); }
    function wantSingle() {
      if (st.layout === "single") return true;
      if (st.layout === "double") return false;
      return global.innerWidth < 820;
    }

    /* ----- intro ----- */
    function showIntro() {
      root.innerHTML = "";
      var saved = store.progress(key), resume = saved > 0 && saved <= last;
      var pct = Math.round(((saved + 1) / pages.length) * 100);
      root.appendChild(el("main", { className: "intro" }, [
        el("div", { className: "cover" }, [
          el("b", { text: book.title }),
          el("span", { text: String(book.kind || "").toUpperCase() + " · " + pages.length + (pages.length === 1 ? " page" : " pages") })
        ]),
        el("h1", { className: "intro-title", text: book.title }),
        el("p", { className: "muted", text: resume ? pct + "% read · page " + (saved + 1) + " of " + pages.length : "Not started yet" }),
        el("div", { className: "row center" }, [
          el("button", { className: "btn primary lg", type: "button", text: resume ? "Continue reading" : "Start reading",
            onclick: function () { start(resume ? saved : 0); } }),
          resume ? el("button", { className: "btn lg", type: "button", text: "Start over", onclick: function () { start(0); } }) : null
        ]),
        el("div", { className: "row center sub-actions" }, [
          opts.onExport ? el("button", { className: "btn sm", type: "button", text: "Download standalone file", onclick: opts.onExport }) : null,
          el("button", { className: "btn sm", type: "button", text: "Save reading data", onclick: saveData }),
          el("button", { className: "btn sm", type: "button", text: "Load reading data", onclick: loadDataPick }),
          opts.onBack ? el("button", { className: "btn sm", type: "button", text: "← Choose another file", onclick: opts.onBack }) : null
        ])
      ]));
    }

    /* ----- reading data: save, load, validate ----- */
    function saveData() {
      var data = { format: "immersive-book-data", version: 1, bookKey: key,
        progress: store.progress(key), marks: store.marks(key) };
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "reading-data-" + key + ".json");
    }
    function loadDataPick() {
      var input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
      input.onchange = function () {
        var f = input.files && input.files[0];
        input.remove();
        if (!f) return;
        f.text().then(importData, function () { fail("Could not read that file."); });
      };
      doc.body.appendChild(input);
      input.click();
    }
    function importData(text) {
      var d;
      try { d = JSON.parse(text); } catch (e) { return fail("That file is not valid reading data."); }
      if (!d || d.format !== "immersive-book-data") return fail("That file is not Immersive Book reading data.");
      if (d.bookKey !== key) return fail("This reading data belongs to a different book.");
      var p = Number(d.progress);
      if (isFinite(p) && p >= 0 && p <= last) store.saveProgress(key, Math.floor(p));
      if (Array.isArray(d.marks)) {
        var clean = d.marks.filter(function (m) { return validMark(m, last); }).map(function (m) {
          return { id: m.id.slice(0, 64), page: Math.floor(m.page), title: m.title.slice(0, 80),
            note: typeof m.note === "string" ? m.note.slice(0, 400) : "", createdAt: Number(m.createdAt) || Date.now() };
        });
        store.saveMarks(key, clean);
      }
      showIntro();
    }

    /* ----- reader lifecycle ----- */
    function start(page) {
      engine.init();
      closed = false;
      st.idx = clampIdx(page);
      st.single = wantSingle();
      st.panel = false;
      st.pop = null;
      st.turn = null;
      st.marks = store.marks(key).filter(function (m) { return validMark(m, last); }).sort(byPage);
      buildReader();
      unsubSound = engine.subscribe(function () { if (els.status) els.status.textContent = engine.status; });

      handlers.key = function (e) {
        if (closed) return;
        var t = e.target;
        if (t && t.closest && t.closest("input,textarea,select")) return;
        if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey && !(t && t.closest && t.closest("button")))) { e.preventDefault(); go(1); }
        else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) { e.preventDefault(); go(-1); }
        else if (e.key === "Home") jump(0);
        else if (e.key === "End") jump(last);
        else if (e.key === "Escape") {
          if (st.pop) { st.pop = null; updatePops(); }
          else if (st.panel) { st.panel = false; render(); }
          else if (!doc.fullscreenElement) closeReader();
        }
      };
      handlers.resize = function () { applyLayoutMode(); };
      handlers.down = function (e) {
        if (!st.pop) return;
        if (e.target.closest && e.target.closest(".popwrap")) return;
        st.pop = null; updatePops();
      };
      handlers.fs = updateFsBtn;
      doc.addEventListener("keydown", handlers.key);
      doc.addEventListener("pointerdown", handlers.down);
      doc.addEventListener("fullscreenchange", handlers.fs);
      global.addEventListener("resize", handlers.resize);
      if (global.ResizeObserver) { ro = new global.ResizeObserver(function () { layoutBook(); }); ro.observe(els.stage); }
      render();
      layoutBook();
    }
    function teardown() {
      closed = true;
      engine.stop();
      clearTimeout(turnTimer);
      if (ro) { ro.disconnect(); ro = null; }
      if (unsubSound) unsubSound();
      doc.removeEventListener("keydown", handlers.key);
      doc.removeEventListener("pointerdown", handlers.down);
      doc.removeEventListener("fullscreenchange", handlers.fs);
      global.removeEventListener("resize", handlers.resize);
      unsubSound = null;
      if (doc.fullscreenElement && doc.exitFullscreen) { try { doc.exitFullscreen(); } catch (e) { /* ignore */ } }
    }
    function closeReader() {
      try { teardown(); } catch (e) { /* ignore */ }
      showIntro();
    }
    function updateFsBtn() {
      if (els.fullscreen) els.fullscreen.textContent = doc.fullscreenElement ? "Exit full screen" : "Full screen";
    }
    function applyLayoutMode() {
      if (closed) return;
      var s = wantSingle();
      if (s !== st.single) { st.single = s; st.turn = null; render(); }
      layoutBook();
    }

    /* ----- sound ----- */
    function setSound(p) {
      engine.setPrefs(Object.assign({}, engine.prefs, p));
      if (!els.enBtn) return;
      els.enBtn.textContent = engine.prefs.enabled ? "On" : "Off";
      els.enBtn.setAttribute("aria-pressed", String(engine.prefs.enabled));
      if (els.soundBtn) els.soundBtn.setAttribute("data-on", String(engine.prefs.enabled));
    }
    function option(v, label) { return el("option", { value: v, text: label }); }

    /* ----- view controls ----- */
    function refreshView() {
      viewRefresh.forEach(function (f) { f(); });
      layoutBook();
    }
    function seg(label, choices, get, set) {
      var group = el("div", { className: "seg", role: "group", "aria-label": label });
      var btns = choices.map(function (c) {
        var b = el("button", { className: "btn sm", type: "button", text: c[1], onclick: function () { set(c[0]); refreshView(); } });
        b._v = c[0];
        group.appendChild(b);
        return b;
      });
      viewRefresh.push(function () {
        btns.forEach(function (b) { b.setAttribute("aria-pressed", String(get() === b._v)); });
      });
      return el("div", { className: "ctl" }, [el("span", { className: "lbl", text: label }), group]);
    }
    function setZoom(z) {
      st.zoom = z; saveView();
      if (els.zoomLbl) els.zoomLbl.textContent = z + "%";
    }
    function stepZoom(d) {
      var i = ZOOMS.indexOf(st.zoom);
      if (i < 0) i = ZOOMS.indexOf(100);
      setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + d))]);
      layoutBook();
    }
    function updatePops() {
      ["sound", "view"].forEach(function (n) {
        var open = st.pop === n;
        els["pop_" + n].hidden = !open;
        els["btn_" + n].setAttribute("aria-expanded", String(open));
      });
    }
    function togglePop(n) { st.pop = st.pop === n ? null : n; updatePops(); }
    function popWrap(name, label, content) {
      var btn = el("button", { className: "btn", type: "button", text: label, "aria-haspopup": "true", "aria-expanded": "false",
        onclick: function () { togglePop(name); } });
      var pop = el("div", { className: "pop", hidden: true }, content);
      els["btn_" + name] = btn; els["pop_" + name] = pop;
      return el("div", { className: "popwrap" }, [btn, pop]);
    }

    function buildReader() {
      root.innerHTML = "";
      viewRefresh = [];
      els = {};
      els.book = el("div", { className: "book" });
      els.panel = el("aside", { className: "marks", "aria-label": "Bookmarks", hidden: true });
      els.pos = el("span", { className: "poslbl", "aria-live": "polite" });
      els.prev = el("button", { className: "btn", type: "button", text: "‹ Previous", onclick: function () { go(-1); } });
      els.next = el("button", { className: "btn", type: "button", text: "Next ›", onclick: function () { go(1); } });
      els.edgePrev = el("button", { className: "navbtn left", type: "button", "aria-label": "Previous page", text: "‹", onclick: function () { go(-1); } });
      els.edgeNext = el("button", { className: "navbtn right", type: "button", "aria-label": "Next page", text: "›", onclick: function () { go(1); } });
      els.mark = el("button", { className: "btn", type: "button", onclick: toggleMark });
      els.marksBtn = el("button", { className: "btn", type: "button", onclick: function () { st.panel = !st.panel; st.pop = null; updatePops(); render(); } });
      els.fullscreen = el("button", { className: "btn fsbtn", type: "button", text: "Full screen", onclick: function () {
        if (doc.fullscreenElement) { if (doc.exitFullscreen) doc.exitFullscreen(); }
        else if (root.requestFullscreen) root.requestFullscreen();
      } });
      if (!root.requestFullscreen) els.fullscreen.hidden = true;
      els.slider = el("input", { type: "range", className: "pager", min: "1", max: String(pages.length), step: "1", value: "1", "aria-label": "Go to page" });
      els.slider.oninput = function () { els.pos.textContent = "Page " + els.slider.value + " of " + pages.length; };
      els.slider.onchange = function () { jump(Number(els.slider.value) - 1); };

      /* sound popover */
      els.enBtn = el("button", { className: "btn sm", type: "button", onclick: function () { setSound({ enabled: !engine.prefs.enabled }); } });
      els.vol = el("input", { type: "range", min: "0", max: "1", step: "0.05", "aria-label": "Master volume",
        oninput: function () { setSound({ volume: Number(els.vol.value) }); } });
      els.vol.value = String(engine.prefs.volume);
      els.level = el("select", { "aria-label": "Sound intensity", onchange: function () { setSound({ intensity: Number(els.level.value) }); } },
        [option("0", "Subtle"), option("1", "Balanced"), option("2", "Immersive")]);
      els.level.value = String(engine.prefs.intensity);
      els.status = el("p", { className: "status", "aria-live": "polite", text: engine.status });
      var soundContent = [
        el("div", { className: "ctl" }, [el("span", { className: "lbl", text: "Intelligent sound" }), els.enBtn]),
        el("div", { className: "ctl" }, [el("span", { className: "lbl", text: "Volume" }), els.vol]),
        el("div", { className: "ctl" }, [el("span", { className: "lbl", text: "Intensity" }), els.level]),
        el("div", { className: "ctl" }, [el("span", { className: "lbl", text: "Playback" }),
          el("button", { className: "btn sm", type: "button", text: "Stop sound", onclick: function () { engine.stop(); } })]),
        els.status
      ];

      /* view popover */
      els.zoomLbl = el("span", { className: "zoomlbl", text: st.zoom + "%" });
      var viewContent = [
        el("div", { className: "ctl" }, [el("span", { className: "lbl", text: "Zoom" }),
          el("div", { className: "seg" }, [
            el("button", { className: "btn sm", type: "button", "aria-label": "Zoom out", text: "−", onclick: function () { stepZoom(-1); } }),
            els.zoomLbl,
            el("button", { className: "btn sm", type: "button", "aria-label": "Zoom in", text: "+", onclick: function () { stepZoom(1); } }),
            el("button", { className: "btn sm", type: "button", text: "Reset", onclick: function () { setZoom(100); layoutBook(); } })
          ])]),
        seg("Pages", [["auto", "Auto"], ["single", "Single"], ["double", "Spread"]],
          function () { return st.layout; }, function (v) { st.layout = v; saveView(); applyLayoutMode(); }),
        seg("Fit", [["page", "Whole page"], ["width", "Page width"]],
          function () { return st.fit; }, function (v) { st.fit = v; saveView(); }),
        seg("Theme", [["day", "Day"], ["night", "Night"]],
          function () { return read("ib:theme") === "night" ? "night" : "day"; },
          function (v) { if ((read("ib:theme") === "night" ? "night" : "day") !== v) toggleTheme(); })
      ];

      els.soundWrap = popWrap("sound", "Sound", soundContent);
      els.soundBtn = els.btn_sound;
      var viewWrap = popWrap("view", "View", viewContent);

      els.stage = el("div", { className: "stage" }, [els.book]);
      els.stage.addEventListener("click", onStageClick);
      els.stage.addEventListener("touchstart", function (e) { touchX = e.touches[0].clientX; }, { passive: true });
      els.stage.addEventListener("touchend", function (e) {
        if (touchX === null) return;
        var d = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(d) > 60) go(d < 0 ? 1 : -1);
      }, { passive: true });

      root.appendChild(el("div", { className: "reader" }, [
        el("header", { className: "rbar" }, [
          el("button", { className: "btn", type: "button", text: "← Close", onclick: closeReader }),
          el("div", { className: "t", title: book.title, text: book.title }),
          el("div", { className: "row actions" }, [els.mark, els.marksBtn, els.soundWrap, viewWrap, els.fullscreen])
        ]),
        el("div", { className: "stagewrap" }, [els.stage, els.edgePrev, els.edgeNext, els.panel]),
        el("footer", { className: "rfoot" }, [els.prev, el("div", { className: "pagerwrap" }, [els.slider, els.pos]), els.next])
      ]));

      setSound({});
      refreshView();
      updatePops();
    }

    /* ----- layout: size the book to the stage so nothing is ever clipped ----- */
    function layoutBook() {
      if (closed || !els.stage || !els.book) return;
      var cw = els.stage.clientWidth, chh = els.stage.clientHeight;
      if (!cw || !chh) return;
      var padX = cw < 600 ? 10 : 64, padY = cw < 600 ? 10 : 24;
      els.stage.style.padding = padY + "px " + padX + "px";
      var aw = Math.max(140, cw - padX * 2), ah = Math.max(180, chh - padY * 2);
      var cols = st.single ? 1 : 2;
      var h = st.fit === "width" ? aw / (cols * ratio) : Math.min(ah, aw / (cols * ratio));
      h = Math.max(200, h * st.zoom / 100);
      var w = h * ratio;
      els.book.style.width = Math.round(w * cols) + "px";
      els.book.style.height = Math.round(h) + "px";
      els.book.style.fontSize = Math.max(10, w * 0.042).toFixed(2) + "px";
    }

    /* ----- pages ----- */
    function pageNode(i) {
      var page = pages[i];
      if (!page || i < 0) return el("div", { className: "pg blank" });
      var kids = [];
      if (page.image) {
        kids.push(el("img", { className: "pdf-page-image", src: page.image, alt: "Page " + (i + 1), decoding: "async", draggable: "false" }));
      } else {
        page.blocks.forEach(function (b) { kids.push(b.h != null ? el("h3", { text: b.h }) : el("p", { text: b.p })); });
        kids.push(el("span", { className: "n", text: String(i + 1) }));
      }
      return el("div", { className: "pg" + (page.image ? " pdf-page" : "") }, kids);
    }
    function drawBook(left, right) {
      els.book.textContent = "";
      els.book.appendChild(pageNode(left));
      if (!st.single) els.book.appendChild(pageNode(right));
    }
    function marked(c) { return st.marks.some(function (m) { return m.page === c; }); }

    function render(anim) {
      if (closed) return;
      var c = cur(), step = st.single ? 1 : 2;
      els.book.className = "book" + (st.single ? " single" : "") + (anim ? " anim-" + anim : "");
      drawBook(c, c + 1);
      var shown = st.single ? c + 1 : Math.min(c + 2, pages.length), ch = pages[c] && pages[c].chapter;
      els.pos.textContent = "Page " + (c + 1) + (st.single || shown === c + 1 ? "" : "–" + shown) + " of " + pages.length + (ch ? " · " + ch : "");
      els.slider.value = String(c + 1);
      els.prev.disabled = c === 0;
      els.next.disabled = c + step > last;
      els.edgePrev.hidden = c === 0;
      els.edgeNext.hidden = c + step > last;
      var isMarked = marked(c);
      els.mark.textContent = isMarked ? "Bookmarked ✓" : "Bookmark";
      els.mark.setAttribute("aria-pressed", String(isMarked));
      els.marksBtn.textContent = "Bookmarks (" + st.marks.length + ")";
      els.marksBtn.setAttribute("aria-expanded", String(st.panel));
      els.panel.hidden = !st.panel;
      if (st.panel) renderPanel();
      store.saveProgress(key, c);
      var ids = st.single || !pages[c + 1] ? [c] : [c, c + 1];
      if (plan.pages[c]) engine.play(playbackFor(plan, ids), key);
    }

    function go(dir) {
      if (closed || st.turn) return;
      var c = cur(), step = st.single ? 1 : 2, n = c + dir * step;
      if (n < 0 || n > last) return;
      jump(n, dir);
    }

    function jump(n, dir) {
      if (closed || st.turn) return;
      n = clampIdx(n);
      var target = st.single ? n : n - (n % 2), c = cur();
      if (target === c) return;
      dir = dir || (target > c ? 1 : -1);
      var adjacent = Math.abs(target - c) === (st.single ? 1 : 2);
      if (reduceMotion() || !adjacent) { st.idx = target; render(); return; }
      if (st.single) { st.idx = target; render(dir > 0 ? "next" : "prev"); return; }

      /* two-page spread: draw the pages that will be revealed underneath, then flip one leaf over them */
      st.turn = dir > 0 ? "next" : "prev";
      els.book.className = "book";
      els.stage.style.overflow = "hidden"; // the flipping leaf swings past the book edge: no scrollbar flicker
      els.prev.disabled = els.next.disabled = true;
      var lf = el("div", { className: "lf" });
      if (dir > 0) {
        drawBook(c, c + 3);
        lf.style.left = "50%"; lf.style.transformOrigin = "left center";
        lf.appendChild(pageNode(c + 1));
        lf.appendChild(pageNode(c + 2));
      } else {
        drawBook(c - 2, c + 1);
        lf.style.left = "0"; lf.style.transformOrigin = "right center";
        lf.appendChild(pageNode(c));
        lf.appendChild(pageNode(c - 1));
      }
      els.book.appendChild(lf);
      lf.getBoundingClientRect(); // commit start state before animating
      lf.style.transform = "rotateY(" + (dir > 0 ? -180 : 180) + "deg)";
      turnTimer = setTimeout(function () {
        if (closed) return;
        st.idx = target; st.turn = null;
        els.stage.style.overflow = "";
        render();
      }, TURN_MS + 30);
    }

    function onStageClick(e) {
      if (closed || !e.target.closest(".pg")) return;
      var sel = global.getSelection && global.getSelection();
      if (sel && String(sel).length) return; // user is selecting text
      var b = els.book.getBoundingClientRect();
      if (!b.width) return;
      var x = (e.clientX - b.left) / b.width;
      if (st.single) { if (x > 0.66) go(1); else if (x < 0.34) go(-1); }
      else if (x > 0.85) go(1);
      else if (x < 0.15) go(-1);
    }

    /* ----- bookmarks ----- */
    function toggleMark() {
      var c = cur();
      if (marked(c)) st.marks = st.marks.filter(function (m) { return m.page !== c; });
      else {
        var ch = pages[c] && pages[c].chapter;
        st.marks.push({ id: newId(), page: c, title: "Page " + (c + 1) + (ch ? " – " + ch : ""), note: "", createdAt: Date.now() });
        st.marks.sort(byPage);
      }
      saveMarks();
      render();
    }

    function renderPanel() {
      els.panel.textContent = "";
      els.panel.appendChild(el("div", { className: "panelhead" }, [
        el("h3", { text: "Bookmarks" }),
        el("button", { className: "btn sm", type: "button", text: "Close", onclick: function () { st.panel = false; render(); } })
      ]));
      if (!st.marks.length) els.panel.appendChild(el("p", { className: "muted", text: "No bookmarks yet. Use “Bookmark” in the top bar to save your place." }));
      st.marks.forEach(function (m) {
        var title = el("input", { "aria-label": "Bookmark title", maxlength: "80", value: m.title });
        var note = el("textarea", { "aria-label": "Bookmark note", rows: "2", maxlength: "400", placeholder: "Add a note" });
        note.value = m.note || "";
        title.onchange = function () { m.title = title.value.slice(0, 80); saveMarks(); };
        note.onchange = function () { m.note = note.value.slice(0, 400); saveMarks(); };
        els.panel.appendChild(el("div", { className: "mark" }, [
          title,
          el("small", { text: "Page " + (m.page + 1) + " · " + new Date(m.createdAt).toLocaleDateString() }),
          note,
          el("div", { className: "row" }, [
            el("button", { className: "btn sm", type: "button", text: "Open", onclick: function () {
              st.panel = false; st.idx = m.page; render(); } }),
            el("button", { className: "btn sm", type: "button", text: "Delete", onclick: function () {
              st.marks = st.marks.filter(function (x) { return x !== m; }); saveMarks(); render(); } })
          ])
        ]));
      });
    }

    applyTheme();
    showIntro();
  }


  global.IB = {
    paginate: paginate,
    buildPlan: buildPlan,
    playbackFor: playbackFor,
    SoundEngine: SoundEngine,
    fingerprint: fingerprint,
    openReader: openReader,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme
  };
})(window);
