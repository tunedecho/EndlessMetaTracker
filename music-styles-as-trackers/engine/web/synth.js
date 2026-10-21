/**
 * Synth playground: pick an instrument from a song or style, change its
 * parameters with controls built from the format's schema, play it live, and
 * copy the JSON back out. Audio runs in synth-worklet.js on the same Player
 * and voices as the renderer.
 */
import { toName } from '../../format/lib/core.js';
import { EXAMPLES, STYLES } from './catalog.js';
import { deref as derefIn, scaleFor } from './params.js';

const $ = (id) => document.getElementById(id);
const KEYBOARD_VOICES = 8;
// Tracker keyboard layout: two rows, an octave and a bit each.
const KEYMAP = Object.fromEntries([...'zsxdcvgbhnjm,'].map((k, i) => [k, i]).concat([...'q2w3er5t6y7ui'].map((k, i) => [k, i + 12])));
const KEY_LABEL = Object.fromEntries(Object.entries(KEYMAP).map(([k, i]) => [i, k.toUpperCase()]));
const WHITE = [0, 2, 4, 5, 7, 9, 11];

let defs = null;
let data = null, original = null, sourceName = '', instId = null;
let audio = null, node = null, analyser = null, ready = null;
let octave = 3, lastNote = 48;
const held = new Map(); // note -> keyboard voice
let monoStack = [], nextVoice = 0;

const status = (t) => { $('status').textContent = t; };
const clone = (v) => JSON.parse(JSON.stringify(v));
const sound = () => data.sound;
const cur = () => sound().instruments[instId];
const post = (m) => { if (node) node.port.postMessage(m); };

/* ------------------------------------------------------------- formatting */

/** One line per top-level key, nested values inline, like the files in styles/. */
function compact(v) {
  if (Array.isArray(v)) return `[${v.map(compact).join(', ')}]`;
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${compact(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}
const format = (inst) => `{\n${Object.entries(inst).map(([k, v]) => `  ${JSON.stringify(k)}: ${compact(v)}`).join(',\n')}\n}`;

/* ----------------------------------------------------------- paths */

function getAt(path) {
  let o = cur();
  for (const k of path) { if (o == null) return undefined; o = o[k]; }
  return o;
}

/** Set a value by path; undefined removes it and prunes objects left empty. */
function setAt(path, value) {
  const chain = [cur()];
  for (const k of path.slice(0, -1)) {
    const o = chain.at(-1);
    if (o[k] == null || typeof o[k] !== 'object') { if (value === undefined) return; o[k] = {}; }
    chain.push(o[k]);
  }
  const last = path.at(-1);
  if (value === undefined) delete chain.at(-1)[last];
  else chain.at(-1)[last] = value;
  for (let i = chain.length - 1; i > 0; i--) if (!Object.keys(chain[i]).length) delete chain[i - 1][path[i - 1]];
}

/* ----------------------------------------------------------- controls */

const deref = (raw) => derefIn(defs, raw);


function row(container, key, title) {
  const r = document.createElement('div');
  r.className = 'row';
  r.title = title || '';
  const l = document.createElement('label');
  l.textContent = key;
  r.appendChild(l);
  container.appendChild(r);
  return r;
}

function clearButton(r, onClear) {
  const b = document.createElement('button');
  b.className = 'clear';
  b.textContent = '×';
  b.title = 'unset: use the engine default';
  b.onclick = onClear;
  r.appendChild(b);
}

function choiceControl(container, key, options, path, title, onSet = (v) => { setAt(path, v); changed(); }) {
  const r = row(container, key, title);
  const s = document.createElement('select');
  s.add(new Option('(default)', ''));
  for (const o of options) s.add(new Option(String(o), JSON.stringify(o)));
  const sync = () => { const v = getAt(path); s.value = v === undefined ? '' : JSON.stringify(v); r.classList.toggle('unset', v === undefined); };
  s.onchange = () => { onSet(s.value === '' ? undefined : JSON.parse(s.value)); sync(); };
  r.appendChild(s);
  clearButton(r, () => { onSet(undefined); sync(); });
  sync();
}

function numberControl(container, key, node, ref, path) {
  const sc = scaleFor(node, ref, key);
  const r = row(container, key, node.description);
  const slider = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1000, step: 1 });
  const box = Object.assign(document.createElement('input'), { type: 'number', step: 'any', placeholder: String(sc.rest) });
  const sync = () => {
    const v = getAt(path);
    r.classList.toggle('unset', v === undefined);
    slider.value = Math.round(Math.min(1, Math.max(0, sc.to(Math.min(sc.max, v ?? sc.rest)))) * 1000);
    if (document.activeElement !== box) box.value = v === undefined ? '' : v;
  };
  const set = (v) => {
    if (v !== undefined) v = Math.min(sc.hardMax, Math.max(sc.hardMin, sc.round(v)));
    if (v !== undefined && node.exclusiveMinimum !== undefined && v <= node.exclusiveMinimum) return;
    setAt(path, v);
    changed();
    sync();
  };
  slider.oninput = () => set(sc.from(slider.value / 1000));
  box.onchange = () => set(box.value === '' ? undefined : Number(box.value));
  slider.ondblclick = () => set(undefined);
  r.append(slider, box);
  clearButton(r, () => set(undefined));
  sync();
}

function fields(container, schemaNode, path) {
  for (const [key, raw] of Object.entries(schemaNode.properties || {})) {
    const { node, ref } = deref(raw);
    const p = [...path, key];
    if (node.type === 'object' && node.properties) {
      const fs = document.createElement('fieldset');
      fs.innerHTML = `<legend>${key}</legend>`;
      if (node.description) fs.title = node.description;
      container.appendChild(fs);
      fields(fs, node, p);
    } else if (node.enum) choiceControl(container, key, node.enum, p, node.description);
    else if (node.type === 'boolean') choiceControl(container, key, [true, false], p, node.description);
    else if (node.type === 'number' || node.type === 'integer') numberControl(container, key, node, ref, p);
  }
}

function group(title, schemaNode, path) {
  const fs = document.createElement('fieldset');
  fs.innerHTML = `<legend>${title}</legend>`;
  if (schemaNode?.description) fs.title = schemaNode.description;
  $('params').appendChild(fs);
  if (schemaNode) fields(fs, schemaNode, path);
  return fs;
}

function build() {
  $('params').innerHTML = '';
  const inst = cur();
  const props = defs.instrument.properties;
  const head = group('instrument', null, []);
  const r = row(head, 'engine', 'Which synth engine plays this instrument. Changing it clears the engine parameters.');
  const s = document.createElement('select');
  for (const e of props.engine.enum) s.add(new Option(e, e));
  s.value = inst.engine;
  s.style.gridColumn = '2 / 4';
  s.onchange = () => { inst.engine = s.value; delete inst.params; changed(); build(); };
  r.appendChild(s);
  numberControl(head, 'transpose', props.transpose, null, ['transpose']);
  const tables = Object.keys(sound().tables || {});
  if (tables.length || inst.table) choiceControl(head, 'table', tables, ['table'], props.table.description);
  group(`${inst.engine} params`, defs[`params.${inst.engine}`], ['params']);
  group('amp envelope', deref(props.amp).node, ['amp']);
  group('filter', props.filter, ['filter']);
  group('lfo', props.lfo, ['lfo']);
  group('mix', props.mix, ['mix']);
  showJson();
}

function showJson() {
  if (document.activeElement === $('json')) return;
  $('json').value = format(cur());
  $('json').classList.remove('bad');
}

function changed() {
  showJson();
  post({ type: 'update', id: instId, inst: cur() });
}

/* ----------------------------------------------------------- audio */

function playSound() {
  const s = sound();
  const master = $('fx').checked ? s.master || {} : { volume: s.master?.volume ?? 0.8, limiter: true };
  return { instruments: s.instruments, tables: s.tables || {}, master };
}

function bpm() {
  const b = data.transport?.bpm ?? 120;
  return Array.isArray(b) ? (b[0] + b[1]) / 2 : b;
}

function load() {
  held.clear(); monoStack = [];
  for (const k of $('keys').children) k.classList.remove('down');
  post({ type: 'load', sound: playSound(), bpm: bpm(), stepsPerBeat: data.transport?.stepsPerBeat || 4 });
  sendRepeat();
}

function startAudio() {
  ready ||= (async () => {
    audio = new AudioContext({ latencyHint: 'interactive' });
    await audio.audioWorklet.addModule(new URL('./synth-worklet.js', import.meta.url));
    node = new AudioWorkletNode(audio, 'synth', { numberOfInputs: 0, outputChannelCount: [2] });
    analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    node.connect(analyser).connect(audio.destination);
    load();
    drawScope();
  })().catch((e) => { status(`audio failed: ${e.message}`); console.error(e); ready = null; throw e; });
  if (audio?.state === 'suspended') audio.resume();
  return ready;
}

function drawScope() {
  const c = $('scope'), ctx = c.getContext('2d');
  const buf = new Float32Array(analyser.fftSize);
  const frame = () => {
    analyser.getFloatTimeDomainData(buf);
    ctx.fillStyle = '#16181d'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#262a33'; ctx.beginPath(); ctx.moveTo(0, c.height / 2); ctx.lineTo(c.width, c.height / 2); ctx.stroke();
    // Start at a rising zero crossing so a steady tone stands still.
    let s = 0;
    for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { s = i; break; }
    const n = buf.length / 2;
    ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / n) * c.width, y = c.height / 2 - buf[s + i] * c.height * 0.45;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(frame);
  };
  frame();
}

/* ----------------------------------------------------------- playing */

const base = () => (octave + 1) * 12;
const vel = () => parseFloat($('vel').value);
const keyEl = (note) => $('keys').querySelector(`[data-o="${note - base()}"]`);

async function press(note) {
  if (held.has(note) || monoStack.includes(note)) return;
  lastNote = note;
  keyEl(note)?.classList.add('down');
  if ($('mono').checked) monoStack.push(note);
  else {
    const used = new Set(held.values());
    let v = nextVoice;
    for (let i = 0; i < KEYBOARD_VOICES; i++) { const c = (nextVoice + i) % KEYBOARD_VOICES; if (!used.has(c)) { v = c; break; } }
    held.set(note, v);
    nextVoice = (v + 1) % KEYBOARD_VOICES;
  }
  status(`${instId} · ${toName(note)}`);
  await startAudio();
  if ($('mono').checked) post({ type: 'on', voice: 0, id: instId, note, vel: vel() });
  else post({ type: 'on', voice: held.get(note), id: instId, note, vel: vel() });
  sendRepeat();
}

async function release(note) {
  keyEl(note)?.classList.remove('down');
  if (monoStack.includes(note)) {
    const top = monoStack.at(-1);
    monoStack = monoStack.filter((n) => n !== note);
    await ready;
    if (note !== top) return;
    if (monoStack.length) post({ type: 'on', voice: 0, id: instId, note: monoStack.at(-1), vel: vel() });
    else post({ type: 'off', voice: 0 });
    return;
  }
  const v = held.get(note);
  if (v === undefined) return;
  held.delete(note);
  await ready;
  post({ type: 'off', voice: v });
}

function releaseAll() {
  for (const n of [...held.keys(), ...monoStack]) release(n);
}

function sendRepeat() {
  const every = parseInt($('repeat').value, 10);
  post({ type: 'repeat', id: instId, note: lastNote, every, gate: 0.5 });
}

function buildKeys() {
  const k = $('keys');
  k.innerHTML = '';
  let x = 0;
  for (let o = 0; o <= 24; o++) {
    const pc = o % 12;
    const d = document.createElement('div');
    d.dataset.o = o;
    if (WHITE.includes(pc)) {
      d.className = 'w';
      d.style.left = `${x * 26}px`;
      d.textContent = pc === 0 ? toName(base() + o) : KEY_LABEL[o] || '';
      if (pc === 0 && KEY_LABEL[o]) d.textContent += ` ${KEY_LABEL[o]}`;
      x++;
    } else {
      d.className = 'b';
      d.style.left = `${x * 26 - 9}px`;
      d.textContent = KEY_LABEL[o] || '';
    }
    k.appendChild(d);
  }
  k.style.width = `${x * 26}px`;
  $('oct').textContent = octave;
}

let pointerNote = null;
const noteAt = (x, y) => { const el = document.elementFromPoint(x, y); return el?.parentElement === $('keys') ? base() + parseInt(el.dataset.o, 10) : null; };
$('keys').onpointerdown = (e) => { const n = noteAt(e.clientX, e.clientY); if (n === null) return; $('keys').setPointerCapture(e.pointerId); pointerNote = n; press(n); };
$('keys').onpointermove = (e) => {
  if (pointerNote === null) return;
  const n = noteAt(e.clientX, e.clientY);
  if (n !== null && n !== pointerNote) { release(pointerNote); pointerNote = n; press(n); }
};
$('keys').onpointerup = $('keys').onpointercancel = () => { if (pointerNote !== null) release(pointerNote); pointerNote = null; };

const keysDown = new Map(); // KeyboardEvent.code -> note
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
window.addEventListener('keydown', (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const o = KEYMAP[e.key.toLowerCase()];
  if (o !== undefined) { e.preventDefault(); keysDown.set(e.code, base() + o); press(base() + o); }
});
window.addEventListener('keyup', (e) => {
  // The note the key started, so an octave change while it is down still releases it.
  const n = keysDown.get(e.code);
  if (n === undefined) return;
  keysDown.delete(e.code);
  release(n);
});
window.addEventListener('blur', releaseAll);

function setOctave(o) { releaseAll(); octave = Math.max(0, Math.min(7, o)); buildKeys(); }
$('octDown').onclick = () => setOctave(octave - 1);
$('octUp').onclick = () => setOctave(octave + 1);
$('mono').onchange = releaseAll;
$('repeat').onchange = async () => { if ($('repeat').value !== '0') await startAudio(); sendRepeat(); };
$('panic').onclick = () => { $('repeat').value = '0'; held.clear(); monoStack = []; load(); };
$('fx').onchange = load;

/* ----------------------------------------------------------- sources */

function setHash() {
  history.replaceState(null, '', `#src=${encodeURIComponent($('source').value)}&inst=${encodeURIComponent(instId)}`);
}

function selectInstrument(id) {
  releaseAll();
  instId = id;
  $('inst').value = id;
  $('mono').checked = (cur().params?.glide || 0) > 0;
  build();
  sendRepeat();
  setHash();
  status(`${id} · ${cur().engine}${cur().name ? ` · ${cur().name}` : ''}`);
}

function setSource(json, name, want) {
  if (!json.sound?.instruments) { status(`${name}: no instruments`); return; }
  releaseAll();
  data = json; original = clone(json); sourceName = name;
  $('inst').innerHTML = '';
  for (const [id, inst] of Object.entries(sound().instruments)) $('inst').add(new Option(`${id} · ${inst.engine}${inst.name ? ` · ${inst.name}` : ''}`, id));
  load();
  selectInstrument(want && sound().instruments[want] ? want : Object.keys(sound().instruments)[0]);
  status(`${json.meta?.title || name} · ${Object.keys(sound().instruments).length} instruments · ${bpm()} bpm`);
}

async function loadUrl(url, want) {
  status('loading…');
  const res = await fetch(url);
  if (!res.ok) { status(`could not load ${url}`); return; }
  setSource(await res.json(), url.split('/').pop(), want);
}

$('source').onchange = () => loadUrl($('source').value);
$('inst').onchange = () => selectInstrument($('inst').value);
$('file').onchange = async () => {
  const f = $('file').files[0];
  if (!f) return;
  const opt = new Option(`file: ${f.name}`, `file:${f.name}`);
  $('source').add(opt);
  $('source').value = opt.value;
  setSource(JSON.parse(await f.text()), f.name);
};

$('json').oninput = () => {
  try {
    const v = JSON.parse($('json').value);
    if (!v || typeof v !== 'object' || !defs.instrument.properties.engine.enum.includes(v.engine)) throw new Error('needs a known engine');
    sound().instruments[instId] = v;
    $('json').classList.remove('bad');
    post({ type: 'update', id: instId, inst: v });
    const focus = document.activeElement;
    build();
    focus?.focus();
  } catch { $('json').classList.add('bad'); }
};
$('json').onblur = showJson;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(format(cur())); status(`copied ${instId}`); }
  catch { $('json').select(); status('select-all done: copy with ⌘C / Ctrl+C'); }
};
$('reset').onclick = () => {
  sound().instruments[instId] = clone(original.sound.instruments[instId]);
  changed();
  build();
  status(`reset ${instId}`);
};
$('save').onclick = () => {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = sourceName.endsWith('.json') ? sourceName : `${sourceName}.json`;
  a.click();
};

/* ----------------------------------------------------------- start */

defs = (await (await fetch('../../format/schema/song.json')).json()).$defs;
const songs = document.createElement('optgroup'); songs.label = 'Songs';
for (const [name, url] of EXAMPLES) songs.appendChild(new Option(name, url));
const styles = document.createElement('optgroup'); styles.label = 'Styles';
for (const [name, url] of STYLES) styles.appendChild(new Option(name, url));
$('source').append(songs, styles);
buildKeys();
const hash = new URLSearchParams(location.hash.slice(1));
const src = hash.get('src');
$('source').value = [...EXAMPLES, ...STYLES].some(([, u]) => u === src) ? src : STYLES[0][1];
await loadUrl($('source').value, hash.get('inst'));
