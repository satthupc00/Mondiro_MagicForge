// Properties panel: edits the parameters of the selected node.
import { NODE_TYPES, CATEGORY_COLORS, GRADIENT_PRESETS, paramVisible } from './nodes.js';

const toHex = (c) => '#' + c.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : (+v).toFixed(3).replace(/\.?0+$/, '') || '0');

function sampleGradient(stops, t) {
  const s = [...stops].sort((a, b) => a[0] - b[0]);
  if (t <= s[0][0]) return [...s[0][1]];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const k = (t - s[i - 1][0]) / Math.max(1e-5, s[i][0] - s[i - 1][0]);
      return s[i - 1][1].map((v, j) => v + (s[i][1][j] - v) * k);
    }
  }
  return [...s[s.length - 1][1]];
}

export class PropsPanel {
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks; // {onParam(id, key, value, commit), onImage(id, key, file), onReset(id)}
    this.node = null;
    this.show(null);
  }

  show(node) {
    this.node = node;
    const el = this.el;
    el.innerHTML = '';
    if (!node) {
      el.innerHTML = `<div class="pp-empty">Select a node to edit its properties.<br><br>Tip: double-click a node to show it in the 2D view.</div>`;
      return;
    }
    const def = NODE_TYPES[node.type];
    const head = document.createElement('div');
    head.className = 'pp-head';
    head.innerHTML = `<span class="pp-dot" style="background:${CATEGORY_COLORS[def.category]}"></span><span class="pp-name"></span><span class="pp-cat">${def.category}</span><button class="btn small pp-reset" title="Reset all parameters">Reset</button>`;
    head.querySelector('.pp-name').textContent = def.name;
    head.querySelector('.pp-reset').onclick = () => this.hooks.onReset(node.id);
    el.appendChild(head);

    if (!def.params.length) {
      el.insertAdjacentHTML('beforeend', `<div class="pp-empty small">This node has no parameters.</div>`);
    }
    for (const p of def.params) {
      if (!paramVisible(p, node.params)) continue;
      el.appendChild(this._control(node, p));
    }
    if (node.type === 'output') {
      el.insertAdjacentHTML('beforeend', `<div class="pp-note">Whatever reaches this node is what gets exported as the PNG sequence.<br>
      <b>Color Alpha × Alpha Input</b>: keeps transparency from Gradient Map / Set Alpha.<br>
      <b>From Brightness</b>: dark = transparent (good for black-background FX).<br>
      <b>Bake on Black</b>: opaque PNGs for engines using Additive blending.</div>`);
    }
  }

  _set(key, value, commit, rebuild = false) {
    this.node.params[key] = value;
    this.hooks.onParam(this.node.id, key, value, commit);
    if (rebuild) this.show(this.node);
  }

  _control(node, p) {
    const row = document.createElement('div');
    row.className = 'pp-row pp-' + p.type;
    const label = document.createElement('label');
    label.textContent = p.label;
    row.appendChild(label);
    const v = node.params[p.id];
    const hasDependents = NODE_TYPES[node.type].params.some(q => q.showIf && p.id in q.showIf);

    if (p.type === 'float' || p.type === 'int') {
      const step = p.type === 'int' ? 1 : (p.step || (p.max - p.min) / 1000);
      const wrap = document.createElement('div');
      wrap.className = 'pp-slider';
      wrap.innerHTML = `<input type="range" min="${p.min}" max="${p.max}" step="${step}"><input type="number" step="${step}">`;
      const [range, num] = wrap.querySelectorAll('input');
      range.value = v; num.value = fmt(v, step);
      range.oninput = () => { num.value = fmt(+range.value, step); this._set(p.id, +range.value, false); };
      range.onchange = () => this._set(p.id, +range.value, true, hasDependents);
      num.onchange = () => {
        let x = parseFloat(num.value);
        if (Number.isNaN(x)) x = v;
        if (p.type === 'int') x = Math.round(x);
        range.value = x; num.value = fmt(x, step);
        this._set(p.id, x, true, hasDependents);
      };
      row.appendChild(wrap);
      label.ondblclick = () => { range.value = p.def; num.value = fmt(p.def, step); this._set(p.id, p.def, true, hasDependents); };
      label.title = 'Double-click to reset';
    } else if (p.type === 'enum') {
      const sel = document.createElement('select');
      p.options.forEach((o, i) => sel.add(new Option(o, i)));
      sel.value = v;
      sel.onchange = () => this._set(p.id, +sel.value, true, true);
      row.appendChild(sel);
    } else if (p.type === 'bool') {
      const lab = document.createElement('label');
      lab.className = 'pp-toggle';
      lab.innerHTML = `<input type="checkbox"><span></span>`;
      const cb = lab.querySelector('input');
      cb.checked = !!v;
      cb.onchange = () => this._set(p.id, cb.checked, true, true);
      row.appendChild(lab);
    } else if (p.type === 'color') {
      const wrap = document.createElement('div');
      wrap.className = 'pp-color';
      wrap.innerHTML = `<input type="color"><span class="pp-mini">A</span><input type="range" min="0" max="1" step="0.01">`;
      const [col, alpha] = wrap.querySelectorAll('input');
      col.value = toHex(v); alpha.value = v[3];
      const upd = (commit) => this._set(p.id, [...fromHex(col.value), +alpha.value], commit);
      col.oninput = () => upd(false); col.onchange = () => upd(true);
      alpha.oninput = () => upd(false); alpha.onchange = () => upd(true);
      row.appendChild(wrap);
    } else if (p.type === 'image') {
      const wrap = document.createElement('div');
      wrap.className = 'pp-image';
      wrap.innerHTML = `<button class="btn small">Load image…</button><span class="pp-mini"></span><input type="file" accept="image/png,image/jpeg,image/webp" hidden>`;
      const [btn] = wrap.querySelectorAll('button');
      const file = wrap.querySelector('input');
      wrap.querySelector('.pp-mini').textContent = v ? 'Image loaded' : 'No image';
      btn.onclick = () => file.click();
      file.onchange = () => { if (file.files[0]) this.hooks.onImage(node.id, p.id, file.files[0]); };
      row.appendChild(wrap);
    } else if (p.type === 'gradient') {
      row.classList.add('pp-wide');
      row.appendChild(this._gradientEditor(node, p));
    }
    return row;
  }

  _gradientEditor(node, p) {
    const wrap = document.createElement('div');
    wrap.className = 'pp-grad';
    wrap.innerHTML = `
      <div class="pp-grad-top">
        <select class="pp-grad-preset"><option value="">Presets…</option>${Object.keys(GRADIENT_PRESETS).map(k => `<option>${k}</option>`).join('')}</select>
        <button class="btn small pp-grad-rev" title="Reverse gradient">Reverse</button>
      </div>
      <div class="pp-grad-bar"><canvas width="512" height="28"></canvas><div class="pp-grad-stops"></div></div>
      <div class="pp-grad-edit">
        <input type="color" class="pp-grad-col" title="Stop color">
        <span class="pp-mini">Alpha</span><input type="range" min="0" max="1" step="0.01" class="pp-grad-alpha">
        <span class="pp-mini">Pos</span><input type="number" min="0" max="1" step="0.01" class="pp-grad-pos">
        <button class="btn small pp-grad-del" title="Delete stop">✕</button>
      </div>
      <div class="pp-mini pp-hint">Click the bar to add a stop · drag stops to move · max 8 stops</div>`;
    const canvas = wrap.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const stopsEl = wrap.querySelector('.pp-grad-stops');
    const bar = wrap.querySelector('.pp-grad-bar');
    const col = wrap.querySelector('.pp-grad-col');
    const alpha = wrap.querySelector('.pp-grad-alpha');
    const pos = wrap.querySelector('.pp-grad-pos');
    let stops = structuredClone(node.params[p.id]);
    let sel = 0;

    const draw = () => {
      const w = canvas.width, h = canvas.height;
      for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) {
        ctx.fillStyle = ((x + y) / 8) % 2 ? '#3a3a3a' : '#262626';
        ctx.fillRect(x, y, 8, 8);
      }
      const img = ctx.getImageData(0, 0, w, h);
      for (let x = 0; x < w; x++) {
        const c = sampleGradient(stops, x / (w - 1));
        for (let y = 0; y < h; y++) {
          const i = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) img.data[i + k] = img.data[i + k] * (1 - c[3]) + c[k] * 255 * c[3];
        }
      }
      ctx.putImageData(img, 0, 0);
      stopsEl.innerHTML = '';
      stops.forEach((s, i) => {
        const m = document.createElement('div');
        m.className = 'pp-grad-stop' + (i === sel ? ' sel' : '');
        m.style.left = `${s[0] * 100}%`;
        m.style.setProperty('--c', toHex(s[1]));
        m.dataset.i = i;
        stopsEl.appendChild(m);
      });
      const s = stops[sel];
      col.value = toHex(s[1]); alpha.value = s[1][3]; pos.value = s[0].toFixed(2);
    };
    const emit = (commit) => this._set(p.id, structuredClone(stops), commit);

    bar.addEventListener('pointerdown', (e) => {
      const r = bar.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const marker = e.target.closest('.pp-grad-stop');
      if (marker) sel = +marker.dataset.i;
      else {
        if (stops.length >= 8) return;
        stops.push([t, sampleGradient(stops, t)]);
        sel = stops.length - 1;
        emit(true);
      }
      draw();
      bar.setPointerCapture(e.pointerId);
      let moved = false;
      const move = (ev) => {
        stops[sel][0] = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
        moved = true;
        draw(); emit(false);
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        if (moved) emit(true);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
    const updCol = (commit) => { stops[sel][1] = [...fromHex(col.value), +alpha.value]; draw(); emit(commit); };
    col.oninput = () => updCol(false); col.onchange = () => updCol(true);
    alpha.oninput = () => updCol(false); alpha.onchange = () => updCol(true);
    pos.onchange = () => { stops[sel][0] = Math.min(1, Math.max(0, +pos.value || 0)); draw(); emit(true); };
    wrap.querySelector('.pp-grad-del').onclick = () => {
      if (stops.length <= 2) return;
      stops.splice(sel, 1); sel = 0; draw(); emit(true);
    };
    wrap.querySelector('.pp-grad-rev').onclick = () => {
      stops = stops.map(s => [1 - s[0], s[1]]); draw(); emit(true);
    };
    wrap.querySelector('.pp-grad-preset').onchange = (e) => {
      if (!e.target.value) return;
      stops = structuredClone(GRADIENT_PRESETS[e.target.value]); sel = 0; e.target.value = '';
      draw(); emit(true);
    };
    draw();
    return wrap;
  }
}

