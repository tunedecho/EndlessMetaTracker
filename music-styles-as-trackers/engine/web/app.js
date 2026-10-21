/**
 * Browser player and step editor for Tracker Song Format files, on the same
 * engine as the CLI. Songs play live in an AudioWorklet (synth-worklet.js),
 * so edits are heard the next time their row comes round; the worker renders
 * WAVs and runs the generator and endless mode.
 */
import { resolve, toName, toMidi, stepSource, phrasePlays, getStep, setStep, makeUnique } from '../../format/lib/core.js';
import { encodeWav } from '../lib/wav.js';
import { EXAMPLES, STYLES } from './catalog.js';
import { deref, leafParams } from './params.js';
import { weird, MACROS } from './weird.js';
import { knob } from './knob.js';

const $ = (id) => document.getElementById(id);
// Tracker keyboard layout: two rows, an octave and a bit each.
const KEYMAP = Object.fromEntries([...'zsxdcvgbhnjm,'].map((k, i) => [k, i]).concat([...'q2w3er5t6y7ui'].map((k, i) => [k, i + 12])));
const HOLD = 0.4; // seconds an auditioned step rings before release
const UNDO = 200;

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let song = null, resolved = null, title = 'song';
let audio = null, node = null, out = null, analyser = null, ready = null;
let playing = null; // null | 'song' | 'row'
let playPos = null; // {row, step} from the worklet
let view = 0; // song row shown in the grid
const cur = { step: 0, track: 0 };
let octave = 3;
const undo = [];
const releaseTimers = new Map();
let stepRows = []; // grid <tr> per step of the shown row

function status(text) { $('status').textContent = text; }
function progress(v) { $('progress').firstElementChild.style.width = `${Math.round(v * 100)}%`; }
const tracks = () => song.composition.tracks;
const pl = () => resolved.transport.phraseLength;
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const post = (m) => { if (node) node.port.postMessage(m); };

/* ------------------------------------------------------------- audio */

function startAudio() {
  ready ||= (async () => {
    audio ||= new AudioContext({ latencyHint: 'interactive' });
    await audio.audioWorklet.addModule(new URL('./synth-worklet.js', import.meta.url));
    node = new AudioWorkletNode(audio, 'synth', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = (e) => onLive(e.data);
    node.connect(output());
    if (song) loadKeys();
    drawScope();
  })().catch((e) => { status(`audio failed: ${e.message}`); console.error(e); ready = null; throw e; });
  if (audio?.state === 'suspended') audio.resume();
  return ready;
}

/** Everything audible goes through one node, so the scope sees it all. */
function output() {
  audio ||= new AudioContext({ latencyHint: 'interactive' });
  if (!out) {
    out = audio.createGain();
    analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    out.connect(analyser).connect(audio.destination);
  }
  return out;
}

/** The keyboard player gets one voice per track, so auditioned steps sound like the song. */
function loadKeys() {
  post({ type: 'load', sound: song.sound, bpm: song.transport.bpm, stepsPerBeat: song.transport.stepsPerBeat || 4, voices: tracks().length });
}

function drawScope() {
  const c = $('wave'), ctx = c.getContext('2d');
  const buf = new Float32Array(analyser.fftSize);
  const frame = () => {
    analyser.getFloatTimeDomainData(buf);
    ctx.fillStyle = '#16181d'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < buf.length; i++) {
      const x = (i / buf.length) * c.width, y = c.height / 2 - buf[i] * c.height * 0.45;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(frame);
  };
  frame();
}

/* ------------------------------------------------------------- song */

function setSong(s, name) {
  stop();
  weirdOff(false);
  song = s;
  title = (name || song.meta?.title || 'song').replace(/\.json$/, '');
  resolved = resolve(song);
  undo.length = 0;
  view = 0; cur.step = 0; cur.track = 0;
  for (const id of ['play', 'loop', 'download', 'save']) $(id).disabled = false;
  const m = song.meta || {};
  $('meta').textContent = [m.title, m.style && `style: ${m.style}`, m.seed !== undefined && `seed: ${m.seed}`, `${song.transport.bpm} bpm`, `${tracks().length} tracks, ${Object.keys(song.composition.phrases).length} phrases, ${Object.keys(song.composition.chains).length} chains`, m.notes].filter(Boolean).join('\n');
  $('cInst').innerHTML = '';
  $('cInst').add(new Option('(track)', ''));
  for (const id of Object.keys(song.sound.instruments)) $('cInst').add(new Option(id, id));
  if (node) loadKeys();
  renderRows();
  renderGrid();
  status('ready: Space plays, ↑ ↓ step through');
}

/** After any edit: re-resolve, redraw, and hand the live player the new composition. */
function edited() {
  if (!weirdness.on) cached.base = null; // the song changed under the last weird copy
  resolved = resolve(song);
  renderRows();
  renderGrid();
  post({ type: 'composition', composition: song.composition });
}

function snapshot() {
  undo.push(JSON.stringify(song.composition));
  if (undo.length > UNDO) undo.shift();
}

function renderRows() {
  const t = $('rows');
  t.innerHTML = '';
  const sections = new Map((song.composition.song.sections || []).map((s) => [s.row, s]));
  resolved.rows.forEach((r) => {
    const sec = sections.get(r.row);
    const tr = document.createElement('tr');
    tr.dataset.row = r.row;
    const bars = r.steps / pl();
    const layers = Object.keys(song.composition.song.rows[r.row]).filter((k) => song.composition.song.rows[r.row][k]).join(' ');
    tr.innerHTML = `<td>${r.row}</td><td>${sec?.name ?? ''}</td><td><i class="energy" style="width:${Math.round((sec?.energy ?? 0) * 40)}px"></i></td><td>${bars}b</td><td title="${layers}">${layers.length > 26 ? layers.slice(0, 24) + '…' : layers}</td>`;
    tr.classList.toggle('current', r.row === view);
    tr.onclick = () => { setView(r.row, 0); if (playing) play(playing === 'row'); };
    t.appendChild(tr);
  });
}

/* ------------------------------------------------------------- grid */

function cellHtml(ev) {
  if (!ev) return '·';
  if (ev.note === 'OFF') return 'OFF';
  if (ev.note === null) return Object.keys(ev.fx).join(',').slice(0, 7);
  return `${toName(ev.note)}${ev.vel < 1 ? ' ' + Math.round(ev.vel * 99).toString().padStart(2, '0') : ''}${Object.keys(ev.fx).length ? '*' : ''}${ev.lock ? '◆' : ''}`;
}

function cellClass(ev) {
  if (!ev) return '';
  if (ev.note === 'OFF') return 'off';
  if (ev.note === null) return 'fx';
  return 'note';
}

/** Events of the shown row, by "track:step"; a written step wins over the implicit OFF at a row start. */
function rowEvents() {
  const r = resolved.rows[view];
  const map = new Map();
  for (const e of resolved.events) {
    if (e.row !== view || e.step < r.step || e.step >= r.step + r.steps) continue;
    const k = `${e.track}:${e.step - r.step}`;
    if (!map.has(k) || e.phrase !== null) map.set(k, e);
  }
  return map;
}

function renderGrid() {
  const g = $('grid');
  g.innerHTML = '';
  stepRows = [];
  if (!song) return;
  const r = resolved.rows[view];
  const tr0 = tracks();
  const spb = resolved.transport.stepsPerBeat;
  $('gridTitle').textContent = `Row ${view}${r.name ? ` · ${r.name}` : ''} · ${r.steps / pl()} bars, ${r.steps} steps`;
  for (const tr of $('rows').rows) tr.classList.toggle('current', parseInt(tr.dataset.row, 10) === view);
  const head = document.createElement('tr');
  head.innerHTML = '<th></th>' + tr0.map((t) => `<th title="instrument ${t.instrument ?? '–'}">${t.id}</th>`).join('');
  g.appendChild(head);
  const events = rowEvents();
  const silent = tr0.map((t) => !song.composition.song.rows[view][t.id]);
  for (let s = 0; s < r.steps; s++) {
    if (s % pl() === 0) {
      const band = document.createElement('tr');
      band.className = 'phrase';
      band.innerHTML = `<td>${s / pl()}</td>` + tr0.map((t) => {
        const src = stepSource(song, view, t.id, s);
        if (!src) return '<td class="silent">—</td>';
        const tp = src.transpose ? ` ${src.transpose > 0 ? '+' : ''}${src.transpose}` : '';
        return `<td title="phrase ${src.phrase}, chain ${src.chain} row ${src.chainRow}${tp ? `, transpose${tp}` : ''}">${src.phrase}${tp}</td>`;
      }).join('');
      g.appendChild(band);
    }
    const tr = document.createElement('tr');
    tr.dataset.step = s;
    if (s % spb === 0) tr.className = 'beat';
    let html = `<td class="stepno">${hex(s % pl())}</td>`;
    for (let ti = 0; ti < tr0.length; ti++) {
      const ev = events.get(`${ti}:${s}`);
      html += `<td data-t="${ti}" class="${silent[ti] ? 'silent' : cellClass(ev)}">${silent[ti] ? '' : cellHtml(ev)}</td>`;
    }
    tr.innerHTML = html;
    g.appendChild(tr);
    stepRows.push(tr);
  }
  showCursor(false);
  showPlaying();
}

function showCursor(scroll = true) {
  for (const tr of stepRows) tr.classList.remove('cursor');
  $('grid').querySelector('td.sel')?.classList.remove('sel');
  const tr = stepRows[cur.step];
  if (!tr) return;
  tr.classList.add('cursor');
  tr.cells[cur.track + 1]?.classList.add('sel');
  if (scroll) tr.scrollIntoView({ block: 'nearest' });
  showCell();
}

function showPlaying() {
  for (const tr of stepRows) tr.classList.remove('playing');
  if (playPos && playPos.row === view) stepRows[playPos.step]?.classList.add('playing');
}

function setView(row, step = cur.step) {
  const changed = row !== view;
  view = row;
  cur.step = Math.max(0, Math.min(step, resolved.rows[view].steps - 1));
  if (changed) renderGrid();
  else showCursor();
}

/** Move the cursor by steps, crossing into the next or previous song row at the edges. */
function moveStep(d) {
  let s = cur.step + d, row = view;
  while (s < 0 && row > 0) { row--; s += resolved.rows[row].steps; }
  while (s >= resolved.rows[row].steps && row < resolved.rows.length - 1) { s -= resolved.rows[row].steps; row++; }
  setView(row, Math.max(0, Math.min(s, resolved.rows[row].steps - 1)));
  showCursor();
}

/* ------------------------------------------------------------- step inspector */

function showCell() {
  if (!song) return;
  const t = tracks()[cur.track];
  const src = stepSource(song, view, t.id, cur.step);
  const form = $('cellForm');
  if (!src) {
    $('cell').innerHTML = `<b>${t.id}</b> is silent in row ${view}: no chain to write into.`;
    form.style.opacity = 0.4;
    for (const el of form.querySelectorAll('input, select, button')) el.disabled = true;
    showLocks(null);
    return;
  }
  form.style.opacity = 1;
  for (const el of form.querySelectorAll('input, select, button')) el.disabled = false;
  const plays = phrasePlays(song, src.phrase), here = phrasePlays(song, src.phrase, view);
  const tp = src.transpose ? `, transpose ${src.transpose > 0 ? '+' : ''}${src.transpose}` : '';
  $('cell').innerHTML = `<b>${t.id}</b> · row ${view} step ${hex(cur.step)}\nphrase <b>${src.phrase}</b> step ${hex(src.phraseStep)}\nchain ${src.chain}, row ${src.chainRow}${tp}\n` +
    (plays > 1 ? `<span class="shared">this phrase plays ${plays} times (${here} in this row): an edit changes all of them</span>` : 'this phrase plays only here');
  $('unique').disabled = plays === here; // already only in this row
  const cell = getStep(song, src.phrase, src.phraseStep) || {};
  const active = document.activeElement;
  if (active !== $('cNote')) $('cNote').value = cell.note === undefined ? '' : cell.note === 'OFF' ? 'OFF' : toName(toMidi(cell.note) + src.transpose);
  if (active !== $('cVel')) $('cVel').value = cell.vel ?? '';
  $('cInst').value = cell.inst ?? '';
  if (active !== $('cFx')) { $('cFx').value = cell.fx ? JSON.stringify(cell.fx) : ''; $('cFx').classList.remove('bad'); }
  showLocks(src, cell);
}

/* ------------------------------------------------------------- parameter locks */

let defs = null;
fetch('../../format/schema/song.json').then((r) => r.json()).then((j) => { defs = j.$defs; if (song) showCell(); });
let dragging = false;
// A drag that ends without a change event (or off the slider) must not leave the panel frozen.
addEventListener('pointerup', () => setTimeout(() => { if (dragging) { dragging = false; edited(); } }, 0));
const openGroups = new Set(['params']);
const getPath = (o, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), o);
const short = (v) => (typeof v === 'number' ? Number(v.toPrecision(3)) : v);

/** Every instrument parameter, grouped, for the instrument that plays this step. */
function lockGroups(engine) {
  const props = defs.instrument.properties;
  return [
    ['params', `${engine} params`, leafParams(defs, defs[`params.${engine}`], ['params'])],
    ['filter', 'filter', leafParams(defs, props.filter, ['filter'])],
    ['amp', 'amp envelope', leafParams(defs, deref(defs, props.amp).node, ['amp'])],
    ['lfo', 'lfo', leafParams(defs, props.lfo, ['lfo'])],
    ['mix', 'mix', leafParams(defs, props.mix, ['mix'])],
    ['other', 'transpose', leafParams(defs, { properties: { transpose: props.transpose } })],
  ];
}

/**
 * The All parameters panel: one control per instrument parameter. An unlocked
 * control is dim and shows the instrument's value; moving it locks the value on
 * this step, and × unlocks it.
 */
function showLocks(src, cell = {}) {
  const box = $('locks');
  if (dragging) return;
  box.innerHTML = '';
  $('lockCount').textContent = '';
  if (!defs || !src) return;
  const instId = cell.inst ?? tracks()[cur.track].instrument;
  const inst = song.sound.instruments[instId];
  if (cell.note === undefined || cell.note === 'OFF' || !inst) {
    box.innerHTML = '<p class="dim">Locks shape a note: write a note on this step to lock its parameters.</p>';
    return;
  }
  const lock = cell.lock || {};
  const n = Object.keys(lock).length;
  $('lockCount').textContent = n ? `· ${n} locked` : '';
  const head = document.createElement('p');
  head.className = 'dim';
  head.textContent = weirdness.on
    ? `${instId} (${inst.engine}). Weird is on: these are the weird version's locks. Flip back (\`) or bake to edit.`
    : `${instId} (${inst.engine}). Move a control to lock it on this note; × unlocks.`;
  box.appendChild(head);
  for (const [key, title, params] of lockGroups(inst.engine)) {
    const det = document.createElement('details');
    const locked = params.filter((p) => lock[p.path.join('.')] !== undefined).length;
    det.open = openGroups.has(key) || locked > 0;
    det.ontoggle = () => { if (det.open) openGroups.add(key); else openGroups.delete(key); };
    det.innerHTML = `<summary>${title}${locked ? ` <span class="lk">${locked}</span>` : ''}</summary>`;
    for (const p of params) det.appendChild(lockRow(p, inst, lock));
    box.appendChild(det);
  }
  if (weirdness.on) for (const el of box.querySelectorAll('input, select, button')) el.disabled = true;
}

function lockRow(p, inst, lock) {
  const path = p.path.join('.');
  const own = getPath(inst, p.path);
  const value = lock[path];
  const r = document.createElement('div');
  r.className = `lockrow${value === undefined ? '' : ' locked'}`;
  r.title = `${path}${p.description ? `: ${p.description}` : ''}\ninstrument: ${own === undefined ? 'unset' : own}`;
  const label = document.createElement('label');
  label.textContent = p.path.slice(1).join('.') || path;
  r.appendChild(label);
  if (p.kind === 'number') {
    const sc = p.scale;
    const shown = value ?? own ?? sc.rest;
    const slider = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1000, step: 1, value: Math.round(p.norm(shown) * 1000) });
    const num = Object.assign(document.createElement('input'), { type: 'number', step: 'any', value: value ?? '', placeholder: own === undefined ? '–' : String(short(own)) });
    const clean = (v) => {
      v = Math.min(sc.hardMax, Math.max(sc.hardMin, sc.round(v)));
      return p.exclusiveMinimum !== undefined && v <= p.exclusiveMinimum ? undefined : v;
    };
    slider.oninput = () => {
      if (!dragging) { snapshot(); dragging = true; } // one undo step per drag
      const v = clean(sc.from(slider.value / 1000)); if (v === undefined) return; num.value = v; r.classList.add('locked'); setLock(path, v, false); };
    slider.onchange = () => { dragging = false; setLock(path, clean(sc.from(slider.value / 1000)), true); };
    num.onchange = () => { if (num.value === '') setLock(path, undefined, true, true); else { const v = clean(Number(num.value)); if (v !== undefined) setLock(path, v, true, true); } };
    r.append(slider, num);
  } else {
    const s = document.createElement('select');
    s.add(new Option(`(${own === undefined ? 'default' : own})`, ''));
    for (const o of p.kind === 'bool' ? [true, false] : p.options) s.add(new Option(String(o), JSON.stringify(o)));
    s.value = value === undefined ? '' : JSON.stringify(value);
    s.onchange = () => setLock(path, s.value === '' ? undefined : JSON.parse(s.value), true, true);
    r.appendChild(s);
  }
  const x = document.createElement('button');
  x.className = 'clear';
  x.textContent = '×';
  x.title = 'unlock: back to the instrument';
  x.onclick = () => setLock(path, undefined, true, true);
  r.appendChild(x);
  return r;
}

/**
 * Set or clear one lock on the cursor's step. While a slider moves, the change
 * goes straight to the live player without redrawing; on release it is a full edit.
 */
function setLock(path, value, final, undoable = false) {
  if (weirdBlocks()) return;
  const src = stepSource(song, view, tracks()[cur.track].id, cur.step);
  if (!src) return;
  if (undoable) snapshot();
  const cell = { ...(getStep(song, src.phrase, src.phraseStep) || {}) };
  const lock = { ...cell.lock };
  if (value === undefined) delete lock[path]; else lock[path] = value;
  if (Object.keys(lock).length) cell.lock = lock; else delete cell.lock;
  setStep(song, src.phrase, src.phraseStep, cell);
  if (!final) { resolved = resolve(song); post({ type: 'composition', composition: song.composition }); return; }
  edited();
  auditionCell();
}

/** Write the cursor's step. `change` maps the stored cell (or {}) to the new one; null clears it. */
function writeCell(change) {
  if (weirdBlocks()) return null;
  const t = tracks()[cur.track];
  const src = stepSource(song, view, t.id, cur.step);
  if (!src) { status(`${t.id} is silent in this row: nothing to write into`); return null; }
  snapshot();
  const next = change({ ...(getStep(song, src.phrase, src.phraseStep) || {}) }, src);
  setStep(song, src.phrase, src.phraseStep, next);
  edited();
  return src;
}

function formCell(cell, src) {
  const note = $('cNote').value.trim();
  if (!note) delete cell.note;
  else if (note.toUpperCase() === 'OFF') cell.note = 'OFF';
  else cell.note = toName(toMidi(/^\d+$/.test(note) ? Number(note) : note) - src.transpose);
  const vel = $('cVel').value;
  if (vel === '') delete cell.vel; else cell.vel = Math.max(0, Math.min(1, Number(vel)));
  if ($('cInst').value) cell.inst = $('cInst').value; else delete cell.inst;
  const fx = $('cFx').value.trim();
  if (!fx) delete cell.fx; else cell.fx = JSON.parse(fx);
  return Object.keys(cell).length ? cell : null;
}

function applyForm(e) {
  const src = stepSource(song, view, tracks()[cur.track].id, cur.step);
  if (!src) return;
  let next;
  try { next = formCell({ ...(getStep(song, src.phrase, src.phraseStep) || {}) }, src); }
  catch { e.target.classList.add('bad'); status('not a note name (C4, F#3, OFF) or fx JSON'); return; }
  e.target.classList.remove('bad');
  writeCell(() => next);
}
for (const id of ['cNote', 'cVel', 'cInst', 'cFx']) $(id).onchange = applyForm;
$('unique').onclick = () => {
  if (weirdBlocks()) return;
  const t = tracks()[cur.track];
  const src = stepSource(song, view, t.id, cur.step);
  if (!src) return;
  snapshot();
  const ids = makeUnique(song, view, t.id, src.chainRow);
  edited();
  status(`${t.id}: now chain ${ids.chain}, phrase ${ids.phrase}`);
};

/* ------------------------------------------------------------- audition */

function instFor(ti, ev) { return ev?.inst ?? tracks()[ti].instrument; }

function sound(ti, id, note, vel = 1, lock = null) {
  if (!id) return;
  post({ type: 'on', voice: ti, id, note, vel, lock });
  clearTimeout(releaseTimers.get(ti));
  releaseTimers.set(ti, setTimeout(() => post({ type: 'off', voice: ti }), HOLD * 1000));
}

/** Play every track's note at the cursor step, the way a tracker plays a row as you move onto it. */
async function auditionStep() {
  if (playing) return;
  await startAudio();
  const events = rowEvents();
  for (let ti = 0; ti < tracks().length; ti++) {
    const ev = events.get(`${ti}:${cur.step}`);
    if (ev && typeof ev.note === 'number') sound(ti, instFor(ti, ev), ev.note, ev.vel, ev.lock);
  }
}

async function auditionCell() {
  await startAudio();
  const ev = rowEvents().get(`${cur.track}:${cur.step}`);
  if (ev && typeof ev.note === 'number') sound(cur.track, instFor(cur.track, ev), ev.note, ev.vel, ev.lock);
}

/* ------------------------------------------------------------- playback */

async function play(loop = false) {
  if (!song) return;
  stopEndlessIfOn();
  await startAudio();
  post({ type: 'play', song, row: view, loop });
  playing = loop ? 'row' : 'song';
  $('stop').disabled = false;
  status(loop ? `looping row ${view}` : `playing from row ${view}`);
}

function stop() {
  if (endless.on) stopEndless();
  if (playing) post({ type: 'stop' });
  playing = null; playPos = null;
  $('stop').disabled = true;
  showPlaying();
  if (song) status('stopped');
}

function onLive(m) {
  if (m.type === 'pos' && playing) {
    playPos = m;
    // Following, the grid shows the playing row and keeps the playhead in view; otherwise it stays where you are.
    if (following() && m.row !== view) { view = m.row; cur.step = Math.min(cur.step, resolved.rows[view].steps - 1); renderGrid(); }
    showPlaying();
    if (following() && m.row === view) keepPlayheadInView(stepRows[m.step]);
  } else if (m.type === 'ended') { playing = null; playPos = null; $('stop').disabled = true; showPlaying(); status('end of song'); }
}

/* ------------------------------------------------------------- follow */

const following = () => $('follow').checked;

/** Keep the playing step a third of the way down the grid, so what comes next is visible. */
function keepPlayheadInView(tr) {
  if (!tr) return;
  const wrap = $('gridWrap');
  const head = $('grid').rows[0]?.offsetHeight || 0;
  const top = tr.offsetTop - wrap.scrollTop;
  if (top < head || top + tr.offsetHeight > wrap.clientHeight - tr.offsetHeight * 4) wrap.scrollTop = tr.offsetTop - head - (wrap.clientHeight - head) / 3;
}
try { $('follow').checked = localStorage.getItem('tracker-follow') !== 'off'; } catch {}
$('follow').onchange = () => {
  try { localStorage.setItem('tracker-follow', following() ? 'on' : 'off'); } catch {}
  status(following() ? 'following the playhead' : 'not following: the grid stays put while playing');
};

/* ------------------------------------------------------------- keys */

const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox';
const editing = () => $('edit').checked;
function setEdit(on) { $('edit').checked = on; document.body.classList.toggle('editing', on); status(on ? 'edit mode: note keys write' : 'edit mode off'); }
function setOctave(o) { octave = Math.max(0, Math.min(8, o)); $('oct').textContent = octave; }

window.addEventListener('keydown', (e) => {
  if (!song || typing(e)) return;
  const k = e.key;
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') {
    if (!undo.length) return;
    e.preventDefault();
    if (weirdBlocks()) return;
    song.composition = JSON.parse(undo.pop());
    edited();
    status('undone');
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -pl(), PageDown: pl() }[k];
  if (step) { e.preventDefault(); moveStep(e.shiftKey && Math.abs(step) === 1 ? step * resolved.transport.stepsPerBeat : step); auditionStep(); return; }
  if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); cur.track = (cur.track + (k === 'ArrowLeft' ? -1 : 1) + tracks().length) % tracks().length; showCursor(); return; }
  if (k === ' ') { e.preventDefault(); if (playing) stop(); else play(false); return; }
  if (k === 'Escape') { setEdit(!editing()); return; }
  if (k === '`' || e.code === 'Backquote') { e.preventDefault(); flipWeird(); return; }
  if (k.toLowerCase() === 'f') { $('follow').checked = !following(); $('follow').onchange(); return; }
  if (k === 'Enter') { auditionStep(); return; }
  if (k.toLowerCase() === 'l' && !e.repeat) { if (playing === 'row') stop(); else play(true); return; }
  if (e.repeat) return;
  if (editing() && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); if (writeCell(() => null)) moveStep(1); return; }
  if (editing() && k === '1') { if (writeCell((c) => { delete c.inst; return { ...c, note: 'OFF' }; })) moveStep(1); return; }
  const o = KEYMAP[k.toLowerCase()];
  if (o === undefined) return;
  e.preventDefault();
  const midi = (octave + 1) * 12 + o;
  if (editing()) {
    if (!writeCell((c, src) => ({ ...c, note: toName(midi - src.transpose) }))) return;
    auditionCell().then(() => moveStep(1));
  } else {
    const ev = rowEvents().get(`${cur.track}:${cur.step}`);
    startAudio().then(() => sound(cur.track, instFor(cur.track, ev), midi));
  }
});

$('grid').onclick = (e) => {
  const td = e.target.closest('td[data-t]');
  if (!td) return;
  document.activeElement?.blur();
  cur.step = parseInt(td.parentElement.dataset.step, 10);
  cur.track = parseInt(td.dataset.t, 10);
  showCursor(false);
  auditionCell();
};
$('edit').onchange = () => setEdit(editing());
$('octDown').onclick = () => setOctave(octave - 1);
$('octUp').onclick = () => setOctave(octave + 1);

/* ------------------------------------------------------------- weirdness */

// The macros never touch the song: they build a weird copy from it. While the
// copy is on, `song` is the copy (what plays and shows) and `original` holds
// the song; flipping back restores it, and baking makes the copy the song.
const weirdness = { on: false, seed: 1, depth: 0.5, amounts: Object.fromEntries(Object.keys(MACROS).map((k) => [k, 0])) };
let original = null, weirdTimer = 0, originalLocks = 0;
let cached = { base: null, key: '', song: null }; // the last weird copy, so flipping back to it is instant
const knobs = {};

function weirdBlocks() {
  if (!weirdness.on) return false;
  status('weird is on: flip back (`) or bake it before editing');
  return true;
}

function weirdOpts() {
  const scope = $('wScope').value;
  const opts = { seed: weirdness.seed, amounts: weirdness.amounts, depth: weirdness.depth, vary: $('wVary').checked };
  if (scope === 'row' || scope === 'rowtrack') opts.rows = [view, view + 1];
  if (scope === 'track' || scope === 'rowtrack') opts.tracks = [tracks()[cur.track].id];
  return opts;
}

/** Rebuild the weird copy from the original and, if it is on, play and show it. */
function applyWeird() {
  clearTimeout(weirdTimer);
  const base = original ?? song;
  if (!base || !defs) return;
  const opts = weirdOpts();
  const key = JSON.stringify(opts);
  const w = cached.base === base && cached.key === key ? cached.song : weird(base, defs, opts);
  cached = { base, key, song: w };
  if (w === base) { if (weirdness.on) weirdOff(true); info(); return; }
  if (!weirdness.on) { original = song; originalLocks = resolved.events.filter((e) => e.lock).length; weirdness.on = true; document.body.classList.add('weird'); $('weirdToggle').textContent = 'weird'; }
  song = w;
  resolved = resolve(song);
  setView(Math.min(view, resolved.rows.length - 1));
  renderGrid();
  post({ type: 'composition', composition: song.composition });
  info();
}

function weirdOff(redraw = true) {
  clearTimeout(weirdTimer);
  if (weirdness.on && original) song = original;
  original = null;
  weirdness.on = false;
  document.body.classList.remove('weird');
  $('weirdToggle').textContent = 'original';
  if (redraw && song) { resolved = resolve(song); renderGrid(); post({ type: 'composition', composition: song.composition }); }
  info();
}

function flipWeird() {
  if (!song) return;
  if (weirdness.on) { weirdOff(); status('original'); }
  else { applyWeird(); status(weirdness.on ? 'weird' : 'turn a knob up first'); }
}

function info() {
  const active = Object.entries(weirdness.amounts).filter(([, v]) => v > 0).map(([k]) => k);
  let text = `seed ${weirdness.seed}`;
  if (weirdness.on && original) {
    text += ` · ${resolved.events.filter((e) => e.lock).length - originalLocks} more locked notes · ${active.join(', ')}`;
  } else if (active.length) text += ' · showing the original';
  $('wInfo').textContent = text;
}

/** Knob moves: rebuild shortly after they stop, so dragging stays smooth on long songs. */
function weirdSoon() { clearTimeout(weirdTimer); weirdTimer = setTimeout(applyWeird, 120); }

for (const [key, text] of Object.entries(MACROS)) {
  knobs[key] = knob({ label: key, title: text, onInput: (v) => { weirdness.amounts[key] = v; weirdSoon(); }, onChange: (v) => { weirdness.amounts[key] = v; applyWeird(); } });
  $('knobs').appendChild(knobs[key].el);
}
knobs.depth = knob({ label: 'depth', title: 'How far locks move from the instrument: a nudge at the bottom, anywhere in range at the top', value: weirdness.depth, defaultValue: 0.5, onInput: (v) => { weirdness.depth = v; weirdSoon(); }, onChange: (v) => { weirdness.depth = v; applyWeird(); } });
knobs.depth.el.classList.add('depth');
$('knobs').appendChild(knobs.depth.el);

$('weirdToggle').onclick = flipWeird;
$('reroll').onclick = () => { weirdness.seed = 1 + Math.floor(Math.random() * 99999); applyWeird(); };
$('surprise').onclick = () => {
  weirdness.seed = 1 + Math.floor(Math.random() * 99999);
  for (const k of Object.keys(MACROS)) { const v = Math.random() < 0.55 ? Math.round(Math.random() * 70) / 100 : 0; weirdness.amounts[k] = v; knobs[k].value = v; }
  weirdness.depth = knobs.depth.value = 0.3 + Math.round(Math.random() * 60) / 100;
  applyWeird();
};
$('zero').onclick = () => { for (const k of Object.keys(MACROS)) { weirdness.amounts[k] = 0; knobs[k].value = 0; } weirdOff(); };
$('bake').onclick = () => {
  if (!weirdness.on || !original) { status('nothing to bake: turn a knob up first'); return; }
  undo.push(JSON.stringify(original.composition));
  original = null;
  weirdness.on = false;
  document.body.classList.remove('weird');
  $('weirdToggle').textContent = 'original';
  for (const k of Object.keys(MACROS)) { weirdness.amounts[k] = 0; knobs[k].value = 0; }
  edited();
  info();
  status('baked: the weird version is now the song (⌘Z undoes)');
};
$('wScope').onchange = () => { if (weirdness.on) applyWeird(); };
$('wVary').onchange = () => { if (weirdness.on) applyWeird(); };
info();

/* ---------------------------------------------------------------- endless */
const endless = { on: false, nextTime: 0, queued: 0, bias: 0, sections: [], current: null, sampleRate: 44100, sources: [] };
const LOOKAHEAD = 2; // sections rendered ahead of playback
let raf = 0;

function stopEndlessIfOn() { if (endless.on) stopEndless(); }

function startEndless() {
  stop();
  endless.on = true; endless.queued = 0; endless.bias = 0; endless.sections = []; endless.current = null; endless.sources = [];
  output();
  startAudio();
  weirdOff(false);
  song = null; resolved = null; stepRows = [];
  $('rows').innerHTML = ''; $('grid').innerHTML = ''; $('gridTitle').textContent = 'Row'; $('cell').textContent = '–';
  $('less').disabled = false; $('more').disabled = false; $('stop').disabled = false;
  for (const id of ['play', 'loop', 'download', 'save']) $(id).disabled = true;
  status('endless: starting…');
  worker.postMessage({ type: 'endless-start', style: endless.style, seed: parseInt($('seed').value, 10) || 0 });
}

function requestSection() {
  if (!endless.on) return;
  endless.queued++;
  worker.postMessage({ type: 'endless-next', energy: endless.bias });
  endless.bias = 0;
}

function onSection(m) {
  endless.queued--;
  const buf = audio.createBuffer(2, m.left.length, m.sampleRate);
  buf.copyToChannel(m.left, 0); buf.copyToChannel(m.right, 1);
  const src = audio.createBufferSource();
  src.buffer = buf; src.connect(output());
  if (endless.sections.length === 0) endless.nextTime = audio.currentTime + 0.15;
  const at = endless.nextTime;
  src.start(at);
  endless.nextTime += m.left.length / m.sampleRate;
  endless.sources.push(src);
  src.onended = () => { endless.sources = endless.sources.filter((x) => x !== src); };
  endless.sections.push({ ...m, at, left: null, right: null });
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${m.index}</td><td>${m.section.kind}</td><td><i class="energy" style="width:${Math.round(m.section.energy * 40)}px"></i></td><td>${m.steps / 16}b</td><td>${Object.keys(m.row).join(' ').slice(0, 24)}</td>`;
  $('rows').appendChild(tr);
  if (endless.queued + (endless.sections.length - sectionIndexAt(audio.currentTime)) < LOOKAHEAD + 1) requestSection();
  if (!raf) tickEndless();
}

function sectionIndexAt(t) {
  let i = 0;
  for (let k = 0; k < endless.sections.length; k++) if (endless.sections[k].at <= t) i = k;
  return i;
}

function showEndlessRow(sec) {
  if (endless.current === sec) return;
  endless.current = sec;
  for (const tr of $('rows').rows) tr.classList.toggle('current', tr.firstChild.textContent === String(sec.index));
  $('gridTitle').textContent = `Row ${sec.index} · ${sec.section.kind} · energy ${sec.section.energy} · ${sec.steps / 16} bars (first phrase shown)`;
  const g = $('grid');
  g.innerHTML = '';
  const head = document.createElement('tr');
  head.innerHTML = '<th></th>' + sec.tracks.map((t) => `<th>${t.id}</th>`).join('');
  g.appendChild(head);
  for (let s = 0; s < 16; s++) {
    const tr = document.createElement('tr');
    tr.dataset.step = s;
    if (s % 4 === 0) tr.className = 'beat';
    let html = `<td class="stepno">${hex(s)}</td>`;
    for (let ti = 0; ti < sec.tracks.length; ti++) {
      const ev = sec.events.find((e) => e.track === ti && e.step === s);
      html += `<td class="${cellClass(ev)}">${cellHtml(ev)}</td>`;
    }
    tr.innerHTML = html;
    g.appendChild(tr);
  }
}

function tickEndless() {
  if (!endless.on) { raf = 0; return; }
  const t = audio.currentTime;
  const i = sectionIndexAt(t);
  const sec = endless.sections[i];
  if (sec && sec.at <= t) {
    showEndlessRow(sec);
    const sample = (t - sec.at) * sec.sampleRate;
    let lo = 0, hi = sec.stepStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sec.stepStarts[mid] <= sample) lo = mid; else hi = mid - 1; }
    // Only the first phrase is shown, so light the playhead only while it is in it.
    for (const tr of $('grid').rows) tr.classList.toggle('playing', lo < 16 && parseInt(tr.dataset.step, 10) === lo);
    status(`endless · ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} · row ${sec.index} ${sec.section.kind}${endless.bias ? ` · next ${endless.bias > 0 ? '+' : ''}${endless.bias.toFixed(1)}` : ''}`);
    // Keep the lookahead full as playback advances.
    if (endless.queued + (endless.sections.length - 1 - i) < LOOKAHEAD) requestSection();
  }
  raf = requestAnimationFrame(tickEndless);
}

function stopEndless() {
  endless.on = false;
  for (const s of endless.sources) { try { s.stop(); } catch {} }
  endless.sources = [];
  $('less').disabled = true; $('more').disabled = true;
  status('stopped');
}

$('endless').onclick = async () => {
  endless.style = await (await fetch($('styles').value)).json();
  startEndless();
};
$('more').onclick = () => { endless.bias = Math.min(0.6, endless.bias + 0.2); status(`next section: ${endless.bias >= 0 ? '+' : ''}${endless.bias.toFixed(1)} energy`); };
$('less').onclick = () => { endless.bias = Math.max(-0.6, endless.bias - 0.2); status(`next section: ${endless.bias >= 0 ? '+' : ''}${endless.bias.toFixed(1)} energy`); };

/* ------------------------------------------------------------- worker, files */

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'endless-ready') { status(`endless: ${m.title} at ${m.bpm} bpm`); $('meta').textContent = `${m.title}\nendless run, ${m.bpm} bpm\nseed ${$('seed').value}`; requestSection(); return; }
  if (m.type === 'section') { onSection(m); return; }
  if (m.type === 'progress') progress(m.value);
  else if (m.type === 'rendered') {
    progress(1);
    download(new Blob([encodeWav(m.left, m.right, m.sampleRate)], { type: 'audio/wav' }), `${title}.wav`);
    $('download').disabled = false;
    status('WAV rendered');
  } else if (m.type === 'generated') {
    setSong(m.song);
    status(`generated seed ${m.song.meta.seed}: Space plays, ↑ ↓ step through`);
  } else if (m.type === 'error') {
    status(`error: ${m.message}`);
    $('download').disabled = false;
    console.error(m.message);
  }
};

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[^\w.-]+/g, '_');
  a.click();
}

async function loadUrl(url) {
  status('loading…');
  const res = await fetch(url);
  if (!res.ok) { status(`could not load ${url}`); return; }
  setSong(await res.json(), url.split('/').pop());
}

for (const [name, url] of EXAMPLES) $('examples').add(new Option(name, url));
for (const [name, url] of STYLES) $('styles').add(new Option(name, url));
$('examples').onchange = () => loadUrl($('examples').value);
$('file').onchange = async () => { const f = $('file').files[0]; if (f) setSong(JSON.parse(await f.text()), f.name); };
$('generate').onclick = async () => {
  status('generating…');
  const style = await (await fetch($('styles').value)).json();
  worker.postMessage({ type: 'generate', style, seed: parseInt($('seed').value, 10) || 0, minutes: parseFloat($('minutes').value) || 4 });
};
$('play').onclick = () => play(false);
$('loop').onclick = () => play(true);
$('stop').onclick = stop;
$('download').onclick = () => {
  $('download').disabled = true;
  status('rendering WAV…');
  progress(0);
  worker.postMessage({ type: 'render', song });
};
$('cube').onclick = () => { if (song) try { sessionStorage.setItem('tracker-song', JSON.stringify(song)); } catch {} };
$('save').onclick = () => download(new Blob([JSON.stringify(song, null, 2) + '\n'], { type: 'application/json' }), `${title}.json`);
$('examples').value = EXAMPLES[1][1];
loadUrl(EXAMPLES[1][1]);
