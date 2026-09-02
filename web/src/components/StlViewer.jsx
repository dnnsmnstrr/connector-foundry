import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clusterFace } from "../lib/faceCluster.js";

const MARKER_COLOR = 0x2ecc71;
const MARKER_HOVER_COLOR = 0xffd23f;

// stlBuffer or geometry: one model source. `geometry` (a THREE.BufferGeometry,
// e.g. straight from meshValidate.js) skips a wasted serialize/reparse
// round-trip when the caller already has one parsed — the STL-import
// slot-placement view uses this.
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
export default function StlViewer({ stlBuffer, geometry, markers, onMarkerClick, placingMode, onSurfacePick }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const callbacksRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1b1e);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(80, -80, 80);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
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

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const onClick = (event) => {
      setPointer(event);

      const markerGroup = scene.getObjectByName("markers");
      if (markerGroup && markerGroup.children.length) {
        const hits = raycaster.intersectObjects(markerGroup.children);
        if (hits.length) {
          callbacksRef.current?.onMarkerClick?.(hits[0].object.userData.id);
          return;
        }
      }

      if (callbacksRef.current?.placingMode) {
        const model = scene.getObjectByName("model");
        if (!model || model.geometry.index === null) return;
        const hits = raycaster.intersectObject(model);
        if (!hits.length) return;
        const hit = hits[0];
        const cluster = clusterFace(model.geometry, hit.faceIndex);
        const point = new THREE.Vector3(...cluster.point).applyMatrix4(model.matrixWorld);
        const normal = new THREE.Vector3(...cluster.normal).transformDirection(model.matrixWorld).normalize();
        callbacksRef.current?.onSurfacePick?.([point.x, point.y, point.z], [normal.x, normal.y, normal.z]);
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    const onPointerMove = (event) => {
      setPointer(event);
      const markerGroup = scene.getObjectByName("markers");
      const hasMarkers = markerGroup && markerGroup.children.length;
      const markerHits = hasMarkers ? raycaster.intersectObjects(markerGroup.children) : [];
      if (hasMarkers) {
        const hitSet = new Set(markerHits.map((h) => h.object));
        for (const marker of markerGroup.children) {
          marker.material.color.setHex(hitSet.has(marker) ? MARKER_HOVER_COLOR : MARKER_COLOR);
        }
      }

      let cursor = "default";
      if (markerHits.length) cursor = "pointer";
      else if (callbacksRef.current?.placingMode) {
        const model = scene.getObjectByName("model");
        if (model && raycaster.intersectObject(model).length) cursor = "crosshair";
      }
      renderer.domElement.style.cursor = cursor;
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = { scene, camera, renderer, controls, mount };

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, camera, controls } = sceneRef.current;
    if (!stlBuffer && !geometry) return;

    const previous = scene.getObjectByName("model");
    if (previous) {
      scene.remove(previous);
      previous.geometry.dispose();
      previous.material.dispose();
    }

    const geom = geometry || new STLLoader().parse(stlBuffer);
    geom.computeVertexNormals();
    geom.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({ color: 0x5b8ff9, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(geom, material);
    mesh.name = "model";
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
  }, [stlBuffer, geometry]);

  useEffect(() => {
    callbacksRef.current = { onMarkerClick, placingMode, onSurfacePick };
  }, [onMarkerClick, placingMode, onSurfacePick]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene } = sceneRef.current;

    const previous = scene.getObjectByName("markers");
    if (previous) {
      scene.remove(previous);
      previous.children.forEach((m) => {
        m.geometry.dispose();
        m.material.dispose();
      });
    }

    if (!markers || !markers.length) return;
    const group = new THREE.Group();
    group.name = "markers";
    for (const marker of markers) {
      const geom = new THREE.SphereGeometry(marker.radius ?? 2, 16, 16);
      const material = new THREE.MeshBasicMaterial({ color: MARKER_COLOR });
      const sphere = new THREE.Mesh(geom, material);
      sphere.position.set(marker.x, marker.y, marker.z);
      sphere.userData.id = marker.id;
      group.add(sphere);
    }
    scene.add(group);
  }, [markers]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
