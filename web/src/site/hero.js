// The landing page hero's 3D view: real catalogue parts (assets/
// hero-parts.bin, see scripts/hero-parts.mjs) joining the way they would
// on the Bench. Each pair in turn: the base part rises onto the plate, a
// green slot marker shows its "mount" slot, and the attached part drops
// onto it, then the pair turns on the plate until the next one.
//
// Loaded on demand by landing.js once the page is idle, so three.js never
// holds up the first paint; the page shows the parts' gallery renders
// until this is ready, and keeps them if WebGL is not available. The
// scene lives as long as the page, so nothing here is disposed.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import meshesUrl from "./assets/hero-parts.bin?url";
import { decodeMeshes } from "./heroMeshes.js";
import { meshNames } from "./heroPairs.js";

/** @typedef {import("./heroPairs.js").HeroPair} HeroPair */

// The app icon's metal and orange, and the app's slot-marker green.
const BASE_COLOR = 0xb9c6cd;
const ATTACHED_COLOR = 0xff8a2a;
const MARKER_COLOR = 0x2ecc71;

// One pair's timeline, in milliseconds from its start.
export const PAIR_MS = 6800;
const BASE_IN_MS = 650;
const ATTACHED_IN_AT = 380;
const ATTACHED_IN_MS = 450;
const DESCEND_AT = 1050;
const LAND_AT = 1950;
const SETTLE_MS = 260;
const LEAVE_AT = 6050;
const LEAVE_MS = 700;
// The assembled pose, for reduced motion and for a pair picked by hand
// while the page is still.
const ASSEMBLED_AT = LAND_AT + SETTLE_MS + 400;

// Every pair is scaled to this size (world units), so a 20 mm buckle
// and a 42 mm Gridfinity base fill the view alike.
const PAIR_SIZE = 1.55;
const TURN_SPEED = 0.28; // radians a second
const CREASE_ANGLE = THREE.MathUtils.degToRad(32);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const progress = (t, from, ms) => clamp01((t - from) / ms);

/**
 * @param {Uint16Array | Uint32Array} indices
 * @param {Float32Array} positions
 */
function buildGeometry(positions, indices) {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  indexed.setIndex(new THREE.BufferAttribute(indices, 1));
  // Flat faces stay flat and a cylinder's facets shade as one curve:
  // OpenSCAD's meshes carry no normals, only triangles.
  const shaded = toCreasedNormals(indexed, CREASE_ANGLE);
  const edges = new THREE.EdgesGeometry(indexed, 28);
  indexed.computeBoundingBox();
  return { shaded, edges, box: /** @type {THREE.Box3} */ (indexed.boundingBox) };
}

function partMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.5,
    transparent: true,
  });
}

// A faint grid on the plate, fading out with distance — the app's viewer
// floor, without the hard edge a GridHelper has.
function gridMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0x9aa8b8) }, uRadius: { value: 2.2 } },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPos = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uRadius;
      varying vec2 vPos;
      float lines(float spacing) {
        vec2 cell = vPos / spacing;
        vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float fade = 1.0 - smoothstep(uRadius * 0.2, uRadius, length(vPos));
        float alpha = (lines(0.14) * 0.22 + lines(0.7) * 0.45) * fade;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(uColor, alpha);
      }`,
  });
}

/**
 * One pair's meshes, ready to show: everything in the base part's
 * OpenSCAD frame (Z up), centred and scaled by `fit`.
 */
function buildPair(meshes, pair) {
  const names = meshNames(pair);
  const base = meshes.get(names.base);
  const attached = meshes.get(names.attached);
  if (!base || !attached) throw new Error(`hero-parts.bin has no ${pair.key}`);
  const baseGeometry = buildGeometry(base.positions, base.indices);
  const attachedGeometry = buildGeometry(attached.positions, attached.indices);

  const bounds = baseGeometry.box.clone().union(attachedGeometry.box);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = PAIR_SIZE / Math.max(size.x, size.y, size.z);

  // fit: scales the pair and stands its base on the plate, centred.
  const fit = new THREE.Group();
  fit.scale.setScalar(scale);
  const centred = new THREE.Group();
  const centre = bounds.getCenter(new THREE.Vector3());
  centred.position.set(-centre.x, -centre.y, -bounds.min.z);
  fit.add(centred);

  const baseMaterial = partMaterial(BASE_COLOR);
  const baseMesh = new THREE.Mesh(baseGeometry.shaded, baseMaterial);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  const baseEdges = new THREE.LineSegments(
    baseGeometry.edges,
    new THREE.LineBasicMaterial({ color: 0x1b2129, transparent: true, opacity: 0.32 }),
  );
  const baseGroup = new THREE.Group();
  baseGroup.add(baseMesh, baseEdges);
  centred.add(baseGroup);

  // The attached part turns and lifts about the point where it meets the
  // base: the middle of its own underside, which attach() put on the
  // base's "mount" slot.
  const attachedBox = attachedGeometry.box;
  const mount = new THREE.Vector3(
    (attachedBox.min.x + attachedBox.max.x) / 2,
    (attachedBox.min.y + attachedBox.max.y) / 2,
    attachedBox.min.z,
  );
  const attachedMaterial = partMaterial(ATTACHED_COLOR);
  const attachedMesh = new THREE.Mesh(attachedGeometry.shaded, attachedMaterial);
  attachedMesh.castShadow = true;
  attachedMesh.receiveShadow = true;
  const attachedEdges = new THREE.LineSegments(
    attachedGeometry.edges,
    new THREE.LineBasicMaterial({ color: 0x3a1806, transparent: true, opacity: 0.3 }),
  );
  const attachedInner = new THREE.Group();
  attachedInner.position.copy(mount).negate();
  attachedInner.add(attachedMesh, attachedEdges);
  const attachedPivot = new THREE.Group();
  attachedPivot.position.copy(mount);
  attachedPivot.add(attachedInner);
  centred.add(attachedPivot);

  // The slot marker: a dot and a ring that pulses outwards, sized in world
  // units so it looks the same on every pair whatever its scale.
  const markerRadius = 0.045 / scale;
  const marker = new THREE.Group();
  marker.position.copy(mount).add(new THREE.Vector3(0, 0, 0.02 / scale));
  const dotMaterial = new THREE.MeshBasicMaterial({
    color: MARKER_COLOR,
    transparent: true,
    depthWrite: false,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: MARKER_COLOR,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const dot = new THREE.Mesh(new THREE.CircleGeometry(markerRadius, 32), dotMaterial);
  const ring = new THREE.Mesh(new THREE.RingGeometry(markerRadius * 1.6, markerRadius * 2, 48), ringMaterial);
  marker.add(dot, ring);
  centred.add(marker);

  const attachedHeight = attachedBox.max.z - attachedBox.min.z;
  return {
    pair,
    fit,
    baseGroup,
    baseMaterials: [baseMaterial, baseEdges.material],
    attachedPivot,
    attachedMaterials: [attachedMaterial, attachedEdges.material],
    marker,
    dot,
    ring,
    // How far the attached part starts above its slot, in the pair's mm.
    lift: Math.max(attachedHeight * 0.9, (0.55 / scale) * 0.9),
    baseBox: baseGeometry.box,
    attachedBox,
    // For the camera, in world units: the assembled pair's height and the
    // radius of a sphere around it.
    height: size.z * scale,
    radius: 0.5 * Math.hypot(size.x, size.y, size.z) * scale,
    scale,
  };
}

function setOpacity(materials, opacity, full) {
  materials.forEach((material, i) => {
    material.opacity = opacity * (i === 0 ? 1 : full[i]);
    material.visible = opacity > 0.002;
  });
}

const EDGE_OPACITY = [1, 0.32];

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.stage   gets .is-3d once the first frame is drawn
 * @param {HeroPair[]} options.pairs
 * @param {{ base: HTMLElement, attached: HTMLElement }} options.chips the parts' labels
 * @param {boolean} options.still      prefers-reduced-motion: no autoplay, no turning
 * @param {(index: number) => void} options.onPair a pair starts
 */
export async function createHero({ canvas, stage, pairs, chips, still, onPair }) {
  const response = await fetch(meshesUrl);
  if (!response.ok) throw new Error(`hero-parts.bin: HTTP ${response.status}`);
  const meshes = decodeMeshes(await response.arrayBuffer());

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  // Where the camera looks and how far away it is, eased towards each
  // pair's own framing (frame() and framing()).
  const target = new THREE.Vector3(0, 0.6, 0);
  let distance = 5;

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2.2, 5, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -1.6;
  key.shadow.camera.right = 1.6;
  key.shadow.camera.top = 1.6;
  key.shadow.camera.bottom = -1.6;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0008;
  // A warm light from behind and below: the plate's glow on the parts.
  const glow = new THREE.DirectionalLight(0xff9a48, 1.1);
  glow.position.set(-2.5, 0.4, -3);
  scene.add(key, glow, new THREE.HemisphereLight(0xc8d6ff, 0x26140a, 0.35));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), gridMaterial());
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -0.001;
  scene.add(floor, grid);

  // turntable (Y up) -> zUp (OpenSCAD's Z up) -> each pair's fit group.
  const turntable = new THREE.Group();
  const zUp = new THREE.Group();
  zUp.rotation.x = -Math.PI / 2;
  turntable.add(zUp);
  scene.add(turntable);

  const built = pairs.map((pair) => buildPair(meshes, pair));
  for (const entry of built) {
    entry.fit.visible = false;
    zUp.add(entry.fit);
  }

  // --- state
  let current = 0;
  let pairClock = still ? ASSEMBLED_AT : 0;
  let autoplay = !still;
  let holdUntil = 0; // autoplay waits after a drag
  let running = false;
  let visible = true;
  let last = 0;
  let spin = 0.6; // the turntable's own rotation
  let userYaw = 0;
  let yawVelocity = 0;
  let pitch = 0;
  let dragging = null;

  // Each label's width, measured when its text changes rather than on
  // every frame.
  const chipWidth = { base: 0, attached: 0 };
  function show(index, { assembled = still } = {}) {
    built[current].fit.visible = false;
    current = (index + built.length) % built.length;
    const entry = built[current];
    entry.fit.visible = true;
    pairClock = assembled ? ASSEMBLED_AT : 0;
    chips.base.textContent = entry.pair.base.part;
    chips.attached.textContent = entry.pair.attached.part;
    chipWidth.base = chips.base.offsetWidth;
    chipWidth.attached = chips.attached.offsetWidth;
    onPair(current);
    // While the tour runs the camera eases over to the new pair; a still
    // page cuts straight to it.
    if (!running || still) snapCamera();
    if (!running) draw();
  }

  function snapCamera() {
    const wanted = framing(built[current], pairClock);
    target.y = wanted.y;
    distance = wanted.distance;
  }

  // The pair's pose at `t` ms into its timeline.
  function pose(entry, t) {
    const leaving = progress(t, LEAVE_AT, LEAVE_MS);
    const baseIn = easeOut(progress(t, 0, BASE_IN_MS));
    const baseOpacity = baseIn * (1 - easeOut(leaving));
    setOpacity(entry.baseMaterials, baseOpacity, EDGE_OPACITY);
    entry.baseGroup.position.z = (1 - baseIn) * -2;

    const attachedIn = easeOut(progress(t, ATTACHED_IN_AT, ATTACHED_IN_MS));
    setOpacity(entry.attachedMaterials, attachedIn * (1 - easeOut(leaving)), EDGE_OPACITY);
    const descent = easeInOut(progress(t, DESCEND_AT, LAND_AT - DESCEND_AT));
    const settle = progress(t, LAND_AT, SETTLE_MS);
    // A small dip as it seats, like a snap going home.
    const seat = t >= LAND_AT ? -Math.sin(Math.PI * settle) * entry.lift * 0.035 : 0;
    entry.attachedPivot.position.z = entry.attachedBox.min.z + entry.lift * (1 - descent) + seat;
    entry.attachedPivot.position.z += easeOut(leaving) * entry.lift * 0.45;
    entry.attachedPivot.rotation.z =
      THREE.MathUtils.degToRad(38) * (1 - easeOut(progress(t, DESCEND_AT, 1100)));

    // The marker: on while the slot is free, a ring that pulses outwards,
    // and one wide flash as the part lands.
    const markerOn = progress(t, 150, 300) * (1 - progress(t, LAND_AT - 60, 120));
    const flash = progress(t, LAND_AT, 650);
    entry.dot.material.opacity = markerOn * baseOpacity;
    if (t < LAND_AT) {
      const pulse = (t % 1100) / 1100;
      entry.ring.scale.setScalar(0.6 + pulse * 1.6);
      entry.ring.material.opacity = markerOn * (1 - pulse) * 0.9;
    } else {
      entry.ring.scale.setScalar(1 + easeOut(flash) * 3.2);
      entry.ring.material.opacity = (1 - flash) * 0.85 * baseOpacity;
    }
    entry.dot.visible = entry.dot.material.opacity > 0.01;
    entry.ring.visible = entry.ring.material.opacity > 0.01;
    return { baseOpacity, attachedOpacity: attachedIn * (1 - easeOut(leaving)) };
  }

  // The labels follow the parts on screen: the base's beside its left
  // edge, the attached part's above it, wherever the turntable has them.
  const corner = new THREE.Vector3();
  // The canvas's size in CSS pixels, kept by resize() so a frame never
  // has to ask the layout for it.
  const size = { width: 0, height: 0 };
  function screenBox(box, object) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner
        .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .applyMatrix4(object.matrixWorld)
        .project(camera);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
    return {
      left: ((minX + 1) / 2) * size.width,
      right: ((maxX + 1) / 2) * size.width,
      top: ((1 - maxY) / 2) * size.height,
      bottom: ((1 - minY) / 2) * size.height,
    };
  }

  function placeChips(entry, { baseOpacity, attachedOpacity }) {
    const base = screenBox(entry.baseBox, entry.baseGroup.children[0]);
    const attached = screenBox(entry.attachedBox, entry.attachedPivot.children[0].children[0]);
    const baseX = Math.max(8, base.left - chipWidth.base - 14);
    chips.base.style.transform = `translate(${baseX}px, ${(base.top + base.bottom) / 2 - 14}px)`;
    const attachedX = Math.min(
      size.width - chipWidth.attached - 8,
      Math.max(8, (attached.left + attached.right) / 2 - chipWidth.attached / 2),
    );
    chips.attached.style.transform = `translate(${attachedX}px, ${Math.max(6, attached.top - 40)}px)`;
    chips.base.classList.toggle("is-shown", baseOpacity > 0.6);
    chips.attached.classList.toggle("is-shown", attachedOpacity > 0.6);
  }

  // The framing a pair wants at `t`: its whole bounding sphere in view,
  // its middle a little above the view's (the buttons sit below it), and
  // higher while the attached part is still on its way down.
  function framing(entry, t) {
    const descent = easeInOut(progress(t, DESCEND_AT, LAND_AT - DESCEND_AT));
    const lifted = entry.lift * entry.scale * (1 - descent);
    const halfView = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fit = (entry.radius + lifted * 0.35) / Math.min(halfView, halfView * camera.aspect);
    return { y: entry.height / 2 + lifted * 0.5 - fit * halfView * 0.16, distance: fit * 1.18 };
  }

  function draw() {
    const entry = built[current];
    const state = pose(entry, pairClock);
    turntable.rotation.y = spin + userYaw;
    const elevation = THREE.MathUtils.degToRad(21) + pitch;
    camera.position.set(0, target.y + Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    camera.lookAt(target);
    renderer.render(scene, camera);
    placeChips(entry, state);
    // The current pair's button fills up until the next pair (landing.css).
    stage.style.setProperty("--pair-progress", autoplay ? (pairClock / PAIR_MS).toFixed(4) : "0");
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(64, now - last);
    last = now;
    if (!dragging) {
      userYaw += yawVelocity;
      yawVelocity *= 0.93;
      pitch *= 0.9;
    }
    if (!still) spin += (TURN_SPEED * dt) / 1000;
    const wanted = framing(built[current], pairClock);
    const ease = 1 - Math.exp(-dt / 260);
    target.y += (wanted.y - target.y) * ease;
    distance += (wanted.distance - distance) * ease;
    if (autoplay && !dragging && now >= holdUntil) {
      pairClock += dt;
      if (pairClock >= PAIR_MS) show(current + 1, { assembled: false });
    } else if (!autoplay && pairClock < ASSEMBLED_AT) {
      pairClock = Math.min(ASSEMBLED_AT, pairClock + dt);
    }
    draw();
    requestAnimationFrame(frame);
  }

  function setRunning(next) {
    if (next === running) return;
    running = next;
    if (running) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  }

  const updateRunning = () => setRunning(visible && !document.hidden && (!still || Boolean(dragging)));
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateRunning();
  }).observe(stage);
  document.addEventListener("visibilitychange", updateRunning);

  function resize() {
    size.width = canvas.clientWidth;
    size.height = canvas.clientHeight;
    if (!size.width || !size.height) return;
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    if (!running) {
      snapCamera();
      draw();
    }
  }
  new ResizeObserver(resize).observe(canvas);

  // Drag to turn. Horizontal drags turn the pair, vertical ones tilt the
  // view a little (and spring back); touch-action: pan-y in landing.css
  // leaves vertical swipes to the page's own scrolling.
  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY, id: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    yawVelocity = 0;
    updateRunning();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    yawVelocity = dx * 0.009;
    userYaw += yawVelocity;
    pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, -0.22, 0.4);
    if (still) draw();
  });
  const release = (event) => {
    if (!dragging || event.pointerId !== dragging.id) return;
    dragging = null;
    canvas.classList.remove("is-dragging");
    // The tour waits a moment before moving on, so the pair just turned
    // into view isn't swapped straight away.
    holdUntil = performance.now() + 2500;
    updateRunning();
    if (still) draw();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  resize();
  show(0);
  updateRunning();
  draw();
  stage.classList.add("is-3d");

  return {
    /** Jump to a pair, from the buttons under the view. */
    show(index) {
      show(index, { assembled: still });
    },
    /** Stop or restart the automatic tour (reduced motion turned on or off). */
    setStill(next) {
      still = next;
      autoplay = !next;
      if (still) pairClock = Math.max(pairClock, ASSEMBLED_AT);
      updateRunning();
      draw();
    },
  };
}
