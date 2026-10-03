import { useEffect, useRef, useState } from "react";

/** A real 360-degree rotation, with no easing, reversal or video seam. */
export function MemorySculpture() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([
      import("three"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
    ])
      .then(([THREE, { RoomEnvironment }]) => {
        if (disposed) return;
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: "low-power",
          });
        } catch {
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.domElement.setAttribute("aria-hidden", "true");
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
        camera.position.set(0, 0.12, 5.3);
        const room = new RoomEnvironment();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const environment = pmrem.fromScene(room, 0.04);
        scene.environment = environment.texture;
        const sculpture = new THREE.Group();
        const geometry = new THREE.TorusKnotGeometry(0.78, 0.26, 144, 20, 2, 3);
        const material = new THREE.MeshPhysicalMaterial({
          color: 0xc6b8e8,
          metalness: 0.46,
          roughness: 0.19,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          transmission: 0.2,
          thickness: 0.8,
          ior: 1.42,
          envMapIntensity: 2.1,
        });
        sculpture.add(new THREE.Mesh(geometry, material));
        sculpture.rotation.z = -0.3;
        sculpture.rotation.x = 0.2;
        scene.add(sculpture);
        scene.add(new THREE.AmbientLight(0xb7aedb, 1.5));
        const key = new THREE.DirectionalLight(0xffffff, 4);
        key.position.set(-3, 4, 3);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xaca2ff, 3);
        rim.position.set(3, -1, -2);
        scene.add(rim);
        const fill = new THREE.DirectionalLight(0xaedfd2, 2);
        fill.position.set(1, 2, 2);
        scene.add(fill);
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let visible = false,
          frame = 0,
          previous = 0,
          angle = 0.4;
        const render = () => {
          sculpture.rotation.y = angle;
          renderer.render(scene, camera);
        };
        const resize = () => {
          const { width, height } = container.getBoundingClientRect();
          if (!width || !height) return;
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          render();
        };
        const tick = (time: number) => {
          frame = 0;
          if (!visible || document.hidden || motion.matches) {
            previous = 0;
            return;
          }
          if (previous)
            angle =
              (angle + (Math.min(time - previous, 100) * Math.PI * 2) / 24000) % (Math.PI * 2);
          previous = time;
          render();
          frame = requestAnimationFrame(tick);
        };
        const sync = () => {
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          previous = 0;
          if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick);
        };
        const observer = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          sync();
        });
        observer.observe(container);
        const sizeObserver = new ResizeObserver(resize);
        sizeObserver.observe(container);
        document.addEventListener("visibilitychange", sync);
        motion.addEventListener("change", sync);
        resize();
        setReady(true);
        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          sizeObserver.disconnect();
          document.removeEventListener("visibilitychange", sync);
          motion.removeEventListener("change", sync);
          geometry.dispose();
          material.dispose();
          environment.dispose();
          room.dispose();
          pmrem.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch(() => {
        /* The static sculpture remains available without WebGL. */
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return (
    <>
      <div
        ref={host}
        className={`memory-sculpture ${ready ? "is-ready" : ""}`}
        role="img"
        aria-label="Pearlescent glass memory sculpture"
      >
        <img src="/onboarding/context-crystal-poster.jpg" alt="" />
      </div>
    </>
  );
}
