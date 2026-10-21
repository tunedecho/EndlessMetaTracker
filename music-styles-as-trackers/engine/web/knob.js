/**
 * A rotary knob, 0..1. Drag up or down (Shift for fine), scroll, or use the
 * arrow keys when focused; double-click returns it to its default.
 * Calls onInput while it moves and onChange when a gesture ends.
 */
const ARC = 270; // degrees of travel
const R = 17;

function arc(from, to) {
  const p = (a) => { const r = ((a - 90) * Math.PI) / 180; return [22 + R * Math.cos(r), 22 + R * Math.sin(r)]; };
  const [x1, y1] = p(from), [x2, y2] = p(to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function knob({ label, title = '', value = 0, defaultValue = 0, onInput = () => {}, onChange = () => {} }) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.tabIndex = 0;
  el.title = title;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.innerHTML = `<svg viewBox="0 0 44 44" width="44" height="44"><path class="track" d="${arc(-ARC / 2, ARC / 2)}"/><path class="fill"/><line class="tick" x1="22" y1="22" x2="22" y2="8"/></svg><b></b><span>${label}</span>`;
  const fill = el.querySelector('.fill'), tick = el.querySelector('.tick'), num = el.querySelector('b');
  let v = value;
  const draw = () => {
    const a = -ARC / 2 + ARC * v;
    fill.setAttribute('d', v > 0.002 ? arc(-ARC / 2, a) : '');
    tick.setAttribute('transform', `rotate(${a} 22 22)`);
    num.textContent = Math.round(v * 100);
    el.classList.toggle('zero', v === 0);
    el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  const set = (x, done) => {
    x = Math.min(1, Math.max(0, Math.round(x * 1000) / 1000));
    if (x !== v) { v = x; draw(); onInput(v); }
    if (done) onChange(v);
  };
  el.onpointerdown = (e) => {
    el.setPointerCapture(e.pointerId);
    el.focus();
    let y = e.clientY;
    el.onpointermove = (m) => { set(v + (y - m.clientY) * (m.shiftKey ? 0.001 : 0.006)); y = m.clientY; };
    el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; set(v, true); };
  };
  let wheelTimer = 0;
  el.onwheel = (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * 0.02); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => onChange(v), 250); };
  el.ondblclick = () => set(defaultValue, true);
  el.onkeydown = (e) => {
    const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    set(v + d * (e.shiftKey ? 0.2 : 1), true);
  };
  draw();
  return { el, get value() { return v; }, set value(x) { v = Math.min(1, Math.max(0, x)); draw(); } };
}
