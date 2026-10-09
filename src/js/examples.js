// Starter graphs shown in the Examples menu.
import { GRADIENT_PRESETS } from './nodes.js';

const G = (name) => structuredClone(GRADIENT_PRESETS[name]);

function build(settings, nodes, links) {
  return {
    app: 'Mondiro MagicForge', version: 1,
    settings: { frames: 30, fps: 30, mode: 'loop', width: 512, height: 512, ...settings },
    nextId: nodes.length + 1,
    nodes: nodes.map(([id, type, x, y, params = {}]) => ({ id, type, x, y, params })),
    links: links.map(([from, to, input = 0]) => ({ from, to, input })),
    assets: {},
  };
}

export const EXAMPLES = {
  'Magic Orb (Loop)': () => build({}, [
    ['n1', 'perlin', 0, 0, { scale: 4, octaves: 4, roughness: 0.55, contrast: 1.5, evolution: 1, scrollY: 1 }],
    ['n2', 'polar', 170, 0, { twist: 0.6 }],
    ['n3', 'shape', 170, 170, { shape: 0, size: 0.85, falloff: 2, softness: 0.5 }],
    ['n4', 'blend', 340, 60, { mode: 3 }],
    ['n5', 'levels', 510, 60, { inLow: 0.05, inHigh: 0.75 }],
    ['n6', 'gradientmap', 680, 60, { gradient: G('Magic Purple') }],
    ['output', 'output', 850, 60],
  ], [['n1', 'n2'], ['n2', 'n4', 0], ['n3', 'n4', 1], ['n4', 'n5'], ['n5', 'n6'], ['n6', 'output']]),

  'Fire Ring (Loop)': () => build({}, [
    ['n1', 'perlin', 0, 0, { scale: 5, octaves: 5, roughness: 0.55, contrast: 1.6, evolution: 1, scrollY: 1 }],
    ['n2', 'polar', 170, 0, { clip: false }],
    ['n3', 'shape', 170, 170, { shape: 1, size: 0.6, thickness: 0.45, softness: 0.3 }],
    ['n4', 'blend', 340, 60, { mode: 3 }],
    ['n5', 'levels', 510, 60, { inLow: 0.12, inHigh: 0.7 }],
    ['n6', 'gradientmap', 680, 60, { gradient: G('Fire') }],
    ['output', 'output', 850, 60],
  ], [['n1', 'n2'], ['n2', 'n4', 0], ['n3', 'n4', 1], ['n4', 'n5'], ['n5', 'n6'], ['n6', 'output']]),

  'Shockwave Burst (One-shot)': () => build({ mode: 'oneshot', frames: 24 }, [
    ['n1', 'shape', 0, 0, { shape: 1, size: 0.5, thickness: 0.14, softness: 0.08 }],
    ['n2', 'perlin', 0, 170, { scale: 6, octaves: 3, evolution: 1, contrast: 1.5 }],
    ['n3', 'levels', 170, 170, { inLow: 0.2, inHigh: 0.75, outLow: 0.25 }],
    ['n4', 'blend', 340, 60, { mode: 3 }],
    ['n5', 'transform', 510, 60, { scale: 0.15, animate: 3, scaleEnd: 1.9 }],
    ['n6', 'envelope', 510, 230, { shape: 2, release: 0.75, ease: 1 }],
    ['n7', 'blend', 680, 60, { mode: 3 }],
    ['n8', 'gradientmap', 850, 60, { gradient: G('Electric') }],
    ['output', 'output', 1020, 60],
  ], [['n2', 'n3'], ['n3', 'n4', 0], ['n1', 'n4', 1], ['n4', 'n5'], ['n6', 'n7', 0], ['n5', 'n7', 1], ['n7', 'n8'], ['n8', 'output']]),

  'Holy Rays (Loop)': () => build({}, [
    ['n1', 'rays', 0, 0, { count: 16, sharpness: 0.55, randomness: 0.6, length: 1.0, falloff: 1.3, twinkle: 2 }],
    ['n2', 'shape', 0, 170, { shape: 0, size: 0.22, falloff: 1, softness: 0.45 }],
    ['n3', 'blend', 170, 60, { mode: 1 }],
    ['n4', 'gradientmap', 340, 60, { gradient: G('Holy Gold') }],
    ['output', 'output', 510, 60],
  ], [['n2', 'n3', 0], ['n1', 'n3', 1], ['n3', 'n4'], ['n4', 'output']]),

  'Electric Energy (Loop)': () => build({}, [
    ['n1', 'cells', 0, 0, { scale: 5, mode: 1, width: 0.07, evolution: 1 }],
    ['n2', 'perlin', 0, 170, { scale: 3, octaves: 3, evolution: 2 }],
    ['n3', 'warp', 170, 60, { mode: 0, intensity: 0.05, angle: 45 }],
    ['n4', 'edgefade', 340, 60, { start: 0.45, softness: 0.5 }],
    ['n5', 'gradientmap', 510, 60, { gradient: G('Electric') }],
    ['output', 'output', 680, 60],
  ], [['n1', 'n3', 0], ['n2', 'n3', 1], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'output']]),

  'Poison Dissolve (One-shot)': () => build({ mode: 'oneshot', frames: 30 }, [
    ['n1', 'perlin', 0, 0, { scale: 4, octaves: 5, evolution: 0, contrast: 1.4 }],
    ['n2', 'threshold', 170, 0, { level: 0, smooth: 0.06, animate: 4, levelEnd: 1 }],
    ['n3', 'shape', 170, 170, { shape: 0, size: 0.8, falloff: 2, softness: 0.5 }],
    ['n4', 'blend', 340, 60, { mode: 3 }],
    ['n5', 'gradientmap', 510, 60, { gradient: G('Poison') }],
    ['output', 'output', 680, 60],
  ], [['n1', 'n2'], ['n2', 'n4', 0], ['n3', 'n4', 1], ['n4', 'n5'], ['n5', 'output']]),
};

export const DEFAULT_EXAMPLE = 'Magic Orb (Loop)';
