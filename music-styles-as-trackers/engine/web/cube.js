/**
 * Parameter cube: the tracker grid with a third axis. Tracks run across,
 * steps run down, and every parameter shaping a step runs into the screen,
 * one lane each. Built on cube-data.js; drawn with three.js as one instanced
 * mesh. Plays through the same live worklet as the player.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toName } from '../../format/lib/core.js';
import { generateSong } from '../../endless-techno/lib/generate.js';
import { EXAMPLES, STYLES } from './catalog.js';
import { cubeModel, GROUPS, SOURCE } from './cube-data.js';

const $ = (id) => document.getElementById(id);
const SZ = 1; // lane spacing; track and step spacing follow the shape of the data
let SX = 1.4, SY = 0.5;
const HUE = { note: 210, step: 35, track: 0, instrument: 275, params: 160, filter: 190, amp: 52, lfo: 320, mix: 120 };
const HOVER_LIMIT = 40000; // instances; raycasting more on every move is too slow
const FROM_PLAYER = 'from-player';

let defs = null, song = null, model = null;
let mesh = null, owners = [], byStep = new Map(), lifted = [];
const hidden = new Set();
let audio = null, node = null, ready = null, playing = false;

/* ------------------------------------------------------------- scene */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 2, 3);
scene.add(sun);
const frame = new THREE.Group();
scene.add(frame);
const playhead = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
playhead.rotation.x = -Math.PI / 2;
playhead.visible = false;
scene.add(playhead);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------- layout */

/** Lanes on show, in order: hidden groups and the slice selector decide. */
function visibleLanes() {
  const slice = $('lane').value;
  return model.lanes.map((l, i) => i).filter((i) => (slice === '' ? !hidden.has(model.lanes[i].group) : String(i) === slice));
}

let laneZ = new Map(), size = { x: 1, y: 1, z: 1 };
const pos = (track, step, lane) => new THREE.Vector3(track * SX - size.x / 2, -step * SY + size.y / 2, -laneZ.get(lane) * SZ + size.z / 2);

function color(lane, cell, i) {
  const v = cell.value[i];
  const c = new THREE.Color();
  if (lane.key === 'pitch') c.setHSL(((cell.raw[i] % 12) / 12), 0.75, 0.5 + 0.15 * v); // pitch class as hue
  else if (cell.source[i] === SOURCE.unset) c.setHSL(HUE[lane.group] / 360, 0.08, 0.22 + 0.2 * v);
  else c.setHSL(HUE[lane.group] / 360, cell.source[i] === SOURCE.command ? 0.35 : 0.7, 0.28 + 0.35 * v + (cell.source[i] === SOURCE.command ? 0.15 : 0));
  if (cell.changed[i]) c.lerp(new THREE.Color(0xffffff), 0.35);
  return c;
}

function build() {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  frame.clear();
  owners = []; byStep = new Map(); lifted = [];
  const lanes = visibleLanes();
  laneZ = new Map(lanes.map((li, z) => [li, z]));
  // Keep the cube roughly cubic: long songs squeeze time, few tracks spread out.
  const depth = Math.max(lanes.length * SZ, 24);
  SY = Math.min(0.6, Math.max(0.1, depth / Math.max(1, model.steps)));
  SX = Math.min(4, Math.max(1.4, depth * 0.7 / model.tracks.length));
  size = { x: (model.tracks.length - 1) * SX, y: model.steps * SY, z: Math.max(0, lanes.length - 1) * SZ };
  const changesOnly = $('changes').checked;
  const items = [];
  for (const cell of model.cells) {
    if (cell.kind === 'off') { if (lanes.length) items.push({ cell, lane: null }); continue; }
    for (const li of lanes) {
      const v = cell.value[li];
      if (Number.isNaN(v)) continue;
      if (changesOnly && !cell.changed[li] && model.lanes[li].group !== 'note') continue;
      items.push({ cell, lane: li });
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial();
  mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const offColor = new THREE.Color(0x4a5060);
  items.forEach(({ cell, lane }, k) => {
    if (lane === null) {
      // An OFF is a thin plate across the lanes.
      const p = pos(cell.track, cell.step, lanes[0] ?? 0);
      p.z -= size.z / 2;
      s.set(Math.min(SX * 0.8, 1.2), SY * 0.15, size.z + SZ * 0.8);
      mesh.setColorAt(k, offColor);
      m.compose(p, q, s);
    } else {
      const f = 0.22 + 0.78 * cell.value[lane];
      s.set(Math.min(SX * 0.8, 1.2) * f, SY * 0.85 * f, SZ * 0.8 * f);
      m.compose(pos(cell.track, cell.step, lane), q, s);
      mesh.setColorAt(k, color(model.lanes[lane], cell, lane));
    }
    mesh.setMatrixAt(k, m);
    owners.push({ cell, lane, scale: s.clone() });
    if (!byStep.has(cell.step)) byStep.set(cell.step, []);
    byStep.get(cell.step).push(k);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  buildFrame(lanes);
  buildLabels(lanes);
  playhead.scale.set(size.x + SX, size.z + SZ, 1);
  $('status').textContent = `${model.cells.length} written steps · ${lanes.length} parameters · ${items.length} values`;
}

/** Edges of the cube, and a line at every row and phrase start. */
function buildFrame(lanes) {
  const w = size.x / 2 + SX * 0.6, h = size.y / 2, d = size.z / 2 + SZ * 0.6;
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 2, h * 2 + SY, d * 2)), new THREE.LineBasicMaterial({ color: 0x3b4252 }));
  box.position.y = -SY / 2;
  frame.add(box);
  const pts = [], rowPts = [];
  for (let st = 0; st < model.steps; st += model.phraseLength) {
    const y = -st * SY + size.y / 2 + SY / 2;
    const into = model.rows.some((r) => r.step === st) ? rowPts : pts;
    into.push(-w, y, d, w, y, d, -w, y, d, -w, y, -d);
  }
  const line = (arr, c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: c })); };
  frame.add(line(pts, 0x2a2f3a), line(rowPts, 0x7a5a1c));
}

/* ------------------------------------------------------------- labels */

let labels = [];
function label(text, cls, at, title) {
  const d = document.createElement('div');
  d.textContent = text;
  d.className = cls;
  if (title) d.title = title;
  $('labels').appendChild(d);
  labels.push({ el: d, at, cls });
}

function buildLabels(lanes) {
  $('labels').innerHTML = '';
  labels = [];
  const top = size.y / 2 + 1;
  model.tracks.forEach((t, i) => label(t.id, 'track', new THREE.Vector3(i * SX - size.x / 2, top, size.z / 2 + SZ)));
  const right = size.x / 2 + SX;
  let lastGroup = null;
  lanes.forEach((li) => {
    const lane = model.lanes[li];
    const z = -laneZ.get(li) * SZ + size.z / 2;
    label(lane.label, 'lane', new THREE.Vector3(right + SX * 0.3, top, z));
    if (lane.group !== lastGroup) {
      lastGroup = lane.group;
      label(lane.group, 'group', new THREE.Vector3(-size.x / 2 - SX, top + 1, z));
      labels.at(-1).el.style.color = `hsl(${HUE[lane.group]} 70% 60%)`;
    }
  });
  for (const r of model.rows) label(`row ${r.row}${r.name ? ` ${r.name}` : ''}`, 'row', new THREE.Vector3(-size.x / 2 - SX, -r.step * SY + size.y / 2, size.z / 2));
}

const v3 = new THREE.Vector3();
function placeLabels() {
  // Lane labels pile up when looking straight down the lane axis; hide them then.
  const lanes = labels.filter((l) => l.cls === 'lane');
  let spread = Infinity;
  if (lanes.length > 1) {
    const a = v3.copy(lanes[0].at).project(camera), ax = a.x, ay = a.y;
    const b = v3.copy(lanes.at(-1).at).project(camera);
    spread = Math.hypot((b.x - ax) * innerWidth, (b.y - ay) * innerHeight) / 2 / lanes.length;
  }
  for (const l of labels) {
    v3.copy(l.at).project(camera);
    const show = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1 && !((l.cls === 'lane' || l.cls === 'group') && spread < 9);
    l.el.style.display = show ? '' : 'none';
    if (show) { l.el.style.left = `${(v3.x + 1) / 2 * innerWidth}px`; l.el.style.top = `${(1 - v3.y) / 2 * innerHeight}px`; }
  }
}

/* ------------------------------------------------------------- camera */

let tween = null;
function view(name, instant = false) {
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === name);
  const r = Math.hypot(size.x, size.y, size.z) * 1.25 + 10;
  const dir = { iso: [0.9, 0.55, 1.1], front: [0, 0, 1], side: [1, 0, 0.001], top: [0, 1, 0.001] }[name];
  const to = new THREE.Vector3(...dir).normalize().multiplyScalar(r);
  if (instant) { camera.position.copy(to); controls.target.set(0, 0, 0); return; }
  tween = { from: camera.position.clone(), to, t0: performance.now(), target0: controls.target.clone() };
}
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => view(b.dataset.view);

/* ------------------------------------------------------------- hover */

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let lastRay = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  const tip = $('tip');
  if (!mesh || e.buttons || performance.now() - lastRay < 50) return;
  lastRay = performance.now();
  if (mesh.count > HOVER_LIMIT) { tip.style.display = 'none'; return; }
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObject(mesh)[0];
  if (!hit) { tip.style.display = 'none'; return; }
  const { cell, lane } = owners[hit.instanceId];
  const t = model.tracks[cell.track];
  const head = `<b>${t.id}</b> · row ${cell.row} step ${cell.rowStep.toString(16).toUpperCase().padStart(2, '0')}${cell.inst ? ` · ${cell.inst}` : ''}`;
  if (lane === null) tip.innerHTML = `${head}\nOFF: releases the note`;
  else {
    const l = model.lanes[lane];
    const raw = cell.raw[lane];
    const shown = l.key === 'pitch' ? `${toName(raw)} (${raw})` : raw === null || raw === undefined ? '–' : String(raw);
    const src = { [SOURCE.set]: 'set', [SOURCE.unset]: 'unset: schema default', [SOURCE.command]: 'set by a track command' }[cell.source[lane]] || '';
    tip.innerHTML = `${head}\n<b>${l.label}</b> = ${shown}  <span style="color:var(--dim)">${src}${cell.changed[lane] ? ', changed' : ''}</span>${l.description ? `\n<span style="color:var(--dim)">${l.description}</span>` : ''}`;
  }
  tip.style.display = 'block';
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 350)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});
renderer.domElement.addEventListener('pointerleave', () => { $('tip').style.display = 'none'; });

/* ------------------------------------------------------------- playback */

function startAudio() {
  ready ||= (async () => {
    audio = new AudioContext({ latencyHint: 'interactive' });
    await audio.audioWorklet.addModule(new URL('./synth-worklet.js', import.meta.url));
    node = new AudioWorkletNode(audio, 'synth', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = (e) => onLive(e.data);
    node.connect(audio.destination);
  })().catch((e) => { $('status').textContent = `audio failed: ${e.message}`; ready = null; throw e; });
  if (audio?.state === 'suspended') audio.resume();
  return ready;
}

function rowRange() {
  const v = $('rows').value;
  return v === '' ? { from: 0, to: song.composition.song.rows.length } : { from: Number(v), to: Number(v) + 1 };
}

async function play() {
  if (playing) { stop(); return; }
  await startAudio();
  const { from, to } = rowRange();
  node.port.postMessage({ type: 'play', song, row: from, loop: to - from === 1 });
  playing = true;
  $('play').textContent = 'Stop';
}

function stop() {
  if (node) node.port.postMessage({ type: 'stop' });
  playing = false;
  $('play').textContent = 'Play';
  playhead.visible = false;
  lift(-1);
}

/** Raise the boxes of the step now playing. */
function lift(step) {
  if (!mesh) return;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const k of lifted) { mesh.getMatrixAt(k, m); m.decompose(p, q, s); m.compose(p, q, owners[k].scale); mesh.setMatrixAt(k, m); }
  lifted = byStep.get(step) || [];
  for (const k of lifted) { mesh.getMatrixAt(k, m); m.decompose(p, q, s); m.compose(p, q, owners[k].scale.clone().multiplyScalar(1.45)); mesh.setMatrixAt(k, m); }
  mesh.instanceMatrix.needsUpdate = true;
}

function onLive(m) {
  if (m.type === 'ended') { stop(); return; }
  if (m.type !== 'pos' || !playing) return;
  const r = model.rows.find((x) => x.row === m.row);
  if (!r) return;
  const step = r.step + m.step;
  playhead.visible = true;
  playhead.position.set(0, -step * SY + size.y / 2, 0);
  lift(step);
}

/* ------------------------------------------------------------- sources */

function setSong(s) {
  stop();
  song = s;
  const rows = song.composition.song.rows;
  const sections = new Map((song.composition.song.sections || []).map((x) => [x.row, x]));
  const full = cubeModel(song, defs);
  $('rows').innerHTML = '';
  $('rows').add(new Option(`all rows (${full.steps} steps)`, ''));
  const counts = rows.map((_, i) => full.cells.filter((c) => c.row === i).length);
  rows.forEach((_, i) => $('rows').add(new Option(`row ${i}${sections.get(i)?.name ? ` · ${sections.get(i).name}` : ''} (${full.rows[i]?.steps ?? 0} steps)`, String(i))));
  // Small songs show whole; long ones open on their busiest row.
  $('rows').value = full.steps <= 400 ? '' : String(counts.indexOf(Math.max(...counts)));
  loadRows(true);
}

function loadRows(fresh = false) {
  stop();
  model = cubeModel(song, defs, rowRange());
  const slice = $('lane').value;
  $('lane').innerHTML = '';
  $('lane').add(new Option('all parameters', ''));
  let group = null;
  model.lanes.forEach((l, i) => {
    if (l.group !== group) { group = document.createElement('optgroup'); group.label = l.group; $('lane').appendChild(group); }
    group.appendChild(new Option(l.label, String(i)));
  });
  $('lane').value = model.lanes[slice] ? slice : '';
  legend();
  build();
  if (fresh) view('iso', true);
}

function legend() {
  const g = $('groups');
  g.innerHTML = '';
  for (const [name, text] of Object.entries(GROUPS)) {
    const n = model.lanes.filter((l) => l.group === name).length;
    if (!n) continue;
    const l = document.createElement('label');
    l.title = text;
    l.innerHTML = `<input type="checkbox" ${hidden.has(name) ? '' : 'checked'}><i style="background:hsl(${HUE[name]} 70% 50%)"></i>${name}<small>${n}</small>`;
    l.querySelector('input').onchange = (e) => { if (e.target.checked) hidden.delete(name); else hidden.add(name); build(); };
    g.appendChild(l);
  }
}

async function loadSource(value) {
  $('status').textContent = 'loading…';
  if (value === FROM_PLAYER) { setSong(JSON.parse(sessionStorage.getItem('tracker-song'))); return; }
  const data = await (await fetch(value)).json();
  // A style is a recipe: generate a short song from it to look at.
  setSong(data.format === 'tracker-style/0.1' ? generateSong(data, { seed: 1, minutes: 2 }) : data);
}

/* ------------------------------------------------------------- start */

$('rows').onchange = () => loadRows(true);
$('lane').onchange = () => build();
$('changes').onchange = () => build();
$('play').onclick = play;
$('source').onchange = () => loadSource($('source').value);
addEventListener('keydown', (e) => { if (e.key === ' ' && !/^(INPUT|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); play(); } });

renderer.setAnimationLoop((t) => {
  if (tween) {
    const k = Math.min(1, (t - tween.t0) / 600), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(tween.from, tween.to, e);
    controls.target.lerpVectors(tween.target0, new THREE.Vector3(), e);
    if (k >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
  placeLabels();
});

defs = (await (await fetch('../../format/schema/song.json')).json()).$defs;
let fromPlayer = null;
try { fromPlayer = sessionStorage.getItem('tracker-song'); } catch {}
if (fromPlayer) $('source').add(new Option('the song open in the player', FROM_PLAYER));
const songs = document.createElement('optgroup'); songs.label = 'Songs';
for (const [name, url] of EXAMPLES) songs.appendChild(new Option(name, url));
const styles = document.createElement('optgroup'); styles.label = 'Styles (generated, seed 1)';
for (const [name, url] of STYLES) styles.appendChild(new Option(name, url));
$('source').append(songs, styles);
$('source').value = fromPlayer && location.hash === '#player' ? FROM_PLAYER : EXAMPLES[1][1];
await loadSource($('source').value);
