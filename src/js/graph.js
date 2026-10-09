// Graph model: nodes, links, evaluation order, serialization and undo history.
import { NODE_TYPES, defaultParams } from './nodes.js';

export const FILE_VERSION = 1;

export class Graph {
  constructor() {
    this.nodes = new Map();   // id -> {id, type, x, y, params}
    this.links = [];          // {from, to, input}
    this.assets = {};         // assetId -> dataURL (images)
    this.nextId = 1;
  }

  addNode(type, x, y, params) {
    const id = type === 'output' ? 'output' : `n${this.nextId++}`;
    const node = { id, type, x, y, params: params ? structuredClone(params) : defaultParams(type) };
    // Fill any params added in later versions.
    for (const [k, v] of Object.entries(defaultParams(type))) if (!(k in node.params)) node.params[k] = v;
    this.nodes.set(id, node);
    return node;
  }

  removeNode(id) {
    if (id === 'output') return;
    this.nodes.delete(id);
    this.links = this.links.filter(l => l.from !== id && l.to !== id);
  }

  inputLink(nodeId, input) {
    return this.links.find(l => l.to === nodeId && l.input === input);
  }

  // Would linking from -> to create a cycle?
  wouldCycle(from, to) {
    if (from === to) return true;
    const stack = [from];
    const seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const l of this.links) if (l.to === n) stack.push(l.from);
    }
    return false;
  }

  connect(from, to, input) {
    if (this.wouldCycle(from, to)) return false;
    this.links = this.links.filter(l => !(l.to === to && l.input === input));
    this.links.push({ from, to, input });
    return true;
  }

  disconnect(to, input) {
    this.links = this.links.filter(l => !(l.to === to && l.input === input));
  }

  // Topological order. If `targets` is given, only nodes feeding those targets.
  order(targets) {
    const result = [];
    const state = new Map();
    const visit = (id) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) return; // cycle guard
      state.set(id, 1);
      for (const l of this.links) if (l.to === id && this.nodes.has(l.from)) visit(l.from);
      state.set(id, 2);
      result.push(id);
    };
    for (const id of targets || this.nodes.keys()) if (this.nodes.has(id)) visit(id);
    return result;
  }

  toJSON(settings) {
    const usedAssets = {};
    for (const n of this.nodes.values()) {
      for (const p of NODE_TYPES[n.type].params) {
        if (p.type === 'image' && n.params[p.id] && this.assets[n.params[p.id]]) usedAssets[n.params[p.id]] = this.assets[n.params[p.id]];
      }
    }
    return {
      app: 'Mondiro MagicForge',
      version: FILE_VERSION,
      settings,
      nextId: this.nextId,
      nodes: [...this.nodes.values()],
      links: this.links,
      assets: usedAssets,
    };
  }

  // Snapshot without image data (for undo).
  snapshot() {
    return JSON.stringify({ nextId: this.nextId, nodes: [...this.nodes.values()], links: this.links });
  }

  restore(snap) {
    const d = JSON.parse(snap);
    this.nextId = d.nextId;
    this.nodes = new Map();
    for (const n of d.nodes) this.nodes.set(n.id, n);
    this.links = d.links;
  }

  static fromJSON(data) {
    const g = new Graph();
    g.assets = data.assets || {};
    for (const n of data.nodes) {
      if (!NODE_TYPES[n.type]) continue;
      const node = { id: n.id, type: n.type, x: n.x, y: n.y, params: { ...defaultParams(n.type), ...n.params } };
      g.nodes.set(node.id, node);
    }
    g.links = (data.links || []).filter(l => g.nodes.has(l.from) && g.nodes.has(l.to));
    g.nextId = data.nextId || (g.nodes.size + 1);
    if (!g.nodes.has('output')) g.addNode('output', 600, 200);
    return g;
  }
}

export class History {
  constructor(limit = 80) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }
  push(snap) {
    if (this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current) {
    if (this.undoStack.length < 2) return null;
    this.redoStack.push(this.undoStack.pop());
    return this.undoStack[this.undoStack.length - 1];
  }
  redo() {
    if (!this.redoStack.length) return null;
    const s = this.redoStack.pop();
    this.undoStack.push(s);
    return s;
  }
  reset(snap) {
    this.undoStack = [snap];
    this.redoStack = [];
  }
}
