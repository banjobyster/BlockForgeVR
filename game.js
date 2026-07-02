// ============================================================================
// BLOCKFORGE VR — a voxel sandbox for WebXR (Quest over Link) + desktop
// Single-file engine: world gen, chunk meshing, physics, VR input, audio.
// ============================================================================
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// Constants & block registry
// ----------------------------------------------------------------------------
const CHUNK = 16, WORLD_H = 64, WATER_LEVEL = 14;
const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7,
  COBBLE: 8, GLASS: 9, WATER: 10, BRICK: 11, GLOW: 12, SNOW: 13, BEDROCK: 14,
  TALLGRASS: 15, FLOWER_R: 16, FLOWER_Y: 17,
};
// tile ids in the atlas (col-major fill below)
const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6,
  LEAVES: 7, PLANKS: 8, COBBLE: 9, GLASS: 10, WATER: 11, BRICK: 12, GLOW: 13,
  SNOW: 14, SNOW_SIDE: 15, BEDROCK: 16, TALLGRASS: 17, FLOWER_R: 18, FLOWER_Y: 19,
};
const BLOCKS = {
  [B.GRASS]:     { name: 'Grass',      top: T.GRASS_TOP, bottom: T.DIRT, side: T.GRASS_SIDE, opaque: true, hard: 0.3 },
  [B.DIRT]:      { name: 'Dirt',       top: T.DIRT, bottom: T.DIRT, side: T.DIRT, opaque: true, hard: 0.3 },
  [B.STONE]:     { name: 'Stone',      top: T.STONE, bottom: T.STONE, side: T.STONE, opaque: true, hard: 0.7 },
  [B.SAND]:      { name: 'Sand',       top: T.SAND, bottom: T.SAND, side: T.SAND, opaque: true, hard: 0.25 },
  [B.LOG]:       { name: 'Wood Log',   top: T.LOG_TOP, bottom: T.LOG_TOP, side: T.LOG_SIDE, opaque: true, hard: 0.5 },
  [B.LEAVES]:    { name: 'Leaves',     top: T.LEAVES, bottom: T.LEAVES, side: T.LEAVES, cutout: true, hard: 0.12 },
  [B.PLANKS]:    { name: 'Planks',     top: T.PLANKS, bottom: T.PLANKS, side: T.PLANKS, opaque: true, hard: 0.45 },
  [B.COBBLE]:    { name: 'Cobblestone',top: T.COBBLE, bottom: T.COBBLE, side: T.COBBLE, opaque: true, hard: 0.7 },
  [B.GLASS]:     { name: 'Glass',      top: T.GLASS, bottom: T.GLASS, side: T.GLASS, trans: true, hard: 0.15 },
  [B.WATER]:     { name: 'Water',      top: T.WATER, bottom: T.WATER, side: T.WATER, trans: true, liquid: true, solid: false, hard: Infinity },
  [B.BRICK]:     { name: 'Bricks',     top: T.BRICK, bottom: T.BRICK, side: T.BRICK, opaque: true, hard: 0.7 },
  [B.GLOW]:      { name: 'Glowstone',  top: T.GLOW, bottom: T.GLOW, side: T.GLOW, opaque: true, hard: 0.3, light: true },
  [B.SNOW]:      { name: 'Snow',       top: T.SNOW, bottom: T.DIRT, side: T.SNOW_SIDE, opaque: true, hard: 0.25 },
  [B.BEDROCK]:   { name: 'Bedrock',    top: T.BEDROCK, bottom: T.BEDROCK, side: T.BEDROCK, opaque: true, hard: Infinity },
  [B.TALLGRASS]: { name: 'Tall Grass', top: T.TALLGRASS, bottom: T.TALLGRASS, side: T.TALLGRASS, cross: true, solid: false, replaceable: true, hard: 0.04 },
  [B.FLOWER_R]:  { name: 'Poppy',      top: T.FLOWER_R, bottom: T.FLOWER_R, side: T.FLOWER_R, cross: true, solid: false, replaceable: true, hard: 0.04 },
  [B.FLOWER_Y]:  { name: 'Dandelion',  top: T.FLOWER_Y, bottom: T.FLOWER_Y, side: T.FLOWER_Y, cross: true, solid: false, replaceable: true, hard: 0.04 },
};
const PALETTE = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.LEAVES, B.SAND, B.GLASS, B.BRICK, B.GLOW, B.SNOW];

const def = id => BLOCKS[id];
const isOpaque = id => { const d = BLOCKS[id]; return !!(d && d.opaque); };
const isSolidBlock = id => { const d = BLOCKS[id]; return !!d && d.solid !== false; };
const occludes = id => { const d = BLOCKS[id]; return !!(d && (d.opaque || d.cutout)); }; // for AO

// ----------------------------------------------------------------------------
// Seeded noise
// ----------------------------------------------------------------------------
let SEED = 1337;
function hashI(x, z, s) {
  let h = (x * 374761393 + z * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  const a = hashI(xi, zi, s), b = hashI(xi + 1, zi, s), c = hashI(xi, zi + 1, s), d = hashI(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}
function fbm(x, z, oct, s) {
  let v = 0, amp = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x, z, s + i * 101) * amp;
    tot += amp; amp *= 0.5; x *= 2.03; z *= 1.97;
  }
  return v / tot;
}

// ----------------------------------------------------------------------------
// World generation (pure functions of world x,z — deterministic everywhere)
// ----------------------------------------------------------------------------
function heightAt(x, z) {
  const c = fbm(x * 0.004 + 37.7, z * 0.004 - 81.3, 3, SEED);           // continents
  const h = fbm(x * 0.016, z * 0.016, 4, SEED + 7);                     // hills
  const m = fbm(x * 0.006 + 512, z * 0.006 - 333, 4, SEED + 13);        // mountains
  const cs = c * c * (3 - 2 * c);                                       // sharpen coastlines
  let y = 3 + cs * 20 + h * 8 + Math.pow(Math.max(0, (m - 0.55) / 0.45), 1.7) * 32;
  return Math.max(2, Math.min(58, Math.floor(y)));
}
function forestAt(x, z) { return fbm(x * 0.012 + 900, z * 0.012 - 900, 2, SEED + 23); }
function treeAt(x, z) {
  const h = heightAt(x, z);
  if (h <= WATER_LEVEL + 1 || h >= 40) return null;
  const density = forestAt(x, z) > 0.56 ? 0.030 : 0.0035;
  const r = hashI(x, z, SEED + 31);
  if (r >= density) return null;
  return { h, trunk: 4 + Math.floor(hashI(x, z, SEED + 37) * 3) };
}
function surfaceBlockFor(h) {
  if (h >= 44) return B.SNOW;
  if (h >= 38) return B.STONE;
  if (h <= WATER_LEVEL + 1) return B.SAND;
  return B.GRASS;
}

// ----------------------------------------------------------------------------
// Chunk storage
// ----------------------------------------------------------------------------
const chunks = new Map();          // "cx,cz" -> {data, meshes:[], built}
const edits = new Map();           // "cx,cz" -> Map(idx -> blockId)
const glowSet = new Set();         // "x,y,z" of placed glowstone
const remeshQueue = new Set();     // chunk keys needing (re)mesh
const ckey = (cx, cz) => cx + ',' + cz;
const vidx = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

function genChunkData(cx, cz) {
  const data = new Uint8Array(CHUNK * CHUNK * WORLD_H);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const wx = x0 + x, wz = z0 + z;
    const h = heightAt(wx, wz);
    const surf = surfaceBlockFor(h);
    for (let y = 0; y <= h; y++) {
      let b;
      if (y === 0) b = B.BEDROCK;
      else if (y === h) b = surf;
      else if (y >= h - 3) b = (surf === B.SAND) ? B.SAND : (surf === B.STONE || surf === B.SNOW) ? B.STONE : B.DIRT;
      else b = B.STONE;
      data[vidx(x, y, z)] = b;
    }
    for (let y = h + 1; y <= WATER_LEVEL; y++) data[vidx(x, y, z)] = B.WATER;
    // decorations (only on grass, above water)
    if (surf === B.GRASS && h + 1 < WORLD_H) {
      const r = hashI(wx, wz, SEED + 71);
      if (r < 0.05) data[vidx(x, h + 1, z)] = B.TALLGRASS;
      else if (r < 0.058) data[vidx(x, h + 1, z)] = B.FLOWER_R;
      else if (r < 0.066) data[vidx(x, h + 1, z)] = B.FLOWER_Y;
    }
  }
  // trees — consider trunks up to 3 blocks outside this chunk so canopies cross borders
  for (let tz = z0 - 3; tz < z0 + CHUNK + 3; tz++) for (let tx = x0 - 3; tx < x0 + CHUNK + 3; tx++) {
    const t = treeAt(tx, tz);
    if (!t) continue;
    const put = (wx, wy, wz, b, always) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || wy < 0 || wy >= WORLD_H) return;
      const i = vidx(lx, wy, lz);
      if (always || data[i] === B.AIR || BLOCKS[data[i]]?.cross) data[i] = b;
    };
    for (let y = t.h + 1; y <= t.h + t.trunk; y++) put(tx, y, tz, B.LOG, true);
    const top = t.h + t.trunk;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0 && dy <= 0) continue;
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && hashI(tx + dx * 7, tz + dz * 7 + dy, SEED + 41) < 0.5) continue;
      put(tx + dx, top + dy, tz + dz, B.LEAVES);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
      put(tx + dx, top + 1, tz + dz, B.LEAVES);
    }
    put(tx, top + 2, tz, B.LEAVES);
  }
  // apply saved edits
  const em = edits.get(ckey(cx, cz));
  if (em) for (const [i, v] of em) data[i] = v;
  return data;
}

function ensureChunkData(cx, cz) {
  const k = ckey(cx, cz);
  let c = chunks.get(k);
  if (!c) { c = { cx, cz, data: genChunkData(cx, cz), meshes: null, built: false }; chunks.set(k, c); }
  return c;
}
function getBlock(wx, wy, wz) {
  if (wy < 0) return B.BEDROCK;
  if (wy >= WORLD_H) return B.AIR;
  const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
  const c = chunks.get(ckey(cx, cz));
  if (!c) return B.AIR;
  return c.data[vidx(wx - cx * CHUNK, wy, wz - cz * CHUNK)];
}
function hasChunkAt(wx, wz) {
  return chunks.has(ckey(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)));
}
let saveDirty = false;
function setBlock(wx, wy, wz, v) {
  if (wy < 0 || wy >= WORLD_H) return;
  const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
  const c = ensureChunkData(cx, cz);
  const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
  const i = vidx(lx, wy, lz);
  if (c.data[i] === v) return;
  // popping a support block also pops the plant above it
  const above = wy + 1 < WORLD_H ? c.data[vidx(lx, wy + 1, lz)] : B.AIR;
  c.data[i] = v;
  let em = edits.get(ckey(cx, cz));
  if (!em) { em = new Map(); edits.set(ckey(cx, cz), em); }
  em.set(i, v);
  saveDirty = true;
  const gk = wx + ',' + wy + ',' + wz;
  if (v === B.GLOW) glowSet.add(gk); else glowSet.delete(gk);
  remeshQueue.add(ckey(cx, cz));
  if (lx === 0) remeshQueue.add(ckey(cx - 1, cz));
  if (lx === CHUNK - 1) remeshQueue.add(ckey(cx + 1, cz));
  if (lz === 0) remeshQueue.add(ckey(cx, cz - 1));
  if (lz === CHUNK - 1) remeshQueue.add(ckey(cx, cz + 1));
  if (v === B.AIR && BLOCKS[above]?.cross) setBlock(wx, wy + 1, wz, B.AIR);
}

// ----------------------------------------------------------------------------
// Procedural texture atlas (8x8 grid of 16px tiles, 16px extrusion padding)
// ----------------------------------------------------------------------------
const ATLAS_N = 8, TILE = 16, CELL = 32, ATLAS_PX = ATLAS_N * CELL;
let atlasCanvas, atlasTex;

function makeAtlas() {
  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = ATLAS_PX;
  const actx = atlasCanvas.getContext('2d');
  const tileCv = document.createElement('canvas');
  tileCv.width = tileCv.height = TILE;
  const tctx = tileCv.getContext('2d');

  let rngState = 12345;
  const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };

  function px(img, x, y, r, g, b, a = 255) {
    const i = (y * TILE + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
  }
  function fillNoise(img, r, g, b, v, a = 255) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const n = 1 + (rnd() - 0.5) * v;
      px(img, x, y, r * n, g * n, b * n, a);
    }
  }
  const painters = {
    [T.GRASS_TOP]: img => fillNoise(img, 116, 176, 68, 0.22),
    [T.DIRT]: img => fillNoise(img, 134, 96, 67, 0.25),
    [T.GRASS_SIDE]: img => {
      fillNoise(img, 134, 96, 67, 0.25);
      for (let x = 0; x < TILE; x++) {
        const d = 3 + Math.floor(rnd() * 3);
        for (let y = 0; y < d; y++) { const n = 1 + (rnd() - 0.5) * 0.2; px(img, x, y, 110 * n, 170 * n, 64 * n); }
      }
    },
    [T.STONE]: img => {
      fillNoise(img, 136, 136, 140, 0.14);
      for (let i = 0; i < 14; i++) { const x = (rnd() * TILE) | 0, y = (rnd() * TILE) | 0; px(img, x, y, 105, 105, 110); }
    },
    [T.SAND]: img => fillNoise(img, 219, 208, 155, 0.12),
    [T.LOG_SIDE]: img => {
      for (let x = 0; x < TILE; x++) {
        const stripe = (x % 4 === 0 || x % 7 === 0);
        for (let y = 0; y < TILE; y++) {
          const n = 1 + (rnd() - 0.5) * 0.18;
          if (stripe) px(img, x, y, 84 * n, 62 * n, 38 * n); else px(img, x, y, 108 * n, 81 * n, 48 * n);
        }
      }
    },
    [T.LOG_TOP]: img => {
      fillNoise(img, 165, 132, 82, 0.1);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
        if (((d | 0) % 3) === 0 && d < 8) px(img, x, y, 118, 90, 52);
      }
    },
    [T.LEAVES]: img => {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        if (rnd() < 0.12) { px(img, x, y, 0, 0, 0, 0); continue; }
        const n = 1 + (rnd() - 0.5) * 0.4;
        px(img, x, y, 62 * n, 122 * n, 42 * n);
      }
    },
    [T.PLANKS]: img => {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const seamY = (y % 4 === 3), seamX = (x === (((y >> 2) % 2) ? 7 : 12));
        const n = 1 + (rnd() - 0.5) * 0.14;
        if (seamY || (seamX && !seamY)) px(img, x, y, 118 * n, 91 * n, 51 * n);
        else px(img, x, y, 178 * n, 140 * n, 82 * n);
      }
    },
    [T.COBBLE]: img => {
      fillNoise(img, 90, 90, 94, 0.15);
      for (let i = 0; i < 7; i++) {
        const cx0 = rnd() * TILE, cy0 = rnd() * TILE, rr = 2 + rnd() * 2.6;
        const shade = 120 + rnd() * 45;
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
          const dx = Math.min(Math.abs(x - cx0), TILE - Math.abs(x - cx0));
          const dy = Math.min(Math.abs(y - cy0), TILE - Math.abs(y - cy0));
          if (dx * dx + dy * dy < rr * rr) { const n = 1 + (rnd() - 0.5) * 0.12; px(img, x, y, shade * n, shade * n, (shade + 4) * n); }
        }
      }
    },
    [T.GLASS]: img => {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const border = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
        if (border) px(img, x, y, 210, 230, 240, 255);
        else if (x + y > 8 && x + y < 12) px(img, x, y, 235, 245, 252, 120);
        else px(img, x, y, 195, 225, 240, 52);
      }
    },
    [T.WATER]: img => {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const n = 1 + (rnd() - 0.5) * 0.15;
        px(img, x, y, 53 * n, 108 * n, 208 * n, 178);
      }
    },
    [T.BRICK]: img => {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const row = y >> 2;
        const mortarY = (y % 4 === 3);
        const mortarX = ((x + (row % 2) * 4) % 8 === 7);
        const n = 1 + (rnd() - 0.5) * 0.13;
        if (mortarY || mortarX) px(img, x, y, 188 * n, 178 * n, 168 * n);
        else px(img, x, y, 168 * n, 82 * n, 62 * n);
      }
    },
    [T.GLOW]: img => {
      fillNoise(img, 255, 208, 106, 0.12);
      for (let i = 0; i < 9; i++) {
        const x = (rnd() * 14) | 0, y = (rnd() * 14) | 0;
        px(img, x, y, 255, 244, 196); px(img, x + 1, y, 255, 244, 196); px(img, x, y + 1, 255, 244, 196);
      }
    },
    [T.SNOW]: img => fillNoise(img, 242, 246, 250, 0.05),
    [T.SNOW_SIDE]: img => {
      fillNoise(img, 134, 96, 67, 0.25);
      for (let x = 0; x < TILE; x++) for (let y = 0; y < 4 + (rnd() < 0.5 ? 1 : 0); y++) px(img, x, y, 240, 245, 250);
    },
    [T.BEDROCK]: img => {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const v = rnd() < 0.5 ? 45 : 78;
        px(img, x, y, v, v, v + 4);
      }
    },
    [T.TALLGRASS]: img => {
      for (let i = 0; i < TILE * TILE; i++) img.data[i * 4 + 3] = 0;
      for (let b = 0; b < 9; b++) {
        let x = 2 + (rnd() * 12) | 0;
        const h = 6 + (rnd() * 9) | 0;
        for (let y = TILE - 1; y > TILE - 1 - h; y--) {
          if (rnd() < 0.25) x += rnd() < 0.5 ? -1 : 1;
          if (x < 0 || x >= TILE) break;
          const n = 1 + (rnd() - 0.5) * 0.3;
          px(img, x, y, 96 * n, 158 * n, 56 * n);
        }
      }
    },
    [T.FLOWER_R]: img => {
      painters[T.TALLGRASS](img);
      // clear a stem + bloom
      for (let i = 0; i < TILE * TILE; i++) img.data[i * 4 + 3] = 0;
      for (let y = 6; y < TILE; y++) px(img, 8, y, 62, 128, 44);
      px(img, 7, 9, 62, 128, 44);
      const R = [[8, 4], [7, 4], [9, 4], [8, 3], [8, 5], [7, 3], [9, 3], [7, 5], [9, 5]];
      for (const [x, y] of R) px(img, x, y, 214, 48, 44);
      px(img, 8, 4, 40, 30, 30);
    },
    [T.FLOWER_Y]: img => {
      for (let i = 0; i < TILE * TILE; i++) img.data[i * 4 + 3] = 0;
      for (let y = 7; y < TILE; y++) px(img, 7, y, 62, 128, 44);
      const R = [[7, 4], [6, 4], [8, 4], [7, 3], [7, 5]];
      for (const [x, y] of R) px(img, x, y, 238, 208, 60);
      px(img, 7, 4, 250, 236, 150);
    },
  };

  for (let t = 0; t < ATLAS_N * ATLAS_N; t++) {
    const paint = painters[t];
    if (!paint) continue;
    const img = tctx.createImageData(TILE, TILE);
    rngState = 1000 + t * 977;
    paint(img);
    tctx.putImageData(img, 0, 0);
    const cx0 = (t % ATLAS_N) * CELL, cy0 = Math.floor(t / ATLAS_N) * CELL;
    actx.save();
    actx.beginPath(); actx.rect(cx0, cy0, CELL, CELL); actx.clip();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      actx.drawImage(tileCv, cx0 + 8 + dx * TILE, cy0 + 8 + dy * TILE);
    actx.restore();
  }
  atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.generateMipmaps = true;
  atlasTex.anisotropy = 4;
}
// uv rect of a tile (inner 16px of its padded cell)
function tileUV(t) {
  const cx0 = (t % ATLAS_N) * CELL + 8, cy0 = Math.floor(t / ATLAS_N) * CELL + 8;
  return [cx0 / ATLAS_PX, 1 - (cy0 + TILE) / ATLAS_PX, (cx0 + TILE) / ATLAS_PX, 1 - cy0 / ATLAS_PX];
}

// ----------------------------------------------------------------------------
// Chunk meshing (per-face culling + per-vertex AO baked into vertex colors)
// ----------------------------------------------------------------------------
const FACES = [
  { dir: [-1, 0, 0], shade: 0.78, corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0],  shade: 0.78, corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], shade: 0.55, corners: [{ pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0],  shade: 1.0,  corners: [{ pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], shade: 0.68, corners: [{ pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1],  shade: 0.88, corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];
const AO_LEVELS = [0.42, 0.62, 0.8, 1.0];

let matOpaque, matCross, matTrans, matEmissive, matWater;
const waterUniforms = { uTime: { value: 0 } };
function makeMaterials() {
  matOpaque = new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
  matCross = new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  matTrans = new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.05 });
  matEmissive = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true }); // light-emitting blocks ignore scene light
  // water: gentle vertex waves on the surface + drifting texture (stays inside the
  // atlas cell thanks to the 8px extrusion padding around each tile)
  matWater = new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  matWater.onBeforeCompile = sh => {
    sh.uniforms.uTime = waterUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
        vMapUv += vec2(sin(uTime * 0.35), cos(uTime * 0.27)) * ${(3 / ATLAS_PX).toFixed(6)};
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (normal.y > 0.5) {
          vec3 wpw = (modelMatrix * vec4(position, 1.0)).xyz;
          transformed.y += -0.1
            + sin(uTime * 1.7 + wpw.x * 0.9 + wpw.z * 0.7) * 0.045
            + sin(uTime * 1.1 + wpw.z * 1.4 - wpw.x * 0.6) * 0.035;
        }`);
  };
}

function buildChunkMesh(c) {
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
  const geos = { o: null, x: null, t: null, e: null, w: null };
  const buf = {
    o: { pos: [], nor: [], uv: [], col: [], idx: [] },
    x: { pos: [], nor: [], uv: [], col: [], idx: [] },
    t: { pos: [], nor: [], uv: [], col: [], idx: [] },
    e: { pos: [], nor: [], uv: [], col: [], idx: [] },
    w: { pos: [], nor: [], uv: [], col: [], idx: [] },
  };
  const gb = (wx, wy, wz) => getBlock(wx, wy, wz);

  for (let y = 0; y < WORLD_H; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const v = c.data[vidx(x, y, z)];
    if (v === B.AIR) continue;
    const d = BLOCKS[v];
    const wx = x0 + x, wz = z0 + z;

    // subtle per-block color variation so grass and foliage don't look flat
    let tr = 1, tg = 1, tb = 1;
    if (v === B.GRASS || v === B.LEAVES || v === B.TALLGRASS) {
      const h1 = hashI(wx, wz, SEED + 201), h2 = hashI(wx + 517, wz - 293, SEED + 202);
      tr = 0.93 + h1 * 0.1; tg = 0.9 + h2 * 0.16; tb = 0.93 + h1 * 0.08;
    }

    if (d.cross) {
      // two crossed quads
      const b = buf.x;
      const [u0, v0, u1, v1] = tileUV(d.side);
      const quads = [
        [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.15, 1, 0.15], [0.85, 1, 0.85]],
        [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.85, 1, 0.15], [0.15, 1, 0.85]],
      ];
      for (const q of quads) {
        const n = b.pos.length / 3;
        const uvq = [[u0, v1], [u1, v1], [u0, v0], [u1, v0]]; // note: uv y=1 at top
        for (let i = 0; i < 4; i++) {
          b.pos.push(x + q[i][0], y + q[i][1], z + q[i][2]);
          b.nor.push(0, 1, 0);
          b.uv.push(uvq[i][0], q[i][1] === 1 ? v1 : v0);
          b.col.push(tr, tg, tb);
        }
        b.idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      }
      continue;
    }

    for (const f of FACES) {
      const nb = gb(wx + f.dir[0], y + f.dir[1], wz + f.dir[2]);
      if (d.opaque || d.cutout) {
        if (isOpaque(nb)) continue;
        if (d.cutout && nb === v) continue;               // cull leaf-leaf internal faces
      } else { // transparent (water/glass)
        if (isOpaque(nb) || nb === v) continue;
      }
      const b = d.light ? buf.e : d.liquid ? buf.w : (d.opaque || d.cutout) ? buf.o : buf.t;
      const [u0, v0, u1, v1] = tileUV(f.dir[1] > 0 ? d.top : f.dir[1] < 0 ? d.bottom : d.side);
      const n = b.pos.length / 3;
      // tangent axes for AO
      const na = f.dir[0] !== 0 ? 0 : f.dir[1] !== 0 ? 1 : 2;
      const ta = na === 0 ? 1 : 0, ua = na === 2 ? 1 : 2;
      for (const cn of f.corners) {
        b.pos.push(x + cn.pos[0], y + cn.pos[1], z + cn.pos[2]);
        b.nor.push(f.dir[0], f.dir[1], f.dir[2]);
        b.uv.push(u0 + (u1 - u0) * cn.uv[0], v0 + (v1 - v0) * cn.uv[1]);
        let ao = 1;
        if ((d.opaque || d.cutout) && !d.light) {
          const base = [wx + f.dir[0], y + f.dir[1], wz + f.dir[2]];
          const s1o = [0, 0, 0], s2o = [0, 0, 0];
          s1o[ta] = cn.pos[ta] === 1 ? 1 : -1;
          s2o[ua] = cn.pos[ua] === 1 ? 1 : -1;
          const s1 = occludes(gb(base[0] + s1o[0], base[1] + s1o[1], base[2] + s1o[2])) ? 1 : 0;
          const s2 = occludes(gb(base[0] + s2o[0], base[1] + s2o[1], base[2] + s2o[2])) ? 1 : 0;
          const cc = occludes(gb(base[0] + s1o[0] + s2o[0], base[1] + s1o[1] + s2o[1], base[2] + s1o[2] + s2o[2])) ? 1 : 0;
          ao = AO_LEVELS[(s1 && s2) ? 0 : 3 - (s1 + s2 + cc)];
        }
        const sh = d.light ? 0.75 + f.shade * 0.25 : f.shade * ao;
        b.col.push(sh * tr, sh * tg, sh * tb);
      }
      b.idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
    }
  }

  for (const k of ['o', 'x', 't', 'e', 'w']) {
    const b = buf[k];
    if (b.idx.length === 0) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    geos[k] = g;
  }
  return geos;
}

let worldGroup;
function remeshChunk(c) {
  if (c.meshes) {
    for (const m of c.meshes) { worldGroup.remove(m); m.geometry.dispose(); }
  }
  c.meshes = [];
  const geos = buildChunkMesh(c);
  const mats = { o: matOpaque, x: matCross, t: matTrans, e: matEmissive, w: matWater };
  for (const k of ['o', 'x', 't', 'e', 'w']) {
    if (!geos[k]) continue;
    const m = new THREE.Mesh(geos[k], mats[k]);
    m.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
    if (k === 'w') m.renderOrder = 2;
    if (k === 't') m.renderOrder = 3;
    if (k === 'o' || k === 'x' || k === 'e') m.castShadow = true;
    if (k === 'o' || k === 'x' || k === 't' || k === 'w') m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    worldGroup.add(m);
    c.meshes.push(m);
  }
  c.built = true;
}

// ----------------------------------------------------------------------------
// Voxel raycast (DDA)
// ----------------------------------------------------------------------------
function raycastVoxel(ox, oy, oz, dx, dy, dz, maxDist) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x)) * tDX : Infinity;
  let tMY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y)) * tDY : Infinity;
  let tMZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z)) * tDZ : Infinity;
  let face = [0, 0, 0], t = 0;
  for (let i = 0; i < 256; i++) {
    const b = getBlock(x, y, z);
    if (b !== B.AIR && b !== B.WATER) return { x, y, z, block: b, face, dist: t };
    if (tMX < tMY && tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; face = [-stepX, 0, 0]; }
    else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; face = [0, -stepY, 0]; }
    else { z += stepZ; t = tMZ; tMZ += tDZ; face = [0, 0, -stepZ]; }
    if (t > maxDist) return null;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Renderer / scene / sky
// ----------------------------------------------------------------------------
let renderer, scene, camera, rig;
let sunLight, moonGlowAmbient, ambient, hemiLight;
let sunMesh, moonMesh, stars, cloudGroup, skyDome;
let vignette;
const glowLights = [];

function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);
  atlasTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 1400);
  rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  worldGroup = new THREE.Group();
  scene.add(worldGroup);

  ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a5a, 0.35);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff3d0, 1.1);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 40;
  sunLight.shadow.camera.far = 520;
  sunLight.shadow.camera.left = -60;
  sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60;
  sunLight.shadow.camera.bottom = -60;
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight);
  scene.add(sunLight.target);

  scene.fog = new THREE.Fog(0x87ceeb, 30, 200);

  buildSkyDome();

  // sun & moon billboards
  const mkDisc = (inner, outer, alpha) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, inner); gr.addColorStop(0.45, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false, opacity: alpha }));
    m.renderOrder = -10;
    scene.add(m);
    return m;
  };
  sunMesh = mkDisc('rgba(255,252,230,1)', 'rgba(255,214,110,0.9)', 1);
  moonMesh = mkDisc('rgba(235,240,255,1)', 'rgba(160,180,220,0.55)', 0.9);
  moonMesh.scale.setScalar(0.55);

  // stars
  {
    const n = 900, posArr = new Float32Array(n * 3);
    let st = 424242;
    const r = () => { st = (st * 1103515245 + 12345) & 0x7fffffff; return st / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, e = Math.asin(r() * 0.98);
      const R = 1000;
      posArr[i * 3] = Math.cos(a) * Math.cos(e) * R;
      posArr[i * 3 + 1] = Math.sin(e) * R;
      posArr[i * 3 + 2] = Math.sin(a) * Math.cos(e) * R;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    stars.renderOrder = -11;
    scene.add(stars);
  }

  buildClouds();

  // glowstone light pool
  for (let i = 0; i < 6; i++) {
    const pl = new THREE.PointLight(0xffc873, 0, 13, 1.6);
    pl.visible = false;
    scene.add(pl);
    glowLights.push(pl);
  }

  // comfort vignette
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    vignette = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    vignette.position.set(0, 0, -0.42);
    vignette.renderOrder = 999;
    camera.add(vignette);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// gradient sky dome with sun/moon halo — replaces the flat background color
function buildSkyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3a7bd5) },
      horizonColor: { value: new THREE.Color(0x9fd3f0) },
      bottomColor: { value: new THREE.Color(0x37546e) },
      glowDir: { value: new THREE.Vector3(0, 1, 0) },
      glowColor: { value: new THREE.Color(0xffe9b0) },
      glowStrength: { value: 0.4 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor, horizonColor, bottomColor, glowDir, glowColor;
      uniform float glowStrength;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = d.y >= 0.0
          ? mix(horizonColor, topColor, pow(min(1.0, d.y * 1.5), 0.65))
          : mix(horizonColor, bottomColor, min(1.0, -d.y * 3.5));
        float s = max(0.0, dot(d, glowDir));
        col += glowColor * (pow(s, 6.0) * 0.3 + pow(s, 48.0) * 0.7) * glowStrength;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  skyDome = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), mat);
  skyDome.renderOrder = -20;
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  scene.background = null;
}

// clouds: periodic tile of flat boxes, 3x3 instances → seamless infinite drift
const CLOUD_P = 768;
function buildClouds() {
  const cell = 24, cells = CLOUD_P / cell;
  const boxes = [];
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const n = fbm((i % cells) * 0.55 + 4000, (j % cells) * 0.55 + 4000, 2, 5150);
    if (n > 0.62) boxes.push([i * cell, j * cell, Math.min(1, (n - 0.62) * 8)]);
  }
  const geo = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (const [bx, bz, s] of boxes) {
    const w = cell * (0.55 + s * 0.45), h = 5;
    const x0 = bx, x1 = bx + w, z0 = bz, z1 = bz + w, y0 = 0, y1 = h;
    const base = pos.length / 3;
    const corners = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    for (const c of corners) pos.push(...c);
    const quads = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const q of quads) idx.push(base + q[0], base + q[2], base + q[1], base + q[0], base + q[3], base + q[2]);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, fog: false });
  cloudGroup = new THREE.Group();
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(i * CLOUD_P, 0, j * CLOUD_P);
    m.castShadow = true; // drifting cloud shadows on the terrain
    cloudGroup.add(m);
  }
  cloudGroup.position.y = 96;
  scene.add(cloudGroup);
}

// ----------------------------------------------------------------------------
// Day / night cycle
// ----------------------------------------------------------------------------
const DAY_LENGTH = 600; // seconds for a full cycle
let timeOfDay = 0.35;   // mid-morning start (0.5 = noon)
const skyHorizonDay = new THREE.Color(0x9fd3f0), skyHorizonNight = new THREE.Color(0x0b1530), skySet = new THREE.Color(0xff8c4a);
const skyTopDay = new THREE.Color(0x3a7bd5), skyTopNight = new THREE.Color(0x04081a), skyTopDusk = new THREE.Color(0x45437c);
const glowDay = new THREE.Color(0xffe9b0), glowSunset = new THREE.Color(0xff6f2e), glowMoon = new THREE.Color(0x8fa8ff);
const ambDay = new THREE.Color(0xffffff), ambNight = new THREE.Color(0x6272b8);
const underwaterCol = new THREE.Color(0x14407c);
const tmpCol = new THREE.Color(), tmpCol2 = new THREE.Color();
const lightDirTmp = new THREE.Vector3();
let curDayF = 1, curUnderwater = false;

function updateSky(dt, headPos) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  const ang = timeOfDay * Math.PI * 2 - Math.PI / 2; // t=0.25 → sun overhead
  const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
  const e = sunDir.y; // sun elevation -1..1

  const dayF = THREE.MathUtils.clamp(e * 3 + 0.1, 0, 1);
  const setF = THREE.MathUtils.clamp(1 - Math.abs(e) * 5, 0, 1) * dayF;
  curDayF = dayF;
  const night = e < -0.04;

  // horizon drives the fog; top color darkens toward dusk purple
  tmpCol.copy(skyHorizonNight).lerp(skyHorizonDay, dayF).lerp(skySet, setF * 0.7);
  tmpCol2.copy(skyTopNight).lerp(skyTopDay, dayF).lerp(skyTopDusk, setF * 0.55);
  const dist = RENDER_R * CHUNK;
  const underwater = getBlock(Math.floor(headPos.x), Math.floor(headPos.y), Math.floor(headPos.z)) === B.WATER;
  curUnderwater = underwater;
  const u = skyDome.material.uniforms;
  if (underwater) {
    scene.fog.color.copy(underwaterCol);
    scene.fog.near = 1; scene.fog.far = 18;
    u.topColor.value.copy(underwaterCol).multiplyScalar(0.5);
    u.horizonColor.value.copy(underwaterCol);
    u.bottomColor.value.copy(underwaterCol).multiplyScalar(0.35);
    u.glowStrength.value = 0;
  } else {
    scene.fog.color.copy(tmpCol);
    scene.fog.near = dist * 0.45; scene.fog.far = dist * 0.95;
    u.topColor.value.copy(tmpCol2);
    u.horizonColor.value.copy(tmpCol);
    u.bottomColor.value.copy(tmpCol).multiplyScalar(0.4);
    if (night) {
      u.glowDir.value.copy(sunDir).negate();
      u.glowColor.value.copy(glowMoon);
      u.glowStrength.value = 0.22;
    } else {
      u.glowDir.value.copy(sunDir);
      u.glowColor.value.copy(glowDay).lerp(glowSunset, setF);
      u.glowStrength.value = 0.35 + setF * 1.1;
    }
  }
  skyDome.position.copy(headPos);

  // one directional light: sun by day, cool moonlight after dark
  lightDirTmp.copy(sunDir);
  if (night) lightDirTmp.negate();
  sunLight.position.copy(lightDirTmp).multiplyScalar(300).add(headPos);
  sunLight.target.position.copy(headPos);
  if (night) {
    sunLight.intensity = 0.3;
    sunLight.color.set(0x8fa5ff);
  } else {
    sunLight.intensity = 0.35 + dayF * 1.3;
    sunLight.color.setHSL(0.12 - setF * 0.05, 0.5 + setF * 0.4, 0.72 + dayF * 0.18);
  }
  ambient.intensity = 0.28 + dayF * 0.42;
  ambient.color.copy(ambNight).lerp(ambDay, dayF);
  hemiLight.intensity = 0.15 + dayF * 0.4;

  sunMesh.position.copy(sunDir).multiplyScalar(900).add(headPos);
  sunMesh.lookAt(headPos);
  moonMesh.position.copy(sunDir).multiplyScalar(-900).add(headPos);
  moonMesh.lookAt(headPos);
  stars.material.opacity = THREE.MathUtils.clamp(-e * 4, 0, 0.95);
  stars.position.copy(headPos);

  // clouds drift + follow player (periodic tile → snapping is seamless)
  cloudDrift += dt * 1.6;
  const px = headPos.x, pz = headPos.z;
  cloudGroup.position.x = cloudDrift % CLOUD_P + Math.floor((px - cloudDrift % CLOUD_P) / CLOUD_P) * CLOUD_P;
  cloudGroup.position.z = Math.floor(pz / CLOUD_P) * CLOUD_P;
}
let cloudDrift = 0;

function updateGlowLights(headPos) {
  const near = [];
  for (const k of glowSet) {
    const [x, y, z] = k.split(',').map(Number);
    const d2 = (x - headPos.x) ** 2 + (y - headPos.y) ** 2 + (z - headPos.z) ** 2;
    if (d2 < 32 * 32) near.push([d2, x, y, z]);
  }
  near.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < glowLights.length; i++) {
    const pl = glowLights[i];
    if (i < near.length) {
      pl.position.set(near[i][1] + 0.5, near[i][2] + 0.5, near[i][3] + 0.5);
      pl.visible = true; pl.intensity = 14;
    } else pl.visible = false;
  }
}

// ----------------------------------------------------------------------------
// Audio (procedural, positional)
// ----------------------------------------------------------------------------
let actx = null, masterGain = null, masterFilter = null;
function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain();
    masterGain.gain.value = OPTS.volume;
    masterFilter = actx.createBiquadFilter(); // underwater muffle
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 20000;
    const comp = actx.createDynamicsCompressor(); // loud but never clipping
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 8;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    masterGain.connect(masterFilter);
    masterFilter.connect(comp);
    comp.connect(actx.destination);
    startAmbience();
  } catch (e) { /* audio unavailable */ }
}
function panNode(pos) {
  if (!pos) return masterGain;
  const p = actx.createPanner();
  p.panningModel = 'equalpower';
  p.refDistance = 3; p.rolloffFactor = 0.45; p.maxDistance = 48;
  p.setPosition(pos.x, pos.y, pos.z);
  p.connect(masterGain);
  return p;
}
function noiseBurst({ freq = 500, q = 2, dur = 0.09, vol = 0.5, pos = null, drop = 0 }) {
  if (!actx) return;
  const n = actx.sampleRate * dur;
  const bufSrc = actx.createBufferSource();
  const buffer = actx.createBuffer(1, n, actx.sampleRate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  bufSrc.buffer = buffer;
  const filt = actx.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = q;
  if (drop) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq - drop), actx.currentTime + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  bufSrc.connect(filt); filt.connect(g); g.connect(panNode(pos));
  bufSrc.start();
}
function sndBreak(pos, id) {
  const stone = [B.STONE, B.COBBLE, B.BRICK, B.BEDROCK].includes(id);
  noiseBurst({ freq: stone ? 900 : 480, q: 1.2, dur: 0.12, vol: 1.0, pos, drop: 300 });
  noiseBurst({ freq: stone ? 300 : 160, q: 2, dur: 0.16, vol: 0.75, pos });
}
function sndPlace(pos) { noiseBurst({ freq: 380, q: 3, dur: 0.07, vol: 0.8, pos, drop: 150 }); }
function sndStep(surface) {
  const stone = [B.STONE, B.COBBLE, B.BRICK, B.BEDROCK, B.SNOW].includes(surface);
  const sand = surface === B.SAND;
  noiseBurst({ freq: stone ? 300 : sand ? 140 : 190, q: 1.5, dur: 0.05, vol: 0.3 });
}
function sndMineTick(pos) { noiseBurst({ freq: 700, q: 4, dur: 0.03, vol: 0.25, pos }); }
function sndBleat(pos) {
  if (!actx) return;
  const o = actx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(480, actx.currentTime);
  o.frequency.linearRampToValueAtTime(360, actx.currentTime + 0.28);
  const vib = actx.createOscillator(); vib.frequency.value = 14;
  const vibG = actx.createGain(); vibG.gain.value = 26;
  vib.connect(vibG); vibG.connect(o.frequency);
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.linearRampToValueAtTime(0.3, actx.currentTime + 0.05);
  g.gain.linearRampToValueAtTime(0.0001, actx.currentTime + 0.3);
  o.connect(f); f.connect(g); g.connect(panNode(pos));
  o.start(); vib.start();
  o.stop(actx.currentTime + 0.32); vib.stop(actx.currentTime + 0.32);
}
function updateAudioListener() {
  if (!actx) return;
  const l = actx.listener;
  const p = new THREE.Vector3(); camera.getWorldPosition(p);
  const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  if (l.setPosition) { l.setPosition(p.x, p.y, p.z); l.setOrientation(fw.x, fw.y, fw.z, up.x, up.y, up.z); }
}

// ambience: looping wind bed + birds by day, crickets by night
let ambienceOn = false, windGain = null, birdT = 3, cricketT = 4;
function startAmbience() {
  if (!actx || ambienceOn) return;
  ambienceOn = true;
  const len = actx.sampleRate * 2;
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const ch = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) { v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; ch[i] = v * 3.5; }
  const src = actx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 340;
  windGain = actx.createGain(); windGain.gain.value = 0;
  src.connect(f); f.connect(windGain); windGain.connect(masterGain);
  src.start();
}
function randAmbientPos(dist) {
  const p = new THREE.Vector3(); camera.getWorldPosition(p);
  const a = Math.random() * Math.PI * 2;
  return new THREE.Vector3(p.x + Math.cos(a) * dist, p.y + 3 + Math.random() * 5, p.z + Math.sin(a) * dist);
}
function sndBird() {
  const t0 = actx.currentTime, base = 2100 + Math.random() * 1300;
  const pan = panNode(randAmbientPos(10 + Math.random() * 8));
  const chirps = 2 + (Math.random() * 3 | 0);
  for (let i = 0; i < chirps; i++) {
    const ts = t0 + i * (0.13 + Math.random() * 0.1);
    const o = actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(base * (1 + Math.random() * 0.25), ts);
    o.frequency.exponentialRampToValueAtTime(base * 0.72, ts + 0.09);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.16, ts + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.11);
    o.connect(g); g.connect(pan);
    o.start(ts); o.stop(ts + 0.13);
  }
}
function sndCricket() {
  const t0 = actx.currentTime;
  const pan = panNode(randAmbientPos(7 + Math.random() * 6));
  const o = actx.createOscillator(); o.type = 'triangle';
  o.frequency.value = 4200 + Math.random() * 700;
  const g = actx.createGain(); g.gain.value = 0;
  o.connect(g); g.connect(pan);
  const pulses = 6 + (Math.random() * 8 | 0);
  for (let i = 0; i < pulses; i++) {
    const ts = t0 + i * 0.055;
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.06, ts + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.045);
  }
  o.start(t0); o.stop(t0 + pulses * 0.055 + 0.1);
}
function updateAmbience(dt, dayF, underwater) {
  if (!actx || !ambienceOn) return;
  if (masterFilter) {
    const wantF = underwater ? 620 : 20000;
    masterFilter.frequency.value += (wantF - masterFilter.frequency.value) * Math.min(1, dt * 7);
  }
  if (player.mode === null) return;
  const wantWind = underwater ? 0.02 : 0.05 + dayF * 0.035;
  windGain.gain.value += (wantWind - windGain.gain.value) * Math.min(1, dt);
  if (underwater) return;
  birdT -= dt;
  if (birdT <= 0) { birdT = 3 + Math.random() * 9; if (dayF > 0.5) sndBird(); }
  cricketT -= dt;
  if (cricketT <= 0) { cricketT = 1.5 + Math.random() * 5; if (dayF < 0.18) sndCricket(); }
}

// ----------------------------------------------------------------------------
// Player
// ----------------------------------------------------------------------------
const player = {
  vel: new THREE.Vector3(),
  onGround: false,
  flying: false,
  inWater: false,
  sel: 0,
  mode: null, // 'vr' | 'desktop' | null (attract)
};
const HALF_W = 0.32, EPS = 0.001;
const headWorld = new THREE.Vector3();
const lastHeadOff = new THREE.Vector2();

function getHeadWorld() { camera.getWorldPosition(headWorld); return headWorld; }
function bodyHeight() {
  if (player.mode === 'vr') {
    const h = getHeadWorld().y - rig.position.y;
    return THREE.MathUtils.clamp(h + 0.12, 1.0, 2.25);
  }
  return 1.8;
}
function headOffXZ(out) {
  if (player.mode === 'vr') {
    const h = getHeadWorld();
    out.set(h.x - rig.position.x, h.z - rig.position.z);
  } else out.set(0, 0);
  return out;
}
function isSolidAt(x, y, z) { return isSolidBlock(getBlock(x, y, z)); }

function collideAxis(axis, delta, off, hgt) {
  if (delta === 0) return false;
  const p = rig.position;
  p[axis] += delta;
  const cx = p.x + off.x, cz = p.z + off.y;
  const minX = cx - HALF_W, maxX = cx + HALF_W;
  const minZ = cz - HALF_W, maxZ = cz + HALF_W;
  const minY = p.y + 0.001, maxY = p.y + hgt;
  let hit = false;
  for (let by = Math.floor(minY); by <= Math.floor(maxY - 0.001); by++)
    for (let bx = Math.floor(minX); bx <= Math.floor(maxX); bx++)
      for (let bz = Math.floor(minZ); bz <= Math.floor(maxZ); bz++) {
        if (!isSolidAt(bx, by, bz)) continue;
        hit = true;
        if (axis === 'x') {
          const bound = delta > 0 ? bx - HALF_W - off.x - EPS : bx + 1 + HALF_W - off.x + EPS;
          p.x = delta > 0 ? Math.min(p.x, bound) : Math.max(p.x, bound);
        } else if (axis === 'z') {
          const bound = delta > 0 ? bz - HALF_W - off.y - EPS : bz + 1 + HALF_W - off.y + EPS;
          p.z = delta > 0 ? Math.min(p.z, bound) : Math.max(p.z, bound);
        } else {
          if (delta > 0) p.y = Math.min(p.y, by - hgt - EPS);
          else p.y = Math.max(p.y, by + 1 + EPS);
        }
      }
  return hit;
}

function rotateRig(theta) {
  const head = getHeadWorld().clone();
  rig.rotation.y += theta;
  const px = rig.position.x - head.x, pz = rig.position.z - head.z;
  const c = Math.cos(theta), s = Math.sin(theta);
  rig.position.x = head.x + px * c + pz * s;
  rig.position.z = head.z + (-px * s + pz * c);
}

let stepTimer = 0;
function updatePlayer(dt, input) {
  const off = headOffXZ(new THREE.Vector2());
  const hgt = bodyHeight();

  lastHeadOff.copy(off);

  // where is the body?
  const head = getHeadWorld();
  const feetBlock = getBlock(Math.floor(head.x), Math.floor(rig.position.y + 0.4), Math.floor(head.z));
  const headBlock = getBlock(Math.floor(head.x), Math.floor(head.y), Math.floor(head.z));
  player.inWater = feetBlock === B.WATER || headBlock === B.WATER;

  // don't fall into unloaded terrain
  if (!hasChunkAt(head.x, head.z)) return;

  // desired horizontal velocity (head-yaw relative)
  const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  fw.y = 0; fw.normalize();
  const right = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0));
  const speed = player.flying ? 9 : player.inWater ? 2.4 : 4.4;
  const wish = new THREE.Vector3()
    .addScaledVector(fw, input.moveY)
    .addScaledVector(right, input.moveX);
  if (wish.lengthSq() > 1) wish.normalize();
  wish.multiplyScalar(speed);
  const accel = player.onGround || player.flying ? 12 : 5;
  player.vel.x += (wish.x - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (wish.z - player.vel.z) * Math.min(1, accel * dt);

  // vertical
  if (player.flying) {
    const vy = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    player.vel.y += (vy * 7 - player.vel.y) * Math.min(1, 10 * dt);
  } else if (player.inWater) {
    player.vel.y -= 5 * dt;
    if (player.vel.y < -2.2) player.vel.y = -2.2;
    if (input.up) player.vel.y += 14 * dt;
    if (player.vel.y > 2.6) player.vel.y = 2.6;
  } else {
    player.vel.y -= 23 * dt;
    if (player.vel.y < -40) player.vel.y = -40;
    if (input.jump && player.onGround) { player.vel.y = 7.6; player.onGround = false; }
  }

  // integrate with collision
  const wasGround = player.onGround;
  player.onGround = false;
  if (collideAxis('x', player.vel.x * dt, off, hgt)) player.vel.x = 0;
  if (collideAxis('z', player.vel.z * dt, off, hgt)) player.vel.z = 0;
  if (collideAxis('y', player.vel.y * dt, off, hgt)) {
    if (player.vel.y < 0) { player.onGround = true; if (!wasGround && player.vel.y < -9) noiseBurst({ freq: 150, q: 1, dur: 0.1, vol: 0.7 }); }
    player.vel.y = 0;
  }

  // footsteps
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  if (player.onGround && hSpeed > 1.5) {
    stepTimer -= dt * hSpeed;
    if (stepTimer <= 0) { stepTimer = 2.4; sndStep(getBlock(Math.floor(head.x), Math.floor(rig.position.y - 0.5), Math.floor(head.z))); }
  }

  // safety: fell out of the world
  if (rig.position.y < -20) {
    const s = findSpawn();
    rig.position.set(s.x, s.y, s.z);
    player.vel.set(0, 0, 0);
  }
}

function playerIntersects(bx, by, bz) {
  const off = headOffXZ(new THREE.Vector2());
  const hgt = bodyHeight();
  const cx = rig.position.x + off.x, cz = rig.position.z + off.y;
  return bx + 1 > cx - HALF_W && bx < cx + HALF_W &&
    bz + 1 > cz - HALF_W && bz < cz + HALF_W &&
    by + 1 > rig.position.y && by < rig.position.y + hgt;
}

function findSpawn() {
  for (let r = 0; r < 64; r++) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(8 + Math.cos(a) * r * 4), z = Math.round(8 + Math.sin(a) * r * 4);
      const h = heightAt(x, z);
      if (h > WATER_LEVEL + 1 && h < 36) return new THREE.Vector3(x + 0.5, h + 1.02, z + 0.5);
    }
  }
  return new THREE.Vector3(8, 40, 8);
}

// ----------------------------------------------------------------------------
// Interaction: highlight, mining, placing (shared by hands & mouse)
// ----------------------------------------------------------------------------
const REACH = 5.2;
let crackTexs = [];
function makeCrackTextures() {
  for (let stage = 0; stage < 3; stage++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(10,10,10,0.9)';
    g.lineWidth = 2;
    let st = 777 + stage * 131;
    const r = () => { st = (st * 1103515245 + 12345) & 0x7fffffff; return st / 0x7fffffff; };
    const n = 4 + stage * 4;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      let x = 32 + (r() - 0.5) * 16, y = 32 + (r() - 0.5) * 16;
      g.moveTo(x, y);
      const segs = 2 + (stage);
      for (let s2 = 0; s2 < segs; s2++) {
        x += (r() - 0.5) * 38; y += (r() - 0.5) * 38;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    crackTexs.push(tex);
  }
}

// block-break debris (single InstancedMesh pool)
const MAXP = 240;
let pMesh = null;
const pPool = [];
const tileColorCache = new Map();
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3(), _pv = new THREE.Vector3(), _pc = new THREE.Color();
function tileAvgColor(t) {
  let c = tileColorCache.get(t);
  if (c) return c;
  const g = atlasCanvas.getContext('2d');
  const cx0 = (t % ATLAS_N) * CELL + 8, cy0 = Math.floor(t / ATLAS_N) * CELL + 8;
  const img = g.getImageData(cx0, cy0, TILE, TILE).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < img.length; i += 4) {
    if (img[i + 3] < 64) continue;
    r += img[i]; gg += img[i + 1]; b += img[i + 2]; n++;
  }
  c = n ? { r: r / n / 255, g: gg / n / 255, b: b / n / 255 } : { r: 0.5, g: 0.5, b: 0.5 };
  tileColorCache.set(t, c);
  return c;
}
function initParticles() {
  pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAXP);
  pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pMesh.count = 0;
  pMesh.frustumCulled = false;
  scene.add(pMesh);
}
function spawnBreakFX(x, y, z, id) {
  const d = BLOCKS[id];
  if (!d || !pMesh) return;
  const col = tileAvgColor(d.side);
  for (let i = 0; i < 14; i++) {
    if (pPool.length >= MAXP) pPool.shift();
    const m = 0.8 + Math.random() * 0.4;
    pPool.push({
      x: x + 0.15 + Math.random() * 0.7, y: y + 0.15 + Math.random() * 0.7, z: z + 0.15 + Math.random() * 0.7,
      vx: (Math.random() - 0.5) * 3.6, vy: 1.6 + Math.random() * 3.2, vz: (Math.random() - 0.5) * 3.6,
      life: 0.55 + Math.random() * 0.35, age: 0, s: 0.06 + Math.random() * 0.07,
      r: col.r * m, g: col.g * m, b: col.b * m,
    });
  }
}
function updateParticles(dt) {
  if (!pMesh) return;
  for (let i = pPool.length - 1; i >= 0; i--) {
    const p = pPool[i];
    p.age += dt;
    if (p.age >= p.life) { pPool.splice(i, 1); continue; }
    p.vy -= 16 * dt;
    let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
    if (isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
      if (p.vy < 0) { p.vy *= -0.25; p.vx *= 0.6; p.vz *= 0.6; ny = p.y; }
      else { p.vx = p.vz = 0; nx = p.x; nz = p.z; }
    }
    p.x = nx; p.y = ny; p.z = nz;
  }
  let n = 0;
  for (const p of pPool) {
    const k = 1 - p.age / p.life;
    _ps.setScalar(p.s * (0.5 + k * 0.5));
    _pm.compose(_pv.set(p.x, p.y, p.z), _pq, _ps);
    pMesh.setMatrixAt(n, _pm);
    pMesh.setColorAt(n, _pc.setRGB(p.r, p.g, p.b));
    n++;
  }
  pMesh.count = n;
  pMesh.instanceMatrix.needsUpdate = true;
  if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
}

class Interactor {
  constructor() {
    this.target = null;
    this.mine = { key: null, prog: 0, tickT: 0 };
    this.lastPlaceKey = null;
    this.placeCooldown = 0;
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.9 }));
    this.highlight.visible = false;
    scene.add(this.highlight);
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: crackTexs[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crack.visible = false;
    scene.add(this.crack);
  }
  update(dt, origin, dir, mining, placing, haptic) {
    this.placeCooldown -= dt;
    const hit = raycastVoxel(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, REACH);
    this.target = hit;
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else this.highlight.visible = false;

    // mining
    if (mining && hit) {
      const d = BLOCKS[hit.block];
      const key = hit.x + ',' + hit.y + ',' + hit.z;
      if (this.mine.key !== key) { this.mine.key = key; this.mine.prog = 0; }
      if (d.hard !== Infinity) {
        this.mine.prog += dt / d.hard;
        this.mine.tickT -= dt;
        if (this.mine.tickT <= 0) {
          this.mine.tickT = 0.09;
          sndMineTick(new THREE.Vector3(hit.x, hit.y, hit.z));
          if (haptic) haptic(0.25, 25);
        }
        if (this.mine.prog >= 1) {
          setBlock(hit.x, hit.y, hit.z, B.AIR);
          spawnBreakFX(hit.x, hit.y, hit.z, hit.block);
          sndBreak(new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), hit.block);
          if (haptic) haptic(0.85, 70);
          this.mine.key = null; this.mine.prog = 0;
        }
      }
    } else { this.mine.key = null; this.mine.prog = 0; }

    // crack overlay
    if (this.mine.key && this.mine.prog > 0.03) {
      this.crack.visible = true;
      this.crack.position.copy(this.highlight.position);
      const stage = Math.min(2, Math.floor(this.mine.prog * 3));
      if (this.crack.material.map !== crackTexs[stage]) { this.crack.material.map = crackTexs[stage]; this.crack.material.needsUpdate = true; }
    } else this.crack.visible = false;

    // placing
    if (placing && hit) {
      const tDef = BLOCKS[hit.block];
      let px2 = hit.x, py2 = hit.y, pz2 = hit.z;
      if (!tDef.replaceable) { px2 += hit.face[0]; py2 += hit.face[1]; pz2 += hit.face[2]; }
      const cell = getBlock(px2, py2, pz2);
      const cDef = BLOCKS[cell];
      const key = px2 + ',' + py2 + ',' + pz2;
      const canPlace = (cell === B.AIR || cell === B.WATER || (cDef && cDef.replaceable)) &&
        !playerIntersects(px2, py2, pz2) && py2 >= 0 && py2 < WORLD_H;
      if (canPlace && (key !== this.lastPlaceKey || this.placeCooldown <= 0)) {
        setBlock(px2, py2, pz2, PALETTE[player.sel]);
        sndPlace(new THREE.Vector3(px2 + 0.5, py2 + 0.5, pz2 + 0.5));
        if (haptic) haptic(0.5, 40);
        this.lastPlaceKey = key;
        this.placeCooldown = 0.25;
      }
    } else this.lastPlaceKey = null;
  }
  hide() { this.highlight.visible = false; this.crack.visible = false; this.mine.key = null; this.mine.prog = 0; }
}

// ----------------------------------------------------------------------------
// VR controllers
// ----------------------------------------------------------------------------
const controllers = [];
let selCube, selLabel; // selected-block HUD on right hand

function buildControllerVisual(c) {
  if (c.userData.visual) return;
  const g = new THREE.Group();
  // stylized hand block
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.09),
    new THREE.MeshLambertMaterial({ color: 0x394a5f }));
  hand.position.z = 0.02;
  g.add(hand);
  // pointer beam
  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.5 }));
  g.add(beam);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  g.add(dot);
  c.add(g);
  c.userData.visual = { group: g, beam, dot };
}

function initControllers() {
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.userData.prev = [];
    c.addEventListener('connected', e => {
      c.userData.inputSource = e.data;
      buildControllerVisual(c);
      if (e.data.handedness === 'right') attachSelHud(c);
    });
    c.addEventListener('disconnected', () => { c.userData.inputSource = null; });
    rig.add(c);
    c.userData.interactor = null; // created lazily (needs textures)
    controllers.push(c);
  }
}

function attachSelHud(c) {
  if (!selCube) {
    selCube = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.055), buildSelMaterials(PALETTE[player.sel]));
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    selLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    selLabel.scale.set(0.24, 0.045, 1);
    drawSelLabel(BLOCKS[PALETTE[player.sel]].name);
  }
  selCube.position.set(0, 0.11, -0.03);
  selLabel.position.set(0, 0.165, -0.03);
  c.add(selCube); c.add(selLabel);
}
function buildSelMaterials(id) {
  const d = BLOCKS[id];
  const mk = t => {
    const [u0, v0, u1, v1] = tileUV(t);
    const tex = atlasTex.clone();
    tex.needsUpdate = true;
    tex.offset.set(u0, v0); tex.repeat.set(u1 - u0, v1 - v0);
    return new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.1 }); // HUD cube: always visible, even at night
  };
  const side = mk(d.side), top = mk(d.top), bot = mk(d.bottom);
  return [side, side.clone(), top, bot, side.clone(), side.clone()];
}
function drawSelLabel(text) {
  if (!selLabel) return;
  const cv = selLabel.material.map.image;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = 'rgba(8,12,20,0.65)';
  g.beginPath(); g.roundRect(8, 8, cv.width - 16, cv.height - 16, 20); g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 46px Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cv.width / 2, cv.height / 2 + 2);
  selLabel.material.map.needsUpdate = true;
}
function setSelected(i, silent) {
  player.sel = ((i % PALETTE.length) + PALETTE.length) % PALETTE.length;
  const id = PALETTE[player.sel];
  if (selCube) {
    for (const m of selCube.material) { if (m.map) m.map.dispose(); m.dispose(); }
    selCube.material = buildSelMaterials(id);
    drawSelLabel(BLOCKS[id].name);
  }
  updateDesktopHud();
  if (!silent) noiseBurst({ freq: 900, q: 6, dur: 0.03, vol: 0.1 });
  saveDirty = true;
}
function flashLabel(text) {
  drawSelLabel(text);
  setTimeout(() => drawSelLabel(BLOCKS[PALETTE[player.sel]].name), 1200);
}

const snapState = { latched: false };
function pollVRInput(dt, input) {
  for (const c of controllers) {
    const src = c.userData.inputSource;
    if (!src || !src.gamepad) continue;
    const gp = src.gamepad, hand = src.handedness;
    const prev = c.userData.prev;
    const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const edge = i => pressed(i) && !prev[i];
    const ax = gp.axes.length >= 4 ? gp.axes[2] : 0;
    const ay = gp.axes.length >= 4 ? gp.axes[3] : 0;

    if (hand === 'left') {
      if (Math.abs(ax) > 0.12) input.moveX += ax;
      if (Math.abs(ay) > 0.12) input.moveY += -ay;
      if (edge(5)) setSelected(player.sel - 1);          // Y
      if (edge(4)) {                                      // X
        player.flying = !player.flying;
        player.vel.y = 0;
        flashLabel(player.flying ? 'Fly: ON' : 'Fly: OFF');
      }
    } else if (hand === 'right') {
      // turn
      if (OPTS.smoothTurn) {
        if (Math.abs(ax) > 0.25) rotateRig(-ax * 2.1 * dt);
      } else {
        if (Math.abs(ax) > 0.6 && !snapState.latched) { rotateRig(ax > 0 ? -Math.PI / 4 : Math.PI / 4); snapState.latched = true; }
        if (Math.abs(ax) < 0.3) snapState.latched = false;
      }
      if (edge(4)) input.jump = true;                    // A
      input.up = input.up || pressed(4);
      if (player.flying && ay > 0.55) input.down = true; // stick down = descend
      if (edge(5)) setSelected(player.sel + 1);          // B
    }

    // interact (both hands)
    if (!c.userData.interactor) c.userData.interactor = new Interactor();
    const origin = new THREE.Vector3(), quat = new THREE.Quaternion();
    c.getWorldPosition(origin);
    c.getWorldQuaternion(quat);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const haptic = (inten, ms) => { try { gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse(inten, ms); } catch (e) {} };
    c.userData.interactor.update(dt, origin, dir, pressed(0), pressed(1), haptic);
    // beam length
    const vis = c.userData.visual;
    if (vis) {
      const hd = c.userData.interactor.target ? c.userData.interactor.target.dist : REACH * 0.75;
      vis.beam.scale.z = hd;
      vis.dot.position.set(0, 0, -hd);
      vis.dot.visible = !!c.userData.interactor.target;
    }
    for (let i = 0; i < gp.buttons.length; i++) prev[i] = pressed(i);
  }
}

// ----------------------------------------------------------------------------
// Desktop input
// ----------------------------------------------------------------------------
const keys = new Set();
let mouseDownL = false, mouseDownR = false, pitch = 0;
let desktopInteractor = null;

function initDesktopInput() {
  const cvs = renderer.domElement;
  document.addEventListener('keydown', e => {
    if (player.mode !== 'desktop') return;
    keys.add(e.code);
    if (e.code === 'KeyF') { player.flying = !player.flying; player.vel.y = 0; toast(player.flying ? 'Fly: ON' : 'Fly: OFF'); }
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5));
      if (n >= 1 && n <= PALETTE.length) setSelected(n - 1);
    }
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  cvs.addEventListener('mousedown', e => {
    if (player.mode !== 'desktop') return;
    if (document.pointerLockElement !== cvs) { cvs.requestPointerLock(); return; }
    if (e.button === 0) mouseDownL = true;
    if (e.button === 2) mouseDownR = true;
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) mouseDownL = false;
    if (e.button === 2) mouseDownR = false;
  });
  document.addEventListener('contextmenu', e => { if (player.mode === 'desktop') e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (player.mode !== 'desktop' || document.pointerLockElement !== cvs) return;
    rig.rotation.y -= e.movementX * 0.0021;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0021, -1.55, 1.55);
    camera.rotation.x = pitch;
  });
  document.addEventListener('wheel', e => {
    if (player.mode !== 'desktop') return;
    setSelected(player.sel + (e.deltaY > 0 ? 1 : -1));
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== cvs) { mouseDownL = mouseDownR = false; }
  });
}

function pollDesktopInput(dt, input) {
  if (keys.has('KeyW')) input.moveY += 1;
  if (keys.has('KeyS')) input.moveY -= 1;
  if (keys.has('KeyA')) input.moveX -= 1;
  if (keys.has('KeyD')) input.moveX += 1;
  if (keys.has('Space')) { input.jump = true; input.up = true; }
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) input.down = true;

  if (!desktopInteractor) desktopInteractor = new Interactor();
  const origin = getHeadWorld().clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  desktopInteractor.update(dt, origin, dir, mouseDownL, mouseDownR, null);
}

// jump key should be an edge for jumping (not for swimming/fly)
let spaceWasDown = false;

// ----------------------------------------------------------------------------
// Sheep
// ----------------------------------------------------------------------------
const sheepList = [];
function makeSheepMesh() {
  const g = new THREE.Group();
  const wool = new THREE.MeshLambertMaterial({ color: 0xeeeeea });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc9a58c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.95), wool);
  body.position.y = 0.62;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.32), skin);
  head.position.set(0, 0.82, -0.55);
  g.add(head);
  const woolHat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.3), wool);
  woolHat.position.set(0, 0.95, -0.52);
  g.add(woolHat);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x222222 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), eyeM);
    eye.position.set(sx * 0.09, 0.85, -0.715);
    g.add(eye);
  }
  const legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), skin);
    leg.position.set(sx * 0.2, 0.21, sz * 0.32);
    g.add(leg); legs.push(leg);
  }
  g.userData.legs = legs;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
function groundYAt(x, z, nearY) {
  if (!hasChunkAt(x, z)) return null;
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let y = Math.min(WORLD_H - 1, Math.floor(nearY) + 3); y >= Math.max(0, Math.floor(nearY) - 5); y--) {
    if (isSolidAt(bx, y, bz) && !isSolidAt(bx, y + 1, bz) && !isSolidAt(bx, y + 2, bz)) return y + 1;
  }
  return null;
}
class Sheep {
  constructor(x, y, z) {
    this.mesh = makeSheepMesh();
    this.mesh.position.set(x, y, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.targetYaw = this.yaw;
    this.state = 'idle';
    this.timer = 1 + Math.random() * 3;
    this.bleatT = 6 + Math.random() * 16;
    this.walkPhase = 0;
    scene.add(this.mesh);
  }
  update(dt, headPos) {
    const p = this.mesh.position;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'idle') { this.state = 'walk'; this.targetYaw = Math.random() * Math.PI * 2; this.timer = 2 + Math.random() * 4; }
      else { this.state = 'idle'; this.timer = 1.5 + Math.random() * 3.5; }
    }
    this.bleatT -= dt;
    if (this.bleatT <= 0) {
      this.bleatT = 8 + Math.random() * 18;
      if (p.distanceTo(headPos) < 26) sndBleat(p);
    }
    let da = this.targetYaw - this.yaw;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.yaw += da * Math.min(1, dt * 3);
    if (this.state === 'walk') {
      const sp = 1.1;
      const nx = p.x - Math.sin(this.yaw) * sp * dt, nz = p.z - Math.cos(this.yaw) * sp * dt;
      const gy = groundYAt(nx, nz, p.y);
      if (gy === null || Math.abs(gy - p.y) > 1.2 || getBlock(Math.floor(nx), Math.floor(gy), Math.floor(nz)) === B.WATER) {
        this.targetYaw = this.yaw + Math.PI * (0.6 + Math.random() * 0.8);
      } else {
        p.x = nx; p.z = nz;
        p.y += (gy - p.y) * Math.min(1, dt * 8);
      }
      this.walkPhase += dt * 7;
      const legs = this.mesh.userData.legs;
      for (let i = 0; i < 4; i++) legs[i].rotation.x = Math.sin(this.walkPhase + (i % 2) * Math.PI) * 0.5;
    } else {
      const legs = this.mesh.userData.legs;
      for (let i = 0; i < 4; i++) legs[i].rotation.x *= 0.9;
    }
    this.mesh.rotation.y = this.yaw;
    // keep the herd near the player (quiet respawn far away)
    if (p.distanceTo(headPos) > 95) {
      const spot = randomGrassNear(headPos, 24, 45);
      if (spot) p.copy(spot);
    }
  }
}
function randomGrassNear(pos, rMin, rMax) {
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
    const x = Math.floor(pos.x + Math.cos(a) * r), z = Math.floor(pos.z + Math.sin(a) * r);
    const h = heightAt(x, z);
    if (h > WATER_LEVEL + 1 && h < 40 && surfaceBlockFor(h) === B.GRASS) return new THREE.Vector3(x + 0.5, h + 1, z + 0.5);
  }
  return null;
}
function spawnSheep(center) {
  for (let i = 0; i < 8; i++) {
    const s = randomGrassNear(center, 8, 34);
    if (s) sheepList.push(new Sheep(s.x, s.y, s.z));
  }
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------
function loadSeed() {
  try {
    let s = localStorage.getItem('bfvr_seed');
    if (!s) { s = String((Math.random() * 1e9) | 0); localStorage.setItem('bfvr_seed', s); }
    SEED = parseInt(s) | 0;
  } catch (e) { SEED = 1337; }
}
function loadWorld() {
  try {
    const raw = localStorage.getItem('bfvr_world_' + SEED);
    if (!raw) return null;
    const j = JSON.parse(raw);
    for (const k in j.edits || {}) {
      const em = new Map();
      for (const i in j.edits[k]) {
        const v = j.edits[k][i] | 0;
        em.set(i | 0, v);
        if (v === B.GLOW) {
          const [cx, cz] = k.split(',').map(Number);
          const ii = i | 0;
          const y = Math.floor(ii / (CHUNK * CHUNK));
          const rem = ii - y * CHUNK * CHUNK;
          const z = Math.floor(rem / CHUNK), x = rem - z * CHUNK;
          glowSet.add((cx * CHUNK + x) + ',' + y + ',' + (cz * CHUNK + z));
        }
      }
      edits.set(k, em);
    }
    return j;
  } catch (e) { return null; }
}
function saveWorld() {
  try {
    const ed = {};
    for (const [k, em] of edits) {
      if (em.size === 0) continue;
      const o = {};
      for (const [i, v] of em) o[i] = v;
      ed[k] = o;
    }
    localStorage.setItem('bfvr_world_' + SEED, JSON.stringify({
      edits: ed,
      player: { x: rig.position.x, y: rig.position.y, z: rig.position.z, yaw: rig.rotation.y, fly: player.flying, sel: player.sel },
      timeOfDay,
    }));
    saveDirty = false;
  } catch (e) { /* storage full/blocked */ }
}

// ----------------------------------------------------------------------------
// Chunk streaming
// ----------------------------------------------------------------------------
let RENDER_R = 5;
const meshQueue = [];
function streamChunks(headPos) {
  const pcx = Math.floor(headPos.x / CHUNK), pcz = Math.floor(headPos.z / CHUNK);
  // data one ring wider than meshes (meshing reads neighbors)
  for (let dz = -RENDER_R - 1; dz <= RENDER_R + 1; dz++) for (let dx = -RENDER_R - 1; dx <= RENDER_R + 1; dx++) {
    if (dx * dx + dz * dz > (RENDER_R + 1.5) * (RENDER_R + 1.5)) continue;
    ensureChunkData(pcx + dx, pcz + dz);
  }
  const want = [];
  for (let dz = -RENDER_R; dz <= RENDER_R; dz++) for (let dx = -RENDER_R; dx <= RENDER_R; dx++) {
    if (dx * dx + dz * dz > RENDER_R * RENDER_R + 2) continue;
    const c = chunks.get(ckey(pcx + dx, pcz + dz));
    if (c && !c.built && !meshQueue.includes(c)) want.push([dx * dx + dz * dz, c]);
  }
  want.sort((a, b) => a[0] - b[0]);
  for (const [, c] of want) meshQueue.push(c);
  // unload far meshes
  for (const [k, c] of chunks) {
    if (!c.meshes) continue;
    const dx = c.cx - pcx, dz = c.cz - pcz;
    if (dx * dx + dz * dz > (RENDER_R + 3) * (RENDER_R + 3)) {
      for (const m of c.meshes) { worldGroup.remove(m); m.geometry.dispose(); }
      c.meshes = null; c.built = false;
    }
  }
}
function processMeshQueues() {
  let n = 0;
  for (const k of remeshQueue) {
    const c = chunks.get(k);
    remeshQueue.delete(k);
    if (c) { remeshChunk(c); n++; }
    if (n >= 3) return;
  }
  while (n < 2 && meshQueue.length) {
    const c = meshQueue.shift();
    if (!c.built) { remeshChunk(c); n++; }
  }
}

// ----------------------------------------------------------------------------
// HUD / UI glue
// ----------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const OPTS = { vignette: true, smoothTurn: false, volume: 1 };

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.style.opacity = 1;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.style.opacity = 0, 1300);
}
function updateDesktopHud() {
  const id = PALETTE[player.sel];
  $('blockName').textContent = BLOCKS[id].name;
  const sw = $('swatch');
  const g = sw.getContext('2d');
  const t = BLOCKS[id].side;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 16, 16);
  g.drawImage(atlasCanvas, (t % ATLAS_N) * CELL + 8, Math.floor(t / ATLAS_N) * CELL + 8, TILE, TILE, 0, 0, 16, 16);
}

function initUI() {
  try {
    OPTS.vignette = localStorage.getItem('bfvr_vignette') !== '0';
    OPTS.smoothTurn = localStorage.getItem('bfvr_smoothturn') === '1';
    OPTS.volume = Math.min(1.5, Math.max(0, parseFloat(localStorage.getItem('bfvr_volume') ?? '1')));
    RENDER_R = parseInt(localStorage.getItem('bfvr_dist') || '5');
  } catch (e) {}
  $('optVignette').checked = OPTS.vignette;
  $('optSmoothTurn').checked = OPTS.smoothTurn;
  $('optDist').value = String(RENDER_R);
  $('optVolume').value = String(Math.round(OPTS.volume * 100));
  $('optVolume').oninput = e => {
    OPTS.volume = parseInt(e.target.value) / 100;
    if (masterGain) masterGain.gain.value = OPTS.volume;
    try { localStorage.setItem('bfvr_volume', String(OPTS.volume)); } catch (_) {}
  };
  $('optVignette').onchange = e => { OPTS.vignette = e.target.checked; try { localStorage.setItem('bfvr_vignette', OPTS.vignette ? '1' : '0'); } catch (_) {} };
  $('optSmoothTurn').onchange = e => { OPTS.smoothTurn = e.target.checked; try { localStorage.setItem('bfvr_smoothturn', OPTS.smoothTurn ? '1' : '0'); } catch (_) {} };
  $('optDist').onchange = e => { RENDER_R = parseInt(e.target.value); try { localStorage.setItem('bfvr_dist', e.target.value); } catch (_) {} };
  $('seedLabel').textContent = 'World seed: ' + SEED;
  $('btnNewWorld').onclick = () => {
    try { localStorage.setItem('bfvr_seed', String((Math.random() * 1e9) | 0)); } catch (e) {}
    location.reload();
  };
  $('btnResetWorld').onclick = () => {
    try { localStorage.removeItem('bfvr_world_' + SEED); } catch (e) {}
    location.reload();
  };

  // desktop
  $('btnDesktop').onclick = () => {
    ensureAudio();
    startMode('desktop');
    $('overlay').classList.add('hidden');
    $('hud').style.display = 'block';
    renderer.domElement.requestPointerLock();
  };
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && player.mode === 'desktop') {
      $('overlay').classList.remove('hidden');
      $('btnDesktop').textContent = 'Resume';
    }
  });

  // VR
  const btnVR = $('btnVR');
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      if (ok) { btnVR.disabled = false; btnVR.textContent = 'Enter VR'; }
      else { btnVR.textContent = 'VR not detected'; $('vrHint').innerHTML = 'No VR runtime found. Make sure the <b>Meta Quest Link</b> app is running, the headset is connected via Link, then reload this page.'; }
    }).catch(() => { btnVR.textContent = 'VR not detected'; });
  } else {
    btnVR.textContent = 'VR not available';
    $('vrHint').innerHTML = 'This browser has no WebXR. Use <b>Google Chrome</b> or <b>Microsoft Edge</b> on this PC with the Meta Quest Link app running.';
  }
  btnVR.onclick = async () => {
    ensureAudio();
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      session.addEventListener('end', () => {
        player.mode = null;
        $('overlay').classList.remove('hidden');
        for (const c of controllers) if (c.userData.interactor) c.userData.interactor.hide();
      });
      await renderer.xr.setSession(session);
      startMode('vr');
      $('overlay').classList.add('hidden');
    } catch (err) {
      btnVR.textContent = 'VR failed — check Link';
      console.error(err);
    }
  };

  updateDesktopHud();
}

let started = false;
function startMode(mode) {
  const wasAttract = player.mode === null && !started;
  player.mode = mode;
  if (mode === 'desktop') {
    camera.position.set(0, 1.7, 0);
    camera.rotation.set(pitch, 0, 0);
  }
  if (!started) {
    started = true;
    spawnSheep(rig.position);
  }
  if (mode === 'desktop') $('hud').style.display = 'block';
  else $('hud').style.display = 'none';
}

// ----------------------------------------------------------------------------
// Boot & main loop
// ----------------------------------------------------------------------------
loadSeed();
makeAtlas();
initScene();
makeMaterials();
makeCrackTextures();
initParticles();
initControllers();
initDesktopInput();

const saved = loadWorld();
{
  const s = findSpawn();
  rig.position.copy(s);
  if (saved && saved.player) {
    rig.position.set(saved.player.x, saved.player.y, saved.player.z);
    rig.rotation.y = saved.player.yaw || 0;
    player.flying = !!saved.player.fly;
    if (typeof saved.timeOfDay === 'number') timeOfDay = saved.timeOfDay;
    player.sel = saved.player.sel | 0;
  }
}
initUI();
setSelected(player.sel, true);

// warm up spawn area
streamChunks(rig.position);

let last = performance.now();
let streamT = 0, glowT = 0, saveT = 0, attractA = 0;
const inputState = { moveX: 0, moveY: 0, jump: false, up: false, down: false };

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const head = getHeadWorld().clone();

  // streaming
  streamT -= dt;
  if (streamT <= 0) { streamT = 0.3; streamChunks(head); }
  processMeshQueues();

  // input + physics
  inputState.moveX = 0; inputState.moveY = 0; inputState.jump = false; inputState.up = false; inputState.down = false;
  if (player.mode === 'vr') {
    pollVRInput(dt, inputState);
    updatePlayer(dt, inputState);
  } else if (player.mode === 'desktop') {
    pollDesktopInput(dt, inputState);
    // jump edge for space
    if (inputState.jump && spaceWasDown && !player.flying && !player.inWater) inputState.jump = false;
    spaceWasDown = keys.has('Space');
    updatePlayer(dt, inputState);
  } else {
    // attract mode: slow orbit over spawn
    attractA += dt * 0.06;
    const s = rig.position;
    camera.position.set(Math.cos(attractA) * 26, 16, Math.sin(attractA) * 26);
    camera.lookAt(new THREE.Vector3(0, -6, 0));
  }

  // vignette comfort (and black out if the head is poked inside a block)
  if (vignette) {
    const hSpeed = Math.hypot(player.vel.x, player.vel.z) + Math.abs(player.vel.y) * 0.5;
    let want = (OPTS.vignette && player.mode === 'vr' && hSpeed > 0.8) ? 0.55 : 0;
    if (player.mode && isSolidAt(Math.floor(head.x), Math.floor(head.y), Math.floor(head.z))) want = 1;
    vignette.material.opacity += (want - vignette.material.opacity) * Math.min(1, dt * 8);
    vignette.scale.setScalar(vignette.material.opacity >= 0.99 ? 3 : 1);
  }

  // world dressing
  updateSky(dt, head);
  glowT -= dt;
  if (glowT <= 0) { glowT = 0.8; updateGlowLights(head); }
  const tsec = now / 1000;
  waterUniforms.uTime.value = tsec;
  for (let i = 0; i < glowLights.length; i++) {
    const pl = glowLights[i];
    if (pl.visible) pl.intensity = 14 * (0.9 + 0.1 * Math.sin(tsec * 9 + i * 2.7) * Math.sin(tsec * 13.7 + i));
  }
  updateParticles(dt);
  for (const s of sheepList) s.update(dt, head);
  updateAudioListener();
  updateAmbience(dt, curDayF, curUnderwater);

  // autosave
  saveT -= dt;
  if (saveT <= 0) { saveT = 5; if (saveDirty && started) saveWorld(); }

  renderer.render(scene, camera);
});
window.addEventListener('pagehide', () => { if (started) saveWorld(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && started) saveWorld(); });

// debug handle
window.__game = {
  chunks, rig, player, camera, setBlock, getBlock, scene, renderer, fx: spawnBreakFX,
  get seed() { return SEED; },
  get time() { return timeOfDay; },
  set time(t) { timeOfDay = t; },
};
