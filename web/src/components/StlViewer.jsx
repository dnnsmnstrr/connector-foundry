import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const MARKER_COLOR = 0x2ecc71;
const MARKER_HOVER_COLOR = 0xffd23f;

// markers: optional [{ id, x, y, z, radius? }] — small clickable spheres
// overlaid on the model, in the model's own mm coordinates (the Bench
// uses these for open mount slots; Library mode passes none).
// onMarkerClick(id): called when a marker is clicked.
export default function StlViewer({ stlBuffer, markers, onMarkerClick }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const markersRef = useRef(null);

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
    const onClick = (event) => {
      const markerGroup = scene.getObjectByName("markers");
      if (!markerGroup || !markerGroup.children.length) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(markerGroup.children);
      if (hits.length) markersRef.current?.onMarkerClick?.(hits[0].object.userData.id);
    };
    renderer.domElement.addEventListener("click", onClick);

    const onPointerMove = (event) => {
      const markerGroup = scene.getObjectByName("markers");
      if (!markerGroup || !markerGroup.children.length) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = new Set(raycaster.intersectObjects(markerGroup.children).map((h) => h.object));
      for (const marker of markerGroup.children) {
        marker.material.color.setHex(hits.has(marker) ? MARKER_HOVER_COLOR : MARKER_COLOR);
      }
      renderer.domElement.style.cursor = hits.size ? "pointer" : "default";
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
    if (!stlBuffer || !sceneRef.current) return;
    const { scene, camera, controls } = sceneRef.current;

    const previous = scene.getObjectByName("model");
    if (previous) {
      scene.remove(previous);
      previous.geometry.dispose();
      previous.material.dispose();
    }

    const geometry = new STLLoader().parse(stlBuffer);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({ color: 0x5b8ff9, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "model";
    scene.add(mesh);

    const bbox = geometry.boundingBox;
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
  }, [stlBuffer]);

  useEffect(() => {
    markersRef.current = { onMarkerClick };
  }, [onMarkerClick]);

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
      const geometry = new THREE.SphereGeometry(marker.radius ?? 2, 16, 16);
      const material = new THREE.MeshBasicMaterial({ color: MARKER_COLOR });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(marker.x, marker.y, marker.z);
      sphere.userData.id = marker.id;
      group.add(sphere);
    }
    scene.add(group);
  }, [markers]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
