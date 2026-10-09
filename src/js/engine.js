// WebGL2 renderer: evaluates the node graph on the GPU, one framebuffer per node.
import { NODE_TYPES, GLSL_LIB } from './nodes.js';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_phase;
uniform float u_has0, u_has1, u_has2;
uniform sampler2D u_in0, u_in1, u_in2;
`;

// Draws a texture into the viewer / thumbnails with a background.
const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec4 u_rect;      // x, y, w, h of the image inside the target (0..1)
uniform vec2 u_target;    // target size in pixels
uniform float u_bg;       // 0 checker, 1 black, 2 grey, 3 additive
uniform float u_flipY;
uniform float u_checkSize;
void main() {
  vec2 uv = v_uv;
  if (u_flipY > 0.5) uv.y = 1.0 - uv.y;
  vec2 q = (uv - u_rect.xy) / u_rect.zw;
  vec3 panel = vec3(0.085, 0.09, 0.105);
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { fragColor = vec4(panel, 1.0); return; }
  vec4 c = clamp(texture(u_tex, q), 0.0, 1.0);
  vec3 bg;
  vec2 cell = floor(uv * u_target / u_checkSize);
  float chk = mod(cell.x + cell.y, 2.0);
  if (u_bg < 0.5) bg = mix(vec3(0.16), vec3(0.24), chk);
  else if (u_bg < 1.5) bg = vec3(0.0);
  else if (u_bg < 2.5) bg = vec3(0.32);
  else { fragColor = vec4(vec3(0.07, 0.075, 0.11) + c.rgb * c.a, 1.0); return; }
  fragColor = vec4(mix(bg, c.rgb, c.a), 1.0);
}`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
void main() { fragColor = clamp(texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)), 0.0, 1.0); }`;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available on this computer.');
    this.gl = gl;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    this.programs = new Map();   // type -> {prog, locs}
    this.targets = new Map();    // nodeId -> {tex, fbo, w, h}
    this.images = new Map();     // assetId -> {tex, w, h}
    this.errors = new Map();     // type -> message

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.defaults = {
      black: this._solidTex([0, 0, 0, 255]),
      white: this._solidTex([255, 255, 255, 255]),
      gray: this._solidTex([128, 128, 128, 255]),
      transparent: this._solidTex([0, 0, 0, 0]),
    };
    this.displayProg = this._link(VERT, DISPLAY_FRAG);
    this.copyProg = this._link(VERT, COPY_FRAG);
    this.thumb = this._makeTarget(96, 96, false);
    this.out8 = null;
  }

  _solidTex(rgba) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  _link(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  _program(type) {
    if (this.programs.has(type)) return this.programs.get(type);
    const def = NODE_TYPES[type];
    let uniforms = '';
    for (const p of def.params) {
      if (p.type === 'color') uniforms += `uniform vec4 p_${p.id};\n`;
      else if (p.type === 'gradient') uniforms += `uniform vec4 p_${p.id}_c[8];\nuniform float p_${p.id}_p[8];\nuniform int p_${p.id}_n;\n`;
      else if (p.type === 'image') uniforms += `uniform sampler2D p_${p.id};\nuniform float p_${p.id}_has;\n`;
      else uniforms += `uniform float p_${p.id};\n`;
    }
    const src = HEADER + uniforms + GLSL_LIB + def.glsl + '\nvoid main() { fragColor = process(v_uv); }\n';
    let entry;
    try {
      const prog = this._link(VERT, src);
      const gl = this.gl;
      const loc = (n) => gl.getUniformLocation(prog, n);
      const locs = {
        res: loc('u_res'), phase: loc('u_phase'),
        has: [loc('u_has0'), loc('u_has1'), loc('u_has2')],
        ins: [loc('u_in0'), loc('u_in1'), loc('u_in2')],
        params: {},
      };
      for (const p of def.params) {
        if (p.type === 'gradient') locs.params[p.id] = { c: loc(`p_${p.id}_c`), p: loc(`p_${p.id}_p`), n: loc(`p_${p.id}_n`) };
        else if (p.type === 'image') locs.params[p.id] = { tex: loc(`p_${p.id}`), has: loc(`p_${p.id}_has`) };
        else locs.params[p.id] = loc(`p_${p.id}`);
      }
      entry = { prog, locs };
    } catch (e) {
      console.error(`Shader error in node "${type}":\n${e.message}`);
      this.errors.set(type, e.message);
      entry = null;
    }
    this.programs.set(type, entry);
    return entry;
  }

  _makeTarget(w, h, hdr = true) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hdr && this.floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  _freeTarget(t) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  _target(id, w, h) {
    let t = this.targets.get(id);
    if (t && (t.w !== w || t.h !== h)) { this._freeTarget(t); t = null; }
    if (!t) { t = this._makeTarget(w, h); this.targets.set(id, t); }
    return t;
  }

  dropNode(id) {
    const t = this.targets.get(id);
    if (t) { this._freeTarget(t); this.targets.delete(id); }
  }

  // Load an image asset (data URL) into a texture.
  loadImage(assetId, dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        this.images.set(assetId, { tex, w: img.width, h: img.height });
        resolve();
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // Evaluate every node in `order` at the given phase and size.
  render(graph, order, phase, w, h) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, w, h);
    for (const id of order) {
      const node = graph.nodes.get(id);
      const def = NODE_TYPES[node.type];
      const entry = this._program(node.type);
      const tgt = this._target(id, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fbo);
      if (!entry) { gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); continue; }
      const { prog, locs } = entry;
      gl.useProgram(prog);
      gl.uniform2f(locs.res, w, h);
      gl.uniform1f(locs.phase, phase);
      let unit = 0;
      for (let i = 0; i < 3; i++) {
        const link = graph.inputLink(id, i);
        const src = link && this.targets.get(link.from);
        let tex = src ? src.tex : this.defaults[def.inputs[i]?.def || 'transparent'];
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(locs.ins[i], unit);
        gl.uniform1f(locs.has[i], src ? 1 : 0);
        unit++;
      }
      for (const p of def.params) {
        const v = node.params[p.id];
        const l = locs.params[p.id];
        if (p.type === 'color') gl.uniform4fv(l, v);
        else if (p.type === 'gradient') {
          const stops = [...v].sort((a, b) => a[0] - b[0]).slice(0, 8);
          const pos = new Float32Array(8), col = new Float32Array(32);
          stops.forEach((s, i) => { pos[i] = s[0]; col.set(s[1], i * 4); });
          gl.uniform4fv(l.c, col);
          gl.uniform1fv(l.p, pos);
          gl.uniform1i(l.n, stops.length);
        } else if (p.type === 'image') {
          const img = v && this.images.get(v);
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, img ? img.tex : this.defaults.transparent);
          gl.uniform1i(l.tex, unit);
          gl.uniform1f(l.has, img ? 1 : 0);
          unit++;
        } else gl.uniform1f(l, typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  // Draw a node result into the visible canvas.
  display(nodeId, bgMode) {
    const gl = this.gl;
    const cw = this.canvas.width, ch = this.canvas.height;
    const t = this.targets.get(nodeId);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    if (!t) { gl.clearColor(0.085, 0.09, 0.105, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const pad = 12;
    const s = Math.min((cw - pad * 2) / t.w, (ch - pad * 2) / t.h);
    const iw = t.w * s, ih = t.h * s;
    this._drawDisplay(t.tex, [(cw - iw) / 2 / cw, (ch - ih) / 2 / ch, iw / cw, ih / ch], cw, ch, bgMode, false, 10);
  }

  _drawDisplay(tex, rect, tw, th, bg, flip, check) {
    const gl = this.gl;
    const p = this.displayProg;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    gl.uniform4fv(gl.getUniformLocation(p, 'u_rect'), rect);
    gl.uniform2f(gl.getUniformLocation(p, 'u_target'), tw, th);
    gl.uniform1f(gl.getUniformLocation(p, 'u_bg'), bg);
    gl.uniform1f(gl.getUniformLocation(p, 'u_flipY'), flip ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u_checkSize'), check);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Render a 96x96 thumbnail of a node into ImageData (top-down rows).
  thumbnail(nodeId) {
    const t = this.targets.get(nodeId);
    if (!t) return null;
    const gl = this.gl;
    const T = this.thumb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, T.w, T.h);
    const s = Math.min(T.w / t.w, T.h / t.h);
    const iw = t.w * s / T.w, ih = t.h * s / T.h;
    this._drawDisplay(t.tex, [(1 - iw) / 2, (1 - ih) / 2, iw, ih], T.w, T.h, 0, true, 8);
    const px = new Uint8ClampedArray(T.w * T.h * 4);
    gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return new ImageData(px, T.w, T.h);
  }

  // Read the final straight-alpha RGBA8 pixels of a node (top-down rows).
  readPixels(nodeId) {
    const t = this.targets.get(nodeId);
    const gl = this.gl;
    if (!this.out8 || this.out8.w !== t.w || this.out8.h !== t.h) {
      if (this.out8) this._freeTarget(this.out8);
      this.out8 = this._makeTarget(t.w, t.h, false);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out8.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.useProgram(this.copyProg);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(gl.getUniformLocation(this.copyProg, 'u_tex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }
}
