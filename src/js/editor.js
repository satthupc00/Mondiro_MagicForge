// Node graph editor (DOM nodes + SVG wires), Substance-Designer style.
import { NODE_TYPES, CATEGORIES, CATEGORY_COLORS } from './nodes.js';

export const NODE_W = 116;
const HEAD_H = 22;
const PAD = 8;
const THUMB = 96;
export const NODE_H = HEAD_H + THUMB + PAD * 2;
const IN_Y0 = HEAD_H + PAD + 14;
const IN_DY = 30;

const SVG_NS = 'http://www.w3.org/2000/svg';

export class NodeEditor {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks; // {onChange(kind), onSelect(id), onView(id)}
    this.graph = null;
    this.view = { x: 40, y: 40, zoom: 1 };
    this.selected = new Set();
    this.els = new Map(); // id -> {el, canvas, ctx}
    this.drag = null;

    root.innerHTML = `
      <div class="ge-viewport">
        <div class="ge-layer">
          <svg class="ge-wires"><g class="ge-wire-group"></g><path class="ge-temp-wire" d=""/></svg>
          <div class="ge-nodes"></div>
        </div>
        <div class="ge-select-box"></div>
        <div class="ge-hint">Right-click / Double-click: add node · Drag wire to empty space: add & connect · Wheel: zoom · Middle/Right drag: pan · F: frame all</div>
      </div>
      <div class="ge-menu hidden">
        <input class="ge-menu-search" placeholder="Search nodes..." spellcheck="false" />
        <div class="ge-menu-list"></div>
      </div>`;
    this.viewport = root.querySelector('.ge-viewport');
    this.layer = root.querySelector('.ge-layer');
    this.wireGroup = root.querySelector('.ge-wire-group');
    this.tempWire = root.querySelector('.ge-temp-wire');
    this.nodesEl = root.querySelector('.ge-nodes');
    this.selBox = root.querySelector('.ge-select-box');
    this.menu = root.querySelector('.ge-menu');
    this.menuSearch = root.querySelector('.ge-menu-search');
    this.menuList = root.querySelector('.ge-menu-list');

    this._bindEvents();
    this._applyView();
  }

  setGraph(graph) {
    this.graph = graph;
    this.selected.clear();
    this.rebuild();
  }

  // ------------------------------------------------------------------ DOM
  rebuild() {
    this.nodesEl.innerHTML = '';
    this.els.clear();
    for (const node of this.graph.nodes.values()) this._createNodeEl(node);
    this.refreshSelection();
    this.drawWires();
  }

  _createNodeEl(node) {
    const def = NODE_TYPES[node.type];
    const el = document.createElement('div');
    el.className = 'ge-node' + (node.type === 'output' ? ' ge-output' : '');
    el.dataset.id = node.id;
    el.style.setProperty('--cat', CATEGORY_COLORS[def.category]);
    el.innerHTML = `
      <div class="ge-head"><span class="ge-title"></span></div>
      <div class="ge-body"><canvas class="ge-thumb" width="${THUMB}" height="${THUMB}"></canvas></div>
      <div class="ge-out" title="Output"><span class="ge-sock"></span></div>`;
    el.querySelector('.ge-title').textContent = def.name;
    if (node.type === 'output') el.querySelector('.ge-out').remove();
    def.inputs.forEach((inp, i) => {
      const s = document.createElement('div');
      s.className = 'ge-in';
      s.dataset.i = i;
      s.style.top = `${IN_Y0 + i * IN_DY - 7}px`;
      s.title = inp.name;
      s.innerHTML = `<span class="ge-sock"></span><span class="ge-in-label"></span>`;
      s.querySelector('.ge-in-label').textContent = inp.name;
      el.appendChild(s);
    });
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    this.nodesEl.appendChild(el);
    const canvas = el.querySelector('canvas');
    this.els.set(node.id, { el, canvas, ctx: canvas.getContext('2d') });
  }

  setThumb(id, imageData) {
    const e = this.els.get(id);
    if (e && imageData) e.ctx.putImageData(imageData, 0, 0);
  }

  setLocked(id) {
    for (const [nid, e] of this.els) e.el.classList.toggle('locked', nid === id);
  }

  refreshSelection() {
    for (const [id, e] of this.els) e.el.classList.toggle('selected', this.selected.has(id));
    this.drawWires();
  }

  select(ids, primary) {
    this.selected = new Set(ids);
    this.refreshSelection();
    this.hooks.onSelect(primary ?? [...this.selected][this.selected.size - 1] ?? null);
  }

  // ------------------------------------------------------------------ wires
  socketPos(id, kind, i = 0) {
    const n = this.graph.nodes.get(id);
    if (kind === 'out') return { x: n.x + NODE_W, y: n.y + HEAD_H + PAD + THUMB / 2 };
    return { x: n.x, y: n.y + IN_Y0 + i * IN_DY };
  }

  _wirePath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  drawWires() {
    if (!this.graph) return;
    let html = '';
    const connected = new Set();
    for (const l of this.graph.links) {
      if (!this.graph.nodes.has(l.from) || !this.graph.nodes.has(l.to)) continue;
      const a = this.socketPos(l.from, 'out');
      const b = this.socketPos(l.to, 'in', l.input);
      const hi = this.selected.has(l.from) || this.selected.has(l.to);
      html += `<path class="ge-wire${hi ? ' hi' : ''}" d="${this._wirePath(a, b)}"/>`;
      connected.add(`${l.to}:${l.input}`);
      connected.add(`${l.from}:out`);
    }
    this.wireGroup.innerHTML = html;
    for (const [id, e] of this.els) {
      e.el.querySelectorAll('.ge-in').forEach(s => s.classList.toggle('connected', connected.has(`${id}:${s.dataset.i}`)));
      const o = e.el.querySelector('.ge-out');
      if (o) o.classList.toggle('connected', connected.has(`${id}:out`));
    }
  }

  // ------------------------------------------------------------------ view
  _applyView() {
    const { x, y, zoom } = this.view;
    this.layer.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    const g = 24 * zoom;
    this.viewport.style.backgroundSize = `${g}px ${g}px, ${g * 5}px ${g * 5}px`;
    this.viewport.style.backgroundPosition = `${x}px ${y}px, ${x}px ${y}px`;
  }

  toLayer(clientX, clientY) {
    const r = this.viewport.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.x) / this.view.zoom, y: (clientY - r.top - this.view.y) / this.view.zoom };
  }

  viewCenter() {
    const r = this.viewport.getBoundingClientRect();
    return this.toLayer(r.left + r.width / 2, r.top + r.height / 2);
  }

  frameAll() {
    const nodes = [...this.graph.nodes.values()];
    if (!nodes.length) return;
    const r = this.viewport.getBoundingClientRect();
    const minX = Math.min(...nodes.map(n => n.x)) - 40, minY = Math.min(...nodes.map(n => n.y)) - 40;
    const maxX = Math.max(...nodes.map(n => n.x + NODE_W)) + 40, maxY = Math.max(...nodes.map(n => n.y + NODE_H)) + 40;
    const zoom = Math.min(1.2, Math.max(0.25, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    this.view = { zoom, x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom };
    this._applyView();
  }

  // ------------------------------------------------------------------ editing
  addNode(type, x, y) {
    const node = this.graph.addNode(type, Math.round(x), Math.round(y));
    this._createNodeEl(node);
    return node;
  }

  deleteSelected() {
    const ids = [...this.selected].filter(id => id !== 'output');
    if (!ids.length) return;
    for (const id of ids) {
      this.graph.removeNode(id);
      this.els.get(id)?.el.remove();
      this.els.delete(id);
      this.hooks.onRemoved?.(id);
    }
    this.selected.clear();
    this.drawWires();
    this.hooks.onSelect(null);
    this.hooks.onChange('structure');
  }

  duplicateSelected() {
    const ids = [...this.selected].filter(id => id !== 'output');
    if (!ids.length) return;
    const map = new Map();
    for (const id of ids) {
      const src = this.graph.nodes.get(id);
      const n = this.addNode(src.type, src.x + 30, src.y + 30);
      n.params = structuredClone(src.params);
      map.set(id, n.id);
    }
    // Keep links between duplicated nodes, and inputs coming from outside.
    for (const l of [...this.graph.links]) {
      if (map.has(l.to)) this.graph.connect(map.get(l.from) ?? l.from, map.get(l.to), l.input);
    }
    this.select([...map.values()]);
    this.hooks.onChange('structure');
  }

  // ------------------------------------------------------------------ add menu
  openMenu(clientX, clientY, pending = null) {
    this.menuPos = this.toLayer(clientX, clientY);
    this.menuPending = pending;
    const r = this.root.getBoundingClientRect();
    const mx = Math.min(clientX - r.left, r.width - 230);
    const my = Math.min(clientY - r.top, r.height - 340);
    this.menu.style.left = `${Math.max(4, mx)}px`;
    this.menu.style.top = `${Math.max(4, my)}px`;
    this.menu.classList.remove('hidden');
    this.menuSearch.value = '';
    this._fillMenu('');
    setTimeout(() => this.menuSearch.focus(), 0);
  }

  closeMenu() {
    this.menu.classList.add('hidden');
    this.menuPending = null;
    this.tempWire.setAttribute('d', '');
  }

  _menuTypes(filter) {
    const f = filter.trim().toLowerCase();
    const pending = this.menuPending;
    return Object.entries(NODE_TYPES).filter(([type, def]) => {
      if (type === 'output') return false;
      if (pending?.from && def.inputs.length === 0) return false; // needs an input to connect into
      return !f || def.name.toLowerCase().includes(f) || def.category.toLowerCase().includes(f);
    });
  }

  _fillMenu(filter) {
    const items = this._menuTypes(filter);
    let html = '';
    for (const cat of CATEGORIES) {
      const list = items.filter(([, d]) => d.category === cat);
      if (!list.length) continue;
      html += `<div class="ge-menu-cat" style="--cat:${CATEGORY_COLORS[cat]}">${cat}</div>`;
      for (const [type, d] of list) html += `<div class="ge-menu-item" data-type="${type}" style="--cat:${CATEGORY_COLORS[cat]}">${d.name}</div>`;
    }
    this.menuList.innerHTML = html || '<div class="ge-menu-empty">No match</div>';
    this.menuList.querySelector('.ge-menu-item')?.classList.add('active');
  }

  _pickMenu(type) {
    const pos = this.menuPos;
    const pending = this.menuPending;
    const node = this.addNode(type, pos.x - NODE_W / 2, pos.y - 20);
    if (pending?.from) this.graph.connect(pending.from, node.id, 0);
    if (pending?.to) this.graph.connect(node.id, pending.to, pending.input);
    this.closeMenu();
    this.drawWires();
    this.select([node.id]);
    this.hooks.onChange('structure');
  }

  // ------------------------------------------------------------------ events
  _bindEvents() {
    const vp = this.viewport;

    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z0 = this.view.zoom;
      const z1 = Math.min(2.5, Math.max(0.2, z0 * Math.exp(-e.deltaY * 0.0015)));
      this.view.x = mx - (mx - this.view.x) * (z1 / z0);
      this.view.y = my - (my - this.view.y) * (z1 / z0);
      this.view.zoom = z1;
      this._applyView();
    }, { passive: false });

    vp.addEventListener('contextmenu', (e) => e.preventDefault());

    vp.addEventListener('dblclick', (e) => {
      const hitNode = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ge-node');
      if (hitNode) {
        const id = hitNode.dataset.id;
        this.hooks.onView?.(id);
        return;
      }
      this.openMenu(e.clientX, e.clientY);
    });

    vp.addEventListener('pointerdown', (e) => {
      if (!this.menu.classList.contains('hidden')) this.closeMenu();
      const sockOut = e.target.closest('.ge-out');
      const sockIn = e.target.closest('.ge-in');
      const nodeEl = e.target.closest('.ge-node');
      vp.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY };

      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        this.drag = { kind: 'pan', start, view: { ...this.view }, button: e.button, moved: false };
        return;
      }
      if (e.button !== 0) return;

      if (sockOut && nodeEl) {
        this.drag = { kind: 'wire', from: nodeEl.dataset.id };
        return;
      }
      if (sockIn && nodeEl) {
        const to = nodeEl.dataset.id, input = +sockIn.dataset.i;
        const link = this.graph.inputLink(to, input);
        if (link) {
          this.graph.disconnect(to, input);
          this.drawWires();
          this.drag = { kind: 'wire', from: link.from, detached: true };
        } else {
          this.drag = { kind: 'wire', to, input };
        }
        return;
      }
      if (nodeEl) {
        const id = nodeEl.dataset.id;
        if (e.shiftKey || e.ctrlKey) {
          const s = new Set(this.selected);
          s.has(id) ? s.delete(id) : s.add(id);
          this.select([...s], id);
        } else if (!this.selected.has(id)) {
          this.select([id], id);
        } else {
          this.hooks.onSelect(id);
        }
        const orig = new Map([...this.selected].map(i => [i, { ...this.graph.nodes.get(i) }]));
        this.drag = { kind: 'move', start, orig, moved: false };
        return;
      }
      this.drag = { kind: 'box', start, additive: e.shiftKey || e.ctrlKey, prev: new Set(this.selected) };
    });

    vp.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pan') {
        const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        this.view.x = d.view.x + dx;
        this.view.y = d.view.y + dy;
        this._applyView();
      } else if (d.kind === 'move') {
        const dx = (e.clientX - d.start.x) / this.view.zoom, dy = (e.clientY - d.start.y) / this.view.zoom;
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
        for (const [id, o] of d.orig) {
          const n = this.graph.nodes.get(id);
          n.x = Math.round(o.x + dx);
          n.y = Math.round(o.y + dy);
          const el = this.els.get(id).el;
          el.style.left = `${n.x}px`;
          el.style.top = `${n.y}px`;
        }
        this.drawWires();
      } else if (d.kind === 'wire') {
        const p = this.toLayer(e.clientX, e.clientY);
        const path = d.from ? this._wirePath(this.socketPos(d.from, 'out'), p) : this._wirePath(p, this.socketPos(d.to, 'in', d.input));
        this.tempWire.setAttribute('d', path);
      } else if (d.kind === 'box') {
        const r = vp.getBoundingClientRect();
        const x0 = Math.min(d.start.x, e.clientX), y0 = Math.min(d.start.y, e.clientY);
        const x1 = Math.max(d.start.x, e.clientX), y1 = Math.max(d.start.y, e.clientY);
        Object.assign(this.selBox.style, { display: 'block', left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
        const a = this.toLayer(x0, y0), b = this.toLayer(x1, y1);
        const s = new Set(d.additive ? d.prev : []);
        for (const n of this.graph.nodes.values()) {
          if (n.x < b.x && n.x + NODE_W > a.x && n.y < b.y && n.y + NODE_H > a.y) s.add(n.id);
        }
        this.selected = s;
        this.refreshSelection();
        d.moved = true;
      }
    });

    vp.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'pan') {
        if (d.button === 2 && !d.moved) this.openMenu(e.clientX, e.clientY);
      } else if (d.kind === 'move') {
        if (d.moved) this.hooks.onChange('move');
      } else if (d.kind === 'box') {
        this.selBox.style.display = 'none';
        if (!d.moved && !d.additive) this.select([]);
        else this.hooks.onSelect([...this.selected][0] ?? null);
      } else if (d.kind === 'wire') {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const nodeEl = hit?.closest('.ge-node');
        const sockIn = hit?.closest('.ge-in');
        const sockOut = hit?.closest('.ge-out');
        let changed = !!d.detached;
        let handled = false;
        if (d.from && nodeEl && nodeEl.dataset.id !== d.from) {
          const to = nodeEl.dataset.id;
          let input = sockIn ? +sockIn.dataset.i : -1;
          if (input < 0) {
            // Dropped on the node body: use first free input (or the first one).
            const n = NODE_TYPES[this.graph.nodes.get(to).type].inputs.length;
            for (let i = 0; i < n; i++) if (!this.graph.inputLink(to, i)) { input = i; break; }
            if (input < 0 && n) input = 0;
          }
          if (input >= 0 && this.graph.connect(d.from, to, input)) changed = true;
          handled = true;
        } else if (d.to && nodeEl && nodeEl.dataset.id !== d.to && (sockOut || !sockIn)) {
          if (this.graph.nodes.get(nodeEl.dataset.id).type !== 'output' && this.graph.connect(nodeEl.dataset.id, d.to, d.input)) changed = true;
          handled = true;
        }
        if (!handled && !nodeEl && !d.detached) {
          // Dropped in empty space: open the add menu and auto-connect.
          this.openMenu(e.clientX, e.clientY, d.from ? { from: d.from } : { to: d.to, input: d.input });
          if (changed) this.hooks.onChange('structure');
          return;
        }
        this.tempWire.setAttribute('d', '');
        this.drawWires();
        if (changed) this.hooks.onChange('structure');
      }
    });

    // Menu
    this.menuSearch.addEventListener('input', () => this._fillMenu(this.menuSearch.value));
    this.menuSearch.addEventListener('keydown', (e) => {
      const items = [...this.menuList.querySelectorAll('.ge-menu-item')];
      const idx = items.findIndex(i => i.classList.contains('active'));
      if (e.key === 'Escape') { this.closeMenu(); e.stopPropagation(); }
      else if (e.key === 'Enter' && items[idx]) this._pickMenu(items[idx].dataset.type);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        items[idx]?.classList.remove('active');
        const n = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[n].classList.add('active');
        items[n].scrollIntoView({ block: 'nearest' });
      }
      e.stopPropagation();
    });
    this.menuList.addEventListener('pointerdown', (e) => {
      const it = e.target.closest('.ge-menu-item');
      if (it) this._pickMenu(it.dataset.type);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.classList.contains('hidden') && !this.menu.contains(e.target) && !this.viewport.contains(e.target)) this.closeMenu();
    });
  }
}
