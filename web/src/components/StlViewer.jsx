import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clusterFace } from "../lib/faceCluster.js";

const MARKER_COLOR = 0x2ecc71;
const MARKER_HOVER_COLOR = 0xffd23f;
const MODEL_COLOR = 0x5b8ff9;
const BACKGROUND_COLOR = 0x1a1b1e;
const DEFAULT_MARKER_RADIUS = 2;
const HIGHLIGHT_COLOR = 0xffd23f;
const HIGHLIGHT_PAD_MM = 0.3;
// Pointer travel between pointerdown and click beyond which it was an
// orbit drag, not a click.
const CLICK_SLOP_PX = 5;

// stlBuffer or geometry: one model source. `geometry` (a THREE.BufferGeometry,
// e.g. straight from meshValidate.js) skips a wasted serialize/reparse
// round-trip when the caller already has one parsed — the STL-import
// slot-placement view uses this. A geometry the caller passed in stays
// the caller's to dispose; one parsed here from stlBuffer is disposed
// here when replaced or on unmount.
//
// markers: optional [{ id, x, y, z, radius?, color?, shape?, normal? }]
// — small clickable objects overlaid on the model, in the model's own
// mm coordinates (existing slots to attach something to; the Holes
// tab's holes and snap points). A sphere by default, in the green
// slot colour; `shape: "ring"` draws a flat ring lying on the surface
// whose outward `normal` is given (a hole's outline). Hover turns any
// of them yellow.
// onMarkerClick(id): called when a marker is clicked.
//
// placingMode + onSurfacePick([x,y,z], [nx,ny,nz]): when placingMode is
// true, clicking anywhere on the model itself (not a marker) raycasts
// against its real triangles, then walks out from the hit triangle
// across every connected, coplanar neighbor (faceCluster.js) to find
// the whole flat surface under the cursor — so the reported point is
// that surface's center, not wherever the ray happened to land, and
// the normal is its mating direction. A curved/faceted region has no
// such flat neighbor, so this degrades to the hit triangle's own
// centroid — never worse than a raw click point.
//
// onSurfaceHit(hit) + onSurfaceHover(hit | null): the raw alternative
// to onSurfacePick for a caller that does its own snapping (the Holes
// tab, lib/snapCandidates.js). With onSurfaceHit set, a placing-mode
// click reports the hit as it is — { point, normal (the triangle's
// own), faceIndex, altKey, shiftKey } — instead of a clustered face
// center, and onSurfaceHover gets the same record as the pointer moves
// over the model (null once it leaves it; not called while a marker is
// under the pointer, so snap markers don't vanish on approach).
//
// onModelClick([x,y,z] | null): a plain click (no marker under the
// cursor, not placing) reports where on the model it landed, in model
// mm, or null for a click on empty space — the Bench turns that into
// "select the part here" / "deselect". A drag that happens to end over
// the canvas is not a click (see CLICK_SLOP_PX), so orbiting never
// deselects or opens a marker.
//
// highlightBox: optional { min:[x,y,z], max:[x,y,z] } — an axis-aligned
// outline drawn around it (the selected Bench node).
//
// overlayAnchor + children: `children` are rendered in a DOM layer over
// the canvas, pinned to the screen projection of `overlayAnchor` (model
// mm) and re-pinned every frame so they follow the camera; with no
// anchor they dock at the bottom center of the viewer instead.
//
// Frames are rendered on demand, not on a 60fps loop: a frame is drawn
// when the camera moves (OrbitControls' "change", which it also fires
// on each damping step, so a drag settles smoothly), when the model or
// markers change, on hover highlight, and on resize. A viewer showing a
// still scene costs nothing — this is the one always-visible WebGL
// canvas in the app, so it was the app's whole idle GPU/battery cost.
export default function StlViewer({
  stlBuffer,
  geometry,
  markers,
  onMarkerClick,
  placingMode,
  onSurfacePick,
  onSurfaceHit,
  onSurfaceHover,
  onModelClick,
  highlightBox,
  overlayAnchor,
  children,
}) {
  const mountRef = useRef(null);
  const overlayRef = useRef(null);
  const sceneRef = useRef(null);
  const callbacksRef = useRef(null);
  const overlayAnchorRef = useRef(null);
  // The bounding sphere the camera was last fitted to (see the geometry
  // effect): a new model of the same size in the same place keeps the
  // view the user has set up.
  const fitRef = useRef(null);
  // A browser with WebGL disabled (or a GPU process that just died)
  // throws from the WebGLRenderer constructor. Without this, that throw
  // escapes the effect and React unmounts the whole app to a blank page
  // — so show a message in the viewer's place instead.
  const [webglError, setWebglError] = useState(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(80, -80, 80);
    camera.up.set(0, 0, 1);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      setWebglError(err);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, -1, 2);
    scene.add(dirLight);
    const grid = new THREE.GridHelper(120, 12, 0x444444, 0x2a2b2e);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    let frameId = null;
    const renderFrame = () => {
      frameId = null;
      // With damping on, update() keeps nudging the camera for a few
      // frames after the pointer stops and fires "change" each time it
      // does — which requests the next frame. Once it settles, no
      // change, no frame.
      controls.update();
      renderer.render(scene, camera);
      positionOverlay();
    };
    // Pin the overlay layer to the anchor's screen position. Behind the
    // camera (NDC z > 1) it's hidden rather than mirrored onto the screen.
    const projected = new THREE.Vector3();
    const positionOverlay = () => {
      const el = overlayRef.current;
      const anchor = overlayAnchorRef.current;
      if (!el || !anchor) return;
      projected.set(anchor[0], anchor[1], anchor[2]).project(camera);
      if (projected.z > 1) {
        el.style.visibility = "hidden";
        return;
      }
      const x = ((projected.x + 1) / 2) * mount.clientWidth;
      const y = ((1 - projected.y) / 2) * mount.clientHeight;
      el.style.visibility = "";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    };
    const requestRender = () => {
      if (frameId === null) frameId = requestAnimationFrame(renderFrame);
    };
    controls.addEventListener("change", requestRender);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };
    const markerGroup = () => scene.getObjectByName("markers");
    const model = () => scene.getObjectByName("model");

    // The browser fires "click" after an orbit drag too, as long as the
    // pointer went down and came up on the canvas — so remember where it
    // went down and treat anything that travelled further than a few
    // pixels as the drag it was, not a click.
    let pointerDownAt = null;
    const onPointerDown = (event) => {
      pointerDownAt = [event.clientX, event.clientY];
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    // A raycast hit as the raw-hit callbacks report it: the triangle's
    // own geometric normal (not an interpolated vertex normal), in world
    // space, plus the click's modifier keys.
    const rawHit = (hit, mesh, event) => {
      const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
      return {
        point: [hit.point.x, hit.point.y, hit.point.z],
        normal: [normal.x, normal.y, normal.z],
        faceIndex: hit.faceIndex,
        altKey: Boolean(event?.altKey),
        shiftKey: Boolean(event?.shiftKey),
      };
    };
    // Whether the last hover report was a hit, so "left the model" is
    // reported once, not on every move over empty space.
    let hovering = false;

    const onClick = (event) => {
      if (pointerDownAt && Math.hypot(event.clientX - pointerDownAt[0], event.clientY - pointerDownAt[1]) > CLICK_SLOP_PX) {
        return;
      }
      setPointer(event);

      const group = markerGroup();
      if (group && group.children.length) {
        const hits = raycaster.intersectObjects(group.children);
        if (hits.length) {
          callbacksRef.current?.onMarkerClick?.(hits[0].object.userData.id);
          return;
        }
      }

      if (callbacksRef.current?.placingMode) {
        const mesh = model();
        if (!mesh) return;
        const hits = raycaster.intersectObject(mesh);
        if (!hits.length) return;
        if (callbacksRef.current.onSurfaceHit) {
          callbacksRef.current.onSurfaceHit(rawHit(hits[0], mesh, event));
          return;
        }
        if (mesh.geometry.index === null) return;
        const cluster = clusterFace(mesh.geometry, hits[0].faceIndex);
        const point = new THREE.Vector3(...cluster.point).applyMatrix4(mesh.matrixWorld);
        const normal = new THREE.Vector3(...cluster.normal).transformDirection(mesh.matrixWorld).normalize();
        callbacksRef.current?.onSurfacePick?.([point.x, point.y, point.z], [normal.x, normal.y, normal.z]);
        return;
      }

      if (callbacksRef.current?.onModelClick) {
        const mesh = model();
        const hits = mesh ? raycaster.intersectObject(mesh) : [];
        if (hits.length) {
          const p = hits[0].point;
          callbacksRef.current.onModelClick([p.x, p.y, p.z]);
        } else {
          callbacksRef.current.onModelClick(null);
        }
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    const onPointerMove = (event) => {
      setPointer(event);
      const group = markerGroup();
      const hasMarkers = group && group.children.length;
      const markerHits = hasMarkers ? raycaster.intersectObjects(group.children) : [];
      if (hasMarkers) {
        const hitSet = new Set(markerHits.map((h) => h.object));
        let recolored = false;
        for (const marker of group.children) {
          const color = hitSet.has(marker) ? MARKER_HOVER_COLOR : marker.userData.color ?? MARKER_COLOR;
          if (marker.material.color.getHex() !== color) {
            marker.material.color.setHex(color);
            recolored = true;
          }
        }
        if (recolored) requestRender();
      }

      const callbacks = callbacksRef.current;
      const mesh = model();
      // One raycast against the model serves both the cursor and the
      // hover report; neither is needed with nothing to do on a hit.
      const wantsModelHit = mesh && !markerHits.length && (callbacks?.placingMode || callbacks?.onModelClick);
      const modelHits = wantsModelHit ? raycaster.intersectObject(mesh) : [];

      let cursor = "default";
      if (markerHits.length) cursor = "pointer";
      else if (callbacks?.placingMode && modelHits.length) cursor = "crosshair";
      else if (callbacks?.onModelClick && modelHits.length) cursor = "pointer";
      renderer.domElement.style.cursor = cursor;

      if (callbacks?.placingMode && callbacks?.onSurfaceHover && !markerHits.length) {
        if (modelHits.length) {
          hovering = true;
          callbacks.onSurfaceHover(rawHit(modelHits[0], mesh, event));
        } else if (hovering) {
          hovering = false;
          callbacks.onSurfaceHover(null);
        }
      }
    };
    const onPointerLeave = () => {
      if (!hovering) return;
      hovering = false;
      callbacksRef.current?.onSurfaceHover?.(null);
    };
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // Sized to the mount, and re-sized whenever the mount changes — a
    // window resize, but also the sidebar collapsing, which widens the
    // viewer without any window event.
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    sceneRef.current = { scene, camera, renderer, controls, requestRender };

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      disposeModel(scene);
      disposeMarkers(scene);
      disposeHighlight(scene);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, camera, controls, requestRender } = sceneRef.current;
    if (!stlBuffer && !geometry) return;

    disposeModel(scene);

    const owned = !geometry;
    const geom = geometry || new STLLoader().parse(stlBuffer);
    if (owned) geom.computeVertexNormals();
    geom.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({ color: MODEL_COLOR, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(geom, material);
    mesh.name = "model";
    mesh.userData.ownsGeometry = owned;
    scene.add(mesh);

    const bbox = geom.boundingBox;
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const radius = Math.max(size.x, size.y, size.z, 1);

    // Re-fit the camera only when the model's size or place actually
    // changed: a Bench part turned in place, or a hole drilled into a
    // plate, leaves the view where the user put it.
    const fit = fitRef.current;
    const unchanged = fit && fit.center.distanceTo(center) < 0.02 * radius && Math.abs(fit.radius - radius) < 0.02 * radius;
    if (!unchanged) {
      controls.target.copy(center);
      camera.position.set(center.x + radius * 1.6, center.y - radius * 1.6, center.z + radius * 1.6);
      camera.near = radius / 100;
      camera.far = radius * 20;
      camera.updateProjectionMatrix();
      controls.update();
    }
    fitRef.current = { center: center.clone(), radius };
    requestRender();
  }, [stlBuffer, geometry]);

  useEffect(() => {
    callbacksRef.current = { onMarkerClick, placingMode, onSurfacePick, onSurfaceHit, onSurfaceHover, onModelClick };
  }, [onMarkerClick, placingMode, onSurfacePick, onSurfaceHit, onSurfaceHover, onModelClick]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, requestRender } = sceneRef.current;
    disposeHighlight(scene);
    if (highlightBox) {
      const box = new THREE.Box3(new THREE.Vector3(...highlightBox.min), new THREE.Vector3(...highlightBox.max));
      // A hair outside the part so the lines don't z-fight its faces.
      box.expandByScalar(HIGHLIGHT_PAD_MM);
      const helper = new THREE.Box3Helper(box, HIGHLIGHT_COLOR);
      helper.name = "highlight";
      scene.add(helper);
    }
    requestRender();
  }, [highlightBox]);

  useEffect(() => {
    overlayAnchorRef.current = overlayAnchor ?? null;
    const el = overlayRef.current;
    if (el && !overlayAnchor) {
      // Docked: CSS places it; clear whatever the last projection left.
      el.style.transform = "";
      el.style.visibility = "";
    }
    sceneRef.current?.requestRender();
  }, [overlayAnchor, children]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, requestRender } = sceneRef.current;

    disposeMarkers(scene);
    if (markers && markers.length) {
      const group = new THREE.Group();
      group.name = "markers";
      // One geometry per distinct shape and radius, shared by every
      // marker of that kind, instead of a fresh tessellation per marker.
      const geometryByRadius = new Map();
      const up = new THREE.Vector3(0, 0, 1);
      for (const marker of markers) {
        const radius = marker.radius ?? DEFAULT_MARKER_RADIUS;
        const shape = marker.shape === "ring" ? "ring" : "sphere";
        const key = `${shape}:${radius}`;
        let geom = geometryByRadius.get(key);
        if (!geom) {
          geom = shape === "ring" ? new THREE.RingGeometry(radius * 0.7, radius, 48) : new THREE.SphereGeometry(radius, 16, 16);
          geometryByRadius.set(key, geom);
        }
        const color = marker.color ?? MARKER_COLOR;
        const object = new THREE.Mesh(
          geom,
          new THREE.MeshBasicMaterial({ color, side: shape === "ring" ? THREE.DoubleSide : THREE.FrontSide }),
        );
        object.position.set(marker.x, marker.y, marker.z);
        if (shape === "ring" && marker.normal) {
          // Flat on the surface, lifted a hair off it so it doesn't
          // z-fight the face it outlines.
          const normal = new THREE.Vector3(...marker.normal).normalize();
          object.quaternion.setFromUnitVectors(up, normal);
          object.position.addScaledVector(normal, 0.08);
        }
        object.userData.id = marker.id;
        object.userData.color = color;
        group.add(object);
      }
      group.userData.geometries = [...geometryByRadius.values()];
      scene.add(group);
    }
    requestRender();
  }, [markers]);

  if (webglError) {
    return (
      <div className="viewer-placeholder viewer-unavailable" role="alert">
        <p>
          This browser can't show the 3D preview (WebGL is unavailable). Rendering and downloads still work.
        </p>
      </div>
    );
  }
  return (
    <div className="viewer-canvas">
      <div ref={mountRef} className="viewer-canvas-mount" />
      {children && (
        <div ref={overlayRef} className={overlayAnchor ? "viewer-overlay" : "viewer-overlay viewer-overlay-docked"}>
          {children}
        </div>
      )}
    </div>
  );
}

function disposeHighlight(scene) {
  const previous = scene.getObjectByName("highlight");
  if (!previous) return;
  scene.remove(previous);
  previous.geometry.dispose();
  previous.material.dispose();
}

function disposeModel(scene) {
  const previous = scene.getObjectByName("model");
  if (!previous) return;
  scene.remove(previous);
  if (previous.userData.ownsGeometry) previous.geometry.dispose();
  previous.material.dispose();
}

function disposeMarkers(scene) {
  const previous = scene.getObjectByName("markers");
  if (!previous) return;
  scene.remove(previous);
  for (const marker of previous.children) marker.material.dispose();
  for (const geom of previous.userData.geometries ?? []) geom.dispose();
}
