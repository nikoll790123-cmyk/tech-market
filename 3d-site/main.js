import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ================= UI refs & state ================= */
const $ = (id) => document.getElementById(id);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

window.addEventListener('error', (e) => {
  document.body.dataset.jsError = (e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || '');
});
window.addEventListener('unhandledrejection', (e) => {
  document.body.dataset.jsError = 'rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason);
});

const canvas = $('canvas');
const navPills = $('navPills');
const legendEl = $('legend');
const focusPanel = $('focusPanel');
const focusName = $('focusName');
const focusType = $('focusType');
const planetAvatar = $('planetAvatar');
const planetStats = $('planetStats');
const planetDesc = $('planetDesc');
const moonsList = $('moonsList');
const speedSlider = $('speedSlider');
const speedValue = $('speedValue');
const scaleSlider = $('scaleSlider');
const scaleValue = $('scaleValue');
const dateDisplay = $('dateDisplay');
const viewToggle = $('viewToggle');
const hintText = $('hintText');
const loading = $('loading');
const loadPercent = $('loadPercent');

const HINT_DEFAULT = 'Click a planet to explore • Scroll to zoom • Drag to rotate • L: labels • Space: pause';
hintText.textContent = HINT_DEFAULT;
let timeScale = parseFloat(speedSlider.value);
let sizeScale = parseFloat(scaleSlider.value);
let paused = false;
let labelsOn = true;
let focusedIdx = null;
let simDays = 0;
const startEpoch = Date.now();

/* ================= Scene ================= */
const HOME_POS = new THREE.Vector3(0, 46, 105);
const ORIGIN = new THREE.Vector3(0, 0, 0);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020207);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 8000);
camera.position.copy(HOME_POS);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 1.2;          // can fly very close to a planet surface
controls.maxDistance = 420;
controls.zoomSpeed = 0.9;
controls.rotateSpeed = 0.65;
controls.zoomToCursor = true;        // zoom toward the cursor point
controls.autoRotate = !REDUCED;
controls.autoRotateSpeed = 0.22;
controls.maxPolarAngle = Math.PI * 0.97;
controls.minPolarAngle = Math.PI * 0.03;
controls.target.copy(ORIGIN);

// stop the idle auto-rotation as soon as the user touches the scene
const stopAuto = () => { controls.autoRotate = false; };
canvas.addEventListener('pointerdown', stopAuto);
canvas.addEventListener('wheel', stopAuto, { passive: true });

/* Lighting: hot key light from the Sun + cool fill + rim */
const ambient = new THREE.AmbientLight(0x40506e, 0.35);
const sunLight = new THREE.PointLight(0xfff2d8, 3.2, 0, 0);
const fillLight = new THREE.HemisphereLight(0x8899bb, 0x11131c, 0.25);
scene.add(ambient, sunLight, fillLight);

/* ================= Procedural textures =================
   Equirectangular canvases generated with value noise — no external assets. */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// simple hash-based value noise with fractal octaves
function hash(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 13.7) * amp;
    norm += amp; amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

/* Gas / ice giant: latitudinal bands with turbulent distortion.
   Optionally paints a storm spot directly into the texture. */
function giantTexture(colors, seed, spot) {
  const W = 512, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const stops = colors.map(hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  for (let y = 0; y < H; y++) {
    const lat = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      // warp latitude with flowing noise so bands swirl
      const warp = (fbm(u * 6, lat * 14, seed) - 0.5) * 0.09
                 + (fbm(u * 18, lat * 40, seed + 5) - 0.5) * 0.03;
      const t = lat + warp;
      const band = (Math.sin(t * Math.PI * 2 * (stops.length + 2)) + 1) / 2;
      const i0 = Math.min(stops.length - 1, Math.floor(band * stops.length));
      const i1 = Math.min(stops.length - 1, i0 + 1);
      const f = smooth((band * stops.length) - i0);
      const a = stops[i0], b = stops[i1];
      const grain = (fbm(u * 60, lat * 90, seed + 9) - 0.5) * 18;
      const o = (y * W + x) * 4;
      img.data[o]     = a[0] + (b[0] - a[0]) * f + grain;
      img.data[o + 1] = a[1] + (b[1] - a[1]) * f + grain;
      img.data[o + 2] = a[2] + (b[2] - a[2]) * f + grain;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (spot) {
    // Great Red Spot — soft ellipse in the southern hemisphere
    const sx = W * spot.u, sy = H * spot.v;
    const rx = W * 0.055, ry = H * 0.055;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    g.addColorStop(0, spot.color + 'e6');
    g.addColorStop(0.6, spot.color + '99');
    g.addColorStop(1, spot.color + '00');
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, ry / rx);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/* Rocky world: base color + highlands / maria + impact craters */
function rockyTexture(base, hi, lo, seed, craters = 0) {
  const W = 768, H = 384;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const B = rgb(base), Hi = rgb(hi), Lo = rgb(lo);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const n = fbm(u * 8, v * 8, seed);
      const n2 = fbm(u * 24, v * 24, seed + 3);
      const o = (y * W + x) * 4;
      const mixHi = Math.max(0, n - 0.55) * 2.2;
      const mixLo = Math.max(0, 0.45 - n) * 2.2;
      for (let ch = 0; ch < 3; ch++) {
        let val = B[ch] + (Hi[ch] - B[ch]) * mixHi + (Lo[ch] - B[ch]) * mixLo;
        val += (n2 - 0.5) * 26;
        img.data[o + ch] = val;
      }
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (craters > 0) {
    for (let i = 0; i < craters; i++) {
      const cx = hash(i, 1, seed) * W;
      const cy = 30 + hash(i, 2, seed) * (H - 60);
      const r = 2 + hash(i, 3, seed) * 14;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      g.addColorStop(0, 'rgba(0,0,0,0.28)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
      g.addColorStop(0.88, 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/* Earth: oceans, continents shaped by fbm, ice caps */
function earthTexture() {
  const W = 768, H = 384;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = Math.abs(y / H - 0.5) * 2; // 0 equator, 1 pole
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const land = fbm(u * 5, v * 5, 42) + (fbm(u * 13, v * 13, 77) - 0.5) * 0.35;
      const o = (y * W + x) * 4;
      let r, g, b;
      if (lat > 0.86 || (lat > 0.82 && fbm(u * 20, v * 20, 5) > 0.55)) {
        r = 235; g = 240; b = 248;                       // ice caps
      } else if (land > 0.54) {
        const dry = fbm(u * 7, v * 7, 101);
        if (dry > 0.6) { r = 176; g = 150; b = 96; }      // desert
        else if (land > 0.66) { r = 52; g = 106; b = 54; } // forest
        else { r = 96; g = 132; b = 66; }                  // plains
        const grain = (fbm(u * 90, v * 90, 33) - 0.5) * 24;
        r += grain; g += grain; b += grain;
      } else {
        const depth = Math.min(1, (0.54 - land) * 3.2);
        r = 18 - depth * 10; g = 74 - depth * 40; b = 140 - depth * 55;
        const wave = (fbm(u * 110, v * 110, 8) - 0.5) * 10;
        r += wave; g += wave; b += wave;
      }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/* Earth cloud layer (alpha) */
function cloudTexture() {
  const W = 512, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const n = fbm(u * 6, v * 9, 200) * 0.7 + fbm(u * 16, v * 22, 210) * 0.3;
      const a = Math.max(0, n - 0.5) * 3.0;
      const o = (y * W + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255;
      img.data[o + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/* Sun: boiling granulation with dark sunspots */
function sunTexture() {
  const W = 768, H = 384;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const gran = fbm(u * 64, v * 64, 300, 6);
      const spot = fbm(u * 7, v * 7, 310);
      const o = (y * W + x) * 4;
      let r = 255, g = 186 + gran * 60, b = 50 + gran * 90;
      if (spot > 0.72) {
        const s = (spot - 0.72) * 4;
        r -= 140 * s; g -= 110 * s; b -= 40 * s;
      }
      img.data[o] = Math.max(0, r); img.data[o + 1] = Math.min(255, g); img.data[o + 2] = Math.min(255, b); img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/* Saturn's rings: radial stripe pattern with the Cassini division */
function ringTexture() {
  const W = 512, H = 8;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const t = x / W; // 0 = inner, 1 = outer
    let a = 0.75 + (fbm(t * 40, 0.5, 500) - 0.5) * 0.5;
    if (t < 0.06 || t > 0.98) a = 0;              // gaps
    if (t > 0.62 && t < 0.68) a *= 0.12;          // Cassini division
    if (t > 0.3 && t < 0.32) a *= 0.4;            // minor gap
    const shade = 190 + (fbm(t * 90, 1.5, 510) - 0.5) * 70;
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4;
      img.data[o] = shade; img.data[o + 1] = shade * 0.93; img.data[o + 2] = shade * 0.78;
      img.data[o + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ================= Bodies data =================
   Sizes & orbits are logarithmically compressed so the whole system fits. */
const BODIES = [
  {
    key: 'mercury', name: 'Mercury', type: 'Terrestrial Planet',
    color: 0x9c8f82, radius: 0.62, orbit: 13, period: 0.241, spin: 0.05, tilt: 0.01,
    tex: () => rockyTexture('#8d8175', '#b0a596', '#5d554c', 11, 260),
    desc: '<strong>Mercury</strong> — the smallest planet and the closest to the Sun. Its surface is scorched by day (430 °C) and frozen by night (−180 °C) because it has almost no atmosphere to hold heat.',
    stats: [['Diameter', '4,879 km'], ['Mass', '0.055 × Earth'], ['Day', '58.6 Earth days'], ['Year', '88 Earth days'], ['Avg temp', '167 °C'], ['Moons', '0']],
    moons: []
  },
  {
    key: 'venus', name: 'Venus', type: 'Terrestrial Planet',
    color: 0xd9a95e, radius: 0.95, orbit: 17.5, period: 0.615, spin: -0.02, tilt: 0.05,
    tex: () => giantTexture(['#f5deb3', '#e8c88a', '#d9b06a', '#c99b52', '#e8cf9a'], 4),
    desc: '<strong>Venus</strong> — the hottest planet of the system: a runaway greenhouse effect keeps its surface at 464 °C. It also spins backwards, slower than it orbits.',
    stats: [['Diameter', '12,104 km'], ['Mass', '0.815 × Earth'], ['Day', '243 Earth days'], ['Year', '225 Earth days'], ['Avg temp', '464 °C'], ['Moons', '0']],
    moons: []
  },
  {
    key: 'earth', name: 'Earth', type: 'Terrestrial Planet',
    color: 0x3f7fb5, radius: 1.0, orbit: 22.5, period: 1.0, spin: 0.4, tilt: 0.41,
    tex: earthTexture, atmosphere: 0x6ab8ff, clouds: true,
    desc: '<strong>Earth</strong> — our home. The only known world with liquid water oceans on the surface and life. A single natural satellite keeps its axis stable.',
    stats: [['Diameter', '12,756 km'], ['Mass', '5.97 × 10²⁴ kg'], ['Day', '24 hours'], ['Year', '365.25 days'], ['Avg temp', '15 °C'], ['Moons', '1']],
    moons: [{ name: 'Moon', info: '384,400 km · Ø3,474 km' }]
  },
  {
    key: 'mars', name: 'Mars', type: 'Terrestrial Planet',
    color: 0xc1552f, radius: 0.78, orbit: 27.5, period: 1.881, spin: 0.38, tilt: 0.44,
    tex: () => rockyTexture('#b1502c', '#d98a5c', '#6e2f1c', 23, 200),
    atmosphere: 0xd98a5c, atmosphereStrength: 0.35,
    desc: '<strong>Mars</strong> — the red planet. Home to Olympus Mons, the tallest volcano in the solar system, and deep canyons carved by ancient water flows.',
    stats: [['Diameter', '6,792 km'], ['Mass', '0.107 × Earth'], ['Day', '24.6 hours'], ['Year', '687 Earth days'], ['Avg temp', '−63 °C'], ['Moons', '2']],
    moons: [{ name: 'Phobos', info: '9,376 km · Ø22 km' }, { name: 'Deimos', info: '23,463 km · Ø12 km' }]
  },

  {
    key: 'jupiter', name: 'Jupiter', type: 'Gas Giant',
    color: 0xc9a06c, radius: 3.1, orbit: 39, period: 11.86, spin: 0.9, tilt: 0.05,
    tex: () => giantTexture(['#d8b88f', '#a87c52', '#e8d5b5', '#c49a6a', '#8a6242', '#dfc9a4'], 7,
      { u: 0.62, v: 0.63, color: '#c4503a' }),
    desc: '<strong>Jupiter</strong> — the giant of the system, 2.5× more massive than all other planets combined. Its Great Red Spot is a storm wider than Earth that has raged for centuries.',
    stats: [['Diameter', '142,984 km'], ['Mass', '317.8 × Earth'], ['Day', '9.9 hours'], ['Year', '11.9 Earth years'], ['Avg temp', '−110 °C'], ['Moons', '95']],
    moons: [{ name: 'Io', info: 'volcanic moon' }, { name: 'Europa', info: 'ice shell ocean' }, { name: 'Ganymede', info: 'largest moon' }, { name: 'Callisto', info: 'heavily cratered' }]
  },
  {
    key: 'saturn', name: 'Saturn', type: 'Gas Giant',
    color: 0xe0c68f, radius: 2.7, orbit: 51, period: 29.46, spin: 0.85, tilt: 0.47, rings: true,
    tex: () => giantTexture(['#e8d9ae', '#c9b184', '#f0e4c0', '#bfa374', '#d8c89c'], 12),
    desc: '<strong>Saturn</strong> — the jewel of the system. Its iconic rings are made of billions of ice and rock fragments, yet in places they are only ~10 meters thick.',
    stats: [['Diameter', '120,536 km'], ['Mass', '95.2 × Earth'], ['Day', '10.7 hours'], ['Year', '29.4 Earth years'], ['Avg temp', '−140 °C'], ['Moons', '146']],
    moons: [{ name: 'Titan', info: 'dense atmosphere' }, { name: 'Enceladus', info: 'geysers of ice' }, { name: 'Rhea', info: 'icy surface' }]
  },
  {
    key: 'uranus', name: 'Uranus', type: 'Ice Giant',
    color: 0x8fd4d9, radius: 1.8, orbit: 62, period: 84.01, spin: 0.6, tilt: 1.71,
    tex: () => giantTexture(['#a8e4e8', '#8fd8de', '#b8ecee', '#7ecad2'], 19),
    atmosphere: 0x9fe8f0, atmosphereStrength: 0.5,
    desc: '<strong>Uranus</strong> — an ice giant that rotates on its side, likely knocked over by a ancient collision. Its pale blue-green color comes from methane in the atmosphere.',
    stats: [['Diameter', '51,118 km'], ['Mass', '14.5 × Earth'], ['Day', '17.2 hours'], ['Year', '84 Earth years'], ['Avg temp', '−195 °C'], ['Moons', '28']],
    moons: [{ name: 'Titania', info: 'largest moon' }, { name: 'Oberon', info: 'outer moon' }]
  },
  {
    key: 'neptune', name: 'Neptune', type: 'Ice Giant',
    color: 0x3f5fd9, radius: 1.75, orbit: 71, period: 164.8, spin: 0.55, tilt: 0.49,
    tex: () => giantTexture(['#3f66e0', '#2f4fc4', '#5a80f0', '#28409c', '#4a72e8'], 26),
    atmosphere: 0x5a8aff, atmosphereStrength: 0.55,
    desc: '<strong>Neptune</strong> — the windiest planet: gusts reach 2,100 km/h, the fastest in the solar system. Sunlight here is 900× dimmer than on Earth.',
    stats: [['Diameter', '49,528 km'], ['Mass', '17.1 × Earth'], ['Day', '16.1 hours'], ['Year', '164.8 Earth years'], ['Avg temp', '−200 °C'], ['Moons', '16']],
    moons: [{ name: 'Triton', info: 'retrograde orbit' }]
  }
];

const SUN = {
  key: 'sun', name: 'Sun', type: 'G-type Star',
  color: 0xffb13a, radius: 5,
  desc: '<strong>The Sun</strong> — a yellow dwarf star holding 99.86% of the system\'s mass. Its core fuses 600 million tons of hydrogen every second, lighting all the worlds around it.',
  stats: [['Diameter', '1,392,700 km'], ['Mass', '333,000 × Earth'], ['Rotation', '25.4 days'], ['Age', '4.6 billion y'], ['Core temp', '15,000,000 °C'], ['Composition', 'H + He']],
  moons: []
};

/* ================= Scene construction ================= */
const pickables = [];
const planetNodes = [];

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,225,150,0.9)');
  g.addColorStop(0.45, 'rgba(255,160,60,0.32)');
  g.addColorStop(0.75, 'rgba(255,110,30,0.1)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Two star layers: dense faint field + sparse bright stars with glow */
function buildStars() {
  const group = new THREE.Group();
  const makeLayer = (count, size, minR, maxR, bright) => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = minR + Math.random() * (maxR - minR);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      const t = Math.random();
      if (t < 0.6) c.setHSL(0.58, 0.3, 0.55 + Math.random() * 0.4);
      else if (t < 0.85) c.setHSL(0.1, 0.4, 0.6 + Math.random() * 0.35);
      else c.setHSL(0.02, 0.5, 0.6 + Math.random() * 0.3);
      if (bright) c.multiplyScalar(1.3);
      col[i * 3] = Math.min(1, c.r); col[i * 3 + 1] = Math.min(1, c.g); col[i * 3 + 2] = Math.min(1, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true,
      opacity: bright ? 1 : 0.75, depthWrite: false, sizeAttenuation: true
    });
    group.add(new THREE.Points(g, m));
  };
  makeLayer(5000, 1.8, 900, 3600, false);
  makeLayer(500, 3.6, 900, 3200, true);
  scene.add(group);
  return group;
}
const stars = buildStars();

/* --- Sun: textured surface + layered corona sprites --- */
const sunGroup = new THREE.Group();
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN.radius, 64, 48),
  new THREE.MeshBasicMaterial({ map: sunTexture() })
);
sunMesh.userData.pickIndex = -1;
sunGroup.add(sunMesh);

const glowTex = makeGlowTexture();
const coronaLayers = [];
[
  { scale: 3.2, opacity: 0.95, color: 0xffc878 },
  { scale: 5.5, opacity: 0.45, color: 0xff9a40 },
  { scale: 9.0, opacity: 0.18, color: 0xff7020 }
].forEach(cfg => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: cfg.color, transparent: true, opacity: cfg.opacity,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  s.scale.setScalar(SUN.radius * cfg.scale);
  sunGroup.add(s);
  coronaLayers.push({ sprite: s, base: cfg.scale, opacity: cfg.opacity });
});
scene.add(sunGroup);
pickables.push(sunMesh);

/* Fresnel atmosphere shell — rim glow around a planet */
function makeAtmosphere(radius, color, strength) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.4);
        gl_FragColor = vec4(uColor, fresnel * uStrength);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 48, 32), mat);
}

function makeOrbitLine(radius) {
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.22
  }));
}

BODIES.forEach((body, idx) => {
  const group = new THREE.Group(); // orbit pivot
  const mat = new THREE.MeshStandardMaterial({
    map: body.tex(),
    roughness: body.atmosphere ? 0.9 : 0.85,
    metalness: 0.0,
    emissive: new THREE.Color(body.color).multiplyScalar(0.05)
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(body.radius, 64, 48), mat);
  mesh.rotation.z = body.tilt;
  mesh.userData.pickIndex = idx;
  mesh.position.x = body.orbit;

  group.rotation.x = (Math.random() - 0.5) * 0.07;
  group.rotation.z = (Math.random() - 0.5) * 0.07;
  group.add(mesh);

  // Great Red Spot is painted into Jupiter's texture (see BODIES data)

  // Atmosphere rim
  if (body.atmosphere) {
    mesh.add(makeAtmosphere(body.radius, body.atmosphere, body.atmosphereStrength ?? 0.8));
  }

  // Earth cloud layer
  if (body.clouds) {
    const cloudMat = new THREE.MeshStandardMaterial({
      map: cloudTexture(), transparent: true, opacity: 0.85, depthWrite: false, roughness: 1
    });
    const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(body.radius * 1.015, 64, 48), cloudMat);
    mesh.add(cloudMesh);
    body._cloudMesh = cloudMesh;
  }

  // Saturn rings with radial texture
  if (body.rings) {
    const ringGeo = new THREE.RingGeometry(body.radius * 1.35, body.radius * 2.35, 128, 1);
    // radial UVs so the 1D stripe texture maps outward
    const uv = ringGeo.attributes.uv;
    const posAttr = ringGeo.attributes.position;
    const inner = body.radius * 1.35, outer = body.radius * 2.35;
    for (let i = 0; i < uv.count; i++) {
      const x = posAttr.getX(i), y = posAttr.getY(i);
      const d = Math.sqrt(x * x + y * y);
      uv.setXY(i, (d - inner) / (outer - inner), 0.5);
    }
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTexture(), side: THREE.DoubleSide, transparent: true,
      depthWrite: false, opacity: 0.95
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2 - 0.15;
    mesh.add(ring);
  }

  // Earth's Moon
  if (body.key === 'earth') {
    const moonPivot = new THREE.Group();
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 32, 24),
      new THREE.MeshStandardMaterial({ map: rockyTexture('#a8a49c', '#cfcac0', '#6b675f', 66, 180), roughness: 1 })
    );
    moon.position.x = 2.1;
    moonPivot.add(moon);
    mesh.add(moonPivot);
    body._moonPivot = moonPivot;
    body._moonMesh = moon;
  }

  const orbitLine = makeOrbitLine(body.orbit);
  group.add(orbitLine);
  scene.add(group);

  pickables.push(mesh);
  planetNodes.push({ body, group, mesh, orbitLine, angle: Math.random() * Math.PI * 2 });
});

/* --- Asteroid belt (InstancedMesh, two rock shapes) --- */
const ASTEROID_COUNT = 900;
const beltGroup = new THREE.Group();
{
  const geos = [new THREE.DodecahedronGeometry(0.09, 0), new THREE.IcosahedronGeometry(0.08, 0)];
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8078, roughness: 1 });
  geos.forEach((geo, gi) => {
    const im = new THREE.InstancedMesh(geo, mat, ASTEROID_COUNT / 2);
    const dummy = new THREE.Object3D();
    const inner = 31.5, outer = 35.8;
    for (let i = 0; i < ASTEROID_COUNT / 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = inner + Math.random() * (outer - inner);
      dummy.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 1.4, Math.sin(a) * r);
      dummy.scale.setScalar(0.35 + Math.random() * 1.5);
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    beltGroup.add(im);
  });
}
scene.add(beltGroup);

/* ================= HTML labels projected over the 3D scene ================= */
const labelLayer = document.createElement('div');
labelLayer.className = 'label-layer';
labelLayer.setAttribute('aria-hidden', 'true');
document.body.appendChild(labelLayer);

function createLabel(text) {
  const el = document.createElement('div');
  el.className = 'planet-label';
  el.textContent = text;
  labelLayer.appendChild(el);
  return el;
}

const sunLabel = createLabel('Sun');
planetNodes.forEach((n) => { n.label = createLabel(n.body.name); });

const _v = new THREE.Vector3();
function projectLabels() {
  labelLayer.classList.toggle('hidden', !labelsOn);
  if (!labelsOn) return;
  const place = (el, obj, offset) => {
    obj.getWorldPosition(_v);
    _v.y += offset;
    _v.project(camera);
    if (_v.z > 1) { el.style.opacity = '0'; return; }
    const x = (_v.x * 0.5 + 0.5) * innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * innerHeight;
    el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    el.style.opacity = '1';
  };
  place(sunLabel, sunGroup, SUN.radius * 1.4 + 2.4);
  planetNodes.forEach((n) => place(n.label, n.mesh, n.body.radius * sizeScale + 1.6));
}

/* ================= UI: nav pills & legend ================= */
const allBodies = [SUN, ...BODIES];

function setActivePill(key) {
  navPills.querySelectorAll('.nav-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.key === key);
  });
}

allBodies.forEach((body, i) => {
  const btn = document.createElement('button');
  btn.className = 'nav-pill';
  btn.type = 'button';
  btn.dataset.key = body.key;
  btn.textContent = body.name;
  btn.addEventListener('click', () => focusBody(i === 0 ? -1 : i - 1));
  navPills.appendChild(btn);

  const item = document.createElement('div');
  item.className = 'legend-item';
  const dot = document.createElement('span');
  dot.className = 'legend-color';
  dot.style.background = '#' + body.color.toString(16).padStart(6, '0');
  dot.style.color = dot.style.background;
  item.appendChild(dot);
  item.appendChild(document.createTextNode(body.name));
  legendEl.appendChild(item);
});

/* ================= Focus panel & camera ================= */
let camTween = null;
let focusNode = null;
let focusOffset = new THREE.Vector3();
const lastFocusPos = new THREE.Vector3();

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function tweenCamera(toPos, toTarget, duration = 1.1) {
  camTween = {
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: toTarget.clone(),
    t: 0,
    duration: REDUCED ? 0.01 : duration
  };
}

function worldPosOf(node) {
  const p = new THREE.Vector3();
  if (node === 'sun') sunGroup.getWorldPosition(p);
  else node.mesh.getWorldPosition(p);
  return p;
}

function setFocusNode(node) {
  focusNode = node === 'sun' ? 'sun' : node;
  lastFocusPos.copy(worldPosOf(focusNode));
}

function fillPanel(body) {
  focusName.textContent = body.name;
  focusType.textContent = body.type;
  const hex = '#' + body.color.toString(16).padStart(6, '0');
  planetAvatar.style.background =
    `radial-gradient(circle at 32% 30%, #ffffff55 0%, ${hex} 45%, #000 140%)`;
  planetStats.innerHTML = '';
  body.stats.forEach(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    planetStats.appendChild(dt);
    planetStats.appendChild(dd);
  });
  planetDesc.innerHTML = body.desc;
  moonsList.innerHTML = '';
  if (body.moons.length) {
    body.moons.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'moon-item';
      const name = document.createElement('span');
      name.className = 'moon-name';
      name.textContent = m.name;
      const info = document.createElement('span');
      info.className = 'moon-info';
      info.textContent = m.info;
      row.append(name, info);
      moonsList.appendChild(row);
    });
  }
}

function highlightOrbit(idx) {
  planetNodes.forEach((n, i) => {
    n.orbitLine.material.color.set(i === idx ? n.body.color : 0xffffff);
    n.orbitLine.material.opacity = i === idx ? 0.85 : 0.22;
  });
}

function focusBody(idx) {
  focusedIdx = idx;
  const isSun = idx === -1;
  const body = isSun ? SUN : BODIES[idx];
  fillPanel(body);
  focusPanel.classList.add('visible');
  setActivePill(body.key);
  highlightOrbit(idx);

  const node = isSun ? 'sun' : planetNodes[idx];
  const center = worldPosOf(node);
  const dist = (isSun ? SUN.radius : BODIES[idx].radius * sizeScale) * 6 + 4;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() < 0.001) dir.set(0, 0.5, 1).normalize();
  focusOffset.copy(dir).multiplyScalar(dist);
  tweenCamera(center.clone().add(focusOffset), center);
  setFocusNode(node);
  controls.minDistance = (isSun ? SUN.radius : BODIES[idx].radius * sizeScale) * 1.35;
  controls.maxDistance = dist * 14;
  controls.autoRotate = false;
  hintText.textContent = `${body.name} — drag to orbit · scroll to zoom • ✕ or Esc to return`;
}

function unfocus() {
  if (focusedIdx === null && !focusPanel.classList.contains('visible')) return;
  focusedIdx = null;
  focusNode = null;
  focusPanel.classList.remove('visible');
  setActivePill(null);
  highlightOrbit(-2);
  tweenCamera(HOME_POS, ORIGIN, 1.3);
  controls.minDistance = 1.2;
  controls.maxDistance = 420;
  hintText.textContent = HINT_DEFAULT;
}

document.getElementById('closeFocus').addEventListener('click', unfocus);

/* ================= Picking (click / touch / hover) ================= */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let hoveredIdx = null;

function pick(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  if (!hits.length) return null;
  return hits[0].object.userData.pickIndex;
}

function setHover(idx) {
  if (idx === hoveredIdx) return;
  // restore old
  if (hoveredIdx !== null && hoveredIdx !== -1) {
    const m = planetNodes[hoveredIdx].mesh;
    m.material.emissiveIntensity = 1;
    m.scale.setScalar(sizeScale);
  }
  hoveredIdx = idx;
  if (idx !== null && idx !== -1) {
    const m = planetNodes[idx].mesh;
    m.material.emissiveIntensity = 2.2; // subtle glow on hover
    m.scale.setScalar(sizeScale * 1.06);
  }
}

canvas.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return; // drag, not click
  const idx = pick(e.clientX, e.clientY);
  if (idx !== null && idx !== undefined) focusBody(idx);
});
canvas.addEventListener('pointermove', (e) => {
  if (downPos) { canvas.style.cursor = 'grabbing'; return; }
  const idx = pick(e.clientX, e.clientY);
  setHover(idx);
  canvas.style.cursor = idx !== null ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerleave', () => setHover(null));

/* ================= HUD controls ================= */
function updateSpeedLabel() {
  speedValue.textContent = paused ? '⏸ 0.0×' : timeScale.toFixed(1) + '×';
}
/* Fill progress for Material-style slider tracks (CSS var --fill) */
function updateSliderFill(slider) {
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty('--fill', pct.toFixed(2) + '%');
}
speedSlider.addEventListener('input', () => {
  timeScale = parseFloat(speedSlider.value);
  if (timeScale > 0) paused = false;
  updateSpeedLabel();
  updateSliderFill(speedSlider);
});
scaleSlider.addEventListener('input', () => {
  sizeScale = parseFloat(scaleSlider.value);
  scaleValue.textContent = sizeScale.toFixed(1) + '×';
  updateSliderFill(scaleSlider);
  planetNodes.forEach((n) => {
    const boost = (hoveredIdx !== null && hoveredIdx >= 0 && planetNodes[hoveredIdx] === n) ? 1.06 : 1;
    n.mesh.scale.setScalar(sizeScale * boost);
  });
});
scaleValue.textContent = sizeScale.toFixed(1) + '×';
updateSpeedLabel();
updateSliderFill(speedSlider);
updateSliderFill(scaleSlider);

viewToggle.addEventListener('click', () => {
  labelsOn = !labelsOn;
  viewToggle.classList.toggle('active', labelsOn);
});
viewToggle.classList.toggle('active', labelsOn);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    updateSpeedLabel();
  } else if (e.key.toLowerCase() === 'l') {
    labelsOn = !labelsOn;
    viewToggle.classList.toggle('active', labelsOn);
  } else if (e.key === 'Escape') {
    unfocus();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ================= Collapsible chrome =================
   Fold top bar / HUD / bottom bar out of the way while viewing.
   State persists in localStorage; key H folds/unfolds everything. */
const FOLD_BLOCKS = [
  { block: document.querySelector('.top-bar'),   fold: $('topFold'),   handle: $('topHandle') },
  { block: $('hud'),                            fold: $('hudFold'),   handle: $('hudHandle') },
  { block: document.querySelector('.bottom-bar'), fold: $('bottomFold'), handle: $('bottomHandle') },
];
const foldState = { top: false, hud: false, bottom: false };
try { Object.assign(foldState, JSON.parse(localStorage.getItem('solar.folds') || '{}')); } catch (e) {}

function applyFold(entry, key, folded) {
  foldState[key] = folded;
  entry.block.classList.toggle('collapsed', folded);
  entry.fold.classList.toggle('closed', folded);
  entry.fold.setAttribute('aria-label', folded ? 'Show panel' : 'Hide panel');
  entry.handle.classList.toggle('visible', folded);
  try { localStorage.setItem('solar.folds', JSON.stringify(foldState)); } catch (e) {}
}
FOLD_BLOCKS.forEach((entry, i) => {
  const key = ['top', 'hud', 'bottom'][i];
  if (foldState[key]) applyFold(entry, key, true);
  entry.fold.addEventListener('click', () => applyFold(entry, key, !foldState[key]));
  entry.handle.addEventListener('click', () => applyFold(entry, key, false));
});

window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key.toLowerCase() === 'h' && !e.code.startsWith('Digit')) {
    const anyOpen = FOLD_BLOCKS.some((en, i) => !foldState[['top', 'hud', 'bottom'][i]]);
    FOLD_BLOCKS.forEach((en, i) => applyFold(en, ['top', 'hud', 'bottom'][i], anyOpen));
  }
});

/* ================= Animation loop ================= */
const DAYS_PER_SECOND = 10;
const _tmp = new THREE.Vector3();
const clock = new THREE.Clock();
let dateTimer = 1;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const speed = paused ? 0 : timeScale;
  const simDaysPerSec = DAYS_PER_SECOND * speed;

  // orbits, self-rotation, clouds, moon
  planetNodes.forEach((n) => {
    const yearDays = n.body.period * 365.25;
    n.angle += ((Math.PI * 2) / yearDays) * simDaysPerSec * dt;
    n.mesh.position.set(Math.cos(n.angle) * n.body.orbit, 0, Math.sin(n.angle) * n.body.orbit);
    n.mesh.rotation.y += n.body.spin * speed * dt * 3;
    if (n.body._cloudMesh) n.body._cloudMesh.rotation.y += speed * dt * 0.12;
    if (n.body._moonPivot) {
      n.body._moonPivot.rotation.y += speed * dt * 1.5;
      n.body._moonMesh.rotation.y += speed * dt * 0.4;
    }
  });

  beltGroup.rotation.y += speed * dt * 0.018;
  stars.rotation.y += dt * 0.0035;

  // sun: slow rotation + breathing corona
  sunMesh.rotation.y += dt * 0.012;
  const breathe = 1 + Math.sin(performance.now() * 0.0009) * 0.035;
  coronaLayers.forEach((c, i) => {
    c.sprite.scale.setScalar(SUN.radius * c.base * breathe);
    c.sprite.material.opacity = c.opacity * (0.92 + Math.sin(performance.now() * 0.0011 + i * 1.7) * 0.08);
  });

  simDays += simDaysPerSec * dt;

  // camera tween / follow the focused body
  if (focusNode) {
    const wp = worldPosOf(focusNode);
    if (camTween) {
      camTween.toTarget.copy(wp);
      camTween.toPos.copy(wp).add(focusOffset);
    } else {
      _tmp.copy(wp).sub(lastFocusPos);
      controls.target.add(_tmp);
      camera.position.add(_tmp);
    }
    lastFocusPos.copy(wp);
  }
  if (camTween) {
    camTween.t += dt / camTween.duration;
    const k = easeInOut(Math.min(camTween.t, 1));
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    if (camTween.t >= 1) camTween = null;
  }

  controls.update();
  renderer.render(scene, camera);
  projectLabels();

  dateTimer += dt;
  if (dateTimer > 0.1) {
    dateTimer = 0;
    const d = new Date(Date.UTC(2000, 0, 1) + simDays * 86400000);
    dateDisplay.textContent = d.toISOString().slice(0, 10);
  }
}

/* ================= Boot ================= */
let loadPct = 0;
const loadInterval = setInterval(() => {
  loadPct = Math.min(loadPct + 8 + Math.random() * 15, 100);
  loadPercent.textContent = Math.round(loadPct) + '%';
  if (loadPct >= 100) {
    clearInterval(loadInterval);
    setTimeout(() => document.getElementById('loading').classList.add('hidden'), 200);
  }
}, 90);

renderer.setAnimationLoop(animate);

// default: nothing focused
highlightOrbit(-2);
setActivePill(null);












