/**
 * Browser player for Tracker Song Format files, on the same engine as the CLI.
 */
import { resolve, toName } from '../../format/lib/core.js';
import { encodeWav } from '../lib/wav.js';
import { EXAMPLES, STYLES } from './catalog.js';

const $ = (id) => document.getElementById(id);

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let song = null, resolved = null, audio = null, buffer = null, source = null, startedAt = 0, starts = null, rendered = null, raf = 0;

function status(text) { $('status').textContent = text; }
function progress(v) { $('progress').firstElementChild.style.width = `${Math.round(v * 100)}%`; }

function setSong(s) {
  stop();
  song = s;
  resolved = resolve(song);
  buffer = null; rendered = null; shownRow = -1;
  $('play').disabled = false; $('download').disabled = true;
  const m = song.meta || {};
  $('meta').textContent = [m.title, m.style && `style: ${m.style}`, m.seed !== undefined && `seed: ${m.seed}`, `${song.transport.bpm} bpm`, `${song.composition.tracks.length} tracks, ${Object.keys(song.composition.phrases).length} phrases, ${Object.keys(song.composition.chains).length} chains`, m.notes].filter(Boolean).join('\n');
  renderRows();
  showRow(0);
  drawWave();
  status('ready: Render & Play');
}

function renderRows() {
  const t = $('rows');
  t.innerHTML = '';
  const sections = new Map((song.composition.song.sections || []).map((s) => [s.row, s]));
  resolved.rows.forEach((r) => {
    const sec = sections.get(r.row);
    const tr = document.createElement('tr');
    tr.dataset.row = r.row;
    const bars = r.steps / resolved.transport.phraseLength;
    const layers = Object.keys(song.composition.song.rows[r.row]).filter((k) => song.composition.song.rows[r.row][k]).join(' ');
    tr.innerHTML = `<td>${r.row}</td><td>${sec?.name ?? ''}</td><td><i class="energy" style="width:${Math.round((sec?.energy ?? 0) * 40)}px"></i></td><td>${bars}b</td><td title="${layers}">${layers.length > 26 ? layers.slice(0, 24) + '…' : layers}</td>`;
    tr.onclick = () => { showRow(r.row); if (buffer) play(r.step); };
    t.appendChild(tr);
  });
}

let shownRow = -1;
function showRow(rowIndex) {
  if (rowIndex === shownRow) return;
  shownRow = rowIndex;
  for (const tr of $('rows').rows) tr.classList.toggle('current', parseInt(tr.dataset.row, 10) === rowIndex);
  const r = resolved.rows[rowIndex];
  const pl = resolved.transport.phraseLength;
  const tracks = song.composition.tracks;
  const events = resolved.events.filter((e) => e.step >= r.step && e.step < r.step + Math.min(r.steps, pl));
  $('gridTitle').textContent = `Row ${rowIndex} · first phrase of ${r.steps / pl} bars · ${r.name ?? ''}`;
  const g = $('grid');
  g.innerHTML = '';
  const head = document.createElement('tr');
  head.innerHTML = '<th></th>' + tracks.map((t) => `<th>${t.id}</th>`).join('');
  g.appendChild(head);
  for (let s = 0; s < pl; s++) {
    const tr = document.createElement('tr');
    tr.dataset.step = s;
    if (s % resolved.transport.stepsPerBeat === 0) tr.className = 'beat';
    let html = `<td class="stepno">${s.toString(16).toUpperCase().padStart(2, '0')}</td>`;
    for (let ti = 0; ti < tracks.length; ti++) {
      const ev = events.find((e) => e.track === ti && e.step === r.step + s);
      if (!ev) html += '<td>·</td>';
      else if (ev.note === 'OFF') html += '<td class="off">OFF</td>';
      else if (ev.note === null) html += `<td class="fx">${Object.keys(ev.fx).join(',').slice(0, 7)}</td>`;
      else html += `<td class="note">${toName(ev.note)}${ev.vel < 1 ? ' ' + Math.round(ev.vel * 99).toString().padStart(2, '0') : ''}${Object.keys(ev.fx).length ? '*' : ''}</td>`;
    }
    tr.innerHTML = html;
    g.appendChild(tr);
  }
}

function drawWave(pos = -1) {
  const c = $('wave'), ctx = c.getContext('2d');
  ctx.fillStyle = '#16181d'; ctx.fillRect(0, 0, c.width, c.height);
  if (rendered) {
    const { left } = rendered;
    const step = Math.max(1, Math.floor(left.length / c.width));
    ctx.fillStyle = '#6ee7b7';
    for (let x = 0; x < c.width; x++) {
      let max = 0;
      const base = x * step;
      for (let i = 0; i < step; i += 8) max = Math.max(max, Math.abs(left[base + i] || 0));
      const h = max * c.height;
      ctx.fillRect(x, (c.height - h) / 2, 1, h);
    }
  }
  // Row boundaries.
  if (resolved && rendered && starts) {
    ctx.fillStyle = '#3b4252';
    for (const r of resolved.rows) ctx.fillRect(Math.floor(starts[r.step] / rendered.left.length * c.width), 0, 1, c.height);
  }
  if (pos >= 0) { ctx.fillStyle = '#f59e0b'; ctx.fillRect(Math.floor(pos * c.width), 0, 2, c.height); }
}

function render() {
  if (!song) return;
  $('play').disabled = true;
  status('rendering…');
  progress(0);
  worker.postMessage({ type: 'render', song });
}

function play(fromStep = 0) {
  if (!buffer) return;
  stop();
  audio ||= new AudioContext();
  source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const offset = starts[fromStep] / buffer.sampleRate;
  source.start(0, offset);
  startedAt = audio.currentTime - offset;
  $('stop').disabled = false;
  status('playing');
  source.onended = () => { if (source) { stop(); } };
  tick();
}

function stop() {
  if (endless.on) stopEndless();
  if (source) { try { source.stop(); } catch {} source.onended = null; source = null; }
  cancelAnimationFrame(raf); raf = 0;
  $('stop').disabled = true;
  if (buffer) status('stopped');
  for (const tr of $('grid').rows) tr.classList.remove('playing');
}

function tick() {
  if (!source) return;
  const t = audio.currentTime - startedAt;
  const sample = t * buffer.sampleRate;
  // Find the current step by binary search over step starts.
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= sample) lo = mid; else hi = mid - 1; }
  const row = resolved.rows.findLast((r) => r.step <= lo) || resolved.rows[0];
  showRow(row.row);
  const pl = resolved.transport.phraseLength;
  const stepInPhrase = (lo - row.step) % pl;
  for (const tr of $('grid').rows) tr.classList.toggle('playing', parseInt(tr.dataset.step, 10) === stepInPhrase);
  drawWave(sample / buffer.length);
  raf = requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------- endless */
const endless = { on: false, nextTime: 0, queued: 0, bias: 0, sections: [], current: null, sampleRate: 44100, sources: [] };
const LOOKAHEAD = 2; // sections rendered ahead of playback

function startEndless() {
  stop();
  endless.on = true; endless.queued = 0; endless.bias = 0; endless.sections = []; endless.current = null; endless.sources = [];
  audio ||= new AudioContext();
  audio.resume();
  song = null; resolved = null; buffer = null; rendered = null;
  $('rows').innerHTML = ''; $('grid').innerHTML = ''; $('gridTitle').textContent = 'Row';
  $('less').disabled = false; $('more').disabled = false; $('stop').disabled = false; $('play').disabled = true; $('download').disabled = true;
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
  src.buffer = buf; src.connect(audio.destination);
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
  $('gridTitle').textContent = `Row ${sec.index} · ${sec.section.kind} · energy ${sec.section.energy} · ${sec.steps / 16} bars`;
  const g = $('grid');
  g.innerHTML = '';
  const head = document.createElement('tr');
  head.innerHTML = '<th></th>' + sec.tracks.map((t) => `<th>${t.id}</th>`).join('');
  g.appendChild(head);
  for (let s = 0; s < 16; s++) {
    const tr = document.createElement('tr');
    tr.dataset.step = s;
    if (s % 4 === 0) tr.className = 'beat';
    let html = `<td class="stepno">${s.toString(16).toUpperCase().padStart(2, '0')}</td>`;
    for (let ti = 0; ti < sec.tracks.length; ti++) {
      const ev = sec.events.find((e) => e.track === ti && e.step === s);
      if (!ev) html += '<td>·</td>';
      else if (ev.note === 'OFF') html += '<td class="off">OFF</td>';
      else if (ev.note === null) html += `<td class="fx">${Object.keys(ev.fx).join(',').slice(0, 7)}</td>`;
      else html += `<td class="note">${toName(ev.note)}${ev.vel < 1 ? ' ' + Math.round(ev.vel * 99).toString().padStart(2, '0') : ''}${Object.keys(ev.fx).length ? '*' : ''}</td>`;
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
    const stepInPhrase = lo % 16;
    for (const tr of $('grid').rows) tr.classList.toggle('playing', parseInt(tr.dataset.step, 10) === stepInPhrase);
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

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'endless-ready') { status(`endless: ${m.title} at ${m.bpm} bpm`); $('meta').textContent = `${m.title}\nendless run, ${m.bpm} bpm\nseed ${$('seed').value}`; requestSection(); return; }
  if (m.type === 'section') { onSection(m); return; }
  if (m.type === 'progress') progress(m.value);
  else if (m.type === 'rendered') {
    rendered = m; starts = m.starts;
    audio ||= new AudioContext();
    buffer = audio.createBuffer(2, m.left.length, m.sampleRate);
    buffer.copyToChannel(m.left, 0); buffer.copyToChannel(m.right, 1);
    progress(1);
    $('play').disabled = false; $('download').disabled = false;
    drawWave();
    play(0);
  } else if (m.type === 'generated') {
    setSong(m.song);
    status(`generated seed ${m.song.meta.seed}`);
  } else if (m.type === 'error') {
    status(`error: ${m.message}`);
    $('play').disabled = false;
    console.error(m.message);
  }
};

async function loadUrl(url) {
  status('loading…');
  const res = await fetch(url);
  if (!res.ok) { status(`could not load ${url}`); return; }
  setSong(await res.json());
}

for (const [name, url] of EXAMPLES) $('examples').add(new Option(name, url));
for (const [name, url] of STYLES) $('styles').add(new Option(name, url));
$('examples').onchange = () => loadUrl($('examples').value);
$('file').onchange = async () => { const f = $('file').files[0]; if (f) setSong(JSON.parse(await f.text())); };
$('generate').onclick = async () => {
  status('generating…');
  const style = await (await fetch($('styles').value)).json();
  worker.postMessage({ type: 'generate', style, seed: parseInt($('seed').value, 10) || 0, minutes: parseFloat($('minutes').value) || 4 });
};
$('play').onclick = () => { if (buffer) play(0); else render(); };
$('stop').onclick = stop;
$('download').onclick = () => {
  const wav = encodeWav(rendered.left, rendered.right, rendered.sampleRate);
  const blob = new Blob([wav], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(song.meta?.title || 'song').replace(/[^\w-]+/g, '_')}.wav`;
  a.click();
};
$('examples').value = EXAMPLES[1][1];
loadUrl(EXAMPLES[1][1]);
