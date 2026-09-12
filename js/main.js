// ————————————————————————————————————————————————————————————
// NOCTURNE — Abyssal Bloom
// A bioluminescent mini-game. Three.js + custom GLSL + WebAudio.
// Designed & built by Claude (Fable 5).
// ————————————————————————————————————————————————————————————

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ————— constants —————
const WORLD = { minX: -46, maxX: 46, minY: -10.5, maxY: 15, reefY: -13 };
const CLUSTER_COST = 12;
const CLUSTER_XS = [-38, -25.5, -13, 0, 13, 25.5, 38];
const SPORE_POOL = 44;
const SPORE_ACTIVE = 30;
const URCHIN_COUNT = 6;

const COL = {
  cyan: new THREE.Color('#6ff7e3'),
  violet: new THREE.Color('#9d7bff'),
  amber: new THREE.Color('#ffd98c'),
  iceBlue: new THREE.Color('#8cf5ff'),
  red: new THREE.Color('#ff2d55'),
};

// ————— renderer / scene —————
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: true,
    powerPreference: 'high-performance',
  });
} catch (e) {
  document.getElementById('webglFail').classList.remove('hidden');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04101c, 0.02);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 2, 18);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.38
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const clock = new THREE.Clock();
let elapsed = 0;

// ————— shared helpers —————
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [off, col] of stops) g.addColorStop(off, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
const softGlowTex = radialTexture([
  [0, 'rgba(255,255,255,1)'],
  [0.25, 'rgba(255,255,255,0.55)'],
  [1, 'rgba(255,255,255,0)'],
]);
const ringTex = radialTexture([
  [0, 'rgba(255,255,255,0)'],
  [0.72, 'rgba(255,255,255,0)'],
  [0.82, 'rgba(255,255,255,0.9)'],
  [0.9, 'rgba(255,255,255,0.25)'],
  [1, 'rgba(255,255,255,0)'],
]);

// expanding shockwave rings
const rings = [];
function spawnRing(pos, color = 0x9df5e8, maxScale = 22, dur = 1.3) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringTex, color, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sp.position.copy(pos);
  sp.scale.setScalar(0.4);
  scene.add(sp);
  rings.push({ sp, t: 0, maxScale, dur });
}
function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    const k = Math.min(r.t / r.dur, 1);
    const e = 1 - Math.pow(1 - k, 3); // ease-out
    r.sp.scale.setScalar(0.4 + e * r.maxScale);
    r.sp.material.opacity = (1 - k) * 0.85;
    if (k >= 1) {
      scene.remove(r.sp);
      r.sp.material.dispose();
      rings.splice(i, 1);
    }
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

// ————— background dome —————
const domeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform float uTime;
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
      // authored in linear space — OutputPass lifts to sRGB
      vec3 deep = vec3(0.0008, 0.003, 0.009);
      vec3 mid  = vec3(0.003, 0.014, 0.032);
      vec3 top  = vec3(0.012, 0.05, 0.085);
      vec3 col = mix(deep, mid, smoothstep(0.0, 0.55, h));
      col = mix(col, top, smoothstep(0.55, 1.0, h));
      // faint memory of the surface — shifting light far above
      float shimmer = sin(vDir.x * 34.0 + uTime * 0.4) * sin(vDir.x * 21.0 - uTime * 0.27) * 0.5 + 0.5;
      col += vec3(0.004, 0.016, 0.02) * shimmer * smoothstep(0.6, 1.0, h);
      col += vec3(0.012, 0.038, 0.048) * pow(max(vDir.y, 0.0), 3.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 24), domeMat);
scene.add(dome);

// ————— god rays —————
const rayGroup = new THREE.Group();
const rayMats = [];
{
  const rayGeo = new THREE.PlaneGeometry(1, 1);
  rayGeo.translate(0, -0.5, 0); // origin at top edge
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: Math.random() * 10 },
        uIntensity: { value: rand(0.1, 0.2) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uSeed;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float band = pow(sin(vUv.x * 3.14159), 2.2);
          float fade = pow(vUv.y, 1.6);
          float breathe = 0.7 + 0.3 * sin(uTime * 0.35 + uSeed * 7.0);
          vec3 col = vec3(0.45, 0.85, 0.9);
          gl_FragColor = vec4(col, band * fade * uIntensity * breathe);
        }`,
    });
    rayMats.push(mat);
    const ray = new THREE.Mesh(rayGeo, mat);
    ray.position.set(rand(WORLD.minX, WORLD.maxX), 34, rand(-24, -14));
    ray.scale.set(rand(5, 15), rand(55, 85), 1);
    ray.rotation.z = rand(-0.14, 0.14);
    ray.userData = { baseRot: ray.rotation.z, sway: rand(0.15, 0.4), speed: rand(0.1, 0.25) };
    rayGroup.add(ray);
  }
}
scene.add(rayGroup);

// ————— marine snow (GPU particles) —————
{
  const N = 1200;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rand(-70, 70);
    pos[i * 3 + 1] = rand(-20, 30);
    pos[i * 3 + 2] = rand(-22, 14);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec3 p = position;
        float range = 50.0;
        float speed = 0.25 + aSeed * 0.5;
        p.y = 30.0 - mod(30.0 - p.y + uTime * speed, range);
        p.x += sin(uTime * 0.22 + aSeed * 40.0) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.7 + aSeed * 1.3) * (140.0 / -mv.z);
        vA = 0.05 + aSeed * 0.15;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vA;
        gl_FragColor = vec4(0.62, 0.85, 0.9, a);
      }`,
  });
  scene.add(new THREE.Points(geo, mat));
}

// ————— reef floor silhouette —————
{
  const geo = new THREE.PlaneGeometry(160, 34, 70, 12);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.sin(x * 0.24) * 1.1 + Math.sin(x * 0.53 + 2.0) * 0.7 + Math.sin(z * 0.4) * 0.5);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x050c16 });
  const floor = new THREE.Mesh(geo, mat);
  floor.position.y = WORLD.reefY - 1.2;
  scene.add(floor);
}

// ————— coral clusters —————
const coralVert = `
  uniform float uTime;
  uniform float uAwake;
  attribute float aH;
  attribute float aRand;
  varying float vH;
  varying float vRand;
  void main() {
    vH = aH;
    vRand = aRand;
    vec3 p = position;
    float sway = sin(uTime * 1.1 + p.x * 0.7 + aRand * 6.28) * aH * (0.06 + 0.1 * uAwake);
    p.x += sway;
    p.z += sway * 0.6;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const coralFrag = `
  uniform float uTime;
  uniform float uAwake;
  uniform float uHueShift;
  varying float vH;
  varying float vRand;
  void main() {
    vec3 dormant = mix(vec3(0.003, 0.008, 0.016), vec3(0.01, 0.03, 0.05), vH);
    // dying embers at the tips — findable, but clearly asleep
    dormant += vec3(0.012, 0.055, 0.05) * pow(vH, 4.0) * (0.5 + 0.5 * sin(uTime * 1.3 + vRand * 7.0));
    vec3 base = mix(vec3(0.14, 0.85, 0.75), vec3(0.62, 0.38, 0.98), clamp(vH * 1.15 - uHueShift * 0.3, 0.0, 1.0));
    float pulse = 0.75 + 0.25 * sin(uTime * 1.8 + vRand * 9.0 + vH * 4.0);
    vec3 awake = base * (0.3 + 0.75 * vH) * pulse;
    awake += vec3(1.0) * pow(vH, 6.0) * 0.35 * pulse; // hot tips
    vec3 col = mix(dormant, awake, uAwake);
    gl_FragColor = vec4(col, 1.0);
  }`;

class Cluster {
  constructor(x, index) {
    this.index = index;
    this.x = x;
    this.state = 'dormant'; // dormant | charging | blooming | awake
    this.awake = 0;
    this.bloomStart = 0;
    this.center = new THREE.Vector3(x, WORLD.reefY + 1.6, 0);

    const parts = [];
    const branchCount = 34 + Math.floor(Math.random() * 12);
    for (let b = 0; b < branchCount; b++) {
      const h = rand(0.7, 3.8);
      const isFan = Math.random() < 0.12;
      let g;
      if (isFan) {
        g = new THREE.ConeGeometry(rand(0.3, 0.55), h, 8);
        g.scale(1.35, 1, 0.2);
      } else {
        g = new THREE.CylinderGeometry(rand(0.025, 0.07), rand(0.1, 0.2), h, 5, 3);
      }
      g.translate(0, h / 2, 0);
      // per-vertex height 0→1 for gradient + sway falloff
      const pAttr = g.attributes.position;
      const aH = new Float32Array(pAttr.count);
      const aR = new Float32Array(pAttr.count);
      const br = Math.random();
      for (let i = 0; i < pAttr.count; i++) {
        aH[i] = THREE.MathUtils.clamp(pAttr.getY(i) / h, 0, 1);
        aR[i] = br;
      }
      g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
      g.setAttribute('aRand', new THREE.BufferAttribute(aR, 1));
      g.rotateX(rand(-0.22, 0.22));
      g.rotateZ(rand(-0.3, 0.3));
      const r = Math.pow(Math.random(), 0.7) * 3.9;
      const th = Math.random() * Math.PI * 2;
      g.translate(x + Math.cos(th) * r, WORLD.reefY + rand(-0.4, 0.3), Math.sin(th) * r * 0.75 - 0.9);
      // drop normal/uv so merge stays lean & consistent
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      parts.push(g);
    }
    const merged = BufferGeometryUtils.mergeGeometries(parts);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAwake: { value: 0 },
        uHueShift: { value: Math.random() },
      },
      vertexShader: coralVert,
      fragmentShader: coralFrag,
    });
    this.mesh = new THREE.Mesh(merged, this.mat);
    scene.add(this.mesh);

    // heart glow — visible beacon while dormant
    this.heart = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softGlowTex,
      color: 0x1d4456,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.heart.position.copy(this.center);
    this.heart.scale.setScalar(5);
    scene.add(this.heart);
  }

  beginBloom(t) {
    this.state = 'blooming';
    this.bloomStart = t;
  }

  update(t, dt) {
    this.mat.uniforms.uTime.value = t;
    if (this.state === 'blooming') {
      const k = THREE.MathUtils.clamp((t - this.bloomStart) / 2.6, 0, 1);
      this.awake = k * k * (3 - 2 * k); // smoothstep
      if (k >= 1) this.state = 'awake';
      // rising celebration motes while blooming
      if (Math.random() < 0.5) {
        spawnBurst(
          new THREE.Vector3(this.x + rand(-3.4, 3.4), WORLD.reefY + rand(0.5, 3), rand(-1.4, 1.4)),
          Math.random() < 0.5 ? COL.cyan : COL.violet, 2, 1.6, new THREE.Vector3(0, 2.4, 0)
        );
      }
    }
    this.mat.uniforms.uAwake.value = this.awake;
    // heart pulses while dormant, brightens once awake
    if (this.state === 'dormant') {
      this.heart.material.opacity = 0.55 + 0.25 * Math.sin(t * 1.4 + this.index * 2.2);
      this.heart.material.color.setHex(0x2a5f74);
      this.heart.scale.setScalar(6.5 + Math.sin(t * 1.4 + this.index * 2.2));
    } else {
      this.heart.material.opacity = 0.24 + 0.12 * this.awake + 0.06 * Math.sin(t * 2.2 + this.index);
      this.heart.material.color.lerpColors(new THREE.Color(0x2a5f74), new THREE.Color(0x3ef0d0), this.awake);
      this.heart.scale.setScalar(6.5 + this.awake * 1.5);
    }
  }
}
const clusters = CLUSTER_XS.map((x, i) => new Cluster(x, i));

// ————— player —————
const player = {
  pos: new THREE.Vector3(0, 3, 0),
  vel: new THREE.Vector3(),
  target: new THREE.Vector3(0, 3, 0),
  carried: 0,
  invuln: 0,
  group: new THREE.Group(),
};
{
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xeafffa, transparent: true })
  );
  player.core = core;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softGlowTex, color: 0x7df0dd, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.setScalar(2.6);
  halo.material.opacity = 0.7;
  player.halo = halo;
  player.group.add(core, halo);
  scene.add(player.group);
}

// tendrils — flowing ribbon trails
const TENDRIL_NODES = 22;
class Tendril {
  constructor(angle) {
    this.angle = angle;
    this.phase = Math.random() * Math.PI * 2;
    this.freq = rand(2.2, 3.4);
    this.width = 0; // animates in
    this.targetWidth = rand(0.09, 0.16);
    this.nodes = [];
    for (let i = 0; i < TENDRIL_NODES; i++) this.nodes.push(player.pos.clone());

    const N = TENDRIL_NODES;
    const positions = new Float32Array(N * 2 * 3);
    const aT = new Float32Array(N * 2);
    const indices = [];
    for (let i = 0; i < N; i++) {
      aT[i * 2] = aT[i * 2 + 1] = i / (N - 1);
      if (i < N - 1) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geo.setIndex(indices);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, tendrilMat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(dt, t) {
    this.width += (this.targetWidth - this.width) * Math.min(1, dt * 2);
    const anchor = _v1.copy(player.pos);
    anchor.x += Math.cos(this.angle) * 0.3;
    anchor.y += Math.sin(this.angle) * 0.3;
    this.nodes[0].copy(anchor);
    const follow = Math.min(1, dt * 13);
    for (let i = 1; i < TENDRIL_NODES; i++) {
      const n = this.nodes[i];
      n.lerp(this.nodes[i - 1], follow);
      const w = i / TENDRIL_NODES;
      n.y += Math.sin(t * this.freq + this.phase + i * 0.5) * 0.1 * w * dt * 60 * 0.16;
      n.x += Math.cos(t * this.freq * 0.7 + this.phase + i * 0.4) * 0.05 * w * dt * 60 * 0.16;
    }
    // build camera-facing ribbon
    const posAttr = this.geo.attributes.position;
    for (let i = 0; i < TENDRIL_NODES; i++) {
      const prev = this.nodes[Math.max(0, i - 1)];
      const next = this.nodes[Math.min(TENDRIL_NODES - 1, i + 1)];
      _v2.subVectors(next, prev);
      _v3.set(-_v2.y, _v2.x, 0);
      const len = _v3.length();
      if (len > 0.0001) _v3.divideScalar(len);
      else _v3.set(0, 1, 0);
      const w = this.width * (1 - i / (TENDRIL_NODES - 1));
      const n = this.nodes[i];
      posAttr.setXYZ(i * 2, n.x + _v3.x * w, n.y + _v3.y * w, n.z);
      posAttr.setXYZ(i * 2 + 1, n.x - _v3.x * w, n.y - _v3.y * w, n.z);
    }
    posAttr.needsUpdate = true;
  }
  dispose() {
    scene.remove(this.mesh);
    this.geo.dispose();
  }
}
const tendrilMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: {
    uColorA: { value: COL.cyan },
    uColorB: { value: COL.violet },
    uOpacity: { value: 0.85 },
  },
  vertexShader: `
    attribute float aT;
    varying float vT;
    void main() {
      vT = aT;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uOpacity;
    varying float vT;
    void main() {
      vec3 col = mix(uColorA, uColorB, pow(vT, 0.65)) * 1.35;
      float a = (1.0 - vT);
      a *= a;
      gl_FragColor = vec4(col, a * uOpacity);
    }`,
});
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const tendrils = [];
function setTendrilCount(n) {
  while (tendrils.length < n) {
    tendrils.push(new Tendril((tendrils.length / Math.max(n, 1)) * Math.PI * 2 + rand(0, 0.8)));
  }
}
setTendrilCount(3);

// ————— spores (light motes) —————
const spores = [];
const sporeMesh = new THREE.InstancedMesh(
  new THREE.IcosahedronGeometry(0.13, 1),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
  SPORE_POOL
);
sporeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(sporeMesh);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
for (let i = 0; i < SPORE_POOL; i++) {
  const isCyan = Math.random() < 0.3;
  spores.push({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    seed: Math.random() * 100,
    alive: false,
    respawnAt: 0,
    color: isCyan ? COL.iceBlue.clone() : COL.amber.clone(),
  });
  sporeMesh.setColorAt(i, spores[i].color);
}
sporeMesh.instanceColor.needsUpdate = true;

function spawnSpore(s, x, y) {
  s.alive = true;
  s.pos.set(
    x !== undefined ? x : rand(WORLD.minX + 2, WORLD.maxX - 2),
    y !== undefined ? y : rand(WORLD.reefY + 2.5, WORLD.maxY - 2),
    rand(-1.5, 1.5)
  );
  s.vel.set(0, 0, 0);
}
let aliveTarget = SPORE_ACTIVE;
for (let i = 0; i < SPORE_ACTIVE; i++) spawnSpore(spores[i]);

// ————— urchins —————
const urchins = [];
{
  // spiky silhouette: icosahedron body + cones on vertex directions
  const body = new THREE.IcosahedronGeometry(0.5, 1);
  const dirGeo = new THREE.IcosahedronGeometry(1, 0);
  const dirPos = dirGeo.attributes.position;
  const spikeDirs = [];
  const seen = new Set();
  for (let i = 0; i < dirPos.count; i++) {
    const v = new THREE.Vector3(dirPos.getX(i), dirPos.getY(i), dirPos.getZ(i)).normalize();
    const key = v.toArray().map((n) => n.toFixed(2)).join(',');
    if (!seen.has(key)) { seen.add(key); spikeDirs.push(v); }
  }
  const parts = [body];
  const up = new THREE.Vector3(0, 1, 0);
  for (const dir of spikeDirs) {
    const cone = new THREE.ConeGeometry(0.09, 0.62, 5);
    cone.translate(0, 0.31, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    cone.applyQuaternion(q);
    cone.translate(dir.x * 0.42, dir.y * 0.42, dir.z * 0.42);
    parts.push(cone);
  }
  for (const g of parts) { g.deleteAttribute('uv'); }
  const merged = BufferGeometryUtils.mergeGeometries(
    parts.map((g) => (g.index ? g.toNonIndexed() : g))
  );
  merged.computeVertexNormals();
  const urchinMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.4);
        float pulse = 0.7 + 0.3 * sin(uTime * 2.6);
        vec3 col = mix(vec3(0.006, 0.003, 0.012), vec3(0.85, 0.12, 0.28) * pulse, rim);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  for (let i = 0; i < URCHIN_COUNT; i++) {
    const mesh = new THREE.Mesh(merged, urchinMat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softGlowTex, color: 0xff2d55, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(3.4);
    mesh.add(halo);
    const u = {
      mesh, halo,
      pos: new THREE.Vector3(rand(WORLD.minX + 6, WORLD.maxX - 6), rand(-6, 12), rand(-1, 1)),
      vel: new THREE.Vector3(),
      seed: Math.random() * 100,
      spin: new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)),
    };
    // don't spawn on top of the player start
    if (Math.abs(u.pos.x) < 8 && Math.abs(u.pos.y - 3) < 6) u.pos.x += 16;
    urchins.push(u);
    scene.add(mesh);
  }
  urchins.mat = urchinMat;
}

// ————— particle bursts (pool) —————
const BURST_N = 600;
const burst = {
  idx: 0,
  pos: new Float32Array(BURST_N * 3),
  vel: new Float32Array(BURST_N * 3),
  col: new Float32Array(BURST_N * 3),
  life: new Float32Array(BURST_N),
  maxLife: new Float32Array(BURST_N),
  alpha: new Float32Array(BURST_N),
  size: new Float32Array(BURST_N),
};
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(burst.pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(burst.col, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(burst.alpha, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(burst.size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aColor;
      attribute float aAlpha;
      attribute float aSize;
      varying vec3 vC;
      varying float vA;
      void main() {
        vC = aColor;
        vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * aAlpha * (240.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(vC * 1.6, a);
      }`,
  });
  burst.points = new THREE.Points(geo, mat);
  burst.points.frustumCulled = false;
  scene.add(burst.points);
}
function spawnBurst(origin, color, n = 14, speed = 2.6, bias = null) {
  for (let k = 0; k < n; k++) {
    const i = burst.idx = (burst.idx + 1) % BURST_N;
    burst.pos[i * 3] = origin.x;
    burst.pos[i * 3 + 1] = origin.y;
    burst.pos[i * 3 + 2] = origin.z;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(rand(-1, 1));
    const sp = speed * rand(0.35, 1);
    burst.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp + (bias ? bias.x : 0);
    burst.vel[i * 3 + 1] = Math.sin(ph) * Math.sin(th) * sp + (bias ? bias.y : 0);
    burst.vel[i * 3 + 2] = Math.cos(ph) * sp * 0.4 + (bias ? bias.z : 0);
    burst.col[i * 3] = color.r;
    burst.col[i * 3 + 1] = color.g;
    burst.col[i * 3 + 2] = color.b;
    burst.maxLife[i] = burst.life[i] = rand(0.5, 1.1);
    burst.size[i] = rand(4, 9);
  }
}
function updateBursts(dt) {
  for (let i = 0; i < BURST_N; i++) {
    if (burst.life[i] <= 0) { burst.alpha[i] = 0; continue; }
    burst.life[i] -= dt;
    const t = Math.max(0, burst.life[i] / burst.maxLife[i]);
    burst.alpha[i] = t;
    burst.pos[i * 3] += burst.vel[i * 3] * dt;
    burst.pos[i * 3 + 1] += burst.vel[i * 3 + 1] * dt;
    burst.pos[i * 3 + 2] += burst.vel[i * 3 + 2] * dt;
    burst.vel[i * 3] *= 0.94;
    burst.vel[i * 3 + 1] *= 0.94;
    burst.vel[i * 3 + 2] *= 0.94;
  }
  burst.points.geometry.attributes.position.needsUpdate = true;
  burst.points.geometry.attributes.aAlpha.needsUpdate = true;
  burst.points.geometry.attributes.aColor.needsUpdate = true;
}

// ————— audio (fully procedural) —————
const AudioSys = {
  ctx: null,
  master: null,
  muted: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // lush send delay
    this.delay = this.ctx.createDelay(1);
    this.delay.delayTime.value = 0.34;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.38;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.3;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.master);

    // abyssal pad — detuned sines through a slow-breathing filter
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.05;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 1.4;
    padGain.connect(filter).connect(this.master);
    const freqs = [55, 82.41, 110, 164.81];
    for (const f of freqs) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = rand(-6, 6);
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g).connect(padGain);
      o.start();
    }
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    // water hush — filtered noise
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 240;
    const ng = this.ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf).connect(ng).connect(this.master);
    noise.start();
  },
  note(freq, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol || 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.decay || 1.4));
    o.connect(g);
    g.connect(this.master);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + (opts.decay || 1.4) + 0.1);
    // shimmer partial
    if (!opts.plain) {
      const o2 = this.ctx.createOscillator();
      o2.frequency.value = freq * 2.01;
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime((opts.vol || 0.16) * 0.28, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + (opts.decay || 1.4) * 0.6);
      o2.connect(g2).connect(this.delay);
      o2.start(t);
      o2.stop(t + (opts.decay || 1.4));
    }
  },
  chime(step) {
    const penta = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.7, 1318.5, 1568.0, 1760.0];
    this.note(penta[Math.min(step, penta.length - 1)], { vol: 0.14, decay: 1.5 });
  },
  chord() {
    const notes = [261.63, 392.0, 523.25, 659.25, 783.99];
    notes.forEach((f, i) => this.note(f, { delay: i * 0.09, vol: 0.13, decay: 2.6 }));
    this.note(130.81, { vol: 0.16, decay: 3.2, plain: true });
  },
  thud() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(86, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
  },
};

// ————— game state / UI —————
let state = 'title'; // title | play | won
let startTime = 0;
let totalCollected = 0;
let hits = 0;
let combo = 0;
let lastCollect = -10;
let shake = 0;
let bloomedCount = 0;
let winAt = Infinity;

const hud = document.getElementById('hud');
const hintEl = document.getElementById('hint');
const lumenEl = document.getElementById('lumenCount');
const reefCountEl = document.getElementById('reefCount');
const reefDotsEl = document.getElementById('reefDots');
const hitflashEl = document.getElementById('hitflash');
for (let i = 0; i < 7; i++) {
  const d = document.createElement('div');
  d.className = 'reef-dot';
  reefDotsEl.appendChild(d);
}

let hintTimer = null;
function setHint(text, holdMs = 0) {
  clearTimeout(hintTimer);
  hintEl.classList.remove('visible');
  if (!text) return;
  hintTimer = setTimeout(() => {
    hintEl.textContent = text;
    hintEl.classList.add('visible');
    if (holdMs > 0) {
      hintTimer = setTimeout(() => hintEl.classList.remove('visible'), holdMs);
    }
  }, 650);
}

const tutorial = { collected: false, ready: false, bloomed: false };
function updateLumenHud() {
  lumenEl.textContent = player.carried;
  lumenEl.classList.remove('pop');
  void lumenEl.offsetWidth;
  lumenEl.classList.add('pop');
}

// title word letter animation
{
  const el = document.getElementById('titleWord');
  const word = el.textContent;
  el.textContent = '';
  [...word].forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = ch;
    span.style.animationDelay = `${0.25 + i * 0.09}s`;
    el.appendChild(span);
  });
  document.querySelectorAll('.reveal').forEach((r, i) => {
    r.style.animationDelay = `${0.9 + i * 0.18}s`;
  });
}

const isTouch = window.matchMedia('(pointer: coarse)').matches;
if (isTouch) {
  const ems = document.querySelectorAll('.controls-hint em');
  if (ems[0]) ems[0].textContent = 'your finger';
}

document.getElementById('startBtn').addEventListener('click', () => {
  AudioSys.init();
  if (AudioSys.ctx && AudioSys.ctx.state === 'suspended') AudioSys.ctx.resume();
  document.getElementById('titleScreen').classList.add('dismissed');
  hud.classList.remove('hidden');
  requestAnimationFrame(() => hud.classList.add('visible'));
  state = 'play';
  startTime = elapsed;
  AudioSys.chord();
  setHint(
    isTouch
      ? 'drift with your finger — gather the motes of light'
      : 'drift with your cursor — gather the motes of light',
    6000
  );
});
document.getElementById('againBtn').addEventListener('click', () => location.reload());

document.getElementById('soundToggle').addEventListener('click', () => {
  AudioSys.muted = !AudioSys.muted;
  if (AudioSys.master) {
    AudioSys.master.gain.linearRampToValueAtTime(
      AudioSys.muted ? 0 : 0.5, AudioSys.ctx.currentTime + 0.2
    );
  }
  document.getElementById('soundOnIcon').style.display = AudioSys.muted ? 'none' : '';
  document.getElementById('soundOffIcon').style.display = AudioSys.muted ? '' : 'none';
});

// ————— input —————
const mouseNdc = new THREE.Vector2(0, 0.2);
window.addEventListener('pointermove', (e) => {
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
window.addEventListener('pointerdown', (e) => {
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});

const _ray = new THREE.Vector3();
function mouseToWorld(out) {
  _ray.set(mouseNdc.x, mouseNdc.y, 0.5).unproject(camera);
  _ray.sub(camera.position).normalize();
  const t = -camera.position.z / _ray.z;
  out.copy(camera.position).addScaledVector(_ray, t);
  return out;
}

// ————— core loop —————
const camTarget = new THREE.Vector3(0, 2, 18);
const lookTarget = new THREE.Vector3();

function update(dt) {
  elapsed += dt;
  const t = elapsed;

  // player target
  if (state === 'title') {
    player.target.set(
      Math.sin(t * 0.13) * 11,
      3.5 + Math.sin(t * 0.21 + 1.3) * 4,
      0
    );
  } else {
    mouseToWorld(player.target);
    player.target.x = THREE.MathUtils.clamp(player.target.x, WORLD.minX, WORLD.maxX);
    player.target.y = THREE.MathUtils.clamp(player.target.y, WORLD.reefY + 0.8, WORLD.maxY);
  }

  // player physics — springy drift
  _v1.subVectors(player.target, player.pos);
  player.vel.addScaledVector(_v1, dt * 5.2);
  player.vel.multiplyScalar(Math.pow(0.045, dt));
  player.pos.addScaledVector(player.vel, dt);
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, WORLD.minX, WORLD.maxX);
  player.pos.y = THREE.MathUtils.clamp(player.pos.y, WORLD.reefY + 0.6, WORLD.maxY + 1);
  player.pos.z = 0;
  player.group.position.copy(player.pos);

  // pulse + invulnerability blink
  const pulse = 1 + Math.sin(t * 3.2) * 0.08 + Math.min(player.vel.length() * 0.02, 0.15);
  player.core.scale.setScalar(pulse);
  player.halo.scale.setScalar(2.5 * pulse + player.carried * 0.04);
  if (player.invuln > 0) {
    player.invuln -= dt;
    const blink = Math.sin(t * 26) > 0 ? 1 : 0.25;
    player.core.material.opacity = blink;
    player.halo.material.opacity = 0.85 * blink;
  } else {
    player.core.material.opacity = 1;
    player.halo.material.opacity = 0.62 + Math.sin(t * 3.2) * 0.08;
  }

  for (const td of tendrils) td.update(dt, t);

  // spores
  let needAlive = 0;
  for (let i = 0; i < SPORE_POOL; i++) {
    const s = spores[i];
    if (!s.alive) {
      if (needAlive < aliveTarget && t > s.respawnAt) {
        // count alive first — handled below with scale 0
      }
      _s.setScalar(0.0001);
      _m.compose(s.pos, _q, _s);
      sporeMesh.setMatrixAt(i, _m);
      continue;
    }
    // gentle drift
    s.pos.x += Math.sin(t * 0.4 + s.seed) * 0.15 * dt;
    s.pos.y += Math.cos(t * 0.33 + s.seed * 2) * 0.12 * dt;
    // attraction & collection
    if (state === 'play') {
      const d = s.pos.distanceTo(player.pos);
      if (d < 4.4) {
        _v1.subVectors(player.pos, s.pos).normalize();
        s.vel.addScaledVector(_v1, (1 - d / 4.4) * 34 * dt);
      }
      s.vel.multiplyScalar(Math.pow(0.02, dt));
      s.pos.addScaledVector(s.vel, dt);
      if (d < 1.05) {
        s.alive = false;
        s.respawnAt = t + rand(3.5, 8);
        player.carried++;
        totalCollected++;
        combo = t - lastCollect < 3.5 ? combo + 1 : 0;
        lastCollect = t;
        updateLumenHud();
        spawnBurst(s.pos, s.color, 12, 2.4);
        spawnRing(s.pos, 0xffe9bd, 2.6, 0.55);
        AudioSys.chime(combo);
        if (!tutorial.collected) {
          tutorial.collected = true;
          setHint(`gather ${CLUSTER_COST} lumens of light`, 5000);
        }
        if (!tutorial.ready && player.carried >= CLUSTER_COST) {
          tutorial.ready = true;
          setHint('now — carry your light down to the dark coral', 6500);
        }
      }
    }
    const sc = 1 + Math.sin(t * 2.1 + s.seed) * 0.22;
    _s.setScalar(sc);
    _m.compose(s.pos, _q, _s);
    sporeMesh.setMatrixAt(i, _m);
  }
  // respawn pass
  let aliveCount = spores.filter((s) => s.alive).length;
  for (const s of spores) {
    if (aliveCount >= aliveTarget) break;
    if (!s.alive && t > s.respawnAt) {
      spawnSpore(s);
      aliveCount++;
    }
  }
  sporeMesh.instanceMatrix.needsUpdate = true;

  // urchins
  urchins.mat.uniforms.uTime.value = t;
  for (const u of urchins) {
    // slow wander
    u.vel.x += Math.sin(t * 0.21 + u.seed) * 0.35 * dt;
    u.vel.y += Math.cos(t * 0.17 + u.seed * 3) * 0.3 * dt;
    // weak homing
    if (state === 'play') {
      const d = u.pos.distanceTo(player.pos);
      if (d < 11 && d > 0.01) {
        _v1.subVectors(player.pos, u.pos).normalize();
        u.vel.addScaledVector(_v1, 0.9 * dt);
      }
    }
    u.vel.multiplyScalar(Math.pow(0.3, dt));
    u.pos.addScaledVector(u.vel, dt);
    u.pos.x = THREE.MathUtils.clamp(u.pos.x, WORLD.minX + 2, WORLD.maxX - 2);
    u.pos.y = THREE.MathUtils.clamp(u.pos.y, WORLD.reefY + 3, WORLD.maxY - 1);
    u.pos.z = THREE.MathUtils.clamp(u.pos.z, -1.5, 1.5);
    u.mesh.position.copy(u.pos);
    u.mesh.rotation.x += u.spin.x * dt;
    u.mesh.rotation.y += u.spin.y * dt;
    u.mesh.rotation.z += u.spin.z * dt;
    u.halo.material.opacity = 0.12 + 0.07 * Math.sin(t * 2.6 + u.seed);

    // collision
    if (state === 'play' && player.invuln <= 0 && u.pos.distanceTo(player.pos) < 1.35) {
      hits++;
      player.invuln = 2.2;
      const lost = Math.min(player.carried, 6);
      player.carried -= lost;
      updateLumenHud();
      // scatter the stolen light back into the water
      let scattered = 0;
      for (const s of spores) {
        if (scattered >= lost) break;
        if (!s.alive) {
          spawnSpore(
            s,
            THREE.MathUtils.clamp(player.pos.x + rand(-5, 5), WORLD.minX + 2, WORLD.maxX - 2),
            THREE.MathUtils.clamp(player.pos.y + rand(-3, 5), -8, WORLD.maxY - 1)
          );
          scattered++;
        }
      }
      _v1.subVectors(player.pos, u.pos).normalize();
      player.vel.addScaledVector(_v1, 14);
      u.vel.addScaledVector(_v1, -6);
      shake = 0.7;
      spawnBurst(player.pos, COL.red, 20, 4);
      spawnRing(player.pos, 0xff4d6b, 7, 0.8);
      hitflashEl.classList.add('flash');
      setTimeout(() => hitflashEl.classList.remove('flash'), 90);
      AudioSys.thud();
      combo = 0;
    }
  }

  // clusters
  for (const c of clusters) {
    c.update(t, dt);
    if (
      state === 'play' &&
      c.state === 'dormant' &&
      player.carried >= CLUSTER_COST &&
      player.pos.distanceTo(c.center) < 5.6
    ) {
      player.carried -= CLUSTER_COST;
      updateLumenHud();
      c.beginBloom(t);
      bloomedCount++;
      reefCountEl.textContent = bloomedCount;
      reefDotsEl.children[bloomedCount - 1].classList.add('lit');
      setTendrilCount(3 + bloomedCount);
      // stream of light from player to the coral heart
      _v1.subVectors(c.center, player.pos).normalize();
      spawnBurst(player.pos, COL.cyan, 26, 3.2, _v1.multiplyScalar(5));
      spawnRing(c.center, 0x9df5e8, 26, 1.6);
      AudioSys.chord();
      if (!tutorial.bloomed) {
        tutorial.bloomed = true;
        setHint('the coral wakes — light the whole reef', 5000);
      }
      if (bloomedCount >= 7) {
        winAt = t + 2.8;
      }
    }
  }

  // win
  if (state === 'play' && t > winAt) {
    state = 'won';
    const dur = Math.round(t - startTime);
    document.getElementById('statTime').textContent =
      `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
    document.getElementById('statMotes').textContent = totalCollected;
    document.getElementById('statHits').textContent = hits;
    const ws = document.getElementById('winScreen');
    ws.classList.remove('hidden');
    requestAnimationFrame(() => ws.classList.add('visible'));
    hud.classList.remove('visible');
  }
  if (state === 'won' && Math.random() < 0.12) {
    // ambient celebration — reef exhales light
    const cx = CLUSTER_XS[Math.floor(Math.random() * 7)];
    spawnBurst(
      new THREE.Vector3(cx + rand(-3, 3), WORLD.reefY + rand(1, 4), rand(-1, 1)),
      Math.random() < 0.5 ? COL.cyan : COL.violet, 3, 1.2, new THREE.Vector3(0, 2.8, 0)
    );
  }

  updateBursts(dt);
  updateRings(dt);

  // environment
  domeMat.uniforms.uTime.value = t;
  for (const child of rayGroup.children) {
    child.material.uniforms.uTime.value = t;
    child.rotation.z = child.userData.baseRot + Math.sin(t * child.userData.speed) * 0.02 * child.userData.sway * 10;
  }

  // camera
  shake = Math.max(0, shake - dt * 1.6);
  const followX = THREE.MathUtils.clamp(player.pos.x, WORLD.minX + 11, WORLD.maxX - 11);
  const followY = THREE.MathUtils.clamp(player.pos.y * 0.85 + 0.8, WORLD.reefY + 5.5, 11);
  camTarget.set(
    followX + mouseNdc.x * 0.8,
    followY + mouseNdc.y * 0.5,
    18 + Math.sin(t * 0.23) * 0.5
  );
  const cf = 1 - Math.pow(0.012, dt);
  camera.position.lerp(camTarget, cf);
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake * 0.22;
    camera.position.y += rand(-1, 1) * shake * 0.22;
  }
  lookTarget.lerp(_v1.set(followX, followY - 1.2, 0), cf);
  camera.lookAt(lookTarget);

  dome.position.copy(camera.position);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  composer.render();
}
loop();

// test/dev hook — only when ?debug is in the URL
if (location.search.includes('debug')) {
  window.__noc = {
    grant(n) { player.carried += n; updateLumenHud(); },
    state: () => ({ state, carried: player.carried, bloomed: bloomedCount, pos: player.pos.toArray() }),
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
