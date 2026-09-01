import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export default function StlViewer({ stlBuffer }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);

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

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
