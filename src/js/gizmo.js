// On-canvas transform gizmo for the Transform node: move, scale and rotate
// directly in the 2D view.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROT_HANDLE = 28; // px above the top edge

// Same curves as anim() in the shaders.
function anim(mode, t) {
  t = Math.min(1, Math.max(0, t));
  switch (mode) {
    case 0: return 0;
    case 1: return t;
    case 2: return t * t;
    case 3: return 1 - (1 - t) * (1 - t);
    case 4: return t * t * (3 - 2 * t);
    default: return 0.5 - 0.5 * Math.cos(Math.PI * 2 * t);
  }
}

const rot = (x, y, a) => [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y];
const wrapDeg = (d) => ((d + 540) % 360 + 360) % 360 - 180;

export class TransformGizmo {
  // hooks: { canvas, getRect(), getAspect(), getPhase(), onChange(commit) }
  constructor(host, hooks) {
    this.hooks = hooks;
    this.node = null;
    this.drag = null;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('gizmo', 'hidden');
    this.svg.innerHTML = `
      <rect class="gz-catch" x="0" y="0" width="100%" height="100%" data-h="rotate"/>
      <polygon class="gz-box" data-h="move"/>
      <line class="gz-stem"/>
      <circle class="gz-rot" r="6" data-h="rotate"/>
      <g class="gz-handles"></g>
      <path class="gz-center"/>
      <text class="gz-label" x="10" y="18"></text>`;
    const g = this.svg.querySelector('.gz-handles');
    for (const h of ['c0', 'c1', 'c2', 'c3', 'ex0', 'ey0', 'ex1', 'ey1']) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('width', 10); r.setAttribute('height', 10);
      r.dataset.h = h;
      r.classList.add(h[0] === 'c' ? 'gz-corner' : 'gz-edge');
      g.appendChild(r);
    }
    host.appendChild(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this._down(e));
    this.svg.addEventListener('pointermove', (e) => this._move(e));
    this.svg.addEventListener('pointerup', (e) => this._up(e));
    this.svg.addEventListener('pointercancel', (e) => this._up(e));
  }

  setNode(node) {
    this.node = node && node.type === 'transform' ? node : null;
    this.update();
  }

  // Which parameter set the gizmo edits: Start, or End when animating and
  // the current frame is closer to the End values. `w` is how much that set
  // shows at this frame, so drags can be scaled to follow the mouse.
  _keys() {
    const p = this.node.params;
    const k = p.animate ? anim(p.animate, this.hooks.getPhase()) : 0;
    const end = p.animate > 0 && k >= 0.5;
    return {
      k, end, w: Math.max(0.05, end ? k : 1 - k),
      offX: end ? 'offXEnd' : 'offX', offY: end ? 'offYEnd' : 'offY',
      rotation: end ? 'rotationEnd' : 'rotation', scale: end ? 'scaleEnd' : 'scale',
      scaleX: end ? 'scaleXEnd' : 'scaleX', scaleY: end ? 'scaleYEnd' : 'scaleY',
    };
  }

  // Current (animated) transform in centred image units (short side = 1, y up).
  _state() {
    const p = this.node.params;
    const k = p.animate ? anim(p.animate, this.hooks.getPhase()) : 0;
    const mix = (a, b) => a + (b - a) * k;
    const phase = this.hooks.getPhase();
    return {
      off: [mix(p.offX, p.offXEnd), mix(p.offY, p.offYEnd)],
      rot: (mix(p.rotation, p.rotationEnd) * Math.PI) / 180 + Math.PI * 2 * p.spin * phase,
      sx: Math.max(0.001, mix(p.scale, p.scaleEnd) * mix(p.scaleX, p.scaleXEnd)),
      sy: Math.max(0.001, mix(p.scale, p.scaleEnd) * mix(p.scaleY, p.scaleYEnd)),
    };
  }

  // Centred image units <-> CSS pixels in the viewer.
  _toScreen(x, y) {
    const { r, S } = this.view;
    return [r.x + r.w / 2 + x * S, r.y + r.h / 2 - y * S];
  }
  _fromScreen(px, py) {
    const { r, S } = this.view;
    return [(px - r.x - r.w / 2) / S, -(py - r.y - r.h / 2) / S];
  }

  update() {
    const rect = this.node && this.hooks.getRect();
    if (!this.node || !rect) { this.svg.classList.add('hidden'); return; }
    this.svg.classList.remove('hidden');
    const dpr = window.devicePixelRatio || 1;
    const r = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };
    this.view = { r, S: Math.min(r.w, r.h) };
    const [ax, ay] = this.hooks.getAspect(); // half extents of the input image in centred units
    const st = this._state();
    const local = [[-ax, ay], [ax, ay], [ax, -ay], [-ax, -ay]];
    const world = local.map(([x, y]) => {
      const [rx, ry] = rot(x * st.sx, y * st.sy, st.rot);
      return this._toScreen(rx + st.off[0], ry + st.off[1]);
    });
    this.corners = world;
    this.svg.querySelector('.gz-box').setAttribute('points', world.map(p => p.join(',')).join(' '));
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const edges = { ex1: mid(world[1], world[2]), ex0: mid(world[3], world[0]), ey0: mid(world[0], world[1]), ey1: mid(world[2], world[3]) };
    const place = (el, [x, y]) => { el.setAttribute('x', x - 5); el.setAttribute('y', y - 5); };
    this.svg.querySelectorAll('.gz-handles rect').forEach(el => {
      const h = el.dataset.h;
      place(el, h[0] === 'c' ? world[+h[1]] : edges[h]);
    });
    // Rotation handle: above the top edge, along the box's local up axis.
    const top = edges.ey0;
    const [ux, uy] = rot(0, 1, st.rot);
    const flip = st.sy < 0 ? -1 : 1;
    let rh = [top[0] + ux * ROT_HANDLE * flip, top[1] - uy * ROT_HANDLE * flip];
    // Keep the handle reachable: point it into the box when it would leave the view.
    const vw = this.svg.clientWidth, vh = this.svg.clientHeight;
    if (rh[0] < 8 || rh[1] < 8 || rh[0] > vw - 8 || rh[1] > vh - 8) {
      rh = [top[0] - ux * ROT_HANDLE * flip, top[1] + uy * ROT_HANDLE * flip];
    }
    const stem = this.svg.querySelector('.gz-stem');
    stem.setAttribute('x1', top[0]); stem.setAttribute('y1', top[1]);
    stem.setAttribute('x2', rh[0]); stem.setAttribute('y2', rh[1]);
    const rc = this.svg.querySelector('.gz-rot');
    rc.setAttribute('cx', rh[0]); rc.setAttribute('cy', rh[1]);
    const c = this._toScreen(st.off[0], st.off[1]);
    this.svg.querySelector('.gz-center').setAttribute('d', `M${c[0] - 6} ${c[1]}H${c[0] + 6}M${c[0]} ${c[1] - 6}V${c[1] + 6}`);
    const p = this.node.params;
    this.svg.querySelector('.gz-label').textContent = p.animate > 0
      ? `Animated: editing ${this._keys().end ? 'END' : 'START'} values at this frame`
      : '';
  }

  _local(e) {
    const b = this.svg.getBoundingClientRect();
    return this._fromScreen(e.clientX - b.left, e.clientY - b.top);
  }

  _down(e) {
    const h = e.target.dataset?.h;
    if (!h || !this.node || e.button !== 0) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    const st = this._state();
    const keys = this._keys();
    const p = this.node.params;
    this.drag = {
      h, keys, st,
      start: this._local(e),
      p0: { ...p },
      moved: false,
    };
  }

  _move(e) {
    const d = this.drag;
    if (!d) return;
    const m = this._local(e);
    const { st, keys, p0, start } = d;
    const p = this.node.params;
    const c = st.off;
    if (d.h === 'move') {
      p[keys.offX] = p0[keys.offX] + (m[0] - start[0]) / keys.w;
      p[keys.offY] = p0[keys.offY] + (m[1] - start[1]) / keys.w;
    } else if (d.h === 'rotate') {
      // Accumulate the angle step by step so full turns keep counting.
      const a1 = Math.atan2(m[1] - c[1], m[0] - c[0]);
      if (d.lastA === undefined) d.lastA = Math.atan2(start[1] - c[1], start[0] - c[0]);
      let da = a1 - d.lastA;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      d.acc = (d.acc || 0) + da;
      d.lastA = a1;
      let deg = p0[keys.rotation] + (d.acc * 180) / Math.PI / keys.w;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      p[keys.rotation] = wrapDeg(deg);
    } else if (d.h[0] === 'c') {
      const r0 = Math.hypot(start[0] - c[0], start[1] - c[1]);
      const r1 = Math.hypot(m[0] - c[0], m[1] - c[1]);
      if (r0 > 1e-4) p[keys.scale] = Math.max(0.01, p0[keys.scale] * (r1 / r0));
    } else {
      // Edge handle: scale along the box's own X or Y axis.
      const axis = d.h[1] === 'x' ? rot(1, 0, st.rot) : rot(0, 1, st.rot);
      const proj = (q) => (q[0] - c[0]) * axis[0] + (q[1] - c[1]) * axis[1];
      const s0 = proj(start), s1 = proj(m);
      if (Math.abs(s0) > 1e-4) {
        const key = d.h[1] === 'x' ? keys.scaleX : keys.scaleY;
        p[key] = Math.max(0.01, p0[key] * (s1 / s0));
      }
    }
    d.moved = true;
    this.update();
    this.hooks.onChange(false);
  }

  _up(e) {
    const d = this.drag;
    this.drag = null;
    if (d?.moved) this.hooks.onChange(true);
  }
}
