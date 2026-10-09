// Node library for Mondiro MagicForge.
// Every node is a fragment shader with a `vec4 process(vec2 uv)` function.
// Time is exposed as u_phase (0..1 over the whole clip). In Loop mode the
// phase wraps, so anything driven by an *integer* number of cycles per clip
// (evolution, spin, scroll, pulses) lands exactly back on frame 0.

export const ANIM_OPTIONS = ['None', 'Linear', 'Ease In', 'Ease Out', 'Ease In-Out', 'Ping-Pong (loop safe)'];

// Shared GLSL helpers, prepended to every node shader.
export const GLSL_LIB = `
#define PI 3.14159265359
#define TAU 6.28318530718

float lum(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }
vec4 gray(float v) { return vec4(vec3(v), 1.0); }

// Aspect-corrected coordinates centred on the canvas, short side = 1 unit.
vec2 centered(vec2 uv) {
  vec2 p = uv - 0.5;
  if (u_res.x > u_res.y) p.x *= u_res.x / u_res.y; else p.y *= u_res.y / u_res.x;
  return p;
}
vec2 uncentered(vec2 p) {
  if (u_res.x > u_res.y) p.x /= u_res.x / u_res.y; else p.y /= u_res.y / u_res.x;
  return p + 0.5;
}
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// 0 none, 1 linear, 2 ease in, 3 ease out, 4 ease in-out, 5 ping-pong
float anim(float mode, float t) {
  t = clamp(t, 0.0, 1.0);
  if (mode < 0.5) return 0.0;
  if (mode < 1.5) return t;
  if (mode < 2.5) return t * t;
  if (mode < 3.5) return 1.0 - (1.0 - t) * (1.0 - t);
  if (mode < 4.5) return t * t * (3.0 - 2.0 * t);
  return 0.5 - 0.5 * cos(TAU * t);
}

uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
  return x;
}
uint hash3(ivec3 c, float seed) {
  uvec3 v = uvec3(c);
  return hashU(v.x ^ hashU(v.y ^ hashU(v.z ^ hashU(uint(seed) + 0x9e3779b9U))));
}
float h2f(uint h) { return float(h & 0x00ffffffU) / 16777215.0; }

vec3 grad3(vec3 c, vec3 per, float seed) {
  uint h = hash3(ivec3(mod(c, per)), seed);
  float a = h2f(h) * TAU;
  float z = h2f(hashU(h)) * 2.0 - 1.0;
  float r = sqrt(1.0 - z * z);
  return vec3(r * cos(a), r * sin(a), z);
}

// Periodic gradient noise: tiles every 'per' units on each axis.
float pnoise(vec3 p, vec3 per, float seed) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(grad3(i + vec3(0, 0, 0), per, seed), f - vec3(0, 0, 0));
  float n100 = dot(grad3(i + vec3(1, 0, 0), per, seed), f - vec3(1, 0, 0));
  float n010 = dot(grad3(i + vec3(0, 1, 0), per, seed), f - vec3(0, 1, 0));
  float n110 = dot(grad3(i + vec3(1, 1, 0), per, seed), f - vec3(1, 1, 0));
  float n001 = dot(grad3(i + vec3(0, 0, 1), per, seed), f - vec3(0, 0, 1));
  float n101 = dot(grad3(i + vec3(1, 0, 1), per, seed), f - vec3(1, 0, 1));
  float n011 = dot(grad3(i + vec3(0, 1, 1), per, seed), f - vec3(0, 1, 1));
  float n111 = dot(grad3(i + vec3(1, 1, 1), per, seed), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

vec4 gradSample(vec4 c[8], float p[8], int n, float t) {
  if (t <= p[0]) return c[0];
  for (int i = 1; i < 8; i++) {
    if (i >= n) break;
    if (t <= p[i]) return mix(c[i - 1], c[i], (t - p[i - 1]) / max(p[i] - p[i - 1], 1e-5));
  }
  return c[n - 1];
}
`;

const SEED = { id: 'seed', label: 'Seed', type: 'int', min: 0, max: 999, def: 1 };

export const GRADIENT_PRESETS = {
  'Grayscale':    [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]],
  'Fire':         [[0, [0, 0, 0, 0]], [0.25, [0.55, 0.05, 0.0, 0.7]], [0.5, [1.0, 0.35, 0.0, 1]], [0.75, [1.0, 0.8, 0.2, 1]], [1, [1, 1, 0.9, 1]]],
  'Magic Purple': [[0, [0, 0, 0, 0]], [0.3, [0.25, 0.05, 0.6, 0.6]], [0.6, [0.65, 0.25, 1.0, 1]], [0.85, [0.95, 0.7, 1.0, 1]], [1, [1, 1, 1, 1]]],
  'Ice':          [[0, [0, 0, 0, 0]], [0.35, [0.05, 0.3, 0.7, 0.6]], [0.7, [0.4, 0.85, 1.0, 1]], [1, [1, 1, 1, 1]]],
  'Electric':     [[0, [0, 0, 0, 0]], [0.4, [0.0, 0.35, 1.0, 0.5]], [0.75, [0.3, 0.9, 1.0, 1]], [1, [1, 1, 1, 1]]],
  'Poison':       [[0, [0, 0, 0, 0]], [0.35, [0.1, 0.35, 0.05, 0.6]], [0.7, [0.45, 1.0, 0.2, 1]], [1, [0.95, 1, 0.8, 1]]],
  'Holy Gold':    [[0, [0, 0, 0, 0]], [0.35, [0.6, 0.35, 0.05, 0.6]], [0.7, [1.0, 0.8, 0.3, 1]], [1, [1, 1, 0.9, 1]]],
  'Blood':        [[0, [0, 0, 0, 0]], [0.4, [0.35, 0.0, 0.02, 0.8]], [0.8, [0.85, 0.05, 0.1, 1]], [1, [1, 0.6, 0.55, 1]]],
  'Smoke':        [[0, [0, 0, 0, 0]], [0.5, [0.25, 0.25, 0.28, 0.6]], [1, [0.85, 0.85, 0.9, 1]]],
};

export const CATEGORY_COLORS = {
  Generators: '#25a99a',
  Filters: '#4c86f0',
  Color: '#a066ff',
  Time: '#f0932b',
  Output: '#e5333f',
};

export const NODE_TYPES = {
  // ---------------------------------------------------------------- Generators
  perlin: {
    name: 'Perlin Noise', category: 'Generators', inputs: [],
    params: [
      { id: 'scale', label: 'Scale', type: 'int', min: 1, max: 32, def: 4 },
      { id: 'octaves', label: 'Detail (octaves)', type: 'int', min: 1, max: 8, def: 4 },
      { id: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, def: 0.5 },
      { id: 'contrast', label: 'Contrast', type: 'float', min: 0, max: 4, def: 1.2 },
      { id: 'evolution', label: 'Evolution (cycles / clip)', type: 'int', min: 0, max: 8, def: 1 },
      { id: 'scrollX', label: 'Scroll X (tiles / clip)', type: 'int', min: -8, max: 8, def: 0 },
      { id: 'scrollY', label: 'Scroll Y (tiles / clip)', type: 'int', min: -8, max: 8, def: 0 },
      SEED,
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec2 p = uv - vec2(p_scrollX, p_scrollY) * u_phase;
  // Two lattice cells per evolution cycle: a single cell would jump at the wrap.
  float z = u_phase * p_evolution * 2.0;
  float pz = max(p_evolution * 2.0, 2.0);
  float sum = 0.0, amp = 1.0, norm = 0.0, sc = p_scale;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= p_octaves) break;
    sum += amp * pnoise(vec3(p * sc, z), vec3(sc, sc, pz), p_seed + float(i) * 31.0);
    norm += amp; amp *= p_roughness; sc *= 2.0;
  }
  return gray(clamp(0.5 + sum / norm * p_contrast, 0.0, 1.0));
}`,
  },

  cells: {
    name: 'Cells (Voronoi)', category: 'Generators', inputs: [],
    params: [
      { id: 'scale', label: 'Scale', type: 'int', min: 1, max: 32, def: 6 },
      { id: 'mode', label: 'Pattern', type: 'enum', options: ['Distance', 'Edges', 'Cell Colors', 'Blobs'], def: 0 },
      { id: 'width', label: 'Edge Width', type: 'float', min: 0.01, max: 0.5, def: 0.08, showIf: { mode: [1] } },
      { id: 'jitter', label: 'Randomness', type: 'float', min: 0, max: 1, def: 0.9 },
      { id: 'evolution', label: 'Movement (cycles / clip)', type: 'int', min: 0, max: 8, def: 1 },
      { id: 'scrollX', label: 'Scroll X (tiles / clip)', type: 'int', min: -8, max: 8, def: 0 },
      { id: 'scrollY', label: 'Scroll Y (tiles / clip)', type: 'int', min: -8, max: 8, def: 0 },
      SEED,
    ],
    glsl: `
vec4 process(vec2 uv) {
  float sc = p_scale;
  vec2 p = (uv - vec2(p_scrollX, p_scrollY) * u_phase) * sc;
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0, cv = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y);
    vec2 c = mod(ip + o, vec2(sc));
    uint h = hash3(ivec3(int(c.x), int(c.y), 0), p_seed);
    vec2 r = vec2(h2f(h), h2f(hashU(h))) * 2.0 - 1.0;
    float ph = h2f(hashU(h + 7u));
    float a = TAU * (u_phase * p_evolution + ph);
    vec2 pt = 0.5 + p_jitter * (0.32 * r + 0.16 * vec2(cos(a), sin(a)));
    float d = length(o + pt - fp);
    if (d < d1) { d2 = d1; d1 = d; cv = h2f(hashU(h + 3u)); }
    else if (d < d2) { d2 = d; }
  }
  float v;
  if (p_mode < 0.5) v = d1;
  else if (p_mode < 1.5) v = 1.0 - smoothstep(0.0, p_width, d2 - d1);
  else if (p_mode < 2.5) v = cv;
  else v = 1.0 - smoothstep(0.0, 0.75, d1);
  return gray(clamp(v, 0.0, 1.0));
}`,
  },

  shape: {
    name: 'Shape', category: 'Generators', inputs: [],
    params: [
      { id: 'shape', label: 'Shape', type: 'enum', options: ['Circle', 'Ring', 'Square', 'Polygon', 'Star', 'Cross', 'Rectangle'], def: 0 },
      { id: 'size', label: 'Size', type: 'float', min: 0, max: 1.5, def: 0.6, showIf: { shape: [0, 1, 2, 3, 4, 5] } },
      { id: 'width', label: 'Width', type: 'float', min: 0, max: 1.5, def: 0.8, showIf: { shape: [6] } },
      { id: 'height', label: 'Height', type: 'float', min: 0, max: 1.5, def: 0.4, showIf: { shape: [6] } },
      { id: 'corner', label: 'Corner Radius', type: 'float', min: 0, max: 0.5, def: 0, showIf: { shape: [6] } },
      { id: 'thickness', label: 'Thickness', type: 'float', min: 0.005, max: 1, def: 0.15, showIf: { shape: [1, 5] } },
      { id: 'sides', label: 'Sides / Points', type: 'int', min: 3, max: 16, def: 5, showIf: { shape: [3, 4] } },
      { id: 'inner', label: 'Inner Radius', type: 'float', min: 0, max: 1, def: 0.4, showIf: { shape: [4] } },
      { id: 'falloff', label: 'Falloff', type: 'enum', options: ['Soft Edge', 'Outer Glow', 'Center Gradient'], def: 0 },
      { id: 'softness', label: 'Softness', type: 'float', min: 0, max: 1, def: 0.03 },
      { id: 'rotation', label: 'Rotation', type: 'float', min: -180, max: 180, def: 0 },
    ],
    glsl: `
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
vec4 process(vec2 uv) {
  vec2 p = rot(centered(uv), radians(p_rotation));
  float r = p_size * 0.5;
  float d;
  if (p_shape < 0.5) d = length(p) - r;
  else if (p_shape < 1.5) d = abs(length(p) - r) - p_thickness * 0.25;
  else if (p_shape < 2.5) d = sdBox(p, vec2(r));
  else if (p_shape < 3.5) {
    float an = PI / p_sides;
    float a = atan(p.x, p.y);
    float bn = mod(a, 2.0 * an) - an;
    d = length(p) * cos(bn) - r * cos(an);
  } else if (p_shape < 4.5) {
    float seg = TAU / p_sides;
    float a = atan(p.x, p.y);
    float f = abs(mod(a + seg * 0.5, seg) - seg * 0.5) / (seg * 0.5);
    float rr = mix(r, r * p_inner, pow(f, 0.7));
    d = (length(p) - rr) * 0.7;
  } else if (p_shape < 5.5) {
    float t = p_thickness * 0.25;
    d = min(sdBox(p, vec2(r, t)), sdBox(p, vec2(t, r)));
  } else {
    vec2 hb = vec2(p_width, p_height) * 0.5;
    float cr = min(p_corner, min(hb.x, hb.y));
    d = sdBox(p, hb - cr) - cr;
    r = min(hb.x, hb.y);
  }
  float aa = 1.5 / min(u_res.x, u_res.y);
  float s = max(p_softness * 0.5, aa);
  float v;
  if (p_falloff < 0.5) v = 1.0 - smoothstep(-s, s, d);
  else if (p_falloff < 1.5) v = d <= 0.0 ? 1.0 : pow(1.0 - clamp(d / s, 0.0, 1.0), 2.0);
  else v = clamp(-d / max(r * max(p_softness, 0.02) * 2.0, aa), 0.0, 1.0);
  return gray(v);
}`,
  },

  gradient: {
    name: 'Gradient', category: 'Generators', inputs: [],
    params: [
      { id: 'type', label: 'Type', type: 'enum', options: ['Linear', 'Radial', 'Angular', 'Diamond'], def: 1 },
      { id: 'angle', label: 'Angle', type: 'float', min: -180, max: 180, def: 90 },
      { id: 'repeat', label: 'Repeat', type: 'int', min: 1, max: 32, def: 1 },
      { id: 'mirror', label: 'Mirror Repeats', type: 'bool', def: false },
      { id: 'scroll', label: 'Scroll (cycles / clip)', type: 'int', min: -16, max: 16, def: 0 },
      { id: 'invert', label: 'Invert', type: 'bool', def: false },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec2 p = rot(centered(uv), -radians(p_angle));
  float t;
  if (p_type < 0.5) t = p.x + 0.5;
  else if (p_type < 1.5) t = length(p) * 2.0;
  else if (p_type < 2.5) t = atan(p.y, p.x) / TAU + 0.5;
  else t = (abs(p.x) + abs(p.y)) * 2.0;
  t = t * p_repeat - u_phase * p_scroll;
  if (p_repeat > 1.5 || abs(p_scroll) > 0.5 || (p_type > 1.5 && p_type < 2.5)) {
    t = p_mirror > 0.5 ? 1.0 - abs(fract(t) * 2.0 - 1.0) : fract(t);
  }
  t = clamp(t, 0.0, 1.0);
  return gray(p_invert > 0.5 ? 1.0 - t : t);
}`,
  },

  rays: {
    name: 'Light Rays', category: 'Generators', inputs: [],
    params: [
      { id: 'count', label: 'Ray Count', type: 'int', min: 1, max: 64, def: 12 },
      { id: 'sharpness', label: 'Sharpness', type: 'float', min: 0, max: 1, def: 0.6 },
      { id: 'randomness', label: 'Randomness', type: 'float', min: 0, max: 1, def: 0.5 },
      { id: 'length', label: 'Length', type: 'float', min: 0.05, max: 1.5, def: 0.9 },
      { id: 'falloff', label: 'Falloff', type: 'float', min: 0.1, max: 4, def: 1.2 },
      { id: 'spin', label: 'Spin (turns / clip)', type: 'int', min: -8, max: 8, def: 0 },
      { id: 'twinkle', label: 'Twinkle (cycles / clip)', type: 'int', min: 0, max: 8, def: 1 },
      SEED,
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec2 p = centered(uv);
  float a = fract(atan(p.y, p.x) / TAU + 0.5 - u_phase * p_spin);
  float x = a * p_count;
  float id = mod(floor(x), p_count);
  float f = fract(x);
  uint h = hash3(ivec3(int(id), 0, 0), p_seed);
  float r1 = h2f(h), r2 = h2f(hashU(h)), r3 = h2f(hashU(h + 11u));
  float w = 1.0 - abs(f * 2.0 - 1.0);
  w = pow(w, mix(1.0, 24.0, p_sharpness) * mix(1.0, 0.4 + r3 * 1.2, p_randomness));
  float len = p_length * 0.5 * mix(1.0, 0.25 + 0.75 * r1, p_randomness);
  float radial = pow(clamp(1.0 - length(p) / len, 0.0, 1.0), p_falloff);
  float tw = p_twinkle > 0.5 ? mix(1.0, 0.5 + 0.5 * sin(TAU * (u_phase * p_twinkle + r2)), max(p_randomness, 0.3)) : 1.0;
  return gray(clamp(w * radial * tw, 0.0, 1.0));
}`,
  },

  solid: {
    name: 'Solid Color', category: 'Generators', inputs: [],
    params: [{ id: 'color', label: 'Color', type: 'color', def: [1, 1, 1, 1] }],
    glsl: `vec4 process(vec2 uv) { return p_color; }`,
  },

  image: {
    name: 'Image Input', category: 'Generators', inputs: [],
    params: [
      { id: 'image', label: 'Image (PNG/JPG)', type: 'image', def: null },
      { id: 'tile', label: 'Tile', type: 'bool', def: false },
    ],
    glsl: `
vec4 process(vec2 uv) {
  if (p_image_has < 0.5) return vec4(0.0);
  if (p_tile < 0.5 && (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0)) return vec4(0.0);
  return texture(p_image, fract(uv));
}`,
  },

  // ---------------------------------------------------------------- Filters
  transform: {
    name: 'Transform', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }],
    params: [
      { id: 'offX', label: 'Offset X', type: 'float', min: -1, max: 1, def: 0 },
      { id: 'offY', label: 'Offset Y', type: 'float', min: -1, max: 1, def: 0 },
      { id: 'rotation', label: 'Rotation', type: 'float', min: -360, max: 360, def: 0 },
      { id: 'scale', label: 'Scale', type: 'float', min: 0.01, max: 8, def: 1 },
      { id: 'scaleX', label: 'Scale X', type: 'float', min: 0.01, max: 8, def: 1 },
      { id: 'scaleY', label: 'Scale Y', type: 'float', min: 0.01, max: 8, def: 1 },
      { id: 'tiling', label: 'Outside Area', type: 'enum', options: ['Transparent', 'Clamp', 'Tile'], def: 0 },
      { id: 'animate', label: 'Animate Start → End', type: 'enum', options: ANIM_OPTIONS, def: 0 },
      { id: 'offXEnd', label: 'End Offset X', type: 'float', min: -1, max: 1, def: 0, showIf: { animate: [1, 2, 3, 4, 5] } },
      { id: 'offYEnd', label: 'End Offset Y', type: 'float', min: -1, max: 1, def: 0, showIf: { animate: [1, 2, 3, 4, 5] } },
      { id: 'rotationEnd', label: 'End Rotation', type: 'float', min: -360, max: 360, def: 0, showIf: { animate: [1, 2, 3, 4, 5] } },
      { id: 'scaleEnd', label: 'End Scale', type: 'float', min: 0.01, max: 8, def: 1, showIf: { animate: [1, 2, 3, 4, 5] } },
      { id: 'scaleXEnd', label: 'End Scale X', type: 'float', min: 0.01, max: 8, def: 1, showIf: { animate: [1, 2, 3, 4, 5] } },
      { id: 'scaleYEnd', label: 'End Scale Y', type: 'float', min: 0.01, max: 8, def: 1, showIf: { animate: [1, 2, 3, 4, 5] } },
      { id: 'spin', label: 'Spin (turns / clip)', type: 'int', min: -8, max: 8, def: 0 },
      { id: 'scrollX', label: 'Scroll X (tiles / clip)', type: 'int', min: -8, max: 8, def: 0 },
      { id: 'scrollY', label: 'Scroll Y (tiles / clip)', type: 'int', min: -8, max: 8, def: 0 },
    ],
    glsl: `
vec4 process(vec2 uv) {
  float k = anim(p_animate, u_phase);
  vec2 off = mix(vec2(p_offX, p_offY), vec2(p_offXEnd, p_offYEnd), k);
  float r = radians(mix(p_rotation, p_rotationEnd, k)) + TAU * p_spin * u_phase;
  vec2 s = max(mix(p_scale, p_scaleEnd, k) * mix(vec2(p_scaleX, p_scaleY), vec2(p_scaleXEnd, p_scaleYEnd), k), vec2(0.001));
  vec2 p = centered(uv) - off;
  p = rot(p, -r) / s;
  vec2 q = uncentered(p) + vec2(p_scrollX, p_scrollY) * u_phase;
  if (p_tiling < 0.5) {
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  } else if (p_tiling < 1.5) {
    q = clamp(q, 0.0, 1.0);
  }
  return texture(u_in0, q);
}`,
  },

  warp: {
    name: 'Warp', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }, { name: 'Warp Map', def: 'gray' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Directional', 'Slope'], def: 0 },
      { id: 'intensity', label: 'Intensity', type: 'float', min: 0, max: 1, def: 0.1 },
      { id: 'angle', label: 'Direction', type: 'float', min: -180, max: 180, def: 90, showIf: { mode: [0] } },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec2 off;
  if (p_mode < 0.5) {
    float a = radians(p_angle);
    off = (lum(texture(u_in1, uv)) - 0.5) * 2.0 * p_intensity * vec2(cos(a), sin(a));
  } else {
    vec2 e = 2.0 / u_res;
    float dx = lum(texture(u_in1, uv + vec2(e.x, 0))) - lum(texture(u_in1, uv - vec2(e.x, 0)));
    float dy = lum(texture(u_in1, uv + vec2(0, e.y))) - lum(texture(u_in1, uv - vec2(0, e.y)));
    off = vec2(dx, dy) / (2.0 * e) * p_intensity * 0.02;
  }
  return texture(u_in0, uv - off);
}`,
  },

  polar: {
    name: 'Polar Coordinates', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Bands → Rings', 'Rings → Bands'], def: 0 },
      { id: 'repeat', label: 'Angular Repeat', type: 'int', min: 1, max: 16, def: 1 },
      { id: 'radius', label: 'Radius Scale', type: 'float', min: 0.1, max: 4, def: 1 },
      { id: 'twist', label: 'Twist', type: 'float', min: -4, max: 4, def: 0, showIf: { mode: [0] } },
      { id: 'clip', label: 'Clip Outside Circle', type: 'bool', def: true, showIf: { mode: [0] } },
    ],
    glsl: `
vec4 process(vec2 uv) {
  if (p_mode < 0.5) {
    vec2 p = centered(uv);
    float r = length(p) * 2.0 / p_radius;
    if (p_clip > 0.5 && r > 1.0) return vec4(0.0);
    float a = (atan(p.y, p.x) / TAU + 0.5) * p_repeat + p_twist * r;
    return texture(u_in0, vec2(fract(a), r));
  }
  float a = (uv.x / p_repeat) * TAU - PI;
  vec2 p = vec2(cos(a), sin(a)) * uv.y * 0.5 * p_radius;
  return texture(u_in0, uncentered(p));
}`,
  },

  mirror: {
    name: 'Mirror / Kaleidoscope', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Mirror X', 'Mirror Y', 'Mirror XY', 'Kaleidoscope'], def: 3 },
      { id: 'segments', label: 'Segments', type: 'int', min: 2, max: 24, def: 6, showIf: { mode: [3] } },
      { id: 'flip', label: 'Use Other Side', type: 'bool', def: false },
      { id: 'mirroredOnly', label: 'Show Mirrored Part Only', type: 'bool', def: false },
    ],
    glsl: `
vec4 process(vec2 uv) {
  bool copied = false;
  vec2 q = uv;
  if (p_mode > 2.5) {
    vec2 p = centered(uv);
    float seg = TAU / p_segments;
    float off = p_flip > 0.5 ? seg * 0.5 : 0.0;
    float a0 = atan(p.y, p.x) - off;
    float am = mod(a0, seg);
    float a = (am <= seg * 0.5 ? am : seg - am) + off;
    // The source wedge [0, seg/2) is left untouched; everything else is a copy.
    copied = !(a0 >= 0.0 && a0 < seg * 0.5);
    q = uncentered(vec2(cos(a), sin(a)) * length(p));
  } else {
    bool fx = p_mode < 0.5 || p_mode > 1.5;
    bool fy = p_mode > 0.5;
    if (fx && (p_flip > 0.5) == (q.x < 0.5)) { q.x = 1.0 - q.x; copied = true; }
    if (fy && (p_flip > 0.5) == (q.y < 0.5)) { q.y = 1.0 - q.y; copied = true; }
  }
  if (p_mirroredOnly > 0.5 && !copied) return vec4(0.0);
  return texture(u_in0, q);
}`,
  },

  blur: {
    name: 'Blur', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Gaussian', 'Directional'], def: 0 },
      { id: 'radius', label: 'Radius', type: 'float', min: 0, max: 0.25, def: 0.02 },
      { id: 'angle', label: 'Direction', type: 'float', min: -180, max: 180, def: 0, showIf: { mode: [1] } },
    ],
    glsl: `
vec4 process(vec2 uv) {
  if (p_radius <= 0.0) return texture(u_in0, uv);
  vec4 acc = vec4(0.0); float ws = 0.0;
  vec2 asp = vec2(min(u_res.x, u_res.y)) / u_res;
  if (p_mode < 0.5) {
    for (int i = 0; i < 96; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 96.0);
      float a = fi * 2.39996323;
      vec2 o = vec2(cos(a), sin(a)) * r * p_radius * asp;
      float w = exp(-r * r * 3.0);
      acc += texture(u_in0, uv + o) * w; ws += w;
    }
  } else {
    float a = radians(p_angle);
    vec2 dir = vec2(cos(a), sin(a)) * p_radius * asp;
    for (int i = 0; i < 48; i++) {
      float t = (float(i) + 0.5) / 48.0 * 2.0 - 1.0;
      float w = exp(-t * t * 2.0);
      acc += texture(u_in0, uv + dir * t) * w; ws += w;
    }
  }
  return acc / ws;
}`,
  },

  radialblur: {
    name: 'Radial Blur', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Zoom', 'Spin'], def: 0 },
      { id: 'strength', label: 'Strength', type: 'float', min: 0, max: 1, def: 0.3 },
      { id: 'cx', label: 'Center X', type: 'float', min: 0, max: 1, def: 0.5 },
      { id: 'cy', label: 'Center Y', type: 'float', min: 0, max: 1, def: 0.5 },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec2 c = vec2(p_cx, p_cy);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 48; i++) {
    float t = float(i) / 47.0;
    vec2 q;
    if (p_mode < 0.5) q = c + (uv - c) * (1.0 - p_strength * t);
    else q = uncentered(rot(centered(uv) - centered(c), (t - 0.5) * p_strength * 1.2) + centered(c));
    float w = 1.0 - t * 0.5;
    acc += texture(u_in0, q) * w; ws += w;
  }
  return acc / ws;
}`,
  },

  edgefade: {
    name: 'Edge Fade', category: 'Filters', inputs: [{ name: 'Input', def: 'transparent' }],
    params: [
      { id: 'shape', label: 'Shape', type: 'enum', options: ['Round', 'Square'], def: 0 },
      { id: 'start', label: 'Fade Start', type: 'float', min: 0, max: 1, def: 0.6 },
      { id: 'softness', label: 'Fade Length', type: 'float', min: 0.01, max: 1, def: 0.35 },
      { id: 'affect', label: 'Affect', type: 'enum', options: ['Color + Alpha', 'Alpha Only', 'Color Only'], def: 0 },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0;
  float d = p_shape < 0.5 ? length(p) : max(abs(p.x), abs(p.y));
  float m = 1.0 - smoothstep(p_start, p_start + p_softness, d);
  vec4 c = texture(u_in0, uv);
  if (p_affect < 0.5) return c * m;
  if (p_affect < 1.5) return vec4(c.rgb, c.a * m);
  return vec4(c.rgb * m, c.a);
}`,
  },

  blend: {
    name: 'Blend', category: 'Filters',
    inputs: [{ name: 'Foreground', def: 'transparent' }, { name: 'Background', def: 'black' }, { name: 'Mask', def: 'white' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Normal', 'Add', 'Subtract', 'Multiply', 'Screen', 'Overlay', 'Lighten (Max)', 'Darken (Min)', 'Difference'], def: 3 },
      { id: 'opacity', label: 'Opacity', type: 'float', min: 0, max: 1, def: 1 },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec4 f = texture(u_in0, uv), b = texture(u_in1, uv);
  float k = p_opacity * lum(texture(u_in2, uv));
  vec3 r;
  float m = p_mode;
  if (m < 0.5) r = f.rgb;
  else if (m < 1.5) r = b.rgb + f.rgb;
  else if (m < 2.5) r = b.rgb - f.rgb;
  else if (m < 3.5) r = b.rgb * f.rgb;
  else if (m < 4.5) r = 1.0 - (1.0 - b.rgb) * (1.0 - f.rgb);
  else if (m < 5.5) r = mix(2.0 * b.rgb * f.rgb, 1.0 - 2.0 * (1.0 - b.rgb) * (1.0 - f.rgb), step(0.5, b.rgb));
  else if (m < 6.5) r = max(b.rgb, f.rgb);
  else if (m < 7.5) r = min(b.rgb, f.rgb);
  else r = abs(b.rgb - f.rgb);
  vec3 rgb = mix(b.rgb, clamp(r, 0.0, 1.0), k * f.a);
  float a = mix(b.a, f.a + b.a * (1.0 - f.a), k);
  return vec4(rgb, a);
}`,
  },

  levels: {
    name: 'Levels', category: 'Filters', inputs: [{ name: 'Input', def: 'black' }],
    params: [
      { id: 'inLow', label: 'Input Black', type: 'float', min: 0, max: 1, def: 0 },
      { id: 'inHigh', label: 'Input White', type: 'float', min: 0, max: 1, def: 1 },
      { id: 'gamma', label: 'Gamma', type: 'float', min: 0.1, max: 5, def: 1 },
      { id: 'outLow', label: 'Output Black', type: 'float', min: 0, max: 1, def: 0 },
      { id: 'outHigh', label: 'Output White', type: 'float', min: 0, max: 1, def: 1 },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec4 c = texture(u_in0, uv);
  vec3 v = clamp((c.rgb - p_inLow) / max(p_inHigh - p_inLow, 1e-4), 0.0, 1.0);
  v = pow(v, vec3(1.0 / p_gamma));
  return vec4(mix(vec3(p_outLow), vec3(p_outHigh), v), c.a);
}`,
  },

  threshold: {
    name: 'Threshold / Dissolve', category: 'Filters', inputs: [{ name: 'Input', def: 'black' }],
    params: [
      { id: 'level', label: 'Level', type: 'float', min: 0, max: 1, def: 0.5 },
      { id: 'smooth', label: 'Smoothness', type: 'float', min: 0, max: 0.5, def: 0.05 },
      { id: 'animate', label: 'Animate Level', type: 'enum', options: ANIM_OPTIONS, def: 0 },
      { id: 'levelEnd', label: 'End Level', type: 'float', min: 0, max: 1, def: 1, showIf: { animate: [1, 2, 3, 4, 5] } },
    ],
    glsl: `
vec4 process(vec2 uv) {
  float lv = mix(p_level, p_levelEnd, anim(p_animate, u_phase));
  float s = max(p_smooth, 1e-4);
  float v = smoothstep(lv - s, lv + s, lum(texture(u_in0, uv)));
  return gray(v);
}`,
  },

  invert: {
    name: 'Invert', category: 'Filters', inputs: [{ name: 'Input', def: 'black' }],
    params: [],
    glsl: `vec4 process(vec2 uv) { vec4 c = texture(u_in0, uv); return vec4(1.0 - c.rgb, c.a); }`,
  },

  // ---------------------------------------------------------------- Color
  gradientmap: {
    name: 'Gradient Map', category: 'Color', inputs: [{ name: 'Input', def: 'black' }],
    params: [
      { id: 'gradient', label: 'Gradient', type: 'gradient', def: GRADIENT_PRESETS['Fire'] },
      { id: 'keepAlpha', label: 'Keep Input Alpha', type: 'bool', def: true },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec4 c = texture(u_in0, uv);
  vec4 g = gradSample(p_gradient_c, p_gradient_p, p_gradient_n, clamp(lum(c), 0.0, 1.0));
  if (p_keepAlpha > 0.5) g.a *= c.a;
  return g;
}`,
  },

  setalpha: {
    name: 'Set Alpha', category: 'Color', inputs: [{ name: 'Color', def: 'white' }, { name: 'Alpha', def: 'white' }],
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', options: ['Replace', 'Multiply'], def: 1 },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec4 c = texture(u_in0, uv);
  float a = lum(texture(u_in1, uv));
  return vec4(c.rgb, p_mode < 0.5 ? a : c.a * a);
}`,
  },

  // ---------------------------------------------------------------- Time
  envelope: {
    name: 'Envelope (Time Curve)', category: 'Time', inputs: [],
    params: [
      { id: 'shape', label: 'Curve', type: 'enum', options: ['Fade In → Out', 'Fade In', 'Fade Out', 'Pulse (loop safe)', 'Ramp Up', 'Ramp Down'], def: 0 },
      { id: 'attack', label: 'Fade In Length', type: 'float', min: 0.001, max: 1, def: 0.15, showIf: { shape: [0, 1] } },
      { id: 'release', label: 'Fade Out Length', type: 'float', min: 0.001, max: 1, def: 0.5, showIf: { shape: [0, 2] } },
      { id: 'pulses', label: 'Pulses (per clip)', type: 'int', min: 1, max: 16, def: 1, showIf: { shape: [3] } },
      { id: 'ease', label: 'Ease', type: 'enum', options: ['Linear', 'Smooth', 'Ease Out', 'Ease In'], def: 1 },
      { id: 'low', label: 'Min Value', type: 'float', min: 0, max: 1, def: 0 },
      { id: 'high', label: 'Max Value', type: 'float', min: 0, max: 1, def: 1 },
    ],
    glsl: `
float ez(float t) {
  t = clamp(t, 0.0, 1.0);
  if (p_ease < 0.5) return t;
  if (p_ease < 1.5) return t * t * (3.0 - 2.0 * t);
  if (p_ease < 2.5) return 1.0 - (1.0 - t) * (1.0 - t);
  return t * t;
}
vec4 process(vec2 uv) {
  float t = u_phase, v;
  if (p_shape < 0.5) v = min(ez(t / p_attack), ez((1.0 - t) / p_release));
  else if (p_shape < 1.5) v = ez(t / p_attack);
  else if (p_shape < 2.5) v = ez((1.0 - t) / p_release);
  else if (p_shape < 3.5) v = ez(0.5 - 0.5 * cos(TAU * t * p_pulses));
  else if (p_shape < 4.5) v = ez(t);
  else v = ez(1.0 - t);
  return gray(mix(p_low, p_high, v));
}`,
  },

  // ---------------------------------------------------------------- Output
  output: {
    name: 'Output', category: 'Output', inputs: [{ name: 'Color', def: 'transparent' }, { name: 'Alpha', def: 'white' }],
    params: [
      { id: 'alphaMode', label: 'Alpha', type: 'enum', options: ['Color Alpha × Alpha Input', 'From Brightness', 'Opaque'], def: 0 },
      { id: 'blackBg', label: 'Bake on Black (for Additive)', type: 'bool', def: false },
    ],
    glsl: `
vec4 process(vec2 uv) {
  vec4 c = texture(u_in0, uv);
  float am = u_has1 > 0.5 ? lum(texture(u_in1, uv)) : 1.0;
  float a;
  if (p_alphaMode < 0.5) a = c.a * am;
  else if (p_alphaMode < 1.5) a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0) * am;
  else a = 1.0;
  if (p_blackBg > 0.5) return vec4(c.rgb * a, 1.0);
  return vec4(c.rgb, a);
}`,
  },
};

export const CATEGORIES = ['Generators', 'Filters', 'Color', 'Time'];

export function defaultParams(type) {
  const def = NODE_TYPES[type];
  const out = {};
  for (const p of def.params) out[p.id] = structuredClone(p.def);
  return out;
}

export function paramVisible(pdef, params) {
  if (!pdef.showIf) return true;
  return Object.entries(pdef.showIf).every(([k, vals]) => vals.includes(params[k]));
}
