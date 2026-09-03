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

// stlBuffer or geometry: one model source. `geometry` (a THREE.BufferGeometry,
// e.g. straight from meshValidate.js) skips a wasted serialize/reparse
// round-trip when the caller already has one parsed — the STL-import
// slot-placement view uses this. A geometry the caller passed in stays
// the caller's to dispose; one parsed here from stlBuffer is disposed
// here when replaced or on unmount.
//
// markers: optional [{ id, x, y, z, radius? }] — small clickable spheres
// overlaid on the model, in the model's own mm coordinates (existing
// slots to attach something to).
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
// Frames are rendered on demand, not on a 60fps loop: a frame is drawn
// when the camera moves (OrbitControls' "change", which it also fires
// on each damping step, so a drag settles smoothly), when the model or
// markers change, on hover highlight, and on resize. A viewer showing a
// still scene costs nothing — this is the one always-visible WebGL
// canvas in the app, so it was the app's whole idle GPU/battery cost.
export default function StlViewer({ stlBuffer, geometry, markers, onMarkerClick, placingMode, onSurfacePick }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const callbacksRef = useRef(null);
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

    const onClick = (event) => {
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
        if (!mesh || mesh.geometry.index === null) return;
        const hits = raycaster.intersectObject(mesh);
        if (!hits.length) return;
        const cluster = clusterFace(mesh.geometry, hits[0].faceIndex);
        const point = new THREE.Vector3(...cluster.point).applyMatrix4(mesh.matrixWorld);
        const normal = new THREE.Vector3(...cluster.normal).transformDirection(mesh.matrixWorld).normalize();
        callbacksRef.current?.onSurfacePick?.([point.x, point.y, point.z], [normal.x, normal.y, normal.z]);
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
          const color = hitSet.has(marker) ? MARKER_HOVER_COLOR : MARKER_COLOR;
          if (marker.material.color.getHex() !== color) {
            marker.material.color.setHex(color);
            recolored = true;
          }
        }
        if (recolored) requestRender();
      }

      let cursor = "default";
      if (markerHits.length) cursor = "pointer";
      else if (callbacksRef.current?.placingMode) {
        const mesh = model();
        if (mesh && raycaster.intersectObject(mesh).length) cursor = "crosshair";
      }
      renderer.domElement.style.cursor = cursor;
    };
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
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      disposeModel(scene);
      disposeMarkers(scene);
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

    controls.target.copy(center);
    camera.position.set(center.x + radius * 1.6, center.y - radius * 1.6, center.z + radius * 1.6);
    camera.near = radius / 100;
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }, [stlBuffer, geometry]);

  useEffect(() => {
    callbacksRef.current = { onMarkerClick, placingMode, onSurfacePick };
  }, [onMarkerClick, placingMode, onSurfacePick]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, requestRender } = sceneRef.current;

    disposeMarkers(scene);
    if (markers && markers.length) {
      const group = new THREE.Group();
      group.name = "markers";
      // One sphere geometry per distinct radius, shared by every marker
      // of that size, instead of a fresh tessellation per marker.
      const geometryByRadius = new Map();
      for (const marker of markers) {
        const radius = marker.radius ?? DEFAULT_MARKER_RADIUS;
        let geom = geometryByRadius.get(radius);
        if (!geom) {
          geom = new THREE.SphereGeometry(radius, 16, 16);
          geometryByRadius.set(radius, geom);
        }
        const sphere = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: MARKER_COLOR }));
        sphere.position.set(marker.x, marker.y, marker.z);
        sphere.userData.id = marker.id;
        group.add(sphere);
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
  return <div ref={mountRef} className="viewer-canvas" />;
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
