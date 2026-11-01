import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScene, type Box, type Scene3D } from '../calc/model3d.ts';
import type { Project } from '../model/types.ts';

// Orbitable 3D model of the plan. Loaded lazily (three.js is most of its weight).
// Geometry comes from calc/model3d.ts; this file only turns it into meshes.

const CUTAWAY = 48;

function palette(dark: boolean) {
  return {
    bg: dark ? 0x151920 : 0xeef1f5,
    ext: dark ? 0xd6dbe4 : 0xf4f1ea,
    int: dark ? 0xb8c0cc : 0xffffff,
    floor: dark ? 0x6b5a45 : 0xc9b08a,
    ceiling: dark ? 0xe6e9ef : 0xfbfbfb,
    gable: dark ? 0xd6dbe4 : 0xf4f1ea,
    beam: dark ? 0xc9b08a : 0xe9dcc6,
    glass: 0x7fb3e6,
    roof: dark ? 0x5a4f4a : 0x6e5f58,
  };
}

export default function View3D({ project }: { project: Project }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<{ group: THREE.Group; fit(s: Scene3D): void } | null>(null);
  const [ceilings, setCeilings] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [showRoof, setShowRoof] = useState(true);
  const scene3d = useMemo(() => buildScene(project), [project]);
  const fitted = useRef(false);

  // One renderer per mount.
  useEffect(() => {
    const el = host.current!;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette(dark).bg);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, 1.4);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    fitted.current = false; // a fresh camera needs framing (also covers StrictMode's double mount)

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    world.current = {
      group,
      fit(s) {
        const [x0, , z0] = s.bounds.min;
        const [x1, y1, z1] = s.bounds.max;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        const r = Math.max(x1 - x0, z1 - z0, y1, 120);
        controls.target.set(cx, y1 / 3, cz);
        camera.position.set(cx - r * 0.75, r * 0.95, cz + r * 1.05);
        controls.update();
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      world.current = null;
    };
  }, []);

  // Rebuild meshes whenever the plan or view options change.
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const c = palette(dark);
    for (const child of [...w.group.children]) {
      w.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, ...extra });

    const addBox = (b: Box) => {
      let [, cy] = b.c;
      let [sx, sy, sz] = b.size;
      if (b.kind === 'beam' && !ceilings) return;
      if (cutaway && b.kind !== 'beam') {
        const y0 = cy - sy / 2;
        const y1 = Math.min(cy + sy / 2, CUTAWAY);
        if (y1 <= y0) return;
        cy = (y0 + y1) / 2;
        sy = y1 - y0;
      }
      const color = b.kind === 'wall-ext' ? c.ext : b.kind === 'wall-int' ? c.int : b.kind === 'glass' ? c.glass : c.beam;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        b.kind === 'glass' ? mat(color, { transparent: true, opacity: 0.35, roughness: 0.1 }) : mat(color),
      );
      m.position.set(b.c[0], cy, b.c[2]);
      m.rotation.y = b.rotY;
      w.group.add(m);
    };
    scene3d.boxes.forEach(addBox);

    for (const f of scene3d.flats) {
      if (f.kind === 'ceiling' && (!ceilings || cutaway)) continue;
      const shape = new THREE.Shape(f.outline.map((p) => new THREE.Vector2(p.x, p.y)));
      for (const h of f.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(f.kind === 'floor' ? c.floor : c.ceiling));
      m.rotation.x = Math.PI / 2; // shape XY → plan XZ
      m.position.y = f.y + (f.kind === 'floor' ? -0.5 : 0);
      w.group.add(m);
    }

    for (const f of scene3d.faces) {
      if (cutaway) continue;
      // Roof faces (and the roof's gable-end walls) belong to the roof toggle; the rest to ceilings.
      const isRoof = f.kind === 'roof' || f.roofPart;
      if (isRoof ? !showRoof : !ceilings) continue;
      const g = new THREE.BufferGeometry();
      const v: number[] = [];
      for (let i = 1; i < f.pts.length - 1; i++) v.push(...f.pts[0], ...f.pts[i], ...f.pts[i + 1]);
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      w.group.add(new THREE.Mesh(g, mat(f.kind === 'roof' ? c.roof : f.kind === 'gable' ? c.gable : c.ceiling)));
    }

    if (!fitted.current && scene3d.boxes.length) {
      fitted.current = true;
      w.fit(scene3d);
    }
  }, [scene3d, ceilings, cutaway, showRoof]);

  return (
    <div className="view3d">
      <div className="view3d-bar">
        <label>
          <input type="checkbox" checked={showRoof} onChange={(e) => setShowRoof(e.target.checked)} /> Roof
        </label>
        <label>
          <input type="checkbox" checked={ceilings} onChange={(e) => setCeilings(e.target.checked)} /> Ceilings
        </label>
        <label>
          <input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} /> Cut walls at 4 ft
        </label>
        <button onClick={() => world.current?.fit(scene3d)}>Reset view</button>
        <span className="muted small">Drag to orbit · right-drag to pan · scroll to zoom</span>
      </div>
      <div className="view3d-canvas" ref={host} />
      {!project.walls.length && <p className="view3d-empty muted">Draw some walls on the Plan tab first.</p>}
    </div>
  );
}
