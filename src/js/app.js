// Mondiro MagicForge - application wiring.
import { NODE_TYPES, CATEGORIES, CATEGORY_COLORS, defaultParams } from './nodes.js';
import { Engine } from './engine.js';
import { Graph, History } from './graph.js';
import { NodeEditor, NODE_W } from './editor.js';
import { PropsPanel } from './props.js';
import { encodePNG, ZipWriter } from './encode.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';
import { TransformGizmo } from './gizmo.js';

const api = window.mforge || null; // Electron bridge (null when running in a browser)
const $ = (s) => document.querySelector(s);

const state = {
  graph: null,
  settings: { frames: 30, fps: 30, mode: 'loop', width: 512, height: 512 },
  preview: 512,
  frame: 0,
  playing: true,
  viewMode: 'selected',
  viewNode: 'output',
  lockNode: null,
  selected: null,
  bg: 0,
  dirty: false,
  filePath: null,
  fileName: 'Untitled',
  needsRender: true,
  exportFolder: localStorage.getItem('mf.exportFolder') || '',
};

let engine;
try {
  engine = new Engine($('#view-canvas'));
} catch (e) {
  document.body.innerHTML = `<div style="padding:40px;font-size:15px">Mondiro MagicForge needs WebGL2 (GPU) support.<br><br>${e.message}<br><br>Please update your graphics driver.</div>`;
  throw e;
}
const history = new History();

// ---------------------------------------------------------------- status
let statusTimer;
function status(msg, kind = '') {
  const el = $('#status');
  el.textContent = msg;
  el.className = kind;
  clearTimeout(statusTimer);
  if (kind) statusTimer = setTimeout(() => { el.textContent = 'Ready'; el.className = ''; }, 5000);
}

function updateTitle() {
  document.title = `Mondiro MagicForge — ${state.fileName}${state.dirty ? ' *' : ''}`;
}

function markDirty() {
  state.dirty = true;
  updateTitle();
}

// ---------------------------------------------------------------- editor + props
const editor = new NodeEditor($('#graph-area'), {
  onChange() { commit(); requestRender(); },
  onSelect(id) {
    state.selected = id;
    props.show(id ? state.graph.nodes.get(id) : null);
    gizmo.setNode(id ? state.graph.nodes.get(id) : null);
    if (state.viewMode === 'selected' && id) state.viewNode = id;
    requestRender();
  },
  onView(id) {
    setViewMode('selected', true);
    state.viewNode = id;
    if (state.lockNode) setLock(id);
    requestRender();
  },
  onRemoved(id) {
    engine.dropNode(id);
    if (state.viewNode === id) state.viewNode = 'output';
    if (state.lockNode === id) setLock(null);
  },
});

const props = new PropsPanel($('#props'), {
  onParam(id, key, value, isCommit) {
    if (isCommit) commit();
    requestRender();
  },
  async onImage(id, key, file) {
    const assetId = await loadImageFile(file);
    if (!assetId) return;
    state.graph.nodes.get(id).params[key] = assetId;
    props.show(state.graph.nodes.get(id));
    commit();
    requestRender();
  },
  onReset(id) {
    const n = state.graph.nodes.get(id);
    n.params = defaultParams(n.type);
    props.show(n);
    commit();
    requestRender();
  },
});

// Read an image file into the graph's assets. Returns the asset id, or null.
async function loadImageFile(file) {
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const assetId = 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await engine.loadImage(assetId, dataUrl);
    state.graph.assets[assetId] = dataUrl;
    return assetId;
  } catch {
    status(`Could not read image: ${file.name}`, 'error');
    return null;
  }
}

function commit() {
  history.push(state.graph.snapshot());
  markDirty();
}

function undo() {
  const s = history.undo();
  if (s) applySnapshot(s);
}
function redo() {
  const s = history.redo();
  if (s) applySnapshot(s);
}
function applySnapshot(s) {
  const keepSel = state.selected;
  const keepView = editor.view;
  state.graph.restore(s);
  for (const id of [...engine.targets.keys()]) if (!state.graph.nodes.has(id)) engine.dropNode(id);
  editor.setGraph(state.graph);
  editor.view = keepView;
  if (keepSel && state.graph.nodes.has(keepSel)) editor.select([keepSel], keepSel);
  else editor.select([]);
  if (!state.graph.nodes.has(state.viewNode)) state.viewNode = 'output';
  if (state.lockNode && !state.graph.nodes.has(state.lockNode)) setLock(null);
  else editor.setLocked(state.lockNode);
  markDirty();
  requestRender();
}

// ---------------------------------------------------------------- loading graphs
async function loadGraphData(data, fileName, filePath = null) {
  const g = Graph.fromJSON(data);
  for (const [id, url] of Object.entries(g.assets)) {
    try { await engine.loadImage(id, url); } catch { /* broken image: node shows empty */ }
  }
  for (const id of [...engine.targets.keys()]) engine.dropNode(id);
  state.graph = g;
  Object.assign(state.settings, data.settings || {});
  state.fileName = fileName;
  state.filePath = filePath;
  state.frame = 0;
  state.viewNode = 'output';
  state.selected = null;
  setLock(null);
  syncSettingsUI();
  editor.setGraph(g);
  props.show(null);
  gizmo.setNode(null);
  requestAnimationFrame(() => editor.frameAll());
  history.reset(g.snapshot());
  state.dirty = false;
  updateTitle();
  requestRender();
}

function newGraph() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const g = new Graph();
  g.addNode('output', 400, 120);
  loadGraphData(g.toJSON({ ...state.settings }), 'Untitled');
}

async function saveGraph() {
  const json = JSON.stringify(state.graph.toJSON(state.settings), null, 1);
  if (api) {
    const res = await api.saveGraph(json, state.filePath || `${state.fileName}.magicforge`);
    if (!res) return;
    state.filePath = res;
    state.fileName = res.split(/[\\/]/).pop().replace(/\.magicforge$|\.json$/i, '');
  } else {
    downloadBlob(new Blob([json], { type: 'application/json' }), `${state.fileName}.magicforge`);
  }
  state.dirty = false;
  updateTitle();
  status('Saved.', 'ok');
}

async function openGraph() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  if (api) {
    const res = await api.openGraph();
    if (!res) return;
    try {
      await loadGraphData(JSON.parse(res.text), res.path.split(/[\\/]/).pop().replace(/\.magicforge$|\.json$/i, ''), res.path);
      status('Opened.', 'ok');
    } catch (e) {
      status('This file is not a valid MagicForge graph.', 'error');
    }
  } else {
    $('#file-open').click();
  }
}
$('#file-open').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    await loadGraphData(JSON.parse(await f.text()), f.name.replace(/\.magicforge$|\.json$/i, ''));
  } catch {
    status('This file is not a valid MagicForge graph.', 'error');
  }
  e.target.value = '';
};

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------- library
function buildLibrary(filter = '') {
  const f = filter.trim().toLowerCase();
  let html = '';
  for (const cat of CATEGORIES) {
    const items = Object.entries(NODE_TYPES).filter(([t, d]) => d.category === cat && (!f || d.name.toLowerCase().includes(f)));
    if (!items.length) continue;
    html += `<div class="lib-cat" style="--cat:${CATEGORY_COLORS[cat]}">${cat}</div>`;
    for (const [t, d] of items) html += `<div class="lib-item" draggable="true" data-type="${t}" style="--cat:${CATEGORY_COLORS[cat]}">${d.name}</div>`;
  }
  $('#lib-list').innerHTML = html;
}
$('#lib-search').oninput = (e) => buildLibrary(e.target.value);
$('#lib-list').addEventListener('click', (e) => {
  const it = e.target.closest('.lib-item');
  if (!it) return;
  const c = editor.viewCenter();
  const jitter = () => (Math.random() - 0.5) * 60;
  const n = editor.addNode(it.dataset.type, c.x - NODE_W / 2 + jitter(), c.y - 60 + jitter());
  editor.drawWires();
  editor.select([n.id], n.id);
  commit();
  requestRender();
});
$('#lib-list').addEventListener('dragstart', (e) => {
  const it = e.target.closest('.lib-item');
  if (it) e.dataTransfer.setData('text/x-mforge-node', it.dataset.type);
});
$('#graph-area').addEventListener('dragover', (e) => e.preventDefault());
$('#graph-area').addEventListener('drop', (e) => {
  const type = e.dataTransfer.getData('text/x-mforge-node');
  if (!type) return;
  e.preventDefault();
  const p = editor.toLayer(e.clientX, e.clientY);
  const n = editor.addNode(type, p.x - NODE_W / 2, p.y - 20);
  editor.drawWires();
  editor.select([n.id], n.id);
  commit();
  requestRender();
});

// ---------------------------------------------------------------- examples menu
const exMenu = $('#examples-menu');
exMenu.innerHTML = Object.keys(EXAMPLES).map(k => `<div data-k="${k}">${k}</div>`).join('');
$('#btn-examples').onclick = (e) => { e.stopPropagation(); exMenu.classList.toggle('hidden'); };
exMenu.onclick = (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  exMenu.classList.add('hidden');
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  loadGraphData(EXAMPLES[k](), k);
};
document.addEventListener('click', () => exMenu.classList.add('hidden'));

// ---------------------------------------------------------------- viewer / timeline UI
// Preview lock: keeps the 2D view on one node while you select and edit others.
function setLock(id) {
  state.lockNode = id;
  $('#btn-lock').classList.toggle('on', !!id);
  editor.setLocked(id);
  requestRender();
}
function toggleLock() {
  const target = state.selected || state.viewNode;
  if (state.lockNode && state.lockNode === target) { setLock(null); return; }
  setViewMode('selected', true);
  setLock(target);
}
$('#btn-lock').onclick = toggleLock;

function setViewMode(m, keepLock = false) {
  if (!keepLock && state.lockNode) setLock(null);
  state.viewMode = m;
  document.querySelectorAll('#view-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
  state.viewNode = m === 'output' ? 'output' : (state.selected || 'output');
  requestRender();
}
document.querySelectorAll('#view-mode button').forEach(b => b.onclick = () => setViewMode(b.dataset.v));
$('#bg-mode').onchange = (e) => { state.bg = +e.target.value; requestRender(); };

function phaseOf(frame) {
  const { frames, mode } = state.settings;
  if (mode === 'loop') return frame / frames;
  return frames > 1 ? frame / (frames - 1) : 0;
}

function syncSettingsUI() {
  const s = state.settings;
  $('#set-mode').value = s.mode;
  $('#set-frames').value = s.frames;
  $('#set-fps').value = s.fps;
  $('#set-w').value = s.width;
  $('#set-h').value = s.height;
  $('#frame-slider').max = s.frames - 1;
  state.frame = Math.min(state.frame, s.frames - 1);
  $('#mode-hint').textContent = s.mode === 'loop'
    ? 'Loop: frame after the last one equals frame 1. Use whole numbers for Evolution / Spin / Scroll to stay seamless.'
    : 'One-shot: plays once from start to end (first frame = start, last frame = end). Great with Envelope & animated Transform.';
  updateFrameUI();
}

function updateFrameUI() {
  $('#frame-slider').value = state.frame;
  $('#frame-label').textContent = `${state.frame + 1} / ${state.settings.frames}`;
}

function intInput(sel, key, min, max) {
  $(sel).onchange = (e) => {
    const v = Math.max(min, Math.min(max, Math.round(+e.target.value || state.settings[key])));
    state.settings[key] = v;
    e.target.value = v;
    markDirty();
    syncSettingsUI();
    requestRender();
  };
}
intInput('#set-frames', 'frames', 1, 600);
intInput('#set-fps', 'fps', 1, 120);
intInput('#set-w', 'width', 8, 4096);
intInput('#set-h', 'height', 8, 4096);
$('#set-mode').onchange = (e) => { state.settings.mode = e.target.value; markDirty(); syncSettingsUI(); requestRender(); };
$('#size-preset').onchange = (e) => {
  if (!e.target.value) return;
  state.settings.width = state.settings.height = +e.target.value;
  e.target.value = '';
  markDirty();
  syncSettingsUI();
  requestRender();
};
$('#set-preview').onchange = (e) => { state.preview = +e.target.value; requestRender(); };
$('#frame-slider').oninput = (e) => { state.frame = +e.target.value; setPlaying(false); updateFrameUI(); requestRender(); };

function setPlaying(p) {
  state.playing = p;
  $('#btn-play').textContent = p ? '❚❚' : '▶';
  lastTime = performance.now();
  acc = 0;
}
function step(d) {
  setPlaying(false);
  const n = state.settings.frames;
  state.frame = (state.frame + d + n) % n;
  updateFrameUI();
  requestRender();
}
$('#btn-play').onclick = () => setPlaying(!state.playing);
$('#btn-prev').onclick = () => step(-1);
$('#btn-next').onclick = () => step(1);

// ---------------------------------------------------------------- render loop
function requestRender() { state.needsRender = true; }

function previewSize() {
  const { width, height } = state.settings;
  const s = Math.min(1, state.preview / Math.max(width, height));
  return [Math.max(4, Math.round(width * s)), Math.max(4, Math.round(height * s))];
}

const viewCanvas = $('#view-canvas');
new ResizeObserver(() => {
  const r = viewCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  viewCanvas.width = Math.max(1, Math.round(r.width * dpr));
  viewCanvas.height = Math.max(1, Math.round(r.height * dpr));
  requestRender();
}).observe(viewCanvas);

let lastTime = performance.now();
let acc = 0;
let lastThumbs = 0;
let exporting = false;
let reportedErrors = 0;

function renderPreview(now) {
  const [w, h] = previewSize();
  const order = state.graph.order();
  engine.render(state.graph, order, phaseOf(state.frame), w, h);
  const want = state.lockNode || state.viewNode;
  const vid = state.graph.nodes.has(want) ? want : 'output';
  engine.display(vid, state.bg);
  gizmo.update();
  const vn = state.graph.nodes.get(vid);
  $('#view-label').textContent = `${state.lockNode === vid ? 'Locked: ' : ''}${NODE_TYPES[vn.type].name} · ${state.settings.width}×${state.settings.height}${w !== state.settings.width ? ` (preview ${w}×${h})` : ''}`;
  if (now - lastThumbs > 120 || !state.playing) {
    lastThumbs = now;
    for (const id of order) editor.setThumb(id, engine.thumbnail(id));
  }
  if (engine.errors.size !== reportedErrors) {
    reportedErrors = engine.errors.size;
    status(`Shader error in: ${[...engine.errors.keys()].join(', ')} (see console)`, 'error');
  }
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!state.graph || exporting) return;
  if (state.playing) {
    acc += (now - lastTime) / 1000;
    const dt = 1 / state.settings.fps;
    if (acc >= dt) {
      const steps = Math.floor(acc / dt);
      acc -= steps * dt;
      state.frame = (state.frame + steps) % state.settings.frames;
      updateFrameUI();
      state.needsRender = true;
    }
  }
  lastTime = now;
  if (state.needsRender) {
    state.needsRender = false;
    renderPreview(now);
  }
}

// ---------------------------------------------------------------- export
const modal = $('#export-modal');
function openExport() {
  setPlaying(false);
  $('#ex-name').value = (state.fileName === 'Untitled' ? 'fx' : state.fileName).replace(/[^\w\-]+/g, '_');
  $('#ex-folder').value = state.exportFolder;
  $('#ex-folder-row').classList.toggle('hidden', !api);
  const s = state.settings;
  $('#ex-info').innerHTML = `<b>${s.frames}</b> frames · <b>${s.width}×${s.height}</b> px · <b>${s.mode === 'loop' ? 'Loop' : 'One-shot'}</b> · ${s.fps} fps<br>` +
    (api ? 'PNG files with transparency will be written into the folder.' : 'Browser mode: frames will be downloaded as one .zip file.');
  $('#ex-progress').classList.add('hidden');
  $('#ex-open').classList.add('hidden');
  $('#ex-go').disabled = false;
  modal.classList.remove('hidden');
}
$('#btn-export').onclick = openExport;
$('#ex-cancel').onclick = () => { if (!exporting) modal.classList.add('hidden'); };
$('#ex-browse').onclick = async () => {
  const f = await api.chooseFolder(state.exportFolder);
  if (f) { state.exportFolder = f; $('#ex-folder').value = f; localStorage.setItem('mf.exportFolder', f); }
};
$('#ex-open').onclick = () => api && api.openPath(state.exportFolder);
$('#ex-go').onclick = runExport;

async function runExport() {
  if (exporting) return;
  const s = state.settings;
  const prefix = ($('#ex-name').value.trim() || 'fx').replace(/[\\/:*?"<>|]+/g, '_');
  const start = Math.max(0, Math.round(+$('#ex-start').value || 0));
  const digits = Math.max(1, Math.min(8, Math.round(+$('#ex-digits').value || 4)));
  if (api && !state.exportFolder) {
    await $('#ex-browse').onclick();
    if (!state.exportFolder) return;
  }
  exporting = true;
  $('#ex-go').disabled = true;
  const prog = $('#ex-progress');
  prog.classList.remove('hidden');
  const bar = prog.querySelector('.bar'), label = prog.querySelector('span');
  const zip = api ? null : new ZipWriter();
  try {
    const order = state.graph.order(['output']);
    for (let i = 0; i < s.frames; i++) {
      engine.render(state.graph, order, phaseOf(i), s.width, s.height);
      const px = engine.readPixels('output');
      const png = await encodePNG(px, s.width, s.height);
      const name = `${prefix}_${String(start + i).padStart(digits, '0')}.png`;
      if (api) await api.writeFile(state.exportFolder, name, png);
      else zip.add(name, png);
      bar.style.width = `${((i + 1) / s.frames) * 100}%`;
      label.textContent = `Frame ${i + 1} / ${s.frames}`;
      await new Promise(r => setTimeout(r, 0));
    }
    if (zip) downloadBlob(zip.toBlob(), `${prefix}_png_sequence.zip`);
    label.textContent = `Done! ${s.frames} PNG files exported.`;
    if (api) $('#ex-open').classList.remove('hidden');
    status(`Exported ${s.frames} frames${api ? ' to ' + state.exportFolder : ''}.`, 'ok');
  } catch (e) {
    console.error(e);
    label.textContent = 'Export failed: ' + e.message;
    status('Export failed: ' + e.message, 'error');
  } finally {
    exporting = false;
    $('#ex-go').disabled = false;
    requestRender();
  }
}

// ---------------------------------------------------------------- toolbar + keys
$('#btn-new').onclick = newGraph;
$('#btn-open').onclick = openGraph;
$('#btn-save').onclick = saveGraph;
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;

let mouse = { x: 0, y: 0 };
document.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; });

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input:not([type=range]):not([type=checkbox]), select, textarea');
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (!modal.classList.contains('hidden')) {
    if (e.key === 'Escape' && !exporting) modal.classList.add('hidden');
    return;
  }
  if (ctrl && k === 's') { e.preventDefault(); saveGraph(); return; }
  if (ctrl && k === 'o') { e.preventDefault(); openGraph(); return; }
  if (ctrl && k === 'n') { e.preventDefault(); newGraph(); return; }
  if (ctrl && k === 'e') { e.preventDefault(); openExport(); return; }
  if (typing) return;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (ctrl && k === 'd') { e.preventDefault(); editor.duplicateSelected(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { editor.deleteSelected(); }
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (k === 'f' && !ctrl) editor.frameAll();
  else if (k === 'l' && !ctrl) toggleLock();
  else if (e.key === 'Tab') {
    e.preventDefault();
    const r = $('#graph-area').getBoundingClientRect();
    const inside = mouse.x > r.left && mouse.x < r.right && mouse.y > r.top && mouse.y < r.bottom;
    editor.openMenu(inside ? mouse.x : r.left + r.width / 2, inside ? mouse.y : r.top + r.height / 2);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty && !api) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------- auto update
function setupUpdates() {
  const ver = $('#app-version');
  const info = $('#update-info');
  const btn = $('#btn-update');
  if (!api?.getVersion) { ver.textContent = 'web preview'; return; }
  api.getVersion().then(v => { ver.textContent = `v${v}`; });
  let manual = false;
  ver.onclick = () => { manual = true; api.checkUpdate(); };
  let pending = '';
  api.onUpdateStatus((s) => {
    info.classList.remove('hidden', 'ok');
    if (s.state === 'checking') {
      info.textContent = manual ? 'Checking for updates…' : '';
    } else if (s.state === 'latest') {
      info.textContent = manual ? 'You have the latest version' : '';
      info.classList.add('ok');
      manual = false;
    } else if (s.state === 'downloading') {
      if (s.version) pending = s.version;
      info.textContent = `Downloading update${pending ? ' v' + pending : ''}… ${s.percent || 0}%`;
    } else if (s.state === 'ready') {
      info.textContent = `Update v${s.version} ready`;
      info.classList.add('ok');
      btn.classList.remove('hidden');
    } else if (s.state === 'error') {
      info.textContent = manual ? 'Update check failed' : '';
      info.title = s.message || '';
      manual = false;
    }
    if (!info.textContent) info.classList.add('hidden');
  });
  btn.onclick = () => {
    if (state.dirty && !confirm('Restart now? Unsaved changes to the graph will be lost.\n(Save first with Ctrl+S, or the update installs automatically when you close the app.)')) return;
    api.installUpdate();
  };
}
setupUpdates();

// ---------------------------------------------------------------- transform gizmo
const gizmo = new TransformGizmo($('#viewer'), {
  getRect: () => engine.viewRect,
  getAspect: () => {
    const { width: w, height: h } = state.settings;
    return w > h ? [0.5 * w / h, 0.5] : [0.5, 0.5 * h / w];
  },
  getPhase: () => phaseOf(state.frame),
  onChange(isCommit) {
    if (isCommit) {
      props.show(gizmo.node);
      commit();
    }
    requestRender();
  },
});

// ---------------------------------------------------------------- drop image files
const dropHint = document.createElement('div');
dropHint.className = 'drop-hint hidden';
dropHint.textContent = 'Drop images to create Image Input nodes';
document.body.appendChild(dropHint);
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropHint.classList.remove('hidden');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropHint.classList.add('hidden');
});
document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dropHint.classList.add('hidden');
  const files = [...e.dataTransfer.files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
  if (!files.length) { status('Only image files can be dropped here.', 'error'); return; }
  const r = $('#graph-area').getBoundingClientRect();
  const inGraph = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
  const base = inGraph ? editor.toLayer(e.clientX, e.clientY) : editor.viewCenter();
  const ids = [];
  for (const [i, f] of files.entries()) {
    const assetId = await loadImageFile(f);
    if (!assetId) continue;
    const n = editor.addNode('image', base.x - NODE_W / 2 + i * 30, base.y - 40 + i * 30);
    n.params.image = assetId;
    ids.push(n.id);
  }
  if (!ids.length) return;
  editor.drawWires();
  editor.select(ids, ids[ids.length - 1]);
  commit();
  requestRender();
  status(`Added ${ids.length} Image Input node${ids.length > 1 ? 's' : ''}.`, 'ok');
});

// ---------------------------------------------------------------- start
buildLibrary();
setPlaying(true);
loadGraphData(EXAMPLES[DEFAULT_EXAMPLE](), DEFAULT_EXAMPLE).then(() => {
  // Expose for automated tests / debugging.
  window.__mf = { state, engine, editor, loadGraphData, EXAMPLES, phaseOf, runExport, setPlaying };
});
requestAnimationFrame(tick);
